/**
 * The rules that fail silently: state mapping and reply parsing.
 *
 * A wrong state mapping marks someone's open bug "done"; a reply that fails to
 * parse simply never reaches them. Neither throws, neither logs, and neither is
 * visible from the board — which is exactly why they are pinned here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStateMap,
  collectUserReplies,
  isTerminal,
  parseUserReply,
  pickLatestUserReply,
  replyDigest,
  resolveStateMap,
  stripHtml,
  type PlaneState,
} from '../plane-state.js';

/** A default Plane project: five columns, one per group. */
const BOARD: PlaneState[] = [
  { id: 's-pending', name: 'Backlog', group: 'backlog' },
  { id: 's-todo', name: 'Todo', group: 'unstarted' },
  { id: 's-doing', name: 'Doing', group: 'started' },
  { id: 's-review', name: 'Review', group: 'started' },
  { id: 's-done', name: 'Done', group: 'completed' },
  { id: 's-fail', name: 'Cancelled', group: 'cancelled' },
];

// ─── reading: plane state id → our state ─────────────────────────

test('every column of a default board maps onto one of the five states', () => {
  const map = buildStateMap(BOARD);
  assert.equal(map.get('s-pending'), 'pending');
  assert.equal(map.get('s-todo'), 'pending');
  assert.equal(map.get('s-doing'), 'doing');
  assert.equal(map.get('s-review'), 'review');
  assert.equal(map.get('s-done'), 'done');
  assert.equal(map.get('s-fail'), 'fail');
});

test('name beats group — "Review" stays review even though Plane calls it started', () => {
  const map = buildStateMap(BOARD);
  assert.equal(map.get('s-review'), 'review');
  assert.notEqual(map.get('s-review'), 'doing');
});

test('a renamed column still maps, via its group', () => {
  const map = buildStateMap([{ id: 'x', name: 'In progress', group: 'started' }]);
  assert.equal(map.get('x'), 'doing');
});

test('an unknown column maps to NOTHING rather than to a guess', () => {
  const map = buildStateMap([{ id: 'blocked', name: 'Blocked', group: 'weird' }]);
  assert.equal(map.get('blocked'), undefined);
});

test('a board that answers with nothing maps nothing — no id is ever assumed', () => {
  assert.equal(buildStateMap([]).size, 0);
});

test('only done and fail are terminal', () => {
  assert.equal(isTerminal('done'), true);
  assert.equal(isTerminal('fail'), true);
  assert.equal(isTerminal('review'), false);
  assert.equal(isTerminal('pending'), false);
});

// ─── writing: our state → a plane state id ───────────────────────

test('a default board resolves all five states from its groups', () => {
  const result = resolveStateMap(BOARD);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    pending: 's-todo',
    doing: 's-doing',
    review: 's-review',
    done: 's-done',
    fail: 's-fail',
  });
});

test('unstarted wins over backlog for pending — a new report is queued, not shelved', () => {
  const result = resolveStateMap(BOARD);
  assert.equal(result.ok && result.value.pending, 's-todo');
});

test('doing never resolves to the Review column just because both are started', () => {
  const result = resolveStateMap([
    { id: 'a', name: 'Todo', group: 'unstarted' },
    { id: 'b', name: 'In review', group: 'started' },
    { id: 'c', name: 'In progress', group: 'started' },
    { id: 'd', name: 'Shipped', group: 'completed' },
    { id: 'e', name: 'Wontfix', group: 'cancelled' },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.doing, 'c');
  assert.equal(result.value.review, 'b');
});

test('a board with no review column maps review onto doing rather than failing', () => {
  const result = resolveStateMap([
    { id: 'a', name: 'Todo', group: 'unstarted' },
    { id: 'b', name: 'In progress', group: 'started' },
    { id: 'c', name: 'Done', group: 'completed' },
    { id: 'd', name: 'Cancelled', group: 'cancelled' },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.review, 'b');
});

test('a missing group is reported by name, not silently guessed', () => {
  const result = resolveStateMap([
    { id: 'a', name: 'Todo', group: 'unstarted' },
    { id: 'b', name: 'In progress', group: 'started' },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.missing, ['done', 'fail']);
});

test('an override wins over anything discovered on the board', () => {
  const result = resolveStateMap(BOARD, { done: 'forced-done' });
  assert.equal(result.ok && result.value.done, 'forced-done');
});

test('an override supplies a state the board has no column for', () => {
  const result = resolveStateMap(
    [
      { id: 'a', name: 'Todo', group: 'unstarted' },
      { id: 'b', name: 'In progress', group: 'started' },
      { id: 'c', name: 'Done', group: 'completed' },
    ],
    { fail: 'forced-fail' },
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.fail, 'forced-fail');
});

// ─── replies ─────────────────────────────────────────────────────

test('paragraphs become newlines, not a run-on sentence', () => {
  assert.equal(stripHtml('<p>one</p><p>two</p>'), 'one\ntwo');
  assert.equal(stripHtml('a<br />b'), 'a\nb');
});

test('entities decode, and an escaped tag stays text', () => {
  assert.equal(stripHtml('<p>a &amp; b</p>'), 'a & b');
  assert.equal(stripHtml('<p>&lt;p&gt;</p>'), '<p>');
});

test('an @user comment becomes a reply with the marker removed', () => {
  assert.equal(parseUserReply('<p>@user Fixed, please reload the page.</p>'), 'Fixed, please reload the page.');
});

test('a bolded marker still counts — it was still meant', () => {
  assert.equal(parseUserReply('<p><strong>@user</strong> all done</p>'), 'all done');
});

test('a colon or dash after the marker is punctuation, not content', () => {
  assert.equal(parseUserReply('<p>@user: done</p>'), 'done');
  assert.equal(parseUserReply('<p>@user - done</p>'), 'done');
});

test('an internal comment is not a reply', () => {
  assert.equal(parseUserReply('<p>team B hit this too, check their account</p>'), null);
});

test('a comment that merely mentions @user later is not a reply', () => {
  assert.equal(parseUserReply('<p>ask @user whether it repeats</p>'), null);
});

test('a bare marker is a mis-send, not an empty reply', () => {
  assert.equal(parseUserReply('<p>@user</p>'), null);
  assert.equal(parseUserReply('<p>@user   </p>'), null);
});

test('missing html is not a reply', () => {
  assert.equal(parseUserReply(null), null);
  assert.equal(parseUserReply(undefined), null);
  assert.equal(parseUserReply(''), null);
});

test('the NEWEST @user comment wins, whatever order the list arrives in', () => {
  const reply = pickLatestUserReply([
    { comment_html: '<p>@user old one</p>', created_at: '2026-08-01T00:00:00Z' },
    { comment_html: '<p>internal</p>', created_at: '2026-08-05T00:00:00Z' },
    { comment_html: '<p>@user new one</p>', created_at: '2026-08-03T00:00:00Z' },
  ]);
  assert.equal(reply?.text, 'new one');
  assert.equal(reply?.at?.toISOString(), '2026-08-03T00:00:00.000Z');
});

test('a comment with no timestamp is still readable', () => {
  const reply = pickLatestUserReply([{ comment_html: '<p>@user done</p>' }]);
  assert.equal(reply?.text, 'done');
  assert.equal(reply?.at, null);
});

test('no @user comment means no reply', () => {
  assert.equal(pickLatestUserReply([{ comment_html: '<p>internal</p>' }]), null);
  assert.equal(pickLatestUserReply([]), null);
});

test('the digest changes when the wording changes — an edited reply re-notifies', () => {
  assert.equal(replyDigest('done'), replyDigest('done'));
  assert.notEqual(replyDigest('done'), replyDigest('all done'));
  assert.match(replyDigest('done'), /^[0-9a-f]{8}$/);
});

test('replies come back oldest first even though Plane lists them newest first', () => {
  // `GET /issues/{id}/comments/` answers NEWEST FIRST. Trusting list order
  // would render the answer above the question it answers — and it would look
  // fine.
  const asPlaneReturnsThem = [
    {
      id: 'c3b713f3',
      created_at: '2026-08-26T17:03:04.873634Z',
      comment_html: '<p><strong>@user</strong> Fixed, please check.</p>',
    },
    {
      id: 'dc6368de',
      created_at: '2026-08-26T17:03:01.476597Z',
      comment_html: '<p><em>Reporter said:</em></p><p>another screen is broken too</p>',
    },
    {
      id: 'ffbc991a',
      created_at: '2026-08-26T17:02:57.962776Z',
      comment_html: '<p>@user Looking into it, one moment.</p>',
    },
    {
      id: '928a0b8f',
      created_at: '2026-08-26T17:02:54.529187Z',
      comment_html: '<p>internal: team B is affected as well, do not show the user</p>',
    },
  ];

  const replies = collectUserReplies(asPlaneReturnsThem);

  assert.deepEqual(
    replies.map((reply) => reply.text),
    ['Looking into it, one moment.', 'Fixed, please check.'],
  );
  // Every comment carries an id — that is what makes dedupe by id possible at
  // all, and the only reason the sync can re-read the list every five minutes
  // without appending the same reply again.
  assert.deepEqual(
    replies.map((reply) => reply.commentId),
    ['ffbc991a', 'c3b713f3'],
  );
  // The internal comment and our own posted comment are both correctly absent.
  assert.equal(replies.length, 2);
});
