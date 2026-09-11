import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createSocket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Logger } from '@aitofy/bugdeck-core';
import { serve } from '../serve.js';

interface Recorded {
  message: string;
  meta?: Record<string, unknown>;
}

function recordingLogger(): { logger: Logger; lines: Recorded[] } {
  const lines: Recorded[] = [];
  const record = (message: string, meta?: Record<string, unknown>): void => {
    lines.push({ message, ...(meta ? { meta } : {}) });
  };
  return { lines, logger: { debug: record, info: record, warn: record, error: record } };
}

const STATES = [
  { id: 'state-backlog', name: 'Backlog', group: 'backlog' },
  { id: 'state-todo', name: 'Todo', group: 'unstarted' },
  { id: 'state-doing', name: 'In progress', group: 'started' },
  { id: 'state-review', name: 'In review', group: 'started' },
  { id: 'state-done', name: 'Done', group: 'completed' },
  { id: 'state-cancelled', name: 'Cancelled', group: 'cancelled' },
];

/** A Plane that only knows how to list columns — the one call startup makes. */
function fakePlane(states: readonly unknown[]): Promise<{ url: string; close: () => void }> {
  const server: Server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if ((req.url ?? '').includes('/states/')) {
      res.end(JSON.stringify({ results: states, next_page_results: false }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

function freePort(): Promise<number> {
  const socket = createSocket();
  return new Promise((resolve) => {
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      socket.close(() => resolve(port));
    });
  });
}

describe('serve', () => {
  let storagePath = '';

  before(async () => {
    storagePath = await mkdtemp(join(tmpdir(), 'bugdeck-serve-'));
  });

  after(async () => {
    await rm(storagePath, { recursive: true, force: true });
  });

  it('refuses to start and names what is missing', async () => {
    const result = await serve({ env: {}, logger: recordingLogger().logger });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message.includes('PLANE_BASE_URL'), true);
    assert.equal(!result.ok && result.message.includes('PLANE_API_KEY'), true);
  });

  it('resolves the board columns, logs them, and warns about the header auth mode', async () => {
    const plane = await fakePlane(STATES);
    const { logger, lines } = recordingLogger();
    const result = await serve({
      logger,
      env: {
        PLANE_BASE_URL: plane.url,
        PLANE_API_KEY: 'plane_api_key',
        PLANE_WORKSPACE_SLUG: 'acme',
        PLANE_PROJECT_ID: 'project-1',
        STORAGE_PATH: storagePath,
        PORT: String(await freePort()),
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value.states, {
        pending: 'state-todo',
        doing: 'state-doing',
        review: 'state-review',
        done: 'state-done',
        fail: 'state-cancelled',
      });
      await result.value.close();
    }

    const resolved = lines.find((line) => line.message === 'plane states resolved');
    assert.equal(resolved?.meta?.done, 'state-done');
    assert.equal(
      lines.some((line) => line.message.includes('AUTH_MODE=header')),
      true,
    );
    plane.close();
  });

  it('refuses to start when the board has no column for a state', async () => {
    const plane = await fakePlane(STATES.filter((state) => state.group !== 'completed'));
    const result = await serve({
      logger: recordingLogger().logger,
      env: {
        PLANE_BASE_URL: plane.url,
        PLANE_API_KEY: 'plane_api_key',
        PLANE_WORKSPACE_SLUG: 'acme',
        PLANE_PROJECT_ID: 'project-1',
        STORAGE_PATH: storagePath,
        PORT: String(await freePort()),
      },
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message.includes('done'), true);
    plane.close();
  });

  it('boots on GitHub without a Plane and without a column map', async () => {
    const { logger, lines } = recordingLogger();
    const result = await serve({
      logger,
      env: {
        TRACKER: 'github',
        GITHUB_OWNER: 'acme',
        GITHUB_REPO: 'app',
        GITHUB_TOKEN: 'ghp_test',
        STORAGE_PATH: storagePath,
        PORT: String(await freePort()),
        // A poller that fired here would spend a real request on api.github.com.
        POLL_INTERVAL: '0',
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.states, null);
      await result.value.close();
    }
    assert.equal(
      lines.some((line) => line.meta?.tracker === 'github'),
      true,
    );
  });

  it('names the GitHub variables when TRACKER=github and they are missing', async () => {
    const result = await serve({ env: { TRACKER: 'github' }, logger: recordingLogger().logger });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message.includes('GITHUB_OWNER'), true);
  });
});
