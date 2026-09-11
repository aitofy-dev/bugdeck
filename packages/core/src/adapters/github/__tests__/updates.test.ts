/**
 * The read side: what a repo's issues mean for a reporter's badge.
 *
 * GitHub has two booleans where we have five states, so the mapping is the
 * part that fails silently — a `closed` read as `done` when the maintainer
 * meant "not planned" tells the reporter their bug was fixed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { silentLogger, type TrackerUpdate } from '../../../tracker.js';
import { resolveHttp } from '../client.js';
import { markerFor } from '../markdown.js';
import { mapIssueState, readUpdates, type GithubIssueRow } from '../updates.js';
import { CONFIG, fakeGithub, linkNext, type Route } from './fake-github.js';

const SINCE = new Date('2024-05-01T00:00:00.000Z');

const marked = (over: Partial<GithubIssueRow> = {}): GithubIssueRow => ({
  number: 1,
  body: `a report ${markerFor('report-1')}`,
  state: 'open',
  updated_at: '2024-05-02T10:00:00Z',
  comments: 0,
  ...over,
});

async function collect(routes: Record<string, Route>, over: Record<string, unknown> = {}) {
  const github = fakeGithub(routes);
  const sleeps: number[] = [];
  const http = resolveHttp({
    ...CONFIG,
    fetch: github.impl,
    logger: silentLogger,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    ...over,
  });
  const updates: TrackerUpdate[] = [];
  for await (const update of readUpdates(http, SINCE)) updates.push(update);
  return { updates, calls: github.calls, sleeps };
}

// ─── what is read ────────────────────────────────────────────────

test('every page of the Link header is followed', async () => {
  let page = 0;
  const { updates, calls } = await collect({
    'GET /issues': () => {
      page += 1;
      if (page === 1) {
        return [
          200,
          [marked({ number: 1 })],
          linkNext('https://api.github.com/repos/acme/app/issues?page=2'),
        ];
      }
      return [200, [marked({ number: 2 })]];
    },
  });

  assert.deepEqual(
    updates.map((update) => update.externalId),
    ['1', '2'],
  );
  assert.equal(calls.length, 2);
  // `since` and our label are what keep this to the repo's bugdeck issues.
  assert.ok(calls[0].url.includes(`since=${encodeURIComponent(SINCE.toISOString())}`));
  assert.ok(calls[0].url.includes('labels=bugdeck'));
  assert.ok(calls[0].url.includes('state=all'));
});

test('issues nobody filed through us are left alone', async () => {
  const { updates } = await collect({
    'GET /issues': () => [
      200,
      [
        marked({ number: 1 }),
        { number: 2, body: 'a human filed this', state: 'open' },
        marked({ number: 3, pull_request: { url: 'x' } }),
      ],
    ],
  });

  assert.deepEqual(
    updates.map((update) => update.externalId),
    ['1'],
  );
});

test('an unconfigured GitHub is skipped, not polled', async () => {
  const { calls } = await collect({}, { token: '' });
  assert.equal(calls.length, 0);
});

// ─── state ───────────────────────────────────────────────────────

test('open is doing, closed is done, not planned is fail', () => {
  assert.equal(mapIssueState({ number: 1, state: 'open' }), 'doing');
  assert.equal(mapIssueState({ number: 1, state: 'closed', state_reason: 'completed' }), 'done');
  assert.equal(mapIssueState({ number: 1, state: 'closed', state_reason: null }), 'done');
  assert.equal(mapIssueState({ number: 1, state: 'closed', state_reason: 'not_planned' }), 'fail');
  assert.equal(mapIssueState({ number: 1 }), undefined);
});

test('a state label overrides open and closed alike', () => {
  const pending = { number: 1, state: 'open', labels: [{ name: 'Pending' }] };
  assert.equal(mapIssueState(pending), 'pending');
  const review = { number: 1, state: 'closed', labels: ['review'] };
  assert.equal(mapIssueState(review), 'review');
  // The operator's own label names win over the defaults.
  assert.equal(mapIssueState({ ...review }, { review: 'needs-qa' }), 'done');
  assert.equal(
    mapIssueState({ number: 1, state: 'open', labels: ['needs-qa'] }, { review: 'needs-qa' }),
    'review',
  );
});

test('the state travels with the update', async () => {
  const { updates } = await collect({
    'GET /issues': () => [
      200,
      [marked({ number: 5, state: 'closed', state_reason: 'not_planned' })],
    ],
  });
  assert.equal(updates[0].state, 'fail');
  assert.deepEqual(updates[0].updatedAt, new Date('2024-05-02T10:00:00Z'));
});

// ─── comments ────────────────────────────────────────────────────

test('comments come back as Markdown with their author', async () => {
  const { updates, calls } = await collect({
    'GET /issues': () => [200, [marked({ comments: 2 })]],
    'GET /comments': () => [
      200,
      [
        {
          id: 99,
          body: '@user fixed in 1.2.0',
          created_at: '2024-05-02T09:00:00Z',
          user: { login: 'maintainer' },
        },
        { id: 100, body: 'internal note', created_at: 'not a date' },
      ],
    ],
  });

  assert.deepEqual(updates[0].comments, [
    {
      commentId: '99',
      html: '@user fixed in 1.2.0',
      createdAt: new Date('2024-05-02T09:00:00Z'),
      author: 'maintainer',
    },
    { commentId: '100', html: 'internal note', createdAt: null },
  ]);
  assert.ok(calls[1].url.includes(`since=${encodeURIComponent(SINCE.toISOString())}`));
});

test('an issue with no comments costs no request', async () => {
  const { updates, calls } = await collect({ 'GET /issues': () => [200, [marked()]] });
  assert.deepEqual(updates[0].comments, []);
  assert.equal(calls.length, 1);
});

test('unreadable comments read as not read, never as no replies', async () => {
  const { updates, sleeps } = await collect({
    'GET /issues': () => [200, [marked({ comments: 1 })]],
    'GET /comments': () => [500, { message: 'boom' }],
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].comments, undefined);
  assert.equal(updates[0].state, 'doing');
  assert.deepEqual(sleeps, [500, 1500]);
});
