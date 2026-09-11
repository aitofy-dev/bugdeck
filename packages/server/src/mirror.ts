/**
 * Pushing what the user wrote AFTER filing onto the issue: the edit, and every
 * message they have added since.
 *
 * Same direction as the create bridge — the store is the SSOT, the tracker is a
 * mirror — so every failure here ends in a log line. The user's words are
 * already saved; a board that is down owes them nothing but a later retry.
 *
 * Both passes are idempotent, which is what makes "retry later" a real answer.
 * An edit rewrites the whole description, so doing it twice changes nothing;
 * a message is skipped once its `commentId` is stored, so a retry after the
 * comment landed but before the store heard about it cannot post it twice.
 */
import {
  attachmentName,
  assetLinksHtml,
  textBlock,
  type IssueBodyRenderer,
  type Logger,
  type Result,
} from '@aitofy/bugdeck-core';
import type { EditableTracker } from './editable-tracker.js';
import { buildCreateIssueJob } from './issue-job.js';
import type { FeedbackStore, StoredAsset, StoredThreadEntry } from './store.js';

export interface MirrorDeps {
  tracker: EditableTracker;
  store: FeedbackStore;
  logger: Logger;
  /** Base for auth-scoped asset links, used for images the tracker would not take. */
  publicUrl: string;
  renderBody: IssueBodyRenderer;
}

/** A missing screenshot costs the issue one picture, never the issue. */
export async function loadAssets(
  deps: MirrorDeps,
  reportId: string,
  assetIds: readonly string[],
): Promise<StoredAsset[]> {
  const assets: StoredAsset[] = [];
  for (const assetId of assetIds) {
    const asset = await deps.store.getAsset(assetId);
    if (asset) assets.push(asset);
    else deps.logger.warn('bugdeck asset missing at file time', { reportId, assetId });
  }
  return assets;
}

/**
 * One message as issue HTML, through the same helpers the body uses.
 *
 * Images are attachments rather than inline markup: the tracker seam has no
 * way to say "render an image" yet, and an attachment is visible on every
 * tracker while a guessed element is visible on none. Whatever the upload
 * refused becomes an auth-scoped link, so nothing is silently dropped.
 */
export function renderCommentHtml(
  entry: StoredThreadEntry,
  publicUrl: string,
  unattached: readonly string[],
): string {
  const body = (entry.blocks ?? [])
    .filter((block) => block.kind === 'text')
    .map((block) => `<p>${textBlock(block.text)}</p>`);
  if (!body.length) body.push(`<p>${textBlock(entry.text)}</p>`);

  return ['<p><em>Reporter said:</em></p>', ...body, assetLinksHtml(publicUrl, unattached, 'images (sign in to view)')]
    .filter(Boolean)
    .join('');
}

/** The ids the tracker is now holding itself. Empty on a tracker with no uploads. */
async function attachImages(
  deps: MirrorDeps,
  externalId: string,
  assets: readonly StoredAsset[],
): Promise<Set<string>> {
  const upload = deps.tracker.uploadAttachment?.bind(deps.tracker);
  const attached = new Set<string>();
  if (!upload) return attached;

  for (const asset of assets) {
    const result = await upload(externalId, {
      name: attachmentName(asset.id),
      mime: asset.mime,
      bytes: asset.bytes,
    });
    if (result.ok) attached.add(asset.id);
    else deps.logger.warn('bugdeck comment image not attached', { assetId: asset.id, err: result.error.message });
  }
  return attached;
}

async function postComment(
  deps: MirrorDeps,
  reportId: string,
  externalId: string,
  entry: StoredThreadEntry,
): Promise<Result<{ commentId: string }>> {
  const assets = await loadAssets(deps, reportId, entry.assetIds);
  const attached = await attachImages(deps, externalId, assets);
  const unattached = entry.assetIds.filter((assetId) => !attached.has(assetId));
  return deps.tracker.addComment(externalId, renderCommentHtml(entry, deps.publicUrl, unattached));
}

/**
 * Push an edited report back onto its issue, title included — the title is
 * derived from the description, so leaving it behind puts an item on the board
 * named after a sentence that no longer exists anywhere.
 *
 * A report with no issue yet is left alone on purpose: the create bridge is
 * still retrying and it reads the CURRENT text, so it files the edit itself.
 */
export async function mirrorEdit(deps: MirrorDeps, reportId: string): Promise<void> {
  const report = await deps.store.getReport(reportId);
  if (!report?.externalId) return;
  const updateIssue = deps.tracker.updateIssue?.bind(deps.tracker);
  if (!updateIssue) return;

  const job = buildCreateIssueJob(report, await loadAssets(deps, reportId, report.assetIds), deps.renderBody);
  const result = await updateIssue(report.externalId, job);
  if (result.ok) deps.logger.info('bugdeck edit mirrored', { reportId });
  else deps.logger.warn('bugdeck edit not mirrored', { reportId, err: result.error.message });
}

/**
 * Post every message the issue has not heard yet, oldest first.
 *
 * Reading the whole thread rather than one index is what makes a comment
 * written while the issue did not exist survive: the create bridge calls this
 * the moment it has an id, and finds the backlog waiting. A failure STOPS the
 * pass — posting message three after message two failed would tell the admin a
 * story out of order.
 */
export async function mirrorComments(deps: MirrorDeps, reportId: string): Promise<void> {
  const report = await deps.store.getReport(reportId);
  if (!report?.externalId) return;

  const thread = report.thread ?? [];
  for (let index = 0; index < thread.length; index++) {
    const entry = thread[index];
    if (!entry || entry.source !== 'user' || entry.commentId) continue;

    const posted = await postComment(deps, reportId, report.externalId, entry);
    if (!posted.ok) {
      deps.logger.warn('bugdeck comment not mirrored', { reportId, index, err: posted.error.message });
      return;
    }
    await deps.store.markThreadMirrored(reportId, index, posted.value.commentId);
    deps.logger.info('bugdeck comment mirrored', { reportId, index });
  }
}
