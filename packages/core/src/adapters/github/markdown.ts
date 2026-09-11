/**
 * One report as GitHub Markdown, and the hidden marker a retry recognises.
 *
 * GitHub's REST API takes Markdown, not HTML, and has no attachment upload —
 * so a screenshot is a link back to our own asset route. Every interpolated
 * value is ESCAPED: a description able to write `#` or `<!--` could forge the
 * header lines triage reads and the marker the dedupe looks for.
 */
import type { FeedbackApiError, FeedbackBlock } from '../../contract.js';
import { formatViewport } from '../../issue-body.js';
import type { CommentBodyInput, IssueBodyInput } from '../../tracker.js';

/** Inline constructs: code, emphasis, links, images, raw HTML, tables. */
const MARKDOWN_INLINE = /[\\`*_[\]<>|~]/g;

/**
 * Values only. Line-start constructs are escaped per line, which is where a
 * heading, a quote or a list item is the only place they mean anything.
 */
export function escapeMarkdown(raw: string): string {
  return raw
    .replace(MARKDOWN_INLINE, '\\$&')
    .replace(/^([ \t]*)([#>+-])/gm, '$1\\$2')
    .replace(/^([ \t]*\d+)\./gm, '$1\\.');
}

// ─── the marker ──────────────────────────────────────────────────

export const MARKER_PREFIX = 'bugdeck:report:';

/**
 * GitHub has no `external_id`, so the report id travels in the body itself.
 * Anything outside the id alphabet is dropped: a report id carrying `-->`
 * would otherwise close the comment and print the rest of it to the page.
 */
export function markerTerm(externalId: string): string {
  return `${MARKER_PREFIX}${externalId.replace(/[^\w.:-]/g, '')}`;
}

export function markerFor(externalId: string): string {
  return `<!-- ${markerTerm(externalId)} -->`;
}

/** Whole comment, never the term alone: `report-1` is a prefix of `report-12`. */
export function hasMarker(body: string | null | undefined, externalId: string): boolean {
  return Boolean(body?.includes(markerFor(externalId)));
}

/** Filed by us at all — the filter the poller applies to a repo it shares. */
export function hasAnyMarker(body: string | null | undefined): boolean {
  return Boolean(body?.includes(`<!-- ${MARKER_PREFIX}`));
}

export function withMarker(body: string, externalId: string): string {
  return hasMarker(body, externalId) ? body : `${body.trimEnd()}\n\n${markerFor(externalId)}`;
}

/**
 * The marker comment as it stands in an issue body we did not render.
 *
 * An edit rewrites the whole body, and a rewrite that drops the marker files a
 * duplicate issue on the next retry — so the old one is read back and carried
 * over whenever the new text has none of its own.
 */
export function readMarker(body: string | null | undefined): string | null {
  return /<!-- bugdeck:report:[\w.:-]+ -->/.exec(body ?? '')?.[0] ?? null;
}

// ─── the report ──────────────────────────────────────────────────

function apiErrorText(error: FeedbackApiError): string {
  const when = error.at ? ` at ${escapeMarkdown(error.at)}` : '';
  return `${error.status} ${escapeMarkdown(error.path)} — ${escapeMarkdown(error.message)}${when}`;
}

function whoLine(job: IssueBodyInput): string {
  const who = [`user: ${escapeMarkdown(job.userEmail || 'unknown')}`];
  if (job.teamName) who.push(`team: ${escapeMarkdown(job.teamName)}`);
  return who.join(' · ');
}

/** Omitted rather than printed as `commit: null`; triage reads this line. */
function whereLine(job: IssueBodyInput): string {
  const where: string[] = [];
  if (job.url) where.push(`url: ${escapeMarkdown(job.url)}`);
  if (job.viewport.width || job.viewport.height) {
    where.push(`viewport: ${formatViewport(job.viewport)}`);
  }
  if (job.buildCommit) where.push(`commit: ${escapeMarkdown(job.buildCommit)}`);
  if (job.userAgent) where.push(`UA: ${escapeMarkdown(job.userAgent)}`);
  if (job.lastApiError) where.push(`lastApiError: ${apiErrorText(job.lastApiError)}`);
  return where.join(' · ');
}

/**
 * The bytes stay behind the same auth check as the app, so this link needs a
 * signed-in browser — and without a public URL there is nothing honest to
 * print, which is why a screenshot then goes unmentioned.
 */
function imageMarkdown(publicUrl: string, assetId: string): string {
  if (!publicUrl) return '';
  return `![](${publicUrl.replace(/\/+$/, '')}/assets/${assetId})`;
}

/** The user's own text and images, in the order they wrote them. */
function contentParts(
  text: string,
  blocks: readonly FeedbackBlock[],
  assetIds: readonly string[],
  publicUrl: string,
): string[] {
  const parts: string[] = [];
  const shown = new Set<string>();
  for (const block of blocks) {
    if (block.kind === 'text') {
      parts.push(escapeMarkdown(block.text));
      continue;
    }
    shown.add(block.assetId);
    parts.push(imageMarkdown(publicUrl, block.assetId));
  }
  if (!parts.filter(Boolean).length) parts.push(escapeMarkdown(text));
  // Screenshots the layout never referenced still belong on the issue.
  for (const assetId of assetIds) {
    if (!shown.has(assetId)) parts.push(imageMarkdown(publicUrl, assetId));
  }
  return parts;
}

/**
 * The whole body: who, what they wrote, where, then the marker LAST so the
 * dedupe reads the same string it wrote even after someone edits the issue.
 *
 * A string, not a function — GitHub has no attachment ids to wait for, so
 * there is nothing a second render pass could change.
 */
export function githubBody(job: IssueBodyInput, publicUrl = ''): string {
  const body = contentParts(job.description, job.blocks ?? [], job.assetIds, publicUrl);
  return [whoLine(job), ...body, whereLine(job), markerFor(job.reportId)]
    .filter(Boolean)
    .join('\n\n');
}

// ─── comments ────────────────────────────────────────────────────

const LOOKS_LIKE_HTML = /<\/?[a-z][^>]*>/i;

/**
 * Comment HTML → text. A block close becomes a BLANK line before tags are
 * stripped: Markdown reads one newline as a soft wrap, so without it a
 * two-paragraph reply arrives as one run-on sentence.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * What to POST as a comment body.
 *
 * The caller may hand us either: a host rendering for Plane sends HTML, which
 * GitHub would print as literal tags, so it is flattened to text and escaped.
 * Markdown written for GitHub is passed through untouched.
 */
export function commentMarkdown(body: string): string {
  return LOOKS_LIKE_HTML.test(body) ? escapeMarkdown(htmlToText(body)) : body;
}

/**
 * One message from the reporter, as Markdown.
 *
 * No attachment API and therefore no second render pass: every screenshot is a
 * link back to our own asset route, which needs a signed-in browser — and
 * without a public URL there is nothing honest to print, so it goes unmentioned.
 */
export function githubCommentBody(input: CommentBodyInput, publicUrl = ''): string {
  return ['*Reporter said:*', ...contentParts(input.text, input.blocks, input.assetIds, publicUrl)]
    .filter(Boolean)
    .join('\n\n');
}
