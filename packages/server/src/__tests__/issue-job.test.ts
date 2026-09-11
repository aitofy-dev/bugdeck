import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { attachmentName, issueBodyRenderer, ok, type IssueTracker } from '@bugdeck/core';
import { buildCreateIssueJob, BUGDECK_EXTERNAL_SOURCE } from '../issue-job.js';
import type { StoredAsset, StoredReport } from '../store.js';

const REPORT: StoredReport = {
  id: 'report-1',
  ownerId: 'user-1',
  ownerEmail: 'reporter@example.com',
  title: 'Export is broken',
  description: 'Export is broken',
  state: 'pending',
  context: {
    url: 'https://app.example.com/reports',
    viewport: { width: 1280, height: 720, dpr: 2 },
    userAgent: 'Mozilla/5.0',
  },
  assetIds: ['asset-1'],
  blocks: [
    { kind: 'text', text: 'before' },
    { kind: 'image', assetId: 'asset-1' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ASSET: StoredAsset = {
  id: 'asset-1',
  reportId: 'report-1',
  mime: 'image/png',
  width: 4,
  height: 4,
  bytes: new Uint8Array([1, 2, 3]),
};

/** A tracker with no markup of its own — the plain-HTML path. */
const plainTracker: IssueTracker = {
  async createIssue() {
    return ok({ externalId: 'issue-1', code: 'DEMO-1' });
  },
  async addComment() {
    return ok({ commentId: 'comment-1' });
  },
};

const render = (job: ReturnType<typeof buildCreateIssueJob>): string => {
  const body = job.descriptionHtml;
  return typeof body === 'string' ? body : body({ assetIdByFileName: new Map(), uploaded: true });
};

describe('buildCreateIssueJob', () => {
  it('keys the issue on the report so a retry adopts it', () => {
    const job = buildCreateIssueJob(REPORT, [ASSET], issueBodyRenderer(plainTracker));

    assert.equal(job.externalSource, BUGDECK_EXTERNAL_SOURCE);
    assert.equal(job.externalId, REPORT.id);
    assert.equal(job.title, 'Export is broken');
  });

  it('names every file after its asset id, never after what the user called it', () => {
    const job = buildCreateIssueJob(REPORT, [ASSET], issueBodyRenderer(plainTracker));

    assert.deepEqual(
      job.images.map((file) => file.name),
      [attachmentName('asset-1')],
    );
  });

  it('renders the body with the markup the tracker asked for', () => {
    const marked: IssueTracker = { ...plainTracker, renderBody: (input) => `<p>${input.reportId}</p>` };

    const job = buildCreateIssueJob(REPORT, [ASSET], issueBodyRenderer(marked));

    assert.equal(render(job), '<p>report-1</p>');
  });

  it('falls back to plain HTML, with the screen it happened on, when the tracker has none', () => {
    const renderBody = issueBodyRenderer(plainTracker, 'https://bugs.example.com');

    const html = render(buildCreateIssueJob(REPORT, [ASSET], renderBody));

    assert.equal(html.includes('reporter@example.com'), true);
    assert.equal(html.includes('viewport: 1280×720 @2x'), true);
    assert.equal(html.includes('https://bugs.example.com/assets/asset-1'), true);
    assert.equal(html.includes('image-component'), false);
  });
});
