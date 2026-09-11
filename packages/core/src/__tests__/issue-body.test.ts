/**
 * The body a tracker with no opinion of its own receives.
 *
 * Every case here is silent when it is wrong: escaping our own `<p>` makes a
 * tracker render the literal string `&lt;p&gt;`, not escaping the user's text
 * puts their angle brackets into a triager's browser, and a body that quietly
 * drops the screen it happened on turns "blurry on retina" into "works for me".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commentBodyRenderer,
  defaultCommentBody,
  defaultIssueBody,
  formatViewport,
  issueBodyRenderer,
} from '../issue-body.js';
import { ok, type CommentBodyInput, type IssueBodyInput, type IssueTracker } from '../tracker.js';

function job(over: Partial<IssueBodyInput> = {}): IssueBodyInput {
  return {
    reportId: 'report-1',
    description: 'The Send button does nothing',
    userEmail: 'reporter@example.com',
    teamName: null,
    url: 'https://app.example/campaigns',
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0',
    buildCommit: null,
    lastApiError: null,
    assetIds: [],
    blocks: null,
    ...over,
  };
}

const plainTracker: IssueTracker = {
  async createIssue() {
    return ok({ externalId: 'issue-1', code: 'DEMO-1' });
  },
  async addComment() {
    return ok({ commentId: 'comment-1' });
  },
};

const html = (input: IssueBodyInput, publicUrl?: string): string => {
  const body = defaultIssueBody(input, publicUrl);
  assert.equal(typeof body, 'string', 'the default body has nothing to render twice');
  return body as string;
};

test('our tags stay raw while the user text is escaped', () => {
  const body = html(job({ description: 'breaks at <script>alert(1)</script> & after' }));

  assert.ok(body.startsWith('<p>user: reporter@example.com</p>'));
  assert.ok(!body.includes('&lt;p&gt;'));
  assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; after'));
  assert.ok(!body.includes('<script>'));
});

test('an ordinary screen prints no pixel ratio, a retina one does', () => {
  assert.equal(formatViewport({ width: 1440, height: 900 }), '1440×900');
  assert.equal(formatViewport({ width: 1440, height: 900, dpr: 1 }), '1440×900');
  assert.equal(formatViewport({ width: 1440, height: 900, dpr: 2 }), '1440×900 @2x');
});

test('the last API failure carries when it happened', () => {
  const body = html(
    job({
      lastApiError: {
        status: 500,
        path: '/api/v1/export',
        message: 'boom',
        at: '2026-01-01T10:00:00.000Z',
      },
    }),
  );

  assert.ok(body.includes('lastApiError: 500 /api/v1/export — boom at 2026-01-01T10:00:00.000Z'));
});

test('a block layout contributes its text, and never a broken image tag', () => {
  const body = html(
    job({
      blocks: [
        { kind: 'text', text: 'first' },
        { kind: 'image', assetId: 'asset-1' },
        { kind: 'text', text: 'second' },
      ],
      assetIds: ['asset-1'],
    }),
  );

  assert.ok(body.includes('<p>first</p><p>second</p>'));
  assert.ok(!body.includes('asset-1'));
});

test('screenshots are linked only when there is a URL that resolves them', () => {
  const withUrl = html(job({ assetIds: ['asset-1'] }), 'https://bugs.example.com/');
  assert.ok(withUrl.includes('<a href="https://bugs.example.com/assets/asset-1">'));

  assert.ok(!html(job({ assetIds: ['asset-1'] })).includes('<a '));
});

test('a tracker that renders its own markup is the one that renders', () => {
  const own: IssueTracker = { ...plainTracker, renderBody: (input) => `<p>${input.reportId}</p>` };

  assert.equal(issueBodyRenderer(own)(job()), '<p>report-1</p>');
  assert.ok(String(issueBodyRenderer(plainTracker)(job())).includes('reporter@example.com'));
});

// ─── one message from the reporter ───────────────────────────────

const message = (over: Partial<CommentBodyInput> = {}): CommentBodyInput => ({
  text: 'still broken after the reload',
  blocks: [],
  assetIds: [],
  ...over,
});

const comment = (input: CommentBodyInput, publicUrl = '', uploaded = true): string => {
  const body = defaultCommentBody(input, publicUrl);
  return typeof body === 'string' ? body : body({ assetIdByFileName: new Map(), uploaded });
};

test('a message says who is speaking and then what they wrote', () => {
  const html = comment(message());

  assert.ok(html.startsWith('<p><em>Reporter said:</em></p>'));
  assert.ok(html.includes('<p>still broken after the reload</p>'));
});

test('a message with a layout uses its own words, not the flattened text', () => {
  const html = comment(message({ blocks: [{ kind: 'text', text: 'first' }, { kind: 'text', text: 'second' }] }));

  assert.ok(html.includes('<p>first</p><p>second</p>'));
  assert.ok(!html.includes('still broken after the reload'));
});

test('only the screenshots the tracker refused are offered as links', () => {
  const input = message({ assetIds: ['asset-1'] });

  assert.ok(comment(input, 'https://bugs.example.com').includes('/assets/asset-1'));
  // Before the upload pass nothing has failed — an image is simply waiting.
  assert.ok(!comment(input, 'https://bugs.example.com', false).includes('/assets/asset-1'));
});

test('a tracker that renders its own comments is the one that renders', () => {
  const own: IssueTracker = { ...plainTracker, renderComment: (input) => `<p>${input.text}</p>` };

  assert.equal(commentBodyRenderer(own)(message()), '<p>still broken after the reload</p>');
  assert.ok(String(comment(message())).includes('Reporter said'));
});
