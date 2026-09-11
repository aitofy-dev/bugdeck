/**
 * Fixture-only: no DOM, no network.
 *
 * The context block is the only thing separating "the button does not work"
 * from a reproducible ticket, and the user never sees it — so a field silently
 * going missing costs a round trip with the reporter that nobody notices is
 * needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearLastApiError, normalizeApiError, reportApiError } from '../api-error.js';
import { collectContext, type ContextEnv } from '../context.js';

const env: ContextEnv = {
  href: 'https://app.example.com/settings?tab=pending',
  innerWidth: 1512.4,
  innerHeight: 857.6,
  userAgent: 'Mozilla/5.0 (Macintosh)',
};

test('collectContext carries url, rounded viewport and UA', () => {
  clearLastApiError();
  const context = collectContext(env);
  assert.equal(context.url, env.href);
  assert.deepEqual(context.viewport, { width: 1512, height: 858 });
  assert.equal(context.userAgent, env.userAgent);
  assert.equal(context.buildCommit, undefined);
  assert.equal(context.lastApiError, undefined);
});

test('collectContext omits buildCommit when the host app has none', () => {
  clearLastApiError();
  assert.equal('buildCommit' in collectContext(env, { buildCommit: '' }), false);
  assert.equal(collectContext(env, { buildCommit: 'ca1461e' }).buildCommit, 'ca1461e');
});

test('collectContext picks up the last error reported by the app interceptor', () => {
  clearLastApiError();
  reportApiError(new Error('Request failed'), { status: 502, path: '/api/reports' });
  const context = collectContext(env);
  assert.equal(context.lastApiError?.status, 502);
  assert.equal(context.lastApiError?.path, '/api/reports');
  assert.equal(context.lastApiError?.message, 'Request failed');
  clearLastApiError();
  assert.equal(collectContext(env).lastApiError, undefined);
});

test('normalizeApiError reads axios-shaped rejections', () => {
  const normalized = normalizeApiError({
    message: 'Request failed with status code 403',
    response: { status: 403, data: { message: 'Forbidden' } },
    config: { url: '/api/reports' },
  });
  assert.equal(normalized.status, 403);
  assert.equal(normalized.path, '/api/reports');
  assert.equal(normalized.message, 'Request failed with status code 403');
});

test('normalizeApiError survives a thrown string and a bare object', () => {
  assert.equal(normalizeApiError('boom').message, 'boom');
  assert.equal(normalizeApiError({}).message, 'Unknown error');
  assert.equal(normalizeApiError(undefined).message, 'Unknown error');
  // The contract fields are required, so they are filled rather than dropped.
  assert.deepEqual(normalizeApiError('boom'), { status: 0, path: '', message: 'boom' });
});

test('normalizeApiError caps a runaway message so the report body stays sane', () => {
  const normalized = normalizeApiError(new Error('x'.repeat(9000)));
  assert.equal(normalized.message.length, 500);
});
