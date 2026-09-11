/**
 * One stored report, as the tracker needs to hear about it.
 *
 * Pure: the bridge loads the rows, this decides what they mean. That split is
 * what lets the assembly be tested without a store and without a network.
 *
 * The BODY is not rendered here. Markup belongs to the adapter that has to
 * display it — Plane inlines images with its own element, GitHub would want
 * Markdown — so the renderer arrives as an argument and this package imports no
 * adapter at all.
 */
import {
  attachmentName,
  type CreateIssueJob,
  type IssueBodyInput,
  type IssueBodyRenderer,
  type TrackerFile,
} from '@bugdeck/core';
import type { StoredAsset, StoredReport } from './store.js';

/**
 * Namespaces our `externalId` so a report id can never collide with an id some
 * other importer wrote against the same project. Half of the idempotency key:
 * filing the same report twice adopts the issue instead of duplicating it.
 */
export const BUGDECK_EXTERNAL_SOURCE = 'bugdeck';

/** Stored shape to renderer shape: every absent field becomes an explicit null. */
export function toIssueBodyInput(report: StoredReport): IssueBodyInput {
  return {
    reportId: report.id,
    description: report.description,
    userEmail: report.ownerEmail ?? '',
    teamName: null,
    url: report.context.url,
    viewport: report.context.viewport,
    userAgent: report.context.userAgent,
    buildCommit: report.context.buildCommit ?? null,
    lastApiError: report.context.lastApiError ?? null,
    assetIds: report.assetIds,
    blocks: report.blocks ?? null,
  };
}

/**
 * `assets` is passed in rather than fetched so the caller decides how much of a
 * 100 MB report it wants in memory at once. Names are derived from the asset
 * id, never from what the user called the screenshot: a stable name is the only
 * way an adapter can tell "already uploaded" from "uploaded twice".
 */
export function buildCreateIssueJob(
  report: StoredReport,
  assets: readonly StoredAsset[],
  renderBody: IssueBodyRenderer,
): CreateIssueJob {
  const images: TrackerFile[] = assets.map((asset) => ({
    name: attachmentName(asset.id),
    mime: asset.mime,
    bytes: asset.bytes,
  }));
  return {
    title: report.title,
    descriptionHtml: renderBody(toIssueBodyInput(report)),
    externalSource: BUGDECK_EXTERNAL_SOURCE,
    externalId: report.id,
    images,
  };
}
