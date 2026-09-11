/**
 * Turning what is stored into the conversation a user reads.
 *
 * Two jobs, both pure, both the kind that fail QUIETLY when they are wrong —
 * which is why they live here with tests rather than inline in the sync loop:
 *
 *  1. `buildThread` — fold the legacy `appends[]` into `thread[]` and order the
 *     result by time. Get the order wrong and the page shows an answer above
 *     the question it answers; drop the legacy fold and every report filed
 *     before this shipped silently loses what its author added.
 *  2. `newAdminEntries` — decide which public replies on the tracker issue are
 *     NOT already in the thread. The sync re-reads every comment on every pass,
 *     so a wrong answer here means one reply repeated every five minutes,
 *     forever, with no error anywhere.
 *
 * Identity is `commentId` wherever there is one. It survives an edit (fixing a
 * typo keeps the id) and it is the only field both sides agree on. Where the
 * tracker gives no id the fallback is text + timestamp, which is weaker but
 * still beats appending a duplicate.
 */
import type { FeedbackBlock } from './contract.js';

export interface ThreadEntryLike {
  source: 'user' | 'admin';
  text: string;
  blocks?: FeedbackBlock[] | null;
  assetIds?: string[];
  at: Date;
  commentId?: string | null;
}

/** The pre-thread shape. Always a USER turn — nobody else wrote here. */
export interface LegacyAppendLike {
  description: string;
  blocks?: FeedbackBlock[] | null;
  assetIds?: string[];
  createdAt: Date;
  commentId?: string | null;
}

/**
 * A comment we already know about, reduced to what identifies it.
 *
 * Text is trimmed and lowercased for the fallback match: a tracker round-trips
 * comment HTML through an editor, and the same reply can come back with
 * different whitespace than it went in with.
 */
function identityOf(entry: { text: string; at: Date; commentId?: string | null }): string {
  if (entry.commentId) return `id:${entry.commentId}`;
  return `txt:${entry.text.trim().toLowerCase()}|${entry.at.getTime()}`;
}

function millis(at: Date): number {
  const ms = at?.getTime?.();
  return Number.isFinite(ms) ? (ms as number) : 0;
}

/**
 * Everything the user should see about this report's conversation, oldest
 * first.
 *
 * Stable sort by time: two turns can share a timestamp (a comment posted in
 * the same second the sync stamped a reply), and the order they were stored in
 * is a better tie-break than whatever the sort happens to do.
 *
 * Deduped by identity so a legacy append that also exists as a thread entry —
 * possible only if something re-ran a migration — shows up once.
 */
export function buildThread(
  stored: readonly ThreadEntryLike[] = [],
  legacy: readonly LegacyAppendLike[] = [],
): ThreadEntryLike[] {
  const fromLegacy: ThreadEntryLike[] = legacy.map((append) => ({
    source: 'user',
    text: append.description,
    blocks: append.blocks ?? null,
    assetIds: append.assetIds ?? [],
    at: append.createdAt,
    commentId: append.commentId ?? null,
  }));

  const seen = new Set<string>();
  const all: ThreadEntryLike[] = [];
  for (const entry of [...fromLegacy, ...stored]) {
    const id = identityOf(entry);
    if (seen.has(id)) continue;
    seen.add(id);
    all.push(entry);
  }

  return all
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => millis(a.entry.at) - millis(b.entry.at) || a.index - b.index)
    .map(({ entry }) => entry);
}

/** One public reply as the tracker reader hands it over. */
export interface AdminReply {
  commentId: string | null;
  text: string;
  /** The tracker's `created_at`, or null when it was unparseable. */
  at: Date | null;
}

/**
 * The replies that are not in the thread yet, oldest first.
 *
 * A reply with no usable timestamp is stamped `now`. That is a lie about WHEN,
 * but the alternative — dropping it — is a lie about WHETHER, and only one of
 * those loses the user their answer. It also keeps the entry sorting to the end
 * of the thread, which is where a just-read comment belongs.
 *
 * Comments we posted ourselves (the user's own messages) can never arrive here:
 * they do not open with the public reply marker, so the reader never returns
 * them. The id check is a second net, not the mechanism.
 */
export function newAdminEntries(
  replies: readonly AdminReply[],
  existing: readonly ThreadEntryLike[] = [],
  now: Date = new Date(),
): ThreadEntryLike[] {
  const known = new Set(existing.map(identityOf));
  const added: ThreadEntryLike[] = [];

  for (const reply of replies) {
    const text = reply.text.trim();
    if (!text) continue;
    const entry: ThreadEntryLike = {
      source: 'admin',
      text,
      blocks: null,
      assetIds: [],
      at: reply.at ?? now,
      commentId: reply.commentId ?? null,
    };
    const id = identityOf(entry);
    // Guard against the same comment appearing twice IN ONE PASS as well — a
    // paginated list that repeats a row across pages would otherwise store it
    // twice, and the second copy would then look "known" forever after.
    if (known.has(id)) continue;
    known.add(id);
    added.push(entry);
  }

  return added.sort((a, b) => millis(a.at) - millis(b.at));
}

/** How many turns the USER has taken — the only side that is capped. */
export function countUserTurns(
  stored: readonly ThreadEntryLike[] = [],
  legacy: readonly LegacyAppendLike[] = [],
): number {
  return stored.filter((entry) => entry.source === 'user').length + legacy.length;
}
