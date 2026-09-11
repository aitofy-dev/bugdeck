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
  type CommentBodyRenderer,
  type IssueBodyRenderer,
  type IssueTracker,
  type Logger,
  type Result,
  type TrackerAttachments,
  type TrackerBody,
} from '@aitofy/bugdeck-core';
import { buildCreateIssueJob } from './issue-job.js';
import type { FeedbackStore, StoredAsset, StoredThreadEntry } from './store.js';

export interface MirrorDeps {
  tracker: IssueTracker;
  store: FeedbackStore;
  logger: Logger;
  /** Base for auth-scoped asset links, used for images the tracker would not take. */
  publicUrl: string;
  renderBody: IssueBodyRenderer;
  renderComment: CommentBodyRenderer;
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
 * What the tracker is now holding itself: file name → its own asset id. Empty
 * on a tracker with no attachment API, which is what turns every screenshot in
 * the rendered comment into an auth-scoped link instead.
 */
async function attachImages(
  deps: MirrorDeps,
  externalId: string,
  assets: readonly StoredAsset[],
): Promise<Map<string, string>> {
  const upload = deps.tracker.uploadAttachment?.bind(deps.tracker);
  const assetIdByFileName = new Map<string, string>();
  if (!upload) return assetIdByFileName;

  for (const asset of assets) {
    const name = attachmentName(asset.id);
    const result = await upload(externalId, { name, mime: asset.mime, bytes: asset.bytes });
    if (result.ok) assetIdByFileName.set(name, result.value.assetId);
    else deps.logger.warn('bugdeck comment image not attached', { assetId: asset.id, err: result.error.message });
  }
  return assetIdByFileName;
}

const renderBody = (body: TrackerBody, attachments: TrackerAttachments): string =>
  typeof body === 'string' ? body : body(attachments);

/**
 * One message, in the markup its tracker understands.
 *
 * The images are offered to the tracker FIRST and the renderer is told which
 * of them landed: Plane puts its own ids inline, and whatever was refused
 * becomes an auth-scoped link rather than vanishing.
 */
async function postComment(
  deps: MirrorDeps,
  reportId: string,
  externalId: string,
  entry: StoredThreadEntry,
): Promise<Result<{ commentId: string }>> {
  const assets = await loadAssets(deps, reportId, entry.assetIds);
  const assetIdByFileName = await attachImages(deps, externalId, assets);
  const body = deps.renderComment({
    text: entry.text,
    blocks: entry.blocks ?? [],
    assetIds: entry.assetIds,
  });
  return deps.tracker.addComment(externalId, renderBody(body, { assetIdByFileName, uploaded: true }));
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
