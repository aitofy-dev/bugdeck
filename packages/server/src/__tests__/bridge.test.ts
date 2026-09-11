import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { fail, ok, silentLogger, type CreateIssueJob, type IssueTracker } from '@aitofy/bugdeck-core';
import { createIssueBridge } from '../bridge.js';
import { createMemoryStore } from '../memory-store.js';
import type { FeedbackStore } from '../store.js';

const context = { url: 'https://app.example.com', viewport: { width: 0, height: 0 }, userAgent: '' };

async function storeWithReport(store: FeedbackStore, id = 'report-1'): Promise<string> {
  await store.createReport({
    id,
    ownerId: 'user-1',
    ownerEmail: 'reporter@example.com',
    title: 'Export is broken',
    description: 'Export is broken',
    context,
    assetIds: [],
    blocks: null,
  });
  return id;
}

interface Attempts {
  tracker: IssueTracker;
  jobs: CreateIssueJob[];
}

function trackerAnswering(answers: readonly Awaited<ReturnType<IssueTracker['createIssue']>>[]): Attempts {
  const jobs: CreateIssueJob[] = [];
  return {
    jobs,
    tracker: {
      async createIssue(job) {
        jobs.push(job);
        return answers[jobs.length - 1] ?? answers[answers.length - 1]!;
      },
      async addComment() {
        return ok({ commentId: 'comment-1' });
      },
    },
  };
}

describe('createIssueBridge', () => {
  it('writes the tracker id and code back onto the report', async () => {
    const store = createMemoryStore();
    const id = await storeWithReport(store);
    const attempts = trackerAnswering([ok({ externalId: 'issue-9', code: 'DEMO-9' })]);
    const bridge = createIssueBridge({ tracker: attempts.tracker, store, logger: silentLogger });

    bridge.enqueue(id);
    await bridge.drain();

    const report = await store.getReport(id);
    assert.equal(report?.externalId, 'issue-9');
    assert.equal(report?.code, 'DEMO-9');
  });

  it('retries a retryable failure with the backoff, then gives up quietly', async () => {
    const store = createMemoryStore();
    const id = await storeWithReport(store);
    const attempts = trackerAnswering([fail({ message: 'plane is down', retryable: true })]);
    const slept: number[] = [];
    const bridge = createIssueBridge({
      tracker: attempts.tracker,
      store,
      logger: silentLogger,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    bridge.enqueue(id);
    await bridge.drain();

    assert.equal(attempts.jobs.length, 4, 'one attempt plus three retries');
    assert.deepEqual(slept, [500, 1500, 4500]);
    assert.equal((await store.getReport(id))?.externalId, undefined);
  });

  it('adopts the issue on a retry rather than filing a second one', async () => {
    const store = createMemoryStore();
    const id = await storeWithReport(store);
    const attempts = trackerAnswering([
      fail({ message: 'gateway timeout', status: 504, retryable: true }),
      ok({ externalId: 'issue-9', code: 'DEMO-9' }),
    ]);
    const bridge = createIssueBridge({
      tracker: attempts.tracker,
      store,
      logger: silentLogger,
      sleep: async () => {},
    });

    bridge.enqueue(id);
    await bridge.drain();

    assert.equal(attempts.jobs.length, 2);
    assert.equal(attempts.jobs[0]?.externalId, attempts.jobs[1]?.externalId);
    assert.equal((await store.getReport(id))?.code, 'DEMO-9');
  });

  it('does not repeat a refusal the tracker will keep refusing', async () => {
    const store = createMemoryStore();
    const id = await storeWithReport(store);
    const attempts = trackerAnswering([fail({ message: 'bad project', status: 400, retryable: false })]);
    const bridge = createIssueBridge({ tracker: attempts.tracker, store, logger: silentLogger });

    bridge.enqueue(id);
    await bridge.drain();

    assert.equal(attempts.jobs.length, 1);
  });

  it('leaves a report that already has an issue alone', async () => {
    const store = createMemoryStore();
    const id = await storeWithReport(store);
    await store.updateReport(id, { externalId: 'issue-1', code: 'DEMO-1' });
    const attempts = trackerAnswering([ok({ externalId: 'issue-2', code: 'DEMO-2' })]);
    const bridge = createIssueBridge({ tracker: attempts.tracker, store, logger: silentLogger });

    bridge.enqueue(id);
    await bridge.drain();

    assert.equal(attempts.jobs.length, 0);
    assert.equal((await store.getReport(id))?.code, 'DEMO-1');
  });

  it('survives a report that vanished before the queue reached it', async () => {
    const store = createMemoryStore();
    const attempts = trackerAnswering([ok({ externalId: 'issue-1', code: 'DEMO-1' })]);
    const bridge = createIssueBridge({ tracker: attempts.tracker, store, logger: silentLogger });

    bridge.enqueue('never-existed');
    await bridge.drain();

    assert.equal(attempts.jobs.length, 0);
  });
});
