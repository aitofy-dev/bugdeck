import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readServerConfig, type Environment } from '../config.js';

const COMPLETE: Environment = {
  PLANE_BASE_URL: 'https://plane.example.com/',
  PLANE_API_KEY: 'plane_api_key',
  PLANE_WORKSPACE_SLUG: 'acme',
  PLANE_PROJECT_ID: 'project-1',
};

const read = (env: Environment) => readServerConfig({ ...COMPLETE, ...env });

describe('readServerConfig', () => {
  it('fills in every default a host has no opinion about', () => {
    const result = read({});

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.port, 3131);
    assert.equal(result.ok && result.value.storagePath, './storage');
    assert.equal(result.ok && result.value.authMode, 'header');
    assert.equal(result.ok && result.value.corsOrigin, null);
    assert.equal(result.ok && result.value.plane.baseUrl, 'https://plane.example.com');
  });

  it('names every missing variable at once, not one per restart', () => {
    const result = readServerConfig({ PLANE_BASE_URL: 'https://plane.example.com' });

    assert.equal(result.ok, false);
    assert.equal(
      !result.ok && result.message.includes('PLANE_API_KEY, PLANE_WORKSPACE_SLUG, PLANE_PROJECT_ID'),
      true,
    );
  });

  it('reads the operator state override', () => {
    const result = read({ PLANE_STATE_MAP: '{"done":"state-done","fail":"state-cancelled"}' });

    assert.deepEqual(result.ok && result.value.plane.stateMap, {
      done: 'state-done',
      fail: 'state-cancelled',
    });
  });

  it('refuses a state override naming a state that does not exist', () => {
    const result = read({ PLANE_STATE_MAP: '{"finished":"state-done"}' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message.includes('finished'), true);
  });

  it('refuses a state override that is not JSON', () => {
    const result = read({ PLANE_STATE_MAP: 'done=state-done' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message.includes('PLANE_STATE_MAP'), true);
  });

  it('splits the legacy project list and drops the blanks', () => {
    const result = read({ PLANE_LEGACY_PROJECT_IDS: 'old-1, old-2 , ' });

    assert.deepEqual(result.ok && result.value.plane.legacyProjectIds, ['old-1', 'old-2']);
  });

  it('refuses a tracker this release does not ship', () => {
    const result = read({ TRACKER: 'github' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message.includes('TRACKER=plane'), true);
  });

  it('refuses an auth mode nobody implemented', () => {
    const result = read({ AUTH_MODE: 'oidc' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message.includes('AUTH_MODE=oidc'), true);
  });

  it('refuses a port that is not one', () => {
    const result = read({ PORT: 'http' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message.includes('PORT=http'), true);
  });

  it('hands the public url to the adapter so a refused upload can still be linked', () => {
    const result = read({ PUBLIC_URL: 'https://bugs.example.com/' });

    assert.equal(result.ok && result.value.publicUrl, 'https://bugs.example.com');
    assert.equal(result.ok && result.value.plane.publicUrl, 'https://bugs.example.com');
  });
});
