/**
 * No network: `fetch` is injected.
 *
 * This is the contract seam with the server. If the field names drift, the
 * route answers 400 on a report the user believes was sent — the worst possible
 * failure for a bug-reporting tool, because nobody reports the reporter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEDBACK_IMAGE_FIELD, FEEDBACK_MAX_DESCRIPTION } from '@bugdeck/core/contract';
import { collectContext, type ContextEnv } from '../context.js';
import { defaultStrings } from '../strings.js';
import {
  FeedbackSubmitError,
  assetEndpoint,
  buildFeedbackFormData,
  commentEndpoint,
  commentOnReport,
  reportEndpoint,
  reportsEndpoint,
  submitErrorMessage,
  submitFeedback,
  updateReport,
} from '../submit.js';

const env: ContextEnv = {
  href: 'https://app.example.com/settings',
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 1,
  userAgent: 'test-agent',
};

const png = (name: string) =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

test('the endpoints join without doubling the slash', () => {
  assert.equal(reportsEndpoint('/api'), '/api/reports');
  assert.equal(reportsEndpoint('/api/'), '/api/reports');
  assert.equal(reportsEndpoint('https://app.example.com/api//'), 'https://app.example.com/api/reports');
  assert.equal(reportEndpoint('/api', 'r1'), '/api/reports/r1');
  assert.equal(commentEndpoint('/api', 'r1'), '/api/reports/r1/comment');
  assert.equal(assetEndpoint('/api', 'a1'), '/api/assets/a1');
});

test('buildFeedbackFormData emits description, context JSON and repeated image parts', () => {
  const context = collectContext(env, { buildCommit: 'deadbee' });
  const form = buildFeedbackFormData({
    description: '  the save button does nothing  ',
    context,
    images: [png('screenshot.png'), png('extra.png')],
  });

  assert.equal(form.get('description'), 'the save button does nothing');
  assert.deepEqual(JSON.parse(form.get('context') as string), context);

  const images = form.getAll(FEEDBACK_IMAGE_FIELD) as File[];
  assert.equal(images.length, 2);
  assert.deepEqual(images.map((image) => image.name), ['screenshot.png', 'extra.png']);
  assert.equal(images[0].type, 'image/png');
});

test('buildFeedbackFormData truncates a pasted wall of text', () => {
  const form = buildFeedbackFormData({
    description: 'x'.repeat(FEEDBACK_MAX_DESCRIPTION + 500),
    context: collectContext(env),
    images: [],
  });
  assert.equal((form.get('description') as string).length, FEEDBACK_MAX_DESCRIPTION);
});

test('submitFeedback POSTs multipart to /reports with auth headers and returns id + code', async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const result = await submitFeedback({
    apiBase: '/api',
    description: 'broken',
    context: collectContext(env),
    images: [png('a.png')],
    headers: { Authorization: 'Bearer tok' },
    fetchImpl: (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: '66f', code: 'PROJ-42' }), { status: 201 });
    }) as unknown as typeof fetch,
  });

  assert.deepEqual(result, { id: '66f', code: 'PROJ-42' });
  assert.equal(seen?.url, '/api/reports');
  assert.equal(seen?.init.method, 'POST');
  assert.ok(seen?.init.body instanceof FormData);
  assert.deepEqual(seen?.init.headers, { Authorization: 'Bearer tok' });
  // A hand-set Content-Type would strip the multipart boundary.
  assert.equal('Content-Type' in (seen!.init.headers as Record<string, string>), false);
});

test('an edit PATCHes the report and a comment POSTs under it', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method) });
    return new Response(JSON.stringify({ id: 'r1' }), { status: 200 });
  }) as unknown as typeof fetch;

  const input = { apiBase: '/api', reportId: 'r1', description: 'still broken', context: collectContext(env), images: [], fetchImpl };
  await updateReport(input);
  await commentOnReport(input);

  assert.deepEqual(calls, [
    { url: '/api/reports/r1', method: 'PATCH' },
    { url: '/api/reports/r1/comment', method: 'POST' },
  ]);
});

test('submitFeedback accepts a 201 with no code yet — the tracker bridge is async', async () => {
  const result = await submitFeedback({
    apiBase: '/api',
    description: 'broken',
    context: collectContext(env),
    images: [],
    fetchImpl: (async () => new Response(JSON.stringify({ id: '66f' }), { status: 201 })) as unknown as typeof fetch,
  });
  assert.deepEqual(result, { id: '66f' });
});

/**
 * The server answers a CODE, never a sentence, so the widget owns the wording
 * and a host app can translate it. A body that carries no code still has to
 * produce something a user can read.
 */
test('a 4xx surfaces the error code the server named', async () => {
  const failWith = (body: string, status: number) =>
    submitFeedback({
      apiBase: '/api',
      description: 'broken',
      context: collectContext(env),
      images: [],
      fetchImpl: (async () => new Response(body, { status })) as unknown as typeof fetch,
    });

  await assert.rejects(failWith(JSON.stringify({ error: 'RATE_LIMITED' }), 429), (err: unknown) => {
    assert.ok(err instanceof FeedbackSubmitError);
    assert.equal(err.code, 'RATE_LIMITED');
    assert.equal(err.status, 429);
    assert.equal(submitErrorMessage(err), defaultStrings.errors.RATE_LIMITED);
    return true;
  });

  await assert.rejects(failWith('<html>502</html>', 502), (err: unknown) => {
    assert.ok(err instanceof FeedbackSubmitError);
    assert.equal(err.code, undefined);
    assert.equal(submitErrorMessage(err), defaultStrings.errorUnknown);
    return true;
  });
});

test('an unknown code is not passed through as if it were wording', async () => {
  await assert.rejects(
    submitFeedback({
      apiBase: '/api',
      description: 'broken',
      context: collectContext(env),
      images: [],
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: 'TEAPOT' }), { status: 418 })) as unknown as typeof fetch,
    }),
    (err: unknown) => {
      assert.ok(err instanceof FeedbackSubmitError);
      assert.equal(err.code, undefined);
      return true;
    },
  );
});

test('a failure that is not a submit error still reads as a sentence', () => {
  assert.match(submitErrorMessage(new Error('Failed to fetch')), /Failed to fetch/);
});

test('submitFeedback refuses a 201 without an id instead of faking success', async () => {
  await assert.rejects(
    submitFeedback({
      apiBase: '/api',
      description: 'broken',
      context: collectContext(env),
      images: [],
      fetchImpl: (async () => new Response('{}', { status: 201 })) as unknown as typeof fetch,
    }),
    FeedbackSubmitError,
  );
});
