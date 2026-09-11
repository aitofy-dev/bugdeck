/**
 * Carrying the tracker's answer back: state changes and public replies, on a
 * timer, in one direction only.
 *
 * The user files a report and then waits. Everything after that happens on a
 * board they cannot see, so without this loop their page says "pending" until
 * the heat death of the universe. That is the whole job.
 *
 * Four rules run through it:
 *
 *  1. NOTHING is written to the tracker here. Two boards that write to each
 *     other chase each other, so there is no inverse pass in this file.
 *  2. One issue's failure costs that issue, never the pass. A store error on
 *     report 12 must not lose report 13 its state change.
 *  3. The watermark moves only after a CLEAN pass. Advancing it over a pass
 *     that broke halfway would skip every issue the broken half held, silently
 *     and forever.
 *  4. A tick that finds the previous one still running is dropped, not queued.
 *     A slow board must not end up with two passes writing the same rows.
 *
 * What decides anything lives in core (`decideReportPatch`); this is the loop
 * that reads the board and writes the store.
 */
import {
  consoleLogger,
  decideReportPatch,
  PUBLIC_REPLY_MARKER,
  type FeedbackState,
  type IssueTracker,
  type Logger,
  type ReportPatch,
  type SyncCandidate,
  type SyncDecision,
  type ThreadEntryLike,
  type TrackerUpdate,
} from '@aitofy/bugdeck-core';
import type { FeedbackStore, ReportUpdate, StoredReport, StoredThreadEntry } from './store.js';

/** Where the watermark lives. One key, so a store needs no schema of its own. */
export const SYNC_SINCE_KEY = 'sync.since';

export interface SyncStats {
  /** `disabled` = this tracker cannot be polled; `overlapped` = tick dropped. */
  status: 'ok' | 'disabled' | 'overlapped';
  /** Issues the tracker offered this pass. */
  issues: number;
  stateChanged: number;
  replyChanged: number;
  threadAdded: number;
  /** On the board, but its column maps to none of our five. */
  unmapped: number;
  /** On the board and carrying our marker, but no report claims it. */
  orphaned: number;
  /** Issues whose own pass threw. The watermark stays put when this is not 0. */
  failed: number;
}

export interface SyncWorkerOptions {
  tracker: IssueTracker;
  store: FeedbackStore;
  logger?: Logger;
  /** How often `start()` runs a pass. `0` or less never schedules one. */
  intervalMs: number;
  /**
   * The prefix that makes a comment visible to the reporter. Must match the
   * one the tracker is configured with, which is why `serve` reads both from
   * the same environment variable.
   */
  publicReplyMarker?: string;
  /** The host's notification, fired AFTER the write. Failures are logged only. */
  onStateChange?: (report: StoredReport, state: FeedbackState) => void | Promise<void>;
  onReply?: (report: StoredReport, reply: string) => void | Promise<void>;
}

export interface SyncWorker {
  start(): void;
  stop(): void;
  /** One pass. Safe to call by hand while the timer is running. */
  runOnce(): Promise<SyncStats>;
}

const emptyStats = (status: SyncStats['status']): SyncStats => ({
  status,
  issues: 0,
  stateChanged: 0,
  replyChanged: 0,
  threadAdded: 0,
  unmapped: 0,
  orphaned: 0,
  failed: 0,
});

/** Identity fields only: what answers "have we seen this comment before". */
function toCandidate(report: StoredReport): SyncCandidate {
  const thread: ThreadEntryLike[] = (report.thread ?? []).map((entry) => ({
    source: entry.source,
    text: entry.text,
    at: new Date(entry.at),
    commentId: entry.commentId ?? null,
  }));
  return {
    reportId: report.id,
    externalId: report.externalId ?? '',
    state: report.state,
    publicReply: report.publicReply ?? null,
    // The watermark is one per PASS, not one per report — `decideReportPatch`
    // only ever writes this field, and the tracker did the skipping already.
    syncedAt: null,
    thread,
  };
}

function toStoredEntry(entry: ThreadEntryLike, now: Date): StoredThreadEntry {
  return {
    source: entry.source,
    text: entry.text,
    ...(entry.blocks?.length ? { blocks: entry.blocks } : {}),
    assetIds: entry.assetIds ?? [],
    at: (entry.at ?? now).toISOString(),
    ...(entry.commentId ? { commentId: entry.commentId } : {}),
  };
}

/** The patch as two store calls: the fields, then the turns to append. */
async function applyPatch(
  store: FeedbackStore,
  reportId: string,
  patch: ReportPatch,
  now: Date,
): Promise<void> {
  const update: ReportUpdate = {
    ...(patch.state ? { state: patch.state } : {}),
    ...(patch.publicReply === undefined
      ? {}
      : { publicReply: patch.publicReply, publicReplyAt: (patch.publicReplyAt ?? now).toISOString() }),
  };
  if (Object.keys(update).length) await store.updateReport(reportId, update);
  if (patch.appendThread?.length) {
    await store.appendThread(
      reportId,
      patch.appendThread.map((entry) => toStoredEntry(entry, now)),
    );
  }
}

/** Epoch on the first pass, which reads the whole board and is the point. */
async function readSince(store: FeedbackStore): Promise<Date> {
  const stored = await store.getMeta(SYNC_SINCE_KEY);
  const ms = stored ? Date.parse(stored) : NaN;
  return new Date(Number.isFinite(ms) ? ms : 0);
}

export function createSyncWorker(options: SyncWorkerOptions): SyncWorker {
  const logger = options.logger ?? consoleLogger;
  const { store } = options;
  const listUpdates = options.tracker.listUpdates?.bind(options.tracker);
  const marker = options.publicReplyMarker || PUBLIC_REPLY_MARKER;
  let running: Promise<SyncStats> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Notifications are the host's, and a host that throws owes us nothing. */
  async function notify(what: string, reportId: string, fire: () => void | Promise<void>): Promise<void> {
    try {
      await fire();
    } catch (err) {
      logger.warn('bugdeck sync hook failed', { hook: what, reportId, err: String(err) });
    }
  }

  /**
   * What the host is told, AFTER the write and never before: a notification
   * pointing at a state the report does not have yet is worse than one that
   * arrives a tick late.
   */
  async function announce(
    report: StoredReport,
    patch: ReportPatch,
    decision: SyncDecision,
    stats: SyncStats,
  ): Promise<void> {
    const state = patch.state;
    if (decision.stateChanged && state) {
      stats.stateChanged += 1;
      logger.info('bugdeck report state moved', { reportId: report.id, from: report.state, to: state });
      if (options.onStateChange) {
        await notify('onStateChange', report.id, () => options.onStateChange?.(report, state));
      }
    }

    const reply = patch.publicReply;
    if (decision.replyChanged && reply) {
      stats.replyChanged += 1;
      if (options.onReply) await notify('onReply', report.id, () => options.onReply?.(report, reply));
    }
  }

  async function one(update: TrackerUpdate, stats: SyncStats, now: Date): Promise<void> {
    const report = await store.getReportByExternalId(update.externalId);
    if (!report) {
      // Someone else's issue, or a report this store never had. Ours is the
      // SSOT; an issue with no report here is not our business.
      stats.orphaned += 1;
      return;
    }

    const decision = decideReportPatch(toCandidate(report), update, now, marker);
    if (decision.unmapped) stats.unmapped += 1;
    if (!decision.patch) return;

    await applyPatch(store, report.id, decision.patch, now);
    stats.threadAdded += decision.threadAdded;
    await announce(report, decision.patch, decision, stats);
  }

  async function pass(): Promise<SyncStats> {
    if (!listUpdates) return emptyStats('disabled');

    const stats = emptyStats('ok');
    const since = await readSince(store);
    // Stamped BEFORE the read: a comment posted while this pass runs must land
    // in the next window rather than in the gap between them.
    const startedAt = new Date();
    let whole = true;

    try {
      for await (const update of listUpdates(since)) {
        stats.issues += 1;
        try {
          await one(update, stats, startedAt);
        } catch (err) {
          stats.failed += 1;
          logger.warn('bugdeck sync skipped one issue', {
            externalId: update.externalId,
            err: String(err),
          });
        }
      }
    } catch (err) {
      whole = false;
      logger.error('bugdeck sync pass failed', { err: String(err) });
    }

    if (whole && !stats.failed) await store.setMeta(SYNC_SINCE_KEY, startedAt.toISOString());
    logger.info('bugdeck sync pass', { ...stats, since: since.toISOString() });
    return stats;
  }

  function runOnce(): Promise<SyncStats> {
    if (running) {
      logger.warn('bugdeck sync still running, tick dropped');
      return Promise.resolve(emptyStats('overlapped'));
    }
    running = pass().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    runOnce,

    start(): void {
      if (timer || !listUpdates || options.intervalMs <= 0) return;
      // The first pass is one interval away: a board is polled to catch what
      // changed while we were up, and a restart is not an event on it.
      timer = setInterval(() => void runOnce(), options.intervalMs);
      timer.unref();
    },

    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
