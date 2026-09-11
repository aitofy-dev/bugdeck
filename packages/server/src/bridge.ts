/**
 * Getting a filed report onto the tracker, after the user has been answered.
 *
 * The store is the SSOT and the tracker is a mirror. That direction decides
 * every trade-off here: this may be late, it may lose a screenshot, it may not
 * run at all — but it is never allowed to cost the user the report they just
 * filed. So it runs off the request, and every failure path ends in a log line
 * rather than something a user can see.
 *
 * Concurrency 1, deliberately. Filing a bug is a human-speed action, and a
 * serial queue means a slow tracker delays reports instead of opening fifty
 * sockets to a board that is already struggling.
 */
import {
  commentBodyRenderer,
  consoleLogger,
  issueBodyRenderer,
  type IssueTracker,
  type Logger,
} from '@aitofy/bugdeck-core';
import { buildCreateIssueJob } from './issue-job.js';
import { loadAssets, mirrorComments, mirrorEdit, type MirrorDeps } from './mirror.js';
import type { FeedbackStore } from './store.js';

export interface IssueBridgeOptions {
  tracker: IssueTracker;
  store: FeedbackStore;
  logger?: Logger;
  /** Base for auth-scoped asset links, used when the tracker refuses an upload. */
  publicUrl?: string;
  /** Injectable so a test does not wait six seconds for the backoff. */
  sleep?: (ms: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
}

export interface IssueBridge {
  /** Fire-and-forget: returns immediately, the work happens on the queue. */
  enqueue(reportId: string): void;
  /** Push an edited report back onto the issue it already became. */
  enqueueEdit(reportId: string): void;
  /** Post every message the issue has not heard yet, this one included. */
  enqueueComment(reportId: string): void;
  /** Resolves once the queue is empty. For shutdown, and for tests. */
  drain(): Promise<void>;
}

/** Three retries. Past that the tracker is down, not busy, and a log line is the answer. */
const RETRY_DELAYS_MS: readonly number[] = [500, 1500, 4500];

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createIssueBridge(options: IssueBridgeOptions): IssueBridge {
  const logger = options.logger ?? consoleLogger;
  // The tracker's own markup when it has one, plain HTML when it does not. This
  // package never imports an adapter to find out which.
  const renderBody = issueBodyRenderer(options.tracker, options.publicUrl ?? '');
  const renderComment = commentBodyRenderer(options.tracker, options.publicUrl ?? '');
  const sleep = options.sleep ?? wait;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  let tail: Promise<void> = Promise.resolve();

  const mirror: MirrorDeps = {
    tracker: options.tracker,
    store: options.store,
    logger,
    publicUrl: options.publicUrl ?? '',
    renderBody,
    renderComment,
  };

  /**
   * Retries are safe because the tracker dedupes on `externalSource` +
   * `externalId`: a second create adopts the issue the first one made. A
   * non-retryable failure stops immediately — repeating a 400 three times only
   * delays the log line.
   */
  async function file(reportId: string): Promise<void> {
    const report = await options.store.getReport(reportId);
    if (!report) return;
    if (report.externalId) return;

    const job = buildCreateIssueJob(report, await loadAssets(mirror, reportId, report.assetIds), renderBody);
    for (let attempt = 0; ; attempt++) {
      const result = await options.tracker.createIssue(job);
      if (result.ok) {
        await options.store.updateReport(reportId, {
          externalId: result.value.externalId,
          code: result.value.code,
        });
        logger.info('bugdeck report filed', { reportId, code: result.value.code });
        // Anything the user wrote while the issue did not exist is waiting in
        // the thread; this is the first moment it can be posted.
        await mirrorComments(mirror, reportId);
        return;
      }

      const delay = delays[attempt];
      if (!result.error.retryable || delay === undefined) {
        logger.error('bugdeck report not filed', { reportId, err: result.error.message });
        return;
      }
      logger.warn('bugdeck report filing failed, retrying', {
        reportId,
        attempt: attempt + 1,
        err: result.error.message,
      });
      await sleep(delay);
    }
  }

  /**
   * One serial queue for all three passes, so a comment can never be posted
   * before the issue that carries it exists. Nothing above the catch: an
   * unhandled rejection here would take the process down over a mirror that is
   * allowed to fail.
   */
  function run(pass: string, reportId: string, work: () => Promise<void>): void {
    tail = tail.then(() =>
      work().catch((err: unknown) => {
        logger.error('bugdeck bridge crashed', { pass, reportId, err: String(err) });
      }),
    );
  }

  return {
    enqueue(reportId: string): void {
      run('create', reportId, () => file(reportId));
    },

    enqueueEdit(reportId: string): void {
      run('edit', reportId, () => mirrorEdit(mirror, reportId));
    },

    enqueueComment(reportId: string): void {
      run('comment', reportId, () => mirrorComments(mirror, reportId));
    },

    async drain(): Promise<void> {
      let seen: Promise<void> | null = null;
      while (seen !== tail) {
        seen = tail;
        await seen;
      }
    },
  };
}
