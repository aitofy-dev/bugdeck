/**
 * What the two write routes do to a report that already exists.
 *
 * Split from the routes because the RULES are the interesting part and HTTP is
 * not: an edit replaces the document, a comment only ever adds to it, and
 * neither one may lose a screenshot the user just uploaded.
 *
 * Both take the ids of the images that were already stored, rather than the
 * bytes: the upload has to happen before either can run, because a block
 * references an image by the position it was uploaded at and those positions
 * only become ids once the rows exist.
 */
import {
  blockAssetIds,
  deriveTitle,
  parseFeedbackBlocks,
  type FeedbackBlock,
} from '@aitofy/bugdeck-core';
import type { Submission } from './submission.js';
import type { FeedbackStore, StoredReport, StoredThreadEntry } from './store.js';

export interface AmendContext {
  store: FeedbackStore;
  maxAssets: number;
  /** Whoever is writing. Only used to derive the title from the first line. */
  userEmail: string | undefined;
}

/**
 * Which images the report has after an edit.
 *
 * The LAYOUT decides: an image the user removed is simply no longer referenced.
 * Anything uploaded but not placed is appended rather than dropped — a browser
 * that failed to build `blocks` must not cost the user the screenshot they
 * just attached.
 *
 * Nothing is deleted. Attachments on the issue are named after the asset id, so
 * an admin mid-investigation keeps every picture they have already seen; what
 * changes is only which of them the report still points at.
 */
export function editedAssetIds(
  blocks: FeedbackBlock[] | null,
  uploaded: readonly string[],
  maxAssets: number,
): string[] {
  const placed = blockAssetIds(blocks);
  const unplaced = uploaded.filter((assetId) => !placed.includes(assetId));
  return [...new Set([...placed, ...unplaced])].slice(0, maxAssets);
}

/**
 * Rewrite a report nobody has picked up yet.
 *
 * Images the report ALREADY has arrive as `{kind:'image', assetId}` blocks
 * instead of being uploaded again, which is what keeps asset ids stable across
 * an edit — and stable ids are how a tracker adapter recognises the attachment
 * it already made instead of decorating the issue with a second copy.
 */
export async function editReport(
  ctx: AmendContext,
  report: StoredReport,
  submission: Submission,
  uploaded: readonly string[],
): Promise<StoredReport> {
  const blocks = parseFeedbackBlocks(submission.blocksRaw, uploaded, report.assetIds);
  await ctx.store.updateReport(report.id, {
    title: deriveTitle(submission.description, ctx.userEmail),
    description: submission.description,
    blocks,
    assetIds: editedAssetIds(blocks, uploaded, ctx.maxAssets),
  });
  return (await ctx.store.getReport(report.id)) ?? report;
}

/**
 * Add one message to the conversation, in any state.
 *
 * It never touches `description`, `blocks` or `assetIds`: once a report leaves
 * `pending` those are frozen, and while it is still `pending` editing them is
 * strictly better than commenting. The message lands as its own entry, and on
 * the tracker as a comment — something the admin will see, rather than a silent
 * edit they will not.
 */
export async function commentOnReport(
  ctx: AmendContext,
  report: StoredReport,
  submission: Submission,
  uploaded: readonly string[],
): Promise<StoredReport> {
  // No `keepAssetIds`: a message references only what it brought. Pointing at
  // an image from the report would show the admin the same picture twice.
  const blocks = parseFeedbackBlocks(submission.blocksRaw, uploaded);
  const entry: StoredThreadEntry = {
    source: 'user',
    text: submission.description,
    ...(blocks?.length ? { blocks } : {}),
    assetIds: [...uploaded],
    at: new Date().toISOString(),
  };
  await ctx.store.appendThread(report.id, [entry]);
  return (await ctx.store.getReport(report.id)) ?? report;
}
