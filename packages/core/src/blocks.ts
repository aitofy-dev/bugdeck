/**
 * The ordered text+image document a report carries, parsed at the boundary.
 *
 * Everything here is untrusted: it arrives as a JSON string in a multipart
 * field written by a browser we do not control, and it ends up in HTML someone
 * reads. So this module does the "parse, don't validate" half — anything that
 * survives is a `FeedbackBlock` with a real asset id — and the HTML escaping
 * stays in the renderer where the tags are built.
 *
 * `blocks` is ADDITIVE. A report with no usable blocks is not an error: the
 * `description` field and `assetIds` still hold the whole report, and every
 * consumer is expected to fall back to them rather than branch on this.
 */
import {
  FEEDBACK_MAX_BLOCKS,
  FEEDBACK_MAX_DESCRIPTION,
  type FeedbackBlock,
} from './contract.js';

/**
 * Turn the wire form into stored form: image positions become the asset ids
 * that were just minted for them, in the same order the files were uploaded.
 * An `assetId` the report already owns passes through as-is (edits); one it
 * does not own is dropped, exactly like an out-of-range index.
 *
 * Returns null — not `[]` — when there is nothing usable, so callers store the
 * field as absent rather than as an empty document that would render blank.
 */
export function parseFeedbackBlocks(
  raw: string | undefined,
  assetIds: readonly string[],
  keepAssetIds: readonly string[] = [],
): FeedbackBlock[] | null {
  // Membership is checked against THIS report's own assets, never against "is
  // it a well-formed id": an id is a guess away from someone else's screenshot.
  const keepable = new Set(keepAssetIds);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed layout must never cost the user the report. `description` is
    // still intact; the only thing lost is the interleaving.
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const blocks: FeedbackBlock[] = [];
  for (const entry of parsed.slice(0, FEEDBACK_MAX_BLOCKS)) {
    if (!entry || typeof entry !== 'object') continue;
    const block = entry as { kind?: unknown; text?: unknown; imageIndex?: unknown };

    if (block.kind === 'text') {
      if (typeof block.text !== 'string') continue;
      const text = block.text.trim().slice(0, FEEDBACK_MAX_DESCRIPTION);
      if (text) blocks.push({ kind: 'text', text });
      continue;
    }

    if (block.kind === 'image') {
      const kept = (entry as { assetId?: unknown }).assetId;
      if (typeof kept === 'string') {
        if (keepable.has(kept)) blocks.push({ kind: 'image', assetId: kept });
        continue;
      }
      const index = block.imageIndex;
      // A float, a negative, or an index past the files actually received all
      // mean the same thing: this block points at nothing. Dropping it is right
      // — inventing an asset id would put someone else's screenshot here.
      if (typeof index !== 'number' || !Number.isInteger(index)) continue;
      const assetId = assetIds[index];
      if (assetId) blocks.push({ kind: 'image', assetId });
    }
  }

  return blocks.length ? blocks : null;
}

/**
 * Every image the layout actually shows, in order. Used by a tracker adapter to
 * decide which uploads it needs asset ids for.
 */
export function blockAssetIds(blocks: readonly FeedbackBlock[] | null | undefined): string[] {
  if (!blocks) return [];
  return blocks.flatMap((block) => (block.kind === 'image' ? [block.assetId] : []));
}
