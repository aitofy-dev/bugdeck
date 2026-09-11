/**
 * One stored report, as the tracker needs to hear about it.
 *
 * Pure: the bridge loads the rows, this decides what they mean. That split is
 * what lets the rendering be tested without a store and without a network.
 *
 * The body renderer is Plane's because Plane is the only adapter that ships
 * today. A second tracker renders differently (GitHub takes Markdown), and the
 * choice belongs in this one file when that happens.
 */
import {
  attachmentName,
  planeBody,
  type CreateIssueJob,
  type PlaneJob,
  type TrackerFile,
} from '@bugdeck/core';
import type { StoredAsset, StoredReport } from './store.js';

/**
 * Namespaces our `externalId` so a report id can never collide with an id some
 * other importer wrote against the same project. Half of the idempotency key:
 * filing the same report twice adopts the issue instead of duplicating it.
 */
export const BUGDECK_EXTERNAL_SOURCE = 'bugdeck';

function toPlaneJob(report: StoredReport): PlaneJob {
  return {
    reportId: report.id,
    title: report.title,
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
    externalId: report.externalId ?? null,
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
  publicUrl = '',
): CreateIssueJob {
  const images: TrackerFile[] = assets.map((asset) => ({
    name: attachmentName(asset.id),
    mime: asset.mime,
    bytes: asset.bytes,
  }));
  return {
    title: report.title,
    descriptionHtml: planeBody(toPlaneJob(report), publicUrl),
    externalSource: BUGDECK_EXTERNAL_SOURCE,
    externalId: report.id,
    images,
  };
}
