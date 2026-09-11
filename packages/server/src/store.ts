/**
 * Where reports live, as an interface rather than a database.
 *
 * Two implementations ship (SQLite for a host that wants a server, memory for
 * tests) and a host with its own database writes a third. That is the whole
 * reason this is a seam: the aff-automation deployment this code came from
 * stores reports in Mongo, and nothing about a bug report should force a
 * second database on anyone.
 *
 * Ids are minted by the CALLER, not by the store. The widget references an
 * upload by its position among the files it just sent, so the asset rows have
 * to exist — carrying the report id — before the report row that points at
 * them; a store that minted the report id would make that ordering impossible.
 */
import type {
  FeedbackBlock,
  FeedbackContext,
  FeedbackReport,
  FeedbackState,
  FeedbackThreadEntry,
} from '@aitofy/bugdeck-core';

/** Whoever the host says is making this request. `id` is the only key we use. */
export interface FeedbackUser {
  id: string;
  email?: string;
  name?: string;
}

/**
 * One turn in the conversation, plus the tracker's receipt for it.
 *
 * `commentId` is the idempotency guard on the mirror: a message with no id has
 * not reached the tracker yet, so a retry posts it and a retry after it landed
 * does not. It never reaches the wire — `toReportDto` rebuilds the entry.
 */
export interface StoredThreadEntry extends FeedbackThreadEntry {
  commentId?: string;
}

/**
 * A report plus what the wire never carries: who filed it.
 *
 * The email is stored because the tracker bridge runs AFTER the response, long
 * after the request that knew who the user was — and "who reported this" is the
 * first line of triage.
 */
export interface StoredReport extends FeedbackReport {
  ownerId: string;
  ownerEmail?: string;
  thread?: StoredThreadEntry[];
}

export interface NewReport {
  id: string;
  ownerId: string;
  ownerEmail?: string;
  title: string;
  description: string;
  context: FeedbackContext;
  assetIds: string[];
  blocks: FeedbackBlock[] | null;
}

/**
 * What a caller may overwrite. `id`, `ownerId` and `createdAt` are absent on
 * purpose — a report changing hands is not an edit, it is a bug.
 */
export interface ReportUpdate {
  title?: string;
  description?: string;
  state?: FeedbackState;
  /** The tracker's human reference, `PROJ-12`. */
  code?: string;
  /** The tracker's internal id for the issue. */
  externalId?: string;
  blocks?: FeedbackBlock[] | null;
  assetIds?: string[];
  publicReply?: string;
  /** ISO-8601, like every other timestamp on the wire. */
  publicReplyAt?: string;
}

/** One sanitised screenshot on its way in. Always PNG by the time it gets here. */
export interface NewAsset {
  mime: string;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface StoredAsset extends NewAsset {
  id: string;
  /** Who may read it is decided by the parent report, never by the asset. */
  reportId: string;
}

export interface FeedbackStore {
  createReport(report: NewReport): Promise<StoredReport>;
  getReport(id: string): Promise<StoredReport | null>;
  /** Newest first. */
  listReportsByUser(ownerId: string, limit: number): Promise<StoredReport[]>;
  /** A no-op for an id that is not there: the caller checked ownership already. */
  updateReport(id: string, update: ReportUpdate): Promise<void>;
  /** APPENDS, never replaces — the user may be writing while a sync pass runs. */
  appendThread(id: string, entries: readonly StoredThreadEntry[]): Promise<void>;
  /**
   * Record that one thread entry reached the tracker. `index` is its position
   * in `thread`, which only ever grows, so it stays valid across an append.
   */
  markThreadMirrored(id: string, index: number, commentId: string): Promise<void>;
  putAsset(reportId: string, asset: NewAsset): Promise<string>;
  getAsset(id: string): Promise<StoredAsset | null>;
}
