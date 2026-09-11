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
import { consoleLogger, issueBodyRenderer, type IssueTracker, type Logger } from '@bugdeck/core';
import { buildCreateIssueJob } from './issue-job.js';
import type { FeedbackStore, StoredAsset, StoredReport } from './store.js';

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
  const sleep = options.sleep ?? wait;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  let tail: Promise<void> = Promise.resolve();

  async function loadAssets(report: StoredReport): Promise<StoredAsset[]> {
    const assets: StoredAsset[] = [];
    for (const assetId of report.assetIds) {
      const asset = await options.store.getAsset(assetId);
      // A missing screenshot costs the issue one picture, never the issue.
      if (asset) assets.push(asset);
      else logger.warn('bugdeck asset missing at file time', { reportId: report.id, assetId });
    }
    return assets;
  }

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

    const job = buildCreateIssueJob(report, await loadAssets(report), renderBody);
    for (let attempt = 0; ; attempt++) {
      const result = await options.tracker.createIssue(job);
      if (result.ok) {
        await options.store.updateReport(reportId, {
          externalId: result.value.externalId,
          code: result.value.code,
        });
        logger.info('bugdeck report filed', { reportId, code: result.value.code });
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

  return {
    enqueue(reportId: string): void {
      tail = tail.then(() =>
        file(reportId).catch((err: unknown) => {
          // Nothing above this catches: an unhandled rejection here would take
          // the process down over a mirror that is allowed to fail.
          logger.error('bugdeck bridge crashed', { reportId, err: String(err) });
        }),
      );
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
