/**
 * Reading the board, and deciding what it means.
 *
 * What is worth pinning is not "does it copy a string" but the refusals: it
 * must not write a state it could not map, must not touch a report whose issue
 * was deleted, and must not lose the live board's pass to a legacy board it
 * cannot read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { silentLogger, type TrackerComment, type TrackerUpdate } from '../../../tracker.js';
import { createPlaneTracker, decideReportPatch, shouldReadComments, type SyncCandidate } from '../index.js';
import { CONFIG } from './fake-plane.js';

const STATES = [
  { id: 's-todo', name: 'Todo', group: 'unstarted' },
  { id: 's-doing', name: 'Doing', group: 'started' },
  { id: 's-done', name: 'Done', group: 'completed' },
];

const EPOCH = new Date(0);
const NOW = new Date('2026-08-26T12:00:00Z');

interface Board {
  states?: unknown[];
  issues?: unknown[];
  comments?: unknown[];
}

/** Answers the three list endpoints the poller uses, and records the URLs. */
function board(rows: Board) {
  const urls: string[] = [];
  const impl: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    const results = url.includes('/comments/')
      ? (rows.comments ?? [])
      : url.includes('/states/')
        ? (rows.states ?? STATES)
        : (rows.issues ?? []);
    return new Response(JSON.stringify({ results, next_page_results: false }), { status: 200 });
  };
  return { impl, urls };
}

function poll(fetchImpl: typeof fetch, over: Record<string, unknown> = {}) {
  return createPlaneTracker({ ...CONFIG, fetch: fetchImpl, logger: silentLogger, ...over });
}

async function collect(updates?: AsyncIterable<TrackerUpdate>): Promise<TrackerUpdate[]> {
  assert.ok(updates, 'the Plane adapter must offer listUpdates');
  const out: TrackerUpdate[] = [];
  for await (const one of updates) out.push(one);
  return out;
}

// ─── reading ─────────────────────────────────────────────────────

test('the list request asks for a full page, not Plane’s default of 12', async () => {
  const plane = board({ issues: [{ id: 'i1', state: 's-doing' }] });
  await collect(poll(plane.impl).listUpdates?.(EPOCH));

  assert.ok(
    plane.urls.every((url) => url.includes('per_page=100')),
    plane.urls.join('\n'),
  );
});

test('a column we can map arrives as one of our five', async () => {
  const plane = board({ issues: [{ id: 'i1', state: 's-doing', updated_at: '2026-08-26T10:00:00Z' }] });
  const [update] = await collect(poll(plane.impl).listUpdates?.(EPOCH));

  assert.equal(update.externalId, 'i1');
  assert.equal(update.state, 'doing');
  assert.equal(update.updatedAt?.toISOString(), '2026-08-26T10:00:00.000Z');
});

test('a column we cannot map arrives with NO state rather than a guess', async () => {
  const plane = board({
    states: [{ id: 'blocked', name: 'Blocked', group: 'mystery' }],
    issues: [{ id: 'i1', state: 'blocked' }],
  });
  const [update] = await collect(poll(plane.impl).listUpdates?.(EPOCH));

  assert.equal(update.state, undefined);
});

test('an issue untouched since our last look costs no comment request', async () => {
  const plane = board({
    issues: [{ id: 'i1', state: 's-doing', updated_at: '2026-08-26T10:00:00Z' }],
    comments: [{ comment_html: '<p>@user should not be read</p>' }],
  });
  const updates = await collect(
    poll(plane.impl).listUpdates?.(new Date('2026-08-26T12:00:00Z')),
  );

  // Posting a comment bumps `updated_at`, so an unchanged issue cannot be
  // hiding a new reply.
  assert.equal(updates.length, 0);
  assert.ok(!plane.urls.some((url) => url.includes('/comments/')), plane.urls.join('\n'));
});

test('comments arrive with their id and time, however Plane spells them', async () => {
  const plane = board({
    issues: [{ id: 'i1', state: 's-doing' }],
    comments: [
      { id: 'c2', comment_html: '<p>@user Fixed.</p>', created_at: '2026-08-26T11:00:00Z' },
      { id: 'c1', comment_html: '<p>internal</p>', created_at: 'not a date' },
    ],
  });
  const [update] = await collect(poll(plane.impl).listUpdates?.(EPOCH));

  assert.deepEqual(update.comments, [
    { commentId: 'c2', html: '<p>@user Fixed.</p>', createdAt: new Date('2026-08-26T11:00:00Z') },
    { commentId: 'c1', html: '<p>internal</p>', createdAt: null },
  ]);
});

test('a comments endpoint that 500s costs the reply, not the state change', async () => {
  const impl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/comments/')) return new Response('boom', { status: 500 });
    const results = url.includes('/states/') ? STATES : [{ id: 'i1', state: 's-doing' }];
    return new Response(JSON.stringify({ results, next_page_results: false }), { status: 200 });
  };
  const [update] = await collect(poll(impl, { sleep: async () => {} }).listUpdates?.(EPOCH));

  assert.equal(update.state, 'doing');
  // Absent, never `[]`: "could not read" must not look like "no replies".
  assert.equal(update.comments, undefined);
});

test('an unconfigured Plane is polled not at all', async () => {
  const plane = board({ issues: [{ id: 'i1', state: 's-doing' }] });
  const updates = await collect(poll(plane.impl, { apiKey: '' }).listUpdates?.(EPOCH));

  assert.equal(updates.length, 0);
  assert.equal(plane.urls.length, 0);
});

// ─── the board reports used to live on ───────────────────────────

/** Routes by which project the URL names, so a board can be empty or broken. */
function twoBoards(rows: Record<string, unknown[]>): typeof fetch {
  return async (input) => {
    const url = String(input);
    const project = url.includes('/projects/old/') ? 'old' : 'proj-1';
    if (url.includes('/states/')) {
      return Response.json({ results: STATES, next_page_results: false });
    }
    const key = url.includes('/comments/') ? `${project}:comments` : `${project}:issues`;
    if (rows[key] === undefined && key.endsWith(':issues')) {
      return new Response('boom', { status: 500 });
    }
    return Response.json({ results: rows[key] ?? [], next_page_results: false });
  };
}

test('an issue left behind on the old board is still read, from the old board', async () => {
  const impl = twoBoards({
    'proj-1:issues': [],
    'old:issues': [{ id: 'i1', state: 's-doing' }],
    'old:comments': [{ id: 'c1', comment_html: '<p>@user Fixed.</p>' }],
  });
  const [update] = await collect(
    poll(impl, { legacyProjectIds: ['old'] }).listUpdates?.(EPOCH),
  );

  // Every workitem path is project-scoped, comments included: asking the new
  // project for a legacy issue's comments answers 404 and the reply is lost.
  assert.equal(update.externalId, 'i1');
  assert.equal(update.comments?.[0].commentId, 'c1');
});

test('an unreadable old board does not cost the live board its pass', async () => {
  const impl = twoBoards({ 'proj-1:issues': [{ id: 'i1', state: 's-doing' }] });
  const updates = await collect(
    poll(impl, { legacyProjectIds: ['old'], sleep: async () => {} }).listUpdates?.(EPOCH),
  );

  assert.equal(updates.length, 1);
  assert.equal(updates[0].state, 'doing');
});

// ─── deciding ────────────────────────────────────────────────────

const candidate = (over: Partial<SyncCandidate> = {}): SyncCandidate => ({
  reportId: 'r1',
  externalId: 'i1',
  state: 'pending',
  publicReply: null,
  syncedAt: null,
  thread: [],
  ...over,
});

const update = (over: Partial<TrackerUpdate> = {}): TrackerUpdate => ({
  externalId: 'i1',
  updatedAt: NOW,
  ...over,
});

const said = (html: string, at?: string, commentId: string | null = null): TrackerComment => ({
  commentId,
  html,
  createdAt: at ? new Date(at) : null,
});

test('a moved issue moves the report', () => {
  const decision = decideReportPatch(candidate(), update({ state: 'doing' }), NOW);
  assert.equal(decision.stateChanged, true);
  assert.equal(decision.patch?.state, 'doing');
  assert.equal(decision.patch?.syncedAt, NOW);
});

test('an unchanged issue still gets stamped, so "we looked" is recorded', () => {
  const decision = decideReportPatch(candidate(), update({ state: 'pending' }), NOW);
  assert.equal(decision.stateChanged, false);
  assert.equal(decision.patch?.state, undefined);
  assert.equal(decision.patch?.syncedAt, NOW);
});

test('a state we cannot map leaves the badge alone', () => {
  const decision = decideReportPatch(candidate(), update(), NOW);
  assert.equal(decision.unmapped, true);
  assert.equal(decision.patch?.state, undefined);
});

test('a deleted issue does not touch the report at all', () => {
  const decision = decideReportPatch(candidate(), undefined, NOW);
  assert.equal(decision.orphaned, true);
  assert.equal(decision.patch, undefined);
});

test('an @user comment becomes the public reply and a thread turn', () => {
  const decision = decideReportPatch(
    candidate(),
    update({
      state: 'pending',
      comments: [
        said('<p>internal: ask team B</p>', '2026-08-26T10:00:00Z', 'c0'),
        said('<p>@user Fixed, please check.</p>', '2026-08-26T11:00:00Z', 'c1'),
      ],
    }),
    NOW,
  );

  assert.equal(decision.replyChanged, true);
  assert.equal(decision.patch?.publicReply, 'Fixed, please check.');
  assert.equal(decision.patch?.publicReplyAt?.toISOString(), '2026-08-26T11:00:00.000Z');
  assert.equal(decision.threadAdded, 1);
  assert.deepEqual(decision.patch?.appendThread?.map((entry) => entry.source), ['admin']);
});

test('the same reply on the next pass writes nothing', () => {
  const decision = decideReportPatch(
    candidate({
      publicReply: 'Fixed, please check.',
      thread: [
        {
          source: 'admin',
          text: 'Fixed, please check.',
          at: new Date('2026-08-26T11:00:00Z'),
          commentId: 'c1',
        },
      ],
    }),
    update({ state: 'pending', comments: [said('<p>@user Fixed, please check.</p>', '2026-08-26T11:00:00Z', 'c1')] }),
    NOW,
  );

  // The pass runs every few minutes. Without the id match this reply would be
  // re-appended forever, and nothing anywhere would report an error.
  assert.equal(decision.threadAdded, 0);
  assert.equal(decision.patch?.appendThread, undefined);
  assert.equal(decision.replyChanged, false);
});

test('the reporter’s own comments never come back as admin turns', () => {
  const decision = decideReportPatch(
    candidate(),
    update({
      state: 'pending',
      comments: [said('<p><em>Reporter said:</em></p><p>still broken</p>', '2026-08-26T11:00:00Z', 'c1')],
    }),
    NOW,
  );

  assert.equal(decision.threadAdded, 0);
  assert.equal(decision.patch?.publicReply, undefined);
});

test('comments that were not read are not mistaken for no replies', () => {
  const decision = decideReportPatch(candidate({ publicReply: 'earlier' }), update({ state: 'doing' }), NOW);
  assert.equal(decision.replyChanged, false);
  assert.equal(decision.patch?.publicReply, undefined);
});

test('an unreadable updated_at reads as changed — a missed reply is worse than a wasted call', () => {
  const seen = candidate({ syncedAt: new Date('2026-08-26T12:00:00Z') });
  assert.equal(shouldReadComments(seen, { updatedAt: null }), true);
  assert.equal(shouldReadComments(seen, { updatedAt: new Date('2026-08-26T13:00:00Z') }), true);
  assert.equal(shouldReadComments(seen, { updatedAt: new Date('2026-08-26T11:00:00Z') }), false);
  assert.equal(shouldReadComments(candidate(), { updatedAt: new Date('2020-01-01') }), true);
});
