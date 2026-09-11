import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { GithubConfig, PlaneConfig } from '@aitofy/bugdeck-core';
import { readServerConfig, type ConfigResult, type Environment } from '../config.js';

const COMPLETE: Environment = {
  PLANE_BASE_URL: 'https://plane.example.com/',
  PLANE_API_KEY: 'plane_api_key',
  PLANE_WORKSPACE_SLUG: 'acme',
  PLANE_PROJECT_ID: 'project-1',
};

const read = (env: Environment): ConfigResult => readServerConfig({ ...COMPLETE, ...env });

/** The config a Plane deployment ends up with, or null if it is not one. */
const planeOf = (result: ConfigResult): PlaneConfig | null =>
  result.ok && result.value.tracker.kind === 'plane' ? result.value.tracker.plane : null;

const githubOf = (result: ConfigResult): GithubConfig | null =>
  result.ok && result.value.tracker.kind === 'github' ? result.value.tracker.github : null;

const GITHUB: Environment = {
  TRACKER: 'github',
  GITHUB_OWNER: 'acme',
  GITHUB_REPO: 'app',
  GITHUB_TOKEN: 'ghp_test',
};

describe('readServerConfig', () => {
  it('fills in every default a host has no opinion about', () => {
    const result = read({});

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value.port, 3131);
    assert.equal(result.ok && result.value.storagePath, './storage');
    assert.equal(result.ok && result.value.authMode, 'header');
    assert.equal(result.ok && result.value.corsOrigin, null);
    assert.equal(planeOf(result)?.baseUrl, 'https://plane.example.com');
    assert.equal(result.ok && result.value.pollIntervalMs, 300_000);
    assert.equal(result.ok && result.value.publicReplyMarker, '@user');
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

    assert.deepEqual(planeOf(result)?.stateMap, {
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

    assert.deepEqual(planeOf(result)?.legacyProjectIds, ['old-1', 'old-2']);
  });

  it('refuses a tracker nobody wrote an adapter for', () => {
    const result = read({ TRACKER: 'linear' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message.includes('plane, github'), true);
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
    assert.equal(planeOf(result)?.publicUrl, 'https://bugs.example.com');
  });

  it('reads a GitHub deployment, labels and enterprise host included', () => {
    const result = readServerConfig({
      ...GITHUB,
      GITHUB_LABELS: 'bugdeck, from-users ,',
      GITHUB_API_URL: 'https://github.acme.internal/api/v3/',
      PUBLIC_URL: 'https://bugs.example.com',
      PUBLIC_REPLY_MARKER: '@reporter',
    });

    assert.equal(result.ok && result.value.tracker.kind, 'github');
    assert.equal(githubOf(result)?.owner, 'acme');
    assert.equal(githubOf(result)?.repo, 'app');
    assert.equal(githubOf(result)?.token, 'ghp_test');
    assert.deepEqual(githubOf(result)?.labels, ['bugdeck', 'from-users']);
    assert.equal(githubOf(result)?.baseUrl, 'https://github.acme.internal/api/v3');
    assert.equal(githubOf(result)?.publicUrl, 'https://bugs.example.com');
    // The worker and the adapter must agree, or a reply is read back as internal.
    assert.equal(githubOf(result)?.publicReplyMarker, '@reporter');
    assert.equal(result.ok && result.value.publicReplyMarker, '@reporter');
  });

  it('asks for the GitHub variables, not the Plane ones, when TRACKER=github', () => {
    const result = readServerConfig({ TRACKER: 'github', GITHUB_OWNER: 'acme' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message.includes('GITHUB_REPO, GITHUB_TOKEN'), true);
    assert.equal(!result.ok && result.message.includes('PLANE_'), false);
  });

  it('does not need a single Plane variable to run on GitHub', () => {
    const result = readServerConfig(GITHUB);

    assert.equal(result.ok, true);
  });

  it('reads the poll interval in seconds and lets 0 turn it off', () => {
    const minute = read({ POLL_INTERVAL: '60' });
    assert.equal(minute.ok && minute.value.pollIntervalMs, 60_000);

    const off = read({ POLL_INTERVAL: '0' });
    assert.equal(off.ok && off.value.pollIntervalMs, 0);

    const bad = read({ POLL_INTERVAL: 'often' });
    assert.equal(bad.ok, false);
    assert.equal(!bad.ok && bad.message.includes('POLL_INTERVAL=often'), true);
  });
});
