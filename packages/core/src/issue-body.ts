/**
 * One report as issue HTML, for every tracker that has no opinion of its own.
 *
 * Two things live here rather than in an adapter. The ESCAPING, because the
 * tags are ours and must reach the tracker raw while every interpolated value
 * is attacker-controlled text on its way into someone's browser — one renderer
 * getting that backwards is the bug this module exists to make impossible. And
 * the THREE PARAGRAPHS — who, what, where — because they are the report, not a
 * Plane layout: an adapter overrides how images are embedded, not what triage
 * reads.
 */
import type { FeedbackApiError, FeedbackViewport } from './contract.js';
import {
  attachmentName,
  type CommentBodyInput,
  type CommentBodyRenderer,
  type IssueBodyInput,
  type IssueBodyRenderer,
  type IssueTracker,
  type TrackerBody,
} from './tracker.js';

/** Values only. The tags around them are ours and must reach the tracker raw. */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function textBlock(raw: string): string {
  return escapeHtml(raw).replace(/\r?\n/g, '<br />');
}

/**
 * `1440×900` — with `@2x` only when the screen is not an ordinary one. A
 * report from a retina laptop and one from a 1x monitor look identical without
 * it, and they are not the same bug when the complaint is "blurry".
 */
export function formatViewport(viewport: FeedbackViewport): string {
  const size = `${viewport.width}×${viewport.height}`;
  const dpr = viewport.dpr;
  return dpr && dpr !== 1 ? `${size} @${dpr}x` : size;
}

export function formatApiError(error: FeedbackApiError): string {
  const when = error.at ? ` at ${escapeHtml(error.at)}` : '';
  return `${error.status} ${escapeHtml(error.path)} — ${escapeHtml(error.message)}${when}`;
}

/** Who filed it. */
export function issueWhoHtml(job: IssueBodyInput): string {
  const who = [`user: ${escapeHtml(job.userEmail || 'unknown')}`];
  if (job.teamName) who.push(`team: ${escapeHtml(job.teamName)}`);
  return `<p>${who.join(' · ')}</p>`;
}

/**
 * Where it happened. One line even when half of it is missing — omitted rather
 * than printed as "commit: null", because this is the line triage actually
 * reads.
 */
export function issueWhereHtml(job: IssueBodyInput): string {
  const where: string[] = [];
  if (job.url) where.push(`url: ${escapeHtml(job.url)}`);
  if (job.viewport.width || job.viewport.height) {
    where.push(`viewport: ${formatViewport(job.viewport)}`);
  }
  if (job.buildCommit) where.push(`commit: ${escapeHtml(job.buildCommit)}`);
  if (job.userAgent) where.push(`UA: ${escapeHtml(job.userAgent)}`);
  if (job.lastApiError) where.push(`lastApiError: ${formatApiError(job.lastApiError)}`);
  return where.length ? `<p>${where.join(' · ')}</p>` : '';
}

/**
 * Links to screenshots the tracker is not holding itself.
 *
 * The link needs auth, which is the point: the bytes stay behind the same check
 * as the app. Without a public URL there is nothing honest to print, so the
 * paragraph is simply absent.
 */
export function assetLinksHtml(
  publicUrl: string,
  assetIds: readonly string[],
  label: string,
): string {
  if (!publicUrl || !assetIds.length) return '';
  const base = publicUrl.replace(/\/+$/, '');
  const links = assetIds
    .map((id) => `<a href="${escapeHtml(`${base}/assets/${id}`)}">${escapeHtml(id)}</a>`)
    .join(' · ');
  return `<p>${escapeHtml(label)}: ${links}</p>`;
}

/**
 * The report as plain HTML: who, the text the user wrote, where, and links to
 * the screenshots.
 *
 * A string, not a function — a tracker with no renderer of its own has no way
 * to embed an image either, so there is nothing a second pass could change.
 */
export function defaultIssueBody(job: IssueBodyInput, publicUrl = ''): TrackerBody {
  const body = (job.blocks ?? [])
    .filter((block) => block.kind === 'text')
    .map((block) => `<p>${textBlock(block.text)}</p>`);
  if (!body.length) body.push(`<p>${textBlock(job.description)}</p>`);

  return [
    issueWhoHtml(job),
    ...body,
    issueWhereHtml(job),
    assetLinksHtml(publicUrl, job.assetIds, 'images (sign in to view)'),
  ]
    .filter(Boolean)
    .join('');
}

/**
 * The renderer to use for one tracker: its own, or the plain-HTML default.
 *
 * The caller asks for a renderer instead of importing an adapter, which is the
 * whole point — a server that imports `planeBody` only ships Plane.
 */
export function issueBodyRenderer(tracker: IssueTracker, publicUrl = ''): IssueBodyRenderer {
  const own = tracker.renderBody?.bind(tracker);
  return own ?? ((job) => defaultIssueBody(job, publicUrl));
}

/** Asset ids the upload pass produced no tracker id for. */
export function unattachedAssetIds(
  assetIds: readonly string[],
  assetIdByFileName: ReadonlyMap<string, string>,
): string[] {
  return assetIds.filter((assetId) => !assetIdByFileName.has(attachmentName(assetId)));
}

/**
 * One message from the reporter as plain HTML: who is speaking, what they
 * wrote, and links to whatever the tracker would not hold itself.
 *
 * A FUNCTION, unlike `defaultIssueBody`: a message is posted AFTER its images
 * have been offered to the tracker, so the renderer is told which of them
 * landed and only links the rest. Before the upload pass nothing has failed
 * yet — an image with no id is simply an image whose turn has not come.
 */
export function defaultCommentBody(input: CommentBodyInput, publicUrl = ''): TrackerBody {
  const body = input.blocks
    .filter((block) => block.kind === 'text')
    .map((block) => `<p>${textBlock(block.text)}</p>`);
  if (!body.length) body.push(`<p>${textBlock(input.text)}</p>`);

  return ({ assetIdByFileName, uploaded }) => {
    const failed = uploaded ? unattachedAssetIds(input.assetIds, assetIdByFileName) : [];
    return ['<p><em>Reporter said:</em></p>', ...body, assetLinksHtml(publicUrl, failed, 'images (sign in to view)')]
      .filter(Boolean)
      .join('');
  };
}

/** The comment markup for one tracker: its own, or the plain-HTML default. */
export function commentBodyRenderer(tracker: IssueTracker, publicUrl = ''): CommentBodyRenderer {
  const own = tracker.renderComment?.bind(tracker);
  return own ?? ((input) => defaultCommentBody(input, publicUrl));
}
