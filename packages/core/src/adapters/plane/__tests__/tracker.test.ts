/**
 * The write side of the adapter, with Plane faked.
 *
 * Three things are pinned because all three are silent when wrong: a second run
 * never mints a second workitem, a transient Plane is retried while a rejected
 * payload is not, and the `DEMO-{n}` code is READ off the project rather than
 * assumed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { silentLogger, type CreateIssueJob } from '../../../tracker.js';
import { createPlaneTracker, updateIssue } from '../index.js';
import { resolveHttp } from '../client.js';
import { CONFIG, fakePlane, OK_PROJECT, OK_STATES, png } from './fake-plane.js';

function job(over: Partial<CreateIssueJob> = {}): CreateIssueJob {
  return {
    title: 'The Send button does nothing',
    descriptionHtml: '<p>The Send button does nothing</p>',
    externalSource: 'bugdeck',
    externalId: 'report-1',
    images: [],
    ...over,
  };
}

function tracker(fetchImpl: typeof fetch, over: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  const config = {
    ...CONFIG,
    fetch: fetchImpl,
    logger: silentLogger,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    ...over,
  };
  return { tracker: createPlaneTracker(config), config, sleeps };
}

// ─── the happy path ──────────────────────────────────────────────

test('one report becomes one workitem and a code read off the project', async () => {
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => [201, { id: 'issue-1', sequence_id: 42 }],
  });
  const { tracker: plaine } = tracker(plane.impl);

  const out = await plaine.createIssue(job());
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.value, { externalId: 'issue-1', code: 'DEMO-42' });

  const create = plane.calls.find((call) => call.method === 'POST');
  const body = create?.body as Record<string, unknown>;
  // The second idempotency layer; losing it loses the 409 guard.
  assert.equal(body.external_id, 'report-1');
  assert.equal(body.external_source, 'bugdeck');
  // The column is discovered, never a hardcoded uuid.
  assert.equal(body.state, 's-todo');
  assert.ok(String(body.description_html).startsWith('<p>'));
});

test('a board with no usable columns still files the report, in Plane default', async () => {
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': () => [200, { results: [], next_page_results: false }],
    'POST /issues/': () => [201, { id: 'issue-1', sequence_id: 1 }],
  });
  const { tracker: plaine } = tracker(plane.impl);

  assert.equal((await plaine.createIssue(job())).ok, true);
  const body = plane.calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>;
  assert.equal(body.state, undefined);
});

test('an explicit state map overrides what the board says', async () => {
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => [201, { id: 'issue-1', sequence_id: 1 }],
  });
  const { tracker: plaine } = tracker(plane.impl, { stateMap: { pending: 'forced' } });

  await plaine.createIssue(job());
  const body = plane.calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>;
  assert.equal(body.state, 'forced');
});

test('an unconfigured Plane is a refusal, not a crash and not a request', async () => {
  const plane = fakePlane({});
  const { tracker: plaine } = tracker(plane.impl, { apiKey: '' });

  const out = await plaine.createIssue(job());
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.error.retryable, false);
  assert.equal(plane.calls.length, 0);
});

// ─── idempotency ─────────────────────────────────────────────────

test('a duplicate create is adopted, not duplicated', async () => {
  let creates = 0;
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => {
      creates++;
      return [409, { error: 'Issue with the same external id already exists', id: 'issue-old' }];
    },
    'GET /issues/issue-old/': () => [200, { id: 'issue-old', sequence_id: 7 }],
  });
  const { tracker: plaine, sleeps } = tracker(plane.impl);

  const out = await plaine.createIssue(job());
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.value, { externalId: 'issue-old', code: 'DEMO-7' });
  // A 409 is an answer, not a hiccup: retrying it would just 409 again.
  assert.equal(creates, 1);
  assert.deepEqual(sleeps, []);
});

// ─── retries ─────────────────────────────────────────────────────

test('a flaky Plane gets three tries with growing backoff', async () => {
  let attempts = 0;
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => {
      attempts++;
      return attempts < 3 ? [502, { error: 'bad gateway' }] : [201, { id: 'i', sequence_id: 3 }];
    },
  });
  const { tracker: plaine, sleeps } = tracker(plane.impl);

  assert.equal((await plaine.createIssue(job())).ok, true);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [500, 1500]);
});

test('a rejected payload is asked exactly once — the answer will not change', async () => {
  let attempts = 0;
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => {
      attempts++;
      return [400, { name: ['This field is required.'] }];
    },
  });
  const { tracker: plaine, sleeps } = tracker(plane.impl);

  const out = await plaine.createIssue(job());
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.error.status, 400);
  assert.equal(out.error.retryable, false);
  assert.match(out.error.message, /plane http 400/);
  assert.equal(attempts, 1);
  assert.deepEqual(sleeps, []);
});

test('four failures in a row still stop at three, and say "try again"', async () => {
  let attempts = 0;
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => {
      attempts++;
      return [500, { error: 'nope' }];
    },
  });
  const { tracker: plaine } = tracker(plane.impl);

  const out = await plaine.createIssue(job());
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.error.retryable, true);
  assert.equal(attempts, 3);
});

// ─── comments ────────────────────────────────────────────────────

test('a comment goes up as raw comment_html and comes back with its id', async () => {
  const plane = fakePlane({
    'POST /issues/issue-1/comments/': () => [201, { id: 'c1' }],
  });
  const { tracker: plaine } = tracker(plane.impl);

  const out = await plaine.addComment('issue-1', '<p><em>Reporter said:</em></p><p>still broken</p>');
  assert.equal(out.ok, true);
  if (!out.ok) return;
  // The id is the caller's idempotency guard: without storing it, a retry posts
  // the same note twice and the admin reads it as two messages.
  assert.equal(out.value.commentId, 'c1');
  const body = plane.calls[0].body as { comment_html: string };
  assert.equal(body.comment_html, '<p><em>Reporter said:</em></p><p>still broken</p>');
});

test('a comment Plane accepts without an id is reported, not assumed lost', async () => {
  const plane = fakePlane({ 'POST /issues/issue-1/comments/': () => [201, {}] });
  const { tracker: plaine } = tracker(plane.impl);

  const out = await plaine.addComment('issue-1', '<p>hi</p>');
  assert.equal(out.ok, false);
});

// ─── editing an existing issue ───────────────────────────────────

test('an edit PATCHes the description AND the title, and posts no comment', async () => {
  const plane = fakePlane({
    'GET /issues/issue-1/issue-attachments/': () => [200, []],
    'PATCH /issues/issue-1/': () => [200, {}],
  });
  const { config } = tracker(plane.impl);

  const out = await updateIssue(
    config,
    'issue-1',
    { title: 'renamed', descriptionHtml: '<p>renamed</p>', images: [] },
    resolveHttp(config),
  );
  assert.equal(out.ok, true);
  const patch = plane.calls.find((call) => call.method === 'PATCH');
  const body = patch?.body as { name?: string; description_html?: string };
  // The title is derived from the description; leaving it behind would name the
  // workitem after a sentence that no longer exists anywhere.
  assert.equal(body.name, 'renamed');
  assert.equal(body.description_html, '<p>renamed</p>');
  // A typo fix must never ping the admin.
  assert.ok(!plane.calls.some((call) => call.url.includes('/comments/')));
});

test('an edit does not re-upload a screenshot the issue already has', async () => {
  const plane = fakePlane({
    // A BARE array, which is what Plane answers here.
    'GET /issues/issue-1/issue-attachments/': () => [
      200,
      [{ id: 'plane-0', attributes: { name: 'feedback-a1.png' } }],
    ],
    'PATCH /issues/issue-1/': () => [200, {}],
  });
  const { config } = tracker(plane.impl);

  await updateIssue(
    config,
    'issue-1',
    { title: 't', descriptionHtml: '<p>t</p>', images: [png([1])] },
    resolveHttp(config),
  );
  assert.equal(
    plane.calls.filter((call) => call.method === 'POST' && call.url.includes('/issue-attachments/'))
      .length,
    0,
  );
});
