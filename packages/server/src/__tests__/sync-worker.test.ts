/**
 * The poll worker, with a tracker that answers from an array.
 *
 * Everything pinned here is silent when it breaks: a reply stored twice reads
 * as the admin repeating themselves every five minutes, a watermark that moves
 * over a broken pass loses a state change nobody can find again, and two passes
 * running at once write the same rows twice.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { silentLogger, type FeedbackState, type IssueTracker, type TrackerUpdate } from '@aitofy/bugdeck-core';
import { createMemoryStore } from '../memory-store.js';
import type { FeedbackStore, StoredReport } from '../store.js';
import { createSyncWorker, SYNC_SINCE_KEY } from '../sync-worker.js';

const NOW = new Date('2026-09-12T10:00:00Z');

function fakeTracker(updates: readonly TrackerUpdate[]): {
  tracker: IssueTracker;
  since: Date[];
} {
  const since: Date[] = [];
  const tracker: IssueTracker = {
    async createIssue() {
      throw new Error('not used');
    },
    async addComment() {
      throw new Error('not used');
    },
    async *listUpdates(from: Date) {
      since.push(from);
      for (const update of updates) yield update;
    },
  };
  return { tracker, since };
}

async function seed(store: FeedbackStore, externalId: string): Promise<StoredReport> {
  const report = await store.createReport({
    id: `report-${externalId}`,
    ownerId: 'user-1',
    title: 'The Send button does nothing',
    description: 'The Send button does nothing',
    context: { url: 'https://app.example', viewport: { width: 1440, height: 900 }, userAgent: 'test' },
    assetIds: [],
    blocks: null,
  });
  await store.updateReport(report.id, { externalId });
  return report;
}

const update = (over: Partial<TrackerUpdate> = {}): TrackerUpdate => ({
  externalId: 'issue-1',
  updatedAt: NOW,
  ...over,
});

function workerOn(
  store: FeedbackStore,
  updates: readonly TrackerUpdate[],
  over: Partial<Parameters<typeof createSyncWorker>[0]> = {},
) {
  const { tracker, since } = fakeTracker(updates);
  const worker = createSyncWorker({
    tracker,
    store,
    logger: silentLogger,
    intervalMs: 0,
    ...over,
  });
  return { worker, since };
}

describe('createSyncWorker', () => {
  it('carries a state change into the store and tells the host once', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');
    const moved: Array<[string, FeedbackState]> = [];

    const { worker } = workerOn(store, [update({ state: 'doing' })], {
      onStateChange: (report, state) => {
        moved.push([report.id, state]);
      },
    });
    const stats = await worker.runOnce();

    assert.equal(stats.stateChanged, 1);
    assert.equal((await store.getReport('report-issue-1'))?.state, 'doing');
    assert.deepEqual(moved, [['report-issue-1', 'doing']]);
  });

  it('leaves a state it cannot map alone and counts it', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');

    const stats = await workerOn(store, [update()]).worker.runOnce();

    assert.equal(stats.unmapped, 1);
    assert.equal(stats.stateChanged, 0);
    assert.equal((await store.getReport('report-issue-1'))?.state, 'pending');
  });

  it('stores a marked comment as the public reply and as a thread turn', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');
    const replies: string[] = [];

    const { worker } = workerOn(
      store,
      [
        update({
          state: 'done',
          comments: [
            {
              commentId: 'c-1',
              html: '<p>@user Fixed, please reload the page.</p>',
              createdAt: new Date('2026-09-12T09:00:00Z'),
            },
            { commentId: 'c-2', html: '<p>internal: ask the payments team</p>', createdAt: NOW },
          ],
        }),
      ],
      {
        onReply: (_report, reply) => {
          replies.push(reply);
        },
      },
    );
    const stats = await worker.runOnce();

    assert.equal(stats.replyChanged, 1);
    assert.equal(stats.threadAdded, 1);
    const report = await store.getReport('report-issue-1');
    assert.equal(report?.publicReply, 'Fixed, please reload the page.');
    assert.equal(report?.publicReplyAt, '2026-09-12T09:00:00.000Z');
    assert.deepEqual(
      report?.thread?.map((entry) => [entry.source, entry.text, entry.commentId]),
      [['admin', 'Fixed, please reload the page.', 'c-1']],
    );
    // The unmarked comment names another account. It must never reach a widget.
    assert.deepEqual(replies, ['Fixed, please reload the page.']);
  });

  it('reads a reply back with the marker the operator chose', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');

    const { worker } = workerOn(
      store,
      [update({ comments: [{ commentId: 'c-1', html: '<p>@reporter on its way</p>', createdAt: NOW }] })],
      { publicReplyMarker: '@reporter' },
    );
    await worker.runOnce();

    assert.equal((await store.getReport('report-issue-1'))?.publicReply, 'on its way');
  });

  it('never echoes a comment we posted ourselves back into the thread', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');
    // A message the reporter wrote, already mirrored onto the issue.
    await store.appendThread('report-issue-1', [
      { source: 'user', text: '@user still broken', assetIds: [], at: NOW.toISOString(), commentId: 'c-mine' },
    ]);

    const { worker } = workerOn(store, [
      update({ comments: [{ commentId: 'c-mine', html: '<p>@user still broken</p>', createdAt: NOW }] }),
    ]);
    const stats = await worker.runOnce();

    assert.equal(stats.threadAdded, 0);
    assert.equal((await store.getReport('report-issue-1'))?.thread?.length, 1);
  });

  it('adds a reply once, however many passes read it', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');
    const comments = [{ commentId: 'c-1', html: '<p>@user on its way</p>', createdAt: NOW }];

    const { worker } = workerOn(store, [update({ comments })]);
    await worker.runOnce();
    const second = await worker.runOnce();

    assert.equal(second.threadAdded, 0);
    assert.equal((await store.getReport('report-issue-1'))?.thread?.length, 1);
  });

  it('counts an issue no report claims and writes nothing', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');

    const stats = await workerOn(store, [
      update({ externalId: 'issue-someone-else', state: 'done' }),
    ]).worker.runOnce();

    assert.equal(stats.orphaned, 1);
    assert.equal(stats.stateChanged, 0);
    assert.equal((await store.getReport('report-issue-1'))?.state, 'pending');
  });

  it('lets one broken issue cost itself and nothing else', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');
    await seed(store, 'issue-2');
    const failing: FeedbackStore = {
      ...store,
      async getReportByExternalId(externalId) {
        if (externalId === 'issue-1') throw new Error('database is down');
        return store.getReportByExternalId(externalId);
      },
    };

    const { worker } = workerOn(failing, [
      update({ externalId: 'issue-1', state: 'done' }),
      update({ externalId: 'issue-2', state: 'done' }),
    ]);
    const stats = await worker.runOnce();

    assert.equal(stats.failed, 1);
    assert.equal(stats.stateChanged, 1);
    assert.equal((await store.getReport('report-issue-2'))?.state, 'done');
    // A pass that lost an issue must not claim to have read the window.
    assert.equal(await store.getMeta(SYNC_SINCE_KEY), null);
  });

  it('keeps the watermark and resumes from it', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');

    const { worker, since } = workerOn(store, [update({ state: 'doing' })]);
    await worker.runOnce();
    const stored = await store.getMeta(SYNC_SINCE_KEY);
    await worker.runOnce();

    assert.equal(since[0]?.getTime(), 0);
    assert.equal(stored !== null, true);
    assert.equal(since[1]?.toISOString(), stored);
  });

  it('drops a tick that arrives while the last one is still going', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tracker: IssueTracker = {
      async createIssue() {
        throw new Error('not used');
      },
      async addComment() {
        throw new Error('not used');
      },
      async *listUpdates() {
        await gate;
        yield update({ state: 'doing' });
      },
    };
    const worker = createSyncWorker({ tracker, store, logger: silentLogger, intervalMs: 0 });

    const first = worker.runOnce();
    const second = await worker.runOnce();
    release();

    assert.equal(second.status, 'overlapped');
    assert.equal((await first).stateChanged, 1);
    // The guard clears: the next tick is a real pass again.
    assert.equal((await worker.runOnce()).status, 'ok');
  });

  it('does nothing at all on a tracker that cannot be polled', async () => {
    const store = createMemoryStore();
    const tracker: IssueTracker = {
      async createIssue() {
        throw new Error('not used');
      },
      async addComment() {
        throw new Error('not used');
      },
    };
    const worker = createSyncWorker({ tracker, store, logger: silentLogger, intervalMs: 1 });
    worker.start();

    assert.equal((await worker.runOnce()).status, 'disabled');
    assert.equal(await store.getMeta(SYNC_SINCE_KEY), null);
    worker.stop();
  });

  it('survives a tracker that throws halfway and keeps the watermark', async () => {
    const store = createMemoryStore();
    await seed(store, 'issue-1');
    const tracker: IssueTracker = {
      async createIssue() {
        throw new Error('not used');
      },
      async addComment() {
        throw new Error('not used');
      },
      async *listUpdates() {
        yield update({ state: 'doing' });
        throw new Error('plane went away');
      },
    };
    const worker = createSyncWorker({ tracker, store, logger: silentLogger, intervalMs: 0 });

    const stats = await worker.runOnce();

    assert.equal(stats.stateChanged, 1);
    assert.equal(await store.getMeta(SYNC_SINCE_KEY), null);
  });
});
