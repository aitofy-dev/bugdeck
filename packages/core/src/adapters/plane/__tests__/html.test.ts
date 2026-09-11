/**
 * What reaches Plane as markup.
 *
 * Every case here is silent when it is wrong: escaping our own `<p>` makes
 * Plane render the literal string `&lt;p&gt;`, and NOT escaping the user's text
 * puts their angle brackets straight into an admin's browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssetFallbackHtml,
  buildBlockDescriptionHtml,
  buildDescriptionHtml,
  planeBody,
  planeCommentBody,
} from '../html.js';
import { escapeHtml } from '../../../issue-body.js';
import { createPlaneTracker } from '../index.js';
import type { CommentBodyInput, IssueBodyInput, TrackerBody } from '../../../tracker.js';

const PUBLIC_URL = 'https://app.example';

function job(over: Partial<IssueBodyInput> = {}): IssueBodyInput {
  return {
    reportId: 'report-1',
    description: 'The Send button does nothing',
    userEmail: 'reporter@example.com',
    teamName: 'Alpha',
    url: 'https://app.example/campaigns',
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0',
    buildCommit: 'abc1234',
    lastApiError: { status: 500, path: '/api/v1/x', message: 'boom' },
    assetIds: [],
    blocks: null,
    ...over,
  };
}

test('the <p> wrappers stay raw while the user text is escaped', () => {
  const html = buildDescriptionHtml(job({ description: 'breaks at <script>alert(1)</script> & after' }));

  assert.ok(html.startsWith('<p>user: reporter@example.com · team: Alpha</p>'));
  assert.ok(!html.includes('&lt;p&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; after'));
  assert.ok(!html.includes('<script>'));
});

test('the third paragraph carries everything an admin triages from', () => {
  const html = buildDescriptionHtml(job());
  assert.ok(html.includes('url: https://app.example/campaigns'));
  assert.ok(html.includes('viewport: 1440×900'));
  assert.ok(html.includes('commit: abc1234'));
  assert.ok(html.includes('lastApiError: 500 /api/v1/x — boom'));
});

test('missing context is omitted, never printed as null', () => {
  const html = buildDescriptionHtml(
    job({
      teamName: null,
      url: '',
      viewport: { width: 0, height: 0 },
      userAgent: '',
      buildCommit: null,
      lastApiError: null,
    }),
  );
  assert.equal(
    html,
    '<p>user: reporter@example.com</p><p>The Send button does nothing</p>',
  );
  assert.ok(!html.includes('null'));
});

test('newlines survive as <br />, not as collapsed prose', () => {
  const html = buildDescriptionHtml(job({ description: 'step 1\nstep 2' }));
  assert.ok(html.includes('step 1<br />step 2'));
});

test('escapeHtml covers the four characters that can break out of a paragraph', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('the fallback block links back to the owner-scoped asset route', () => {
  const html = buildAssetFallbackHtml(PUBLIC_URL, ['aaa', 'bbb']);
  assert.ok(html.includes('https://app.example/assets/aaa'));
  assert.ok(html.includes('https://app.example/assets/bbb'));
  assert.equal(buildAssetFallbackHtml(PUBLIC_URL, []), '');
});

// ─── inline images ───────────────────────────────────────────────

/**
 * `<image-component src="{workspace asset id}">` is how Plane's editor stores
 * an inline image, and the id the attachment upload returns IS such an id. It
 * is private editor markup, which is why every image is ALSO an attachment: if
 * a Plane upgrade stops resolving inline ids, the layout is lost and not one
 * screenshot is.
 */
test('blocks render as text and inline images in the order the user wrote them', () => {
  const html = buildBlockDescriptionHtml(
    job({
      blocks: [
        { kind: 'text', text: 'click here' },
        { kind: 'image', assetId: 'a1' },
        { kind: 'text', text: 'and this happens' },
        { kind: 'image', assetId: 'a2' },
      ],
    }),
    new Map([
      ['a1', 'plane-asset-1'],
      ['a2', 'plane-asset-2'],
    ]),
  );

  const order = [...html.matchAll(/<p>click|<image-component src="([^"]+)"|<p>and this/g)].map(
    (match) => match[1] ?? match[0],
  );
  assert.deepEqual(order, ['<p>click', 'plane-asset-1', '<p>and this', 'plane-asset-2']);
  assert.ok(html.startsWith('<p>user: reporter@example.com'));
  assert.match(html, /<p>url: [^<]*<\/p>$/);
});

test('block text is escaped while the tags around it stay raw', () => {
  const html = buildBlockDescriptionHtml(
    job({ blocks: [{ kind: 'text', text: '<script>alert(1)</script> & after' }] }),
    new Map(),
  );
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; after'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('<p>'));
});

test('an image whose upload failed is skipped, not rendered as a broken component', () => {
  const html = buildBlockDescriptionHtml(
    job({
      blocks: [
        { kind: 'text', text: 'still here' },
        { kind: 'image', assetId: 'never-uploaded' },
      ],
    }),
    new Map(),
  );
  assert.ok(!html.includes('<image-component'));
  assert.ok(html.includes('still here'));
});

test('a layout with nothing renderable falls back to the plain description', () => {
  const one = job({ blocks: [{ kind: 'image', assetId: 'nope' }] });
  assert.equal(buildBlockDescriptionHtml(one, new Map()), buildDescriptionHtml(one));
});

test('a report with no blocks is untouched by the block path', () => {
  const one = job({ blocks: null });
  assert.equal(buildBlockDescriptionHtml(one, new Map()), buildDescriptionHtml(one));
});

// ─── the two-pass body ───────────────────────────────────────────

test('planeBody renders the plain body before any upload and the inline one after', () => {
  const body = planeBody(
    job({ assetIds: ['a1'], blocks: [{ kind: 'text', text: 'before' }, { kind: 'image', assetId: 'a1' }] }),
    PUBLIC_URL,
  );
  assert.equal(typeof body, 'function');
  if (typeof body === 'string') return;
  const before = body({ assetIdByFileName: new Map(), uploaded: false });
  const after = body({
    assetIdByFileName: new Map([['feedback-a1.png', 'plane-asset-9']]),
    uploaded: true,
  });

  assert.ok(!before.includes('<image-component'));
  // Before the upload pass nothing has failed, so nothing is offered as a link.
  assert.ok(!before.includes('/assets/a1'));
  assert.ok(after.includes('<image-component src="plane-asset-9"></image-component>'));
  assert.ok(!after.includes('/assets/a1'), 'an uploaded image needs no fallback link');
});

test('an image the upload could not place becomes an owner-scoped link', () => {
  const body = planeBody(job({ assetIds: ['a1'] }), PUBLIC_URL);
  assert.equal(typeof body, 'function');
  if (typeof body === 'string') return;
  assert.ok(body({ assetIdByFileName: new Map(), uploaded: true }).includes('/assets/a1'));
});

test('planeBody is byte-identical both ways when there is nothing to inline', () => {
  const body = planeBody(job(), PUBLIC_URL);
  assert.equal(typeof body, 'function');
  if (typeof body === 'string') return;
  // This equality is what stops the adapter spending a second PATCH on a
  // report that has no images.
  assert.equal(
    body({ assetIdByFileName: new Map(), uploaded: false }),
    body({ assetIdByFileName: new Map([['feedback-a1.png', 'x']]), uploaded: true }),
  );
});

// ─── one message from the reporter ───────────────────────────────

const message = (over: Partial<CommentBodyInput> = {}): CommentBodyInput => ({
  text: 'still broken after the reload',
  blocks: [],
  assetIds: [],
  ...over,
});

const rendered = (body: TrackerBody, assetIdByFileName: Map<string, string>): string =>
  typeof body === 'string' ? body : body({ assetIdByFileName, uploaded: true });

test('a comment gets its images back as Plane inline elements', () => {
  const body = planeCommentBody(
    message({
      blocks: [
        { kind: 'text', text: 'still broken' },
        { kind: 'image', assetId: 'a1' },
      ],
      assetIds: ['a1'],
    }),
    PUBLIC_URL,
  );

  const html = rendered(body, new Map([['feedback-a1.png', 'plane-asset-9']]));
  assert.ok(html.startsWith('<p><em>Reporter said:</em></p>'));
  assert.ok(html.includes('<image-component src="plane-asset-9"></image-component>'));
  assert.ok(!html.includes('/assets/a1'), 'an uploaded image needs no fallback link');
});

test('a comment image Plane refused becomes an owner-scoped link', () => {
  const body = planeCommentBody(message({ assetIds: ['a1'] }), PUBLIC_URL);

  assert.ok(rendered(body, new Map()).includes('/assets/a1'));
  // Before the upload pass nothing has failed yet.
  assert.equal(typeof body, 'function');
  if (typeof body === 'function') {
    assert.ok(!body({ assetIdByFileName: new Map(), uploaded: false }).includes('/assets/a1'));
  }
});

test('the adapter renders its own comments, so a host never names Plane markup', () => {
  const tracker = createPlaneTracker({
    baseUrl: 'https://plane.example.com',
    apiKey: 'k',
    workspaceSlug: 'acme',
    projectId: 'project-1',
    publicUrl: PUBLIC_URL,
  });

  const body = tracker.renderComment?.(
    message({ blocks: [{ kind: 'image', assetId: 'a1' }], assetIds: ['a1'] }),
  );
  assert.ok(body);
  assert.ok(rendered(body, new Map([['feedback-a1.png', 'plane-asset-9']])).includes('<image-component'));
});
