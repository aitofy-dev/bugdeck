/**
 * Reply parsing, the other rule that fails silently: a reply that does not
 * parse simply never reaches the person waiting for it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TrackerComment } from '../../../tracker.js';
import {
  collectUserReplies,
  parseUserReply,
  pickLatestUserReply,
  replyDigest,
  stripHtml,
} from '../reply.js';

/** A tracker comment as the adapter hands it over, wire shape already mapped. */
function comment(html: string, createdAt?: string, commentId: string | null = null): TrackerComment {
  return { commentId, html, createdAt: createdAt ? new Date(createdAt) : null };
}


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
    comment('<p>@user old one</p>', '2026-08-01T00:00:00Z'),
    comment('<p>internal</p>', '2026-08-05T00:00:00Z'),
    comment('<p>@user new one</p>', '2026-08-03T00:00:00Z'),
  ]);
  assert.equal(reply?.text, 'new one');
  assert.equal(reply?.at?.toISOString(), '2026-08-03T00:00:00.000Z');
});

test('a comment with no timestamp is still readable', () => {
  const reply = pickLatestUserReply([comment('<p>@user done</p>')]);
  assert.equal(reply?.text, 'done');
  assert.equal(reply?.at, null);
});

test('no @user comment means no reply', () => {
  assert.equal(pickLatestUserReply([comment('<p>internal</p>')]), null);
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
    comment('<p><strong>@user</strong> Fixed, please check.</p>', '2026-08-26T17:03:04.873Z', 'c3b713f3'),
    comment('<p><em>Reporter said:</em></p><p>another screen is broken too</p>', '2026-08-26T17:03:01.476Z', 'dc6368de'),
    comment('<p>@user Looking into it, one moment.</p>', '2026-08-26T17:02:57.962Z', 'ffbc991a'),
    comment('<p>internal: team B is affected as well, do not show the user</p>', '2026-08-26T17:02:54.529Z', '928a0b8f'),
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
