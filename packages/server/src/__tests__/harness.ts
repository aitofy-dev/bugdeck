/**
 * What every route test needs: a real PNG, a tracker that answers without a
 * network, and an app wired to a memory store.
 */
import sharp from 'sharp';
import { ok, silentLogger, type CreateIssueJob } from '@aitofy/bugdeck-core';
import { createFeedbackApp } from '../app.js';
import type { EditableTracker, IssueUpdateInput } from '../editable-tracker.js';
import { createMemoryStore } from '../memory-store.js';
import type { FeedbackStore, FeedbackUser } from '../store.js';

export const USER: FeedbackUser = { id: 'user-1', email: 'reporter@example.com' };
export const OTHER_USER: FeedbackUser = { id: 'user-2', email: 'stranger@example.com' };

export function pngBytes(size = 4): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
}

export interface FakeComment {
  externalId: string;
  html: string;
}

export interface FakeTracker {
  tracker: EditableTracker;
  calls: CreateIssueJob[];
  comments: FakeComment[];
  updates: Array<{ externalId: string; input: IssueUpdateInput }>;
  uploads: string[];
  /** Resolves the first time an issue is filed, so a test need not poll. */
  filed: Promise<CreateIssueJob>;
  /** Lets the create finish. Only meaningful when the tracker was held. */
  release(): void;
}

export interface FakeTrackerOptions {
  /**
   * Hold `createIssue` until `release()` — the only way to reach the window
   * where a report exists and its issue does not.
   */
  held?: boolean;
}

export function createFakeTracker(options: FakeTrackerOptions = {}): FakeTracker {
  const calls: CreateIssueJob[] = [];
  const comments: FakeComment[] = [];
  const updates: Array<{ externalId: string; input: IssueUpdateInput }> = [];
  const uploads: string[] = [];

  let announce: (job: CreateIssueJob) => void = () => {};
  const filed = new Promise<CreateIssueJob>((resolve) => {
    announce = resolve;
  });
  let release = (): void => {};
  const gate = options.held
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();

  return {
    calls,
    comments,
    updates,
    uploads,
    filed,
    release: () => {
      release();
    },
    tracker: {
      async createIssue(job) {
        await gate;
        calls.push(job);
        announce(job);
        return ok({ externalId: 'issue-1', code: 'DEMO-1' });
      },
      async addComment(externalId, html) {
        comments.push({ externalId, html });
        return ok({ commentId: `comment-${comments.length}` });
      },
      async uploadAttachment(_externalId, file) {
        uploads.push(file.name);
        return ok({ assetId: `plane-${uploads.length}`, name: file.name });
      },
      async updateIssue(externalId, input) {
        updates.push({ externalId, input });
        return ok(undefined);
      },
    },
  };
}

export interface Harness {
  request: (path: string, init?: RequestInit, user?: FeedbackUser | null) => Promise<Response>;
  store: FeedbackStore;
  tracker: FakeTracker;
}

/** The header the test suite authenticates with, mirroring `AUTH_MODE=header`. */
const AS_USER = 'x-test-user';

export function createHarness(options: { store?: FeedbackStore; held?: boolean } = {}): Harness {
  const store = options.store ?? createMemoryStore();
  const tracker = createFakeTracker(options.held ? { held: true } : {});
  const users = new Map([
    [USER.id, USER],
    [OTHER_USER.id, OTHER_USER],
  ]);

  const app = createFeedbackApp({
    tracker: tracker.tracker,
    store,
    logger: silentLogger,
    publicUrl: 'https://bugs.example.com',
    resolveUser: async (request) => users.get(request.headers.get(AS_USER) ?? '') ?? null,
  });

  return {
    store,
    tracker,
    async request(path, init = {}, user = USER) {
      const headers = new Headers(init.headers);
      if (user) headers.set(AS_USER, user.id);
      return app.request(path, { ...init, headers });
    },
  };
}

export interface ReportForm {
  description?: string;
  context?: unknown;
  blocks?: unknown;
  images?: readonly Blob[];
}

export function reportForm(input: ReportForm): FormData {
  const form = new FormData();
  if (input.description !== undefined) form.append('description', input.description);
  form.append('context', JSON.stringify(input.context ?? { url: 'https://app.example.com' }));
  if (input.blocks !== undefined) form.append('blocks', JSON.stringify(input.blocks));
  (input.images ?? []).forEach((image, index) => {
    form.append('images', image, `shot-${index}.png`);
  });
  return form;
}

export const pngBlob = async (): Promise<Blob> =>
  new Blob([await pngBytes()], { type: 'image/png' });

/**
 * Wait for the background queue to get somewhere. The bridge runs off the
 * request on purpose, so a test that asserts straight after a response asserts
 * on a race.
 */
export async function until(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition was never met');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
