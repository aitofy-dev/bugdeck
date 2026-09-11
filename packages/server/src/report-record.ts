/**
 * The shape of a stored report, and the three transforms every store does
 * identically: mint one, patch one, hand one to a user.
 *
 * Pure and shared so the SQLite store and the memory store cannot disagree
 * about what an update means — a disagreement that would only ever show up as
 * "it works in the tests".
 */
import {
  buildThread,
  countUserTurns,
  type FeedbackReport,
  type FeedbackThreadEntry,
} from '@aitofy/bugdeck-core';
import type { NewReport, ReportUpdate, StoredReport, StoredThreadEntry } from './store.js';

export function newReportRecord(input: NewReport, now: string): StoredReport {
  return {
    id: input.id,
    ownerId: input.ownerId,
    ...(input.ownerEmail ? { ownerEmail: input.ownerEmail } : {}),
    title: input.title,
    description: input.description,
    state: 'pending',
    context: input.context,
    assetIds: [...input.assetIds],
    ...(input.blocks?.length ? { blocks: input.blocks } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A patch is what the caller NAMED: an absent key leaves the field alone, and
 * `blocks: null` is the one way to erase a layout. Returns a new record rather
 * than mutating, so a store that hands the same object to two readers cannot
 * change one of them under the other.
 */
export function applyReportUpdate(
  report: StoredReport,
  update: ReportUpdate,
  now: string,
): StoredReport {
  const patched: StoredReport = { ...report, updatedAt: now };
  if (update.title !== undefined) patched.title = update.title;
  if (update.description !== undefined) patched.description = update.description;
  if (update.state !== undefined) patched.state = update.state;
  if (update.code !== undefined) patched.code = update.code;
  if (update.externalId !== undefined) patched.externalId = update.externalId;
  if (update.assetIds !== undefined) patched.assetIds = [...update.assetIds];
  if (update.publicReply !== undefined) patched.publicReply = update.publicReply;
  if (update.publicReplyAt !== undefined) patched.publicReplyAt = update.publicReplyAt;
  if (update.blocks !== undefined) {
    if (update.blocks?.length) patched.blocks = update.blocks;
    else delete patched.blocks;
  }
  return patched;
}

export function appendThreadEntries(
  report: StoredReport,
  entries: readonly StoredThreadEntry[],
  now: string,
): StoredReport {
  if (!entries.length) return report;
  return { ...report, thread: [...(report.thread ?? []), ...entries], updatedAt: now };
}

/**
 * Stamp the tracker's comment id onto one entry. `updatedAt` is deliberately
 * left alone: nothing a user reads changed, and moving it would make every
 * mirrored comment look like a fresh edit to anything watching the timestamp.
 */
export function markThreadEntryMirrored(
  report: StoredReport,
  index: number,
  commentId: string,
): StoredReport {
  const thread = report.thread ?? [];
  const entry = thread[index];
  if (!entry) return report;
  const patched = [...thread];
  patched[index] = { ...entry, commentId };
  return { ...report, thread: patched };
}

/** How many messages the USER has written here — the only side that is capped. */
export function userTurnCount(report: StoredReport): number {
  return countUserTurns(
    (report.thread ?? []).map((entry) => ({ ...entry, at: new Date(entry.at) })),
    (report.appends ?? []).map((append) => ({ ...append, createdAt: new Date(append.createdAt) })),
  );
}

/**
 * Stored ISO strings → the `Date`s `buildThread` sorts on → strings again.
 *
 * The conversion is here rather than in the store because the fold is the same
 * on every backend: legacy `appends` are part of the conversation, and a store
 * that forgot to fold them would silently lose every word a user added before
 * the thread existed.
 */
function mergedThread(report: StoredReport): FeedbackThreadEntry[] {
  const stored = (report.thread ?? []).map((entry) => ({
    ...entry,
    blocks: entry.blocks ?? null,
    at: new Date(entry.at),
  }));
  const legacy = (report.appends ?? []).map((append) => ({
    ...append,
    blocks: append.blocks ?? null,
    createdAt: new Date(append.createdAt),
  }));
  return buildThread(stored, legacy).map((entry) => ({
    source: entry.source,
    text: entry.text,
    ...(entry.blocks?.length ? { blocks: entry.blocks } : {}),
    assetIds: entry.assetIds ?? [],
    at: entry.at.toISOString(),
  }));
}

/**
 * What a user is allowed to see: an explicit field list, so nothing the server
 * learns later (who owns it, which issue it became) can leak by being spread.
 *
 * The thread is opt-in because the list route draws a table of titles, and
 * shipping every word of fifty conversations to render five columns is fine on
 * the day it ships and awful six months later.
 */
export function toReportDto(report: StoredReport, opts: { thread?: boolean } = {}): FeedbackReport {
  const dto: FeedbackReport = {
    id: report.id,
    ...(report.code ? { code: report.code } : {}),
    title: report.title,
    description: report.description,
    state: report.state,
    context: report.context,
    assetIds: report.assetIds,
    ...(report.blocks?.length ? { blocks: report.blocks } : {}),
    ...(report.publicReply ? { publicReply: report.publicReply } : {}),
    ...(report.publicReplyAt ? { publicReplyAt: report.publicReplyAt } : {}),
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
  if (!opts.thread) return dto;

  const thread = mergedThread(report);
  return { ...dto, ...(thread.length ? { thread } : {}) };
}
