/**
 * Deciding which comment on a Plane issue was meant for the reporter.
 *
 * The marker is the whole safety mechanism: comments on that board routinely
 * name other people's accounts, so nothing without it may ever reach a widget.
 * A reply that fails to parse simply never appears, which is why the parsing
 * lives here with tests instead of inline in a poll loop.
 */
import type { TrackerComment } from '../../tracker.js';

/**
 * The marker that makes a comment public, unless the operator renames it.
 * Everything else on the board stays internal, which is the whole point:
 * comments there routinely name accounts belonging to other people.
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
export function parseUserReply(
  commentHtml: string | null | undefined,
  marker: string = PUBLIC_REPLY_MARKER,
): string | null {
  if (!commentHtml) return null;
  const text = stripHtml(commentHtml);
  if (!text.toLowerCase().startsWith(marker.toLowerCase())) return null;
  const body = text
    .slice(marker.length)
    .replace(/^[\s:,-]+/, '')
    .trim();
  // The marker alone is a mis-send, not an empty reply worth notifying about.
  return body || null;
}

/** One public comment, parsed: the marker gone and the words left. */
export interface UserReply {
  commentId: string | null;
  text: string;
  /** When it was written. Null when the tracker's timestamp was unreadable. */
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
export function collectUserReplies(
  comments: readonly TrackerComment[],
  marker: string = PUBLIC_REPLY_MARKER,
): UserReply[] {
  const replies: Array<{ reply: UserReply; at: number }> = [];

  for (const comment of comments) {
    const text = parseUserReply(comment?.html, marker);
    if (!text) continue;
    const at = comment.createdAt?.getTime() ?? NaN;
    replies.push({
      reply: { commentId: comment.commentId ?? null, text, at: comment.createdAt ?? null },
      at: Number.isFinite(at) ? at : 0,
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
export function pickLatestUserReply(
  comments: readonly TrackerComment[],
  marker: string = PUBLIC_REPLY_MARKER,
): UserReply | null {
  const replies = collectUserReplies(comments, marker);
  return replies[replies.length - 1] ?? null;
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
