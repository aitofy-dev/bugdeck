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
import {
  attachmentName,
  type CommentBodyInput,
  type IssueBodyInput,
  type TrackerBody,
} from '../../tracker.js';
import {
  assetLinksHtml,
  escapeHtml,
  issueWhereHtml,
  issueWhoHtml,
  textBlock,
  unattachedAssetIds,
} from '../../issue-body.js';

export function buildDescriptionHtml(job: IssueBodyInput): string {
  return [issueWhoHtml(job), `<p>${textBlock(job.description)}</p>`, issueWhereHtml(job)]
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
  job: IssueBodyInput,
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

  return [issueWhoHtml(job), ...body, issueWhereHtml(job)].filter(Boolean).join('');
}

/**
 * Shown only for screenshots the attachment API refused. The link needs auth,
 * which is the point: the bytes stay behind the same check as the app.
 */
export function buildAssetFallbackHtml(publicUrl: string, assetIds: readonly string[]): string {
  return assetLinksHtml(publicUrl, assetIds, 'images (upload to Plane failed, sign in to view)');
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

/** Our asset id → the Plane asset id the inline element wants. */
function planeAssetIds(
  assetIds: readonly string[],
  assetIdByFileName: ReadonlyMap<string, string>,
): Map<string, string> {
  const byAssetId = new Map<string, string>();
  for (const assetId of assetIds) {
    const planeAssetId = assetIdByFileName.get(attachmentName(assetId));
    if (planeAssetId) byAssetId.set(assetId, planeAssetId);
  }
  return byAssetId;
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
export function planeBody(job: IssueBodyInput, publicUrl = ''): TrackerBody {
  return ({ assetIdByFileName, uploaded }) => {
    const planeAssetIdByAssetId = planeAssetIds(job.assetIds, assetIdByFileName);
    const failed = unattachedAssetIds(job.assetIds, assetIdByFileName);

    const body =
      planeAssetIdByAssetId.size && job.blocks?.length
        ? buildBlockDescriptionHtml(job, planeAssetIdByAssetId)
        : buildDescriptionHtml(job);
    // Before the upload pass nothing has FAILED yet — an image with no id is
    // simply an image whose turn has not come.
    return body + (uploaded && publicUrl ? buildAssetFallbackHtml(publicUrl, failed) : '');
  };
}

/**
 * One message from the reporter, as a `TrackerBody` the adapter renders once
 * the message's images have been offered to Plane.
 *
 * Same double duty as the description: the images are attachments AND inline
 * `<image-component>` elements, so a Plane that ever stops resolving inline ids
 * costs the layout and never the screenshot. Whatever the upload refused
 * becomes an auth-scoped link instead of vanishing.
 */
export function planeCommentBody(input: CommentBodyInput, publicUrl = ''): TrackerBody {
  return ({ assetIdByFileName, uploaded }) => {
    const html = buildAppendCommentHtml(
      input.text,
      input.blocks,
      planeAssetIds(input.assetIds, assetIdByFileName),
    );
    // Before the upload pass nothing has FAILED yet — an image with no id is
    // simply an image whose turn has not come.
    const failed = uploaded ? unattachedAssetIds(input.assetIds, assetIdByFileName) : [];
    return html + buildAssetFallbackHtml(publicUrl, failed);
  };
}
