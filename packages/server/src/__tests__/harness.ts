/**
 * What every route test needs: a real PNG, a tracker that answers without a
 * network, and an app wired to a memory store.
 */
import sharp from 'sharp';
import { ok, silentLogger, type CreateIssueJob, type IssueTracker } from '@bugdeck/core';
import { createFeedbackApp } from '../app.js';
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

export interface FakeTracker {
  tracker: IssueTracker;
  calls: CreateIssueJob[];
  /** Resolves the first time an issue is filed, so a test need not poll. */
  filed: Promise<CreateIssueJob>;
}

export function createFakeTracker(): FakeTracker {
  const calls: CreateIssueJob[] = [];
  let announce: (job: CreateIssueJob) => void = () => {};
  const filed = new Promise<CreateIssueJob>((resolve) => {
    announce = resolve;
  });

  return {
    calls,
    filed,
    tracker: {
      async createIssue(job) {
        calls.push(job);
        announce(job);
        return ok({ externalId: 'issue-1', code: 'DEMO-1' });
      },
      async addComment() {
        return ok({ commentId: 'comment-1' });
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

export function createHarness(options: { store?: FeedbackStore } = {}): Harness {
  const store = options.store ?? createMemoryStore();
  const tracker = createFakeTracker();
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
