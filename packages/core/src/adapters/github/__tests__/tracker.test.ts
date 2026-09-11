/**
 * The write side of the adapter, with GitHub faked.
 *
 * Three things are pinned because all three are silent when wrong: a second
 * run never files a second issue (GitHub has no `external_id`, so the marker
 * is the whole dedupe), a rate-limited GitHub is retried when it says when
 * while a rejected payload is not, and the issue body carries the marker even
 * when the body came from someone else's renderer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { silentLogger, type CreateIssueJob } from '../../../tracker.js';
import { createGithubTracker } from '../index.js';
import { githubBody, markerFor } from '../markdown.js';
import { bodyInput, CONFIG, fakeGithub, NO_RECENT_ISSUES, NO_SEARCH_HIT, type Route } from './fake-github.js';

function job(over: Partial<CreateIssueJob> = {}): CreateIssueJob {
  return {
    title: 'The Send button does nothing',
    descriptionHtml: 'The Send button does nothing',
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
  return { tracker: createGithubTracker(config), sleeps };
}

const CREATED: Route = () => [201, { number: 7 }];

// ─── the happy path ──────────────────────────────────────────────

test('one report becomes one issue carrying the marker', async () => {
  const github = fakeGithub({
    'GET /search/issues': NO_SEARCH_HIT,
    'GET /issues': NO_RECENT_ISSUES,
    'POST /issues': CREATED,
  });
  const { tracker: hub } = tracker(github.impl);

  const out = await hub.createIssue(job());
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.value, { externalId: '7', code: '#7' });

  const create = github.calls.find((call) => call.method === 'POST');
  const body = create?.body as Record<string, unknown>;
  assert.equal(body.title, 'The Send button does nothing');
  // The whole idempotency key; losing it files a second issue on every retry.
  assert.ok(String(body.body).endsWith(markerFor('report-1')));
  assert.deepEqual(body.labels, ['bugdeck']);
  assert.equal(create?.headers.Authorization, 'Bearer ghp_test');
  assert.equal(create?.headers.Accept, 'application/vnd.github+json');
  assert.equal(create?.headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('the search query asks for the marker in the body of this repo', async () => {
  const github = fakeGithub({
    'GET /search/issues': NO_SEARCH_HIT,
    'GET /issues': NO_RECENT_ISSUES,
    'POST /issues': CREATED,
  });
  await tracker(github.impl).tracker.createIssue(job());

  const search = github.calls[0].url;
  assert.equal(
    decodeURIComponent(search.split('q=')[1].split('&')[0]),
    'repo:acme/app "bugdeck:report:report-1" in:body',
  );
});

// ─── dedupe ──────────────────────────────────────────────────────

test('an issue the search already knows is adopted, never duplicated', async () => {
  const github = fakeGithub({
    'GET /search/issues': () => [
      200,
      { items: [{ number: 41, body: `hi ${markerFor('report-1')}` }] },
    ],
    'POST /issues': CREATED,
  });
  const out = await tracker(github.impl).tracker.createIssue(job());

  assert.deepEqual(out.ok && out.value, { externalId: '41', code: '#41' });
  assert.equal(
    github.calls.some((call) => call.method === 'POST'),
    false,
  );
});

test('a search hit for a neighbouring report id is not adopted', async () => {
  const github = fakeGithub({
    // Search tokenises the body, so `report-12` comes back for `report-1`.
    'GET /search/issues': () => [200, { items: [{ number: 9, body: markerFor('report-12') }] }],
    'GET /issues': NO_RECENT_ISSUES,
    'POST /issues': CREATED,
  });
  const out = await tracker(github.impl).tracker.createIssue(job());
  assert.deepEqual(out.ok && out.value, { externalId: '7', code: '#7' });
});

test('a rate-limited search falls back to the recent issues', async () => {
  const github = fakeGithub({
    'GET /search/issues': () => [
      403,
      { message: 'API rate limit exceeded' },
      { 'x-ratelimit-remaining': '0', 'retry-after': '1' },
    ],
    'GET /issues': () => [200, [{ number: 12, body: markerFor('report-1') }]],
    'POST /issues': CREATED,
  });
  const { tracker: hub, sleeps } = tracker(github.impl);

  const out = await hub.createIssue(job());
  assert.deepEqual(out.ok && out.value, { externalId: '12', code: '#12' });
  // Two retries of the search, each waiting exactly as long as GitHub asked.
  assert.deepEqual(sleeps, [1000, 1000]);
  assert.equal(
    github.calls.some((call) => call.method === 'POST'),
    false,
  );
});

// ─── failure ─────────────────────────────────────────────────────

test('a rate-limited create is retried once GitHub says the window reset', async () => {
  let attempts = 0;
  const github = fakeGithub({
    'GET /search/issues': NO_SEARCH_HIT,
    'GET /issues': NO_RECENT_ISSUES,
    'POST /issues': () => {
      attempts += 1;
      if (attempts === 1) {
        return [
          429,
          { message: 'You have exceeded a secondary rate limit' },
          { 'retry-after': '2' },
        ];
      }
      return [201, { number: 7 }];
    },
  });
  const { tracker: hub, sleeps } = tracker(github.impl);

  assert.equal((await hub.createIssue(job())).ok, true);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(attempts, 2);
});

test('a rejected payload is a value, not a retry', async () => {
  let attempts = 0;
  const github = fakeGithub({
    'GET /search/issues': NO_SEARCH_HIT,
    'GET /issues': NO_RECENT_ISSUES,
    'POST /issues': () => {
      attempts += 1;
      return [422, { message: 'Validation Failed' }];
    },
  });
  const out = await tracker(github.impl).tracker.createIssue(job());

  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.error.status, 422);
  assert.equal(out.error.retryable, false);
  assert.equal(attempts, 1);
});

test('an unconfigured GitHub refuses without touching the network', async () => {
  const github = fakeGithub({});
  const out = await tracker(github.impl, { token: '' }).tracker.createIssue(job());

  assert.equal(out.ok, false);
  assert.equal(github.calls.length, 0);
});

// ─── comments ────────────────────────────────────────────────────

test('a comment posts Markdown and answers with its id', async () => {
  const github = fakeGithub({ 'POST /comments': () => [201, { id: 555 }] });
  const out = await tracker(github.impl).tracker.addComment('7', '@user fixed in 1.2.0');

  assert.deepEqual(out.ok && out.value, { commentId: '555' });
  assert.ok(github.calls[0].url.endsWith('/repos/acme/app/issues/7/comments'));
  assert.deepEqual(github.calls[0].body, { body: '@user fixed in 1.2.0' });
});

test('HTML from another tracker’s renderer arrives as text, not as tags', async () => {
  const github = fakeGithub({ 'POST /comments': () => [201, { id: 1 }] });
  await tracker(github.impl).tracker.addComment('7', '<p>Reporter said:</p><p>still broken</p>');

  const body = (github.calls[0].body as { body: string }).body;
  assert.ok(!body.includes('<p>'));
  assert.ok(body.includes('still broken'));
});

// ─── editing ─────────────────────────────────────────────────────

test('an edit PATCHes the title and the body, marker intact', async () => {
  const github = fakeGithub({ 'PATCH /issues/7': () => [200, { number: 7 }] });
  const out = await tracker(github.impl).tracker.updateIssue?.('7', {
    title: 'The Send button still does nothing',
    descriptionHtml: githubBody(bodyInput({ description: 'now on every page' }), CONFIG.publicUrl),
    images: [],
  });

  assert.equal(out?.ok, true);
  const call = github.calls[0];
  assert.equal(call.method, 'PATCH');
  assert.ok(call.url.endsWith('/repos/acme/app/issues/7'));
  const body = call.body as { title: string; body: string };
  assert.equal(body.title, 'The Send button still does nothing');
  // Losing the marker files a second issue on the next retry.
  assert.ok(body.body.endsWith(markerFor('report-1')));
  assert.ok(body.body.includes('now on every page'));
});

test('an edit rendered by someone else keeps the marker the issue already had', async () => {
  const github = fakeGithub({
    'GET /issues/7': () => [200, { number: 7, body: `old text\n\n${markerFor('report-1')}` }],
    'PATCH /issues/7': () => [200, { number: 7 }],
  });
  const out = await tracker(github.impl).tracker.updateIssue?.('7', {
    title: 'Rewritten elsewhere',
    descriptionHtml: 'a body with no marker of its own',
    images: [],
  });

  assert.equal(out?.ok, true);
  const patch = github.calls.find((call) => call.method === 'PATCH');
  assert.ok(String((patch?.body as { body: string }).body).endsWith(markerFor('report-1')));
});

test('a rejected edit comes back as a value, not a throw', async () => {
  const github = fakeGithub({ 'PATCH /issues/7': () => [404, { message: 'Not Found' }] });
  const out = await tracker(github.impl).tracker.updateIssue?.('7', {
    title: 'gone',
    descriptionHtml: githubBody(bodyInput(), CONFIG.publicUrl),
    images: [],
  });

  assert.equal(out?.ok, false);
  assert.equal(out?.ok === false && out.error.status, 404);
  assert.equal(out?.ok === false && out.error.retryable, false);
});
