/**
 * Turning a report into HTML Plane will render.
 *
 * `description_html` and `comment_html` both take RAW html: escaping the `<p>`
 * wrappers makes Plane display the literal string `&lt;p&gt;`. So the tags are
 * ours and stay raw, while every interpolated VALUE is escaped — the text is
 * attacker-controlled and it is about to land in someone's browser.
 *
 * Its own module because three callers render: the create path, the edit path,
 * and the append comment. One of them getting a different escaping rule is
 * exactly the bug this file exists to make impossible.
 */
import type { FeedbackBlock } from '../../contract.js';
import type { TrackerBody } from '../../tracker.js';
import { attachmentName } from './attachments.js';

/**
 * Everything the renderers need about one report.
 *
 * Asset IDS only, never bytes: what goes on the wire is the adapter's business,
 * and a renderer that holds screenshots in memory is a renderer nobody can call
 * twice.
 */
export interface PlaneJob {
  reportId: string;
  title: string;
  description: string;
  userEmail: string;
  teamName: string | null;
  url: string;
  viewport: { width: number; height: number };
  userAgent: string;
  buildCommit: string | null;
  lastApiError: { status: number; path: string; message: string } | null;
  assetIds: string[];
  /** Ordered layout, or null for a report filed before the block editor. */
  blocks: FeedbackBlock[] | null;
  externalId: string | null;
}

/** Values only. The tags around them are ours and must reach Plane raw. */
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
 * Three paragraphs: who, what, where. The third one is what triage actually
 * reads, so it stays on one line even when half of it is missing — omitted
 * rather than printed as "commit: null".
 */
function buildWhoHtml(job: PlaneJob): string {
  const who = [`user: ${escapeHtml(job.userEmail || 'unknown')}`];
  if (job.teamName) who.push(`team: ${escapeHtml(job.teamName)}`);
  return `<p>${who.join(' · ')}</p>`;
}

function buildWhereHtml(job: PlaneJob): string {
  const where: string[] = [];
  if (job.url) where.push(`url: ${escapeHtml(job.url)}`);
  if (job.viewport.width || job.viewport.height) {
    where.push(`viewport: ${job.viewport.width}×${job.viewport.height}`);
  }
  if (job.buildCommit) where.push(`commit: ${escapeHtml(job.buildCommit)}`);
  if (job.userAgent) where.push(`UA: ${escapeHtml(job.userAgent)}`);
  if (job.lastApiError) {
    const error = job.lastApiError;
    where.push(
      `lastApiError: ${error.status} ${escapeHtml(error.path)} — ${escapeHtml(error.message)}`,
    );
  }
  return where.length ? `<p>${where.join(' · ')}</p>` : '';
}

export function buildDescriptionHtml(job: PlaneJob): string {
  return [buildWhoHtml(job), `<p>${textBlock(job.description)}</p>`, buildWhereHtml(job)]
    .filter(Boolean)
    .join('');
}

/**
 * The same three paragraphs, but with the user's own text and images
 * interleaved the way they wrote them.
 *
 * `<image-component src="{asset id}">` is how Plane's editor stores an inline
 * image, and the id it wants is a workspace asset id — which is exactly what
 * the attachment upload hands back, so one upload serves both the Attachments
 * panel and the inline render.
 *
 * That double duty is the safety net: images stay attached no matter what, so
 * if a Plane upgrade ever stops resolving inline ids every screenshot is still
 * one click away — nothing is lost, only the layout.
 *
 * Images the upload could not produce an id for are skipped here; the caller
 * adds the auth-scoped fallback links for those.
 */
export function buildBlockDescriptionHtml(
  job: PlaneJob,
  planeAssetIdByAssetId: ReadonlyMap<string, string>,
): string {
  const body: string[] = [];
  for (const block of job.blocks ?? []) {
    if (block.kind === 'text') {
      body.push(`<p>${textBlock(block.text)}</p>`);
      continue;
    }
    const planeAssetId = planeAssetIdByAssetId.get(block.assetId);
    if (planeAssetId) {
      body.push(`<image-component src="${escapeHtml(planeAssetId)}"></image-component>`);
    }
  }
  // Nothing renderable — fall back rather than ship an issue with a header and
  // no body. `description` always holds the same words.
  if (!body.length) return buildDescriptionHtml(job);

  return [buildWhoHtml(job), ...body, buildWhereHtml(job)].filter(Boolean).join('');
}

/**
 * Shown only for screenshots the attachment API refused. The link needs auth,
 * which is the point: the bytes stay behind the same check as the app.
 */
export function buildAssetFallbackHtml(publicUrl: string, assetIds: readonly string[]): string {
  if (!assetIds.length) return '';
  const base = publicUrl.replace(/\/+$/, '');
  const links = assetIds
    .map((id) => `<a href="${escapeHtml(`${base}/assets/${id}`)}">${escapeHtml(id)}</a>`)
    .join(' · ');
  return `<p>images (upload to Plane failed, sign in to view): ${links}</p>`;
}

/**
 * One message from the user, as a Plane comment.
 *
 * The comment editor is the same one the description uses, so the inline
 * `<image-component>` round-trips there too; the images are ALSO attachments,
 * so the worst case is a lost layout, never a lost screenshot.
 */
export function buildAppendCommentHtml(
  text: string,
  blocks: FeedbackBlock[] | null,
  planeAssetIdByAssetId: ReadonlyMap<string, string>,
): string {
  const body: string[] = ['<p><em>Reporter said:</em></p>'];

  if (blocks?.length) {
    for (const block of blocks) {
      if (block.kind === 'text') {
        body.push(`<p>${textBlock(block.text)}</p>`);
        continue;
      }
      const planeAssetId = planeAssetIdByAssetId.get(block.assetId);
      if (planeAssetId) {
        body.push(`<image-component src="${escapeHtml(planeAssetId)}"></image-component>`);
      }
    }
  } else {
    body.push(`<p>${textBlock(text)}</p>`);
  }

  return body.join('');
}

/**
 * The body of one report, as a `TrackerBody` the adapter can render TWICE.
 *
 * The issue is created with the plain paragraphs because no Plane asset id
 * exists yet; once the uploads land the adapter calls this again with
 * `file name → asset id` and gets the same words back with the images inline.
 * Screenshots Plane refused become auth-scoped links, which is why `publicUrl`
 * is worth configuring — without it a refused image is simply not mentioned.
 */
export function planeBody(job: PlaneJob, publicUrl = ''): TrackerBody {
  return ({ assetIdByFileName, uploaded }) => {
    const planeAssetIdByAssetId = new Map<string, string>();
    const failed: string[] = [];
    for (const assetId of job.assetIds) {
      const planeAssetId = assetIdByFileName.get(attachmentName(assetId));
      if (planeAssetId) planeAssetIdByAssetId.set(assetId, planeAssetId);
      else failed.push(assetId);
    }

    const body =
      planeAssetIdByAssetId.size && job.blocks?.length
        ? buildBlockDescriptionHtml(job, planeAssetIdByAssetId)
        : buildDescriptionHtml(job);
    // Before the upload pass nothing has FAILED yet — an image with no id is
    // simply an image whose turn has not come.
    return body + (uploaded && publicUrl ? buildAssetFallbackHtml(publicUrl, failed) : '');
  };
}
