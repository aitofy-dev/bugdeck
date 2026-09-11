/**
 * Reading a Plane board: which of the five states an issue is in, and which
 * comment (if any) was meant for the reporter to see.
 *
 * Pure on purpose — no fetch, no storage, no env. Both rules here are the kind
 * that fail SILENTLY when they are wrong (a state that maps to nothing leaves
 * the reporter's badge frozen forever; a reply that fails to parse simply never
 * appears), so they get to be unit tests rather than something you find out
 * about from a user.
 *
 * DIRECTION: Plane → report, one way. `resolveStateMap` is the only inverse,
 * and it exists to pick the state an issue is CREATED in, not to push updates
 * back — two boards that write to each other chase each other.
 */
import { FEEDBACK_STATES, type FeedbackState } from './contract.js';

/** Terminal from the user's side: the report is answered, stop polling it hard. */
export const TERMINAL_FEEDBACK_STATES: readonly FeedbackState[] = ['done', 'fail'];

export function isTerminal(state: FeedbackState): boolean {
  return TERMINAL_FEEDBACK_STATES.includes(state);
}

/** One row of `GET /workspaces/{slug}/projects/{id}/states/`. */
export interface PlaneState {
  id: string;
  name?: string;
  /** Plane's own coarse bucket: backlog | unstarted | started | completed | cancelled. */
  group?: string;
}

/**
 * Plane's five groups, collapsed onto ours. Used only when a state's NAME is
 * not one of the five we know — i.e. when someone adds "Blocked" or renames
 * "Doing" to "In progress".
 *
 * `unstarted` and `backlog` both land on `pending` because from the user's
 * side they are the same sentence: nobody has picked this up yet.
 */
const BY_GROUP: Readonly<Record<string, FeedbackState>> = {
  backlog: 'pending',
  unstarted: 'pending',
  started: 'doing',
  completed: 'done',
  cancelled: 'fail',
};

const BY_NAME = new Map<string, FeedbackState>(
  FEEDBACK_STATES.map((state) => [state, state] as const),
);

const normalize = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/**
 * state id → our state, built from what Plane says today.
 *
 * Name first, group second. A state we can map by neither is LEFT OUT rather
 * than guessed: an unknown state means the sync leaves the report where it is,
 * which is visibly stale — much easier to notice than a report silently marked
 * done.
 */
export function buildStateMap(states: readonly PlaneState[]): Map<string, FeedbackState> {
  const map = new Map<string, FeedbackState>();
  for (const state of states) {
    if (!state?.id) continue;
    const mapped = BY_NAME.get(normalize(state.name)) ?? BY_GROUP[normalize(state.group)];
    if (mapped) map.set(state.id, mapped);
  }
  return map;
}

// ─── our state → a state id to write ─────────────────────────────

/** Which Plane groups can stand in for each of our states, best first. */
const GROUPS_FOR: Readonly<Record<FeedbackState, readonly string[]>> = {
  pending: ['unstarted', 'backlog'],
  doing: ['started'],
  review: ['started'],
  done: ['completed'],
  fail: ['cancelled'],
};

/** `review` is a convention, not a Plane group: it is a started state named so. */
const REVIEW_NAME = /review/i;

export type StateMapResult =
  | { ok: true; value: Record<FeedbackState, string> }
  | { ok: false; missing: FeedbackState[] };

function findByName(states: readonly PlaneState[], state: FeedbackState): string | undefined {
  return states.find((row) => row.id && normalize(row.name) === state)?.id;
}

function findByGroup(states: readonly PlaneState[], state: FeedbackState): string | undefined {
  for (const group of GROUPS_FOR[state]) {
    const match = states.find(
      (row) =>
        row.id &&
        normalize(row.group) === group &&
        // A board ordered Todo → In progress → Review must not resolve `doing`
        // to the Review column just because Plane calls both "started".
        !(state === 'doing' && REVIEW_NAME.test(row.name ?? '')),
    );
    if (match) return match.id;
  }
  return undefined;
}

/**
 * The state id to use for each of our five states, discovered from the live
 * board.
 *
 * Hardcoding ids is how a board that was deleted and recreated silently stops
 * receiving reports, so they are read every time and matched by name first,
 * group second. `override` wins outright — it is the operator telling us their
 * board does not follow the convention, and we are not in a position to argue.
 *
 * A missing REQUIRED group is returned as a value, not thrown: the caller logs
 * exactly which states could not be resolved and refuses to start.
 */
export function resolveStateMap(
  states: readonly PlaneState[],
  override: Partial<Record<FeedbackState, string>> = {},
): StateMapResult {
  const resolved: Partial<Record<FeedbackState, string>> = {};
  const missing: FeedbackState[] = [];

  for (const state of FEEDBACK_STATES) {
    const found =
      state === 'review'
        ? (override.review ?? findReviewState(states))
        : (override[state] ?? findByName(states, state) ?? findByGroup(states, state));
    if (found) resolved[state] = found;
    else if (state !== 'review') missing.push(state);
  }

  // A board with no Review column is normal: reports then move straight from
  // doing to done, and `review` never needs a column of its own.
  const review = resolved.review ?? resolved.doing;
  if (missing.length || !review) return { ok: false, missing };

  return {
    ok: true,
    value: {
      pending: resolved.pending as string,
      doing: resolved.doing as string,
      review,
      done: resolved.done as string,
      fail: resolved.fail as string,
    },
  };
}

function findReviewState(states: readonly PlaneState[]): string | undefined {
  const named = states.filter((row) => row.id && REVIEW_NAME.test(row.name ?? ''));
  return (named.find((row) => normalize(row.group) === 'started') ?? named[0])?.id;
}

// ─── public replies ──────────────────────────────────────────────

/**
 * The marker that makes a comment public. Everything else on the board stays
 * internal, which is the whole point: comments there routinely name accounts
 * belonging to other people.
 */
export const PUBLIC_REPLY_MARKER = '@user';

/**
 * Comment HTML → plain text.
 *
 * `<p>`/`<br>` become newlines BEFORE tags are stripped, otherwise a two-
 * paragraph reply arrives as one run-on sentence. Entities are decoded last so
 * a literal `&lt;p&gt;` someone typed stays literal text rather than becoming a
 * tag we then strip.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The user-facing part of a comment, or null if it was not meant for them.
 *
 * Matching is on the STRIPPED text, so `<p><strong>@user</strong> …</p>` counts
 * — bolding the marker does not un-mean it. The marker itself is removed; the
 * user has no idea what `@user` refers to.
 */
export function parseUserReply(commentHtml: string | null | undefined): string | null {
  if (!commentHtml) return null;
  const text = stripHtml(commentHtml);
  if (!text.toLowerCase().startsWith(PUBLIC_REPLY_MARKER)) return null;
  const body = text
    .slice(PUBLIC_REPLY_MARKER.length)
    .replace(/^[\s:,-]+/, '')
    .trim();
  // The marker alone is a mis-send, not an empty reply worth notifying about.
  return body || null;
}

export interface PlaneComment {
  id?: string;
  comment_html?: string;
  created_at?: string;
}

export interface UserReply {
  text: string;
  /** When it was written — used for `publicReplyAt`, not for dedupe. */
  at: Date | null;
}

/** One public comment, as read off the board. */
export interface PlaneUserComment {
  commentId: string | null;
  text: string;
  at: Date | null;
}

/**
 * EVERY public comment on an issue, oldest first.
 *
 * Ordered by `created_at` rather than by list position: Plane answers the
 * comments endpoint NEWEST FIRST, and a thread that renders an answer above the
 * question it answers is worse than no thread.
 *
 * A comment with an unparseable timestamp sorts to the FRONT rather than being
 * dropped — the words matter more than the minute, and the caller stamps a real
 * time when it stores one.
 */
export function collectUserReplies(comments: readonly PlaneComment[]): PlaneUserComment[] {
  const replies: Array<{ reply: PlaneUserComment; at: number }> = [];

  for (const comment of comments) {
    const text = parseUserReply(comment?.comment_html);
    if (!text) continue;
    const parsed = comment.created_at ? Date.parse(comment.created_at) : NaN;
    replies.push({
      reply: {
        commentId: comment.id ?? null,
        text,
        at: Number.isFinite(parsed) ? new Date(parsed) : null,
      },
      at: Number.isFinite(parsed) ? parsed : 0,
    });
  }

  return replies
    .map((row, index) => ({ ...row, index }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((row) => row.reply);
}

/**
 * The newest public comment on an issue.
 *
 * `publicReply` — the one line the list page shows — is defined as "the latest
 * thing that was said". Derived from the same pass as the thread so the two can
 * never disagree about which reply is newest.
 */
export function pickLatestUserReply(comments: readonly PlaneComment[]): UserReply | null {
  const replies = collectUserReplies(comments);
  const last = replies[replies.length - 1];
  return last ? { text: last.text, at: last.at } : null;
}

/**
 * Stable short digest of a reply, for a notification dedupe key.
 *
 * A hash rather than the text itself because the key is indexed and a reply can
 * be five paragraphs; and rather than the comment id because an EDITED reply
 * keeps its id — the user should be told about the new wording.
 *
 * FNV-1a: no crypto import, no collision consequence worth guarding (a
 * collision would suppress one duplicate notification, not lose the reply).
 */
export function replyDigest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
