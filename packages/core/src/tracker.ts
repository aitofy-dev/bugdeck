/**
 * The seam every issue tracker plugs into.
 *
 * Deliberately tiny, and deliberately NOT the union of what Plane, GitHub and
 * Linear can do: two methods are required, the rest are optional, and an
 * adapter that cannot upload a file simply does not define `uploadAttachment`.
 * A wide interface would force every new adapter to stub methods it has no
 * answer for, which is how the third adapter ends up throwing at runtime.
 *
 * Failures come back as VALUES. A tracker being unreachable is an ordinary
 * Tuesday, not an exception: the report is already saved, and the caller's job
 * is to retry later, not to unwind a stack.
 */
import type { FeedbackState } from './contract.js';

// ─── result ──────────────────────────────────────────────────────

export interface TrackerError {
  /** What failed, why, and what to do — an operator reads this in a log. */
  message: string;
  /** The tracker's HTTP status, when it answered at all. */
  status?: number;
  /**
   * Whether asking again could work. 429, 5xx and network failures yes; a 4xx
   * is the tracker saying "no", and repeating it three times only delays the
   * log line.
   */
  retryable: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: TrackerError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(error: TrackerError): Result<T> {
  return { ok: false, error };
}

// ─── what goes up ────────────────────────────────────────────────

/**
 * One file on its way to a tracker.
 *
 * `name` is the identity: adapters recognise their own earlier uploads by it,
 * so it has to be derived from the asset id rather than from whatever the user
 * called the screenshot. `bytes` carries the content, so a declared size can
 * never disagree with it — a presign policy that pins content-length rejects
 * the upload when it does.
 */
export interface TrackerFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** What the attachment pass produced, as the body renderer needs to see it. */
export interface TrackerAttachments {
  /** File name → tracker asset id, for the uploads that landed. */
  assetIdByFileName: ReadonlyMap<string, string>;
  /**
   * Whether the upload pass has run. An empty map means two opposite things
   * without it — "not tried yet" on the first render and "every upload failed"
   * on the second — and only one of them should produce a fallback link.
   */
  uploaded: boolean;
}

/**
 * The issue body, as raw tracker HTML.
 *
 * A FUNCTION when the layout carries images the tracker can render inline: the
 * adapter renders once to create the issue, then again once the uploads have
 * ids, so the markup for an inline image stays inside the adapter that
 * understands it. An adapter with no attachments renders once, `uploaded` false.
 */
export type TrackerBody = string | ((attachments: TrackerAttachments) => string);

/**
 * One report, as the tracker needs to hear about it.
 *
 * `externalSource` + `externalId` are OUR side of the dedupe: the tracker is
 * told "this issue is report X from bugdeck" so that a retry after a crash
 * adopts the issue that already exists instead of filing a second one. Do not
 * confuse them with the id `createIssue` hands BACK, which is the tracker's own
 * id for the issue and is what every later call addresses it by.
 */
export interface CreateIssueJob {
  title: string;
  descriptionHtml: TrackerBody;
  externalSource: string;
  externalId: string;
  images: TrackerFile[];
}

// ─── what comes back ─────────────────────────────────────────────

/** One comment as read off a tracker. `createdAt` is null when unparseable. */
export interface TrackerComment {
  commentId: string | null;
  html: string;
  createdAt: Date | null;
}

/**
 * One issue that moved since the poller last looked.
 *
 * `state` is absent when the tracker's column maps to none of our five — the
 * caller then leaves the badge alone, because a stale badge is visible and a
 * wrong one is not. `comments` is absent when they were not read this pass.
 */
export interface TrackerUpdate {
  /** The tracker's own id for the issue. */
  externalId: string;
  updatedAt: Date | null;
  state?: FeedbackState;
  comments?: TrackerComment[];
}

// ─── the seam ────────────────────────────────────────────────────

export interface IssueTracker {
  /** Idempotent on `externalSource` + `externalId`: twice is one issue. */
  createIssue(job: CreateIssueJob): Promise<Result<{ externalId: string; code: string }>>;
  addComment(externalId: string, html: string): Promise<Result<{ commentId: string }>>;
  /** Absent on trackers with no attachment API; the caller links instead. */
  uploadAttachment?(
    externalId: string,
    file: TrackerFile,
  ): Promise<Result<{ assetId: string; name: string }>>;
  /** Absent on trackers with no way to ask "what changed"; polling is optional. */
  listUpdates?(since: Date): AsyncIterable<TrackerUpdate>;
}

// ─── logging ─────────────────────────────────────────────────────

/**
 * Four levels, structured meta, no transport. The host already has a logger;
 * this is the shape we ask it to look like, not a logger we ship.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  debug: (message, meta) => console.debug(message, meta ?? {}),
  info: (message, meta) => console.info(message, meta ?? {}),
  warn: (message, meta) => console.warn(message, meta ?? {}),
  error: (message, meta) => console.error(message, meta ?? {}),
};

/** The default in tests, and for a host that wants no output at all. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
