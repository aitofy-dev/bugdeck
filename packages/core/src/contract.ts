/**
 * The wire contract between the widget, the server and any tracker adapter.
 *
 * One fact, one place. The widget bundles this into a browser, so nothing here
 * may reference a tracker id, a database or a filesystem path.
 */

/** The five states a report can be in, from the reporter's point of view. */
export const FEEDBACK_STATES = ['pending', 'doing', 'review', 'done', 'fail'] as const;
export type FeedbackState = (typeof FEEDBACK_STATES)[number];

export function isFeedbackState(value: unknown): value is FeedbackState {
  return typeof value === 'string' && (FEEDBACK_STATES as readonly string[]).includes(value);
}

/**
 * The state where the ball is in the USER's court.
 *
 * `review` means the issue has been FIXED and the reporter is asked to confirm
 * — not that someone is still looking at it. Any label for it has to say so.
 */
export function needsUserCheck(state: FeedbackState): boolean {
  return state === 'review';
}

/**
 * Whether the report BODY can still be rewritten.
 *
 * `pending` means nobody has looked yet, so a real edit is honest. From `doing`
 * onwards someone has already read it, and silently changing the text under
 * them is how two people end up debugging different bugs. Everything the user
 * thinks of later is a comment, which is allowed in every state including
 * `done` — "it is still broken" is the most valuable message on the page and it
 * arrives after the report closes.
 */
export function canEditFeedback(state: FeedbackState): boolean {
  return state === 'pending';
}

/**
 * Every 4xx the server answers with. The server returns the CODE, never a
 * sentence: the widget owns the wording so it can be translated.
 */
export const ERROR_CODES = [
  'MISSING_DESCRIPTION',
  'TOO_MANY_IMAGES',
  'IMAGE_TOO_LARGE',
  'UNSUPPORTED_IMAGE',
  'NOT_PENDING',
  'NOT_FOUND',
  'RATE_LIMITED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ─── multipart field names ───────────────────────────────────────

/**
 * Screenshots go up as a REPEATED `images` key — not `images[]`, which some
 * form libraries emit and which would arrive as a different field entirely.
 */
export const FEEDBACK_IMAGE_FIELD = 'images';
export const FEEDBACK_DESCRIPTION_FIELD = 'description';
/** JSON-stringified `FeedbackContext`. */
export const FEEDBACK_CONTEXT_FIELD = 'context';
/** JSON-stringified `FeedbackBlockInput[]`, ordered. */
export const FEEDBACK_BLOCKS_FIELD = 'blocks';

// ─── limits ──────────────────────────────────────────────────────

/**
 * Limits are contract, not policy: the widget enforces them for a fast error,
 * the server enforces them again because the widget is untrusted.
 *
 * `FEEDBACK_MAX_ASSETS` is the ONE number for "how many images fit in a
 * report". Everything downstream derives from it — the multipart file cap and
 * the body ceiling on the write routes.
 */
export const FEEDBACK_MAX_ASSETS = 10;
export const FEEDBACK_MAX_ASSET_BYTES = 10 * 1024 * 1024;
/** Decompression-bomb ceiling — the sanitiser refuses anything above this. */
export const FEEDBACK_MAX_IMAGE_DIMENSION = 5000;
export const FEEDBACK_MAX_DESCRIPTION = 5000;
/** Title is derived, never typed: the first line of the description, trimmed. */
export const FEEDBACK_TITLE_MAX = 60;
/** A report is at most this many blocks — a bug report, not a document. */
export const FEEDBACK_MAX_BLOCKS = 40;
/** A report is a bug report, not a forum. Caps the USER's side only. */
export const FEEDBACK_MAX_COMMENTS = 20;

// ─── the document a report carries ───────────────────────────────

/**
 * What the widget sends. Images arrive one of two ways:
 *
 *  - `imageIndex` — position among the repeated `images` parts. The browser has
 *    no id for a file it has not uploaded yet, so the server swaps each index
 *    for the asset id it just minted.
 *  - `assetId` — an image the report ALREADY has, kept across an edit. Stable
 *    ids are what let a tracker adapter recognise its own attachments instead
 *    of decorating the issue with duplicates.
 *
 * The server rejects an `assetId` that is not already on that report.
 */
export type FeedbackBlockInput =
  | { kind: 'text'; text: string }
  | { kind: 'image'; imageIndex: number }
  | { kind: 'image'; assetId: string };

/** What is stored and returned: the same order, with real asset ids. */
export type FeedbackBlock = { kind: 'text'; text: string } | { kind: 'image'; assetId: string };

/** The last API failure the host app saw before the user hit "report". */
export interface FeedbackApiError {
  status: number;
  path: string;
  message: string;
}

/** Auto-attached by the widget. The user never sees or edits this. */
export interface FeedbackContext {
  url: string;
  viewport: { width: number; height: number };
  userAgent: string;
  buildCommit?: string;
  lastApiError?: FeedbackApiError;
}

/**
 * A message the user sent after filing.
 *
 * LEGACY shape, kept because reports filed before the thread existed store
 * their additions here. New code reads `thread`.
 */
export interface FeedbackAppend {
  description: string;
  blocks?: FeedbackBlock[];
  assetIds: string[];
  createdAt: string;
}

export type FeedbackThreadSource = 'user' | 'admin';

/**
 * One turn in the conversation on a report, from either side.
 *
 * Both sides in ONE list because the only useful order is chronological: an
 * "fixed it" and a "still broken" only mean anything next to each other.
 *
 * `admin` entries are tracker comments that opened with the public reply
 * marker — nothing else on that board is ever shown here, because comments
 * there routinely name other people's accounts. They carry text only.
 */
export interface FeedbackThreadEntry {
  source: FeedbackThreadSource;
  text: string;
  /** User entries only — text and images in the order they were written. */
  blocks?: FeedbackBlock[];
  assetIds: string[];
  /** When it was WRITTEN, on the tracker, not when the sync read it. */
  at: string;
}

export interface FeedbackReport {
  id: string;
  /** `PROJ-12` — the tracker's own reference, once the issue exists. */
  code?: string;
  title: string;
  description: string;
  state: FeedbackState;
  context: FeedbackContext;
  /** Fetch each via `GET /assets/:id`; only the owner of the report may. */
  assetIds: string[];
  /**
   * Text and images in the order the user wrote them. Absent on reports filed
   * before the block editor shipped — `description` + `assetIds` stay the
   * complete fallback, so nothing has to branch on the presence of this field.
   */
  blocks?: FeedbackBlock[];
  /** The latest comment written for the reporter to read. */
  publicReply?: string;
  /** When it was written, not when the sync noticed. */
  publicReplyAt?: string;
  /** Legacy additions, oldest first. Already folded into `thread` on read. */
  appends?: FeedbackAppend[];
  /**
   * The whole conversation, oldest first, both sides interleaved. Returned by
   * `GET /reports/:id` and the write routes — NOT by the list route, which
   * would then carry every word of fifty reports to draw a table of titles.
   */
  thread?: FeedbackThreadEntry[];
  /** The tracker's internal id for the issue, for adapters only. */
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}
