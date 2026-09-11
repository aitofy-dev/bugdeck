/**
 * What one polled update MEANS for one stored report. Pure: no fetch, no store.
 *
 * The loop that reads the board and writes the store lives in the server; this
 * file only decides. Three refusals are the whole value of it, and all three
 * are silent when they go wrong:
 *
 *  1. A state we cannot map is LEFT ALONE, never defaulted. An admin adding a
 *     sixth column must not silently mark reports done — a stale badge is
 *     visible, a wrong badge is not.
 *  2. An issue the board no longer has does not touch the report. Our store is
 *     the SSOT and the user's words are not the tracker's to remove.
 *  3. `syncedAt` is stamped even when nothing changed. It is the "we looked"
 *     mark, and it is what lets the comment fetch be skipped: posting a comment
 *     bumps the issue's `updated_at`, so an issue untouched since our last look
 *     cannot be hiding a new reply.
 *
 * Nothing here writes to Plane. There is no inverse function on purpose.
 */
import type { FeedbackState } from '../../contract.js';
import type { TrackerUpdate } from '../../tracker.js';
import { newAdminEntries, type ThreadEntryLike } from '../../thread.js';
import { collectUserReplies, PUBLIC_REPLY_MARKER } from './reply.js';

/** One report the poller is allowed to touch, as read out of the store. */
export interface SyncCandidate {
  reportId: string;
  /** The tracker's own id for the issue. */
  externalId: string;
  state: FeedbackState;
  publicReply: string | null;
  syncedAt: Date | null;
  /**
   * The conversation as already stored — needed to answer "have we seen this
   * comment before". Only the identity fields are read.
   */
  thread: ThreadEntryLike[];
}

export interface ReportPatch {
  state?: FeedbackState;
  publicReply?: string;
  publicReplyAt?: Date | null;
  syncedAt: Date;
  /**
   * Admin turns to APPEND, never to replace. The user may be writing a comment
   * at the same moment this pass runs, and replacing the array would drop it.
   * Absent when there is nothing new, which is the common case.
   */
  appendThread?: ThreadEntryLike[];
}

/**
 * What the caller should do about one candidate, and what it should count.
 *
 * `patch` is absent exactly when the issue is gone: that is the one outcome
 * where even the "we looked" stamp would be a lie about a report the board no
 * longer knows.
 */
export interface SyncDecision {
  patch?: ReportPatch;
  stateChanged: boolean;
  replyChanged: boolean;
  threadAdded: number;
  /** The issue is on the board but its state maps to none of our five. */
  unmapped: boolean;
  /** The report holds an id the board no longer has (deleted issue). */
  orphaned: boolean;
}

/**
 * Whether this issue could be hiding a reply we have not read.
 *
 * Posting a comment bumps the issue's `updated_at`, so an issue whose
 * `updated_at` predates our last look has no new comment — which turns "one
 * request per open report, every five minutes" into "one request per report
 * that actually moved".
 *
 * Unparseable or missing timestamps read as CHANGED. Fetching a few comment
 * lists we did not need costs a request; deciding "nothing new" off a timestamp
 * we could not read costs the user their answer.
 */
export function shouldReadComments(
  candidate: Pick<SyncCandidate, 'syncedAt'>,
  update: Pick<TrackerUpdate, 'updatedAt'>,
): boolean {
  if (!candidate.syncedAt) return true;
  const updated = update.updatedAt?.getTime() ?? NaN;
  if (!Number.isFinite(updated)) return true;
  return updated > candidate.syncedAt.getTime();
}

const NOTHING: Omit<SyncDecision, 'patch'> = {
  stateChanged: false,
  replyChanged: false,
  threadAdded: 0,
  unmapped: false,
  orphaned: false,
};

/**
 * One candidate, one update, one decision.
 *
 * `update` is undefined when the board no longer has the issue. `now` is passed
 * in rather than read so a pass is reproducible and a test does not have to
 * guess what the clock did. `marker` is the operator's, defaulting to `@user`.
 */
export function decideReportPatch(
  candidate: SyncCandidate,
  update: TrackerUpdate | undefined,
  now: Date,
  marker: string = PUBLIC_REPLY_MARKER,
): SyncDecision {
  if (!update) return { ...NOTHING, orphaned: true };

  const decision: SyncDecision = { ...NOTHING, patch: { syncedAt: now } };
  const patch = decision.patch as ReportPatch;

  if (!update.state) decision.unmapped = true;
  else if (update.state !== candidate.state) {
    patch.state = update.state;
    decision.stateChanged = true;
  }

  // Absent comments mean "not read this pass", which is not the same as "no
  // replies" — and nothing is ever REMOVED from a thread on the strength of
  // this list, so the two can be treated alike without losing anything.
  if (!update.comments) return decision;

  const replies = collectUserReplies(update.comments, marker);

  // Everything the admin has said that is not in the thread yet. Adding is the
  // only operation: a reply stored once stays stored even if the tracker later
  // hides it, because the user may already have acted on it.
  const added = newAdminEntries(replies, candidate.thread, now);
  if (added.length) {
    patch.appendThread = added;
    decision.threadAdded = added.length;
  }

  // `publicReply` is the list page's one line: the latest thing the admin said.
  // Derived from the same read as the thread so the two can never disagree
  // about which reply is newest.
  const latest = replies[replies.length - 1];
  if (latest && latest.text !== candidate.publicReply) {
    patch.publicReply = latest.text;
    patch.publicReplyAt = latest.at;
    decision.replyChanged = true;
  }

  return decision;
}
