import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { attachmentName } from '@bugdeck/core';
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
    viewport: { width: 1280, height: 720 },
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

const render = (job: ReturnType<typeof buildCreateIssueJob>, uploaded: Map<string, string>): string => {
  const body = job.descriptionHtml;
  return typeof body === 'string'
    ? body
    : body({ assetIdByFileName: uploaded, uploaded: uploaded.size > 0 });
};

describe('buildCreateIssueJob', () => {
  it('keys the issue on the report so a retry adopts it', () => {
    const job = buildCreateIssueJob(REPORT, [ASSET]);

    assert.equal(job.externalSource, BUGDECK_EXTERNAL_SOURCE);
    assert.equal(job.externalId, REPORT.id);
    assert.equal(job.title, 'Export is broken');
  });

  it('names every file after its asset id, never after what the user called it', () => {
    const job = buildCreateIssueJob(REPORT, [ASSET]);

    assert.deepEqual(
      job.images.map((file) => file.name),
      [attachmentName('asset-1')],
    );
  });

  it('renders once without the images and again with them', () => {
    const job = buildCreateIssueJob(REPORT, [ASSET]);

    const before = render(job, new Map());
    assert.equal(before.includes('image-component'), false);
    assert.equal(before.includes('reporter@example.com'), true);

    const after = render(job, new Map([[attachmentName('asset-1'), 'plane-asset-1']]));
    assert.equal(after.includes('<image-component src="plane-asset-1">'), true);
  });

  it('links an image the tracker refused, when a public url is configured', () => {
    const job = buildCreateIssueJob(REPORT, [ASSET], 'https://bugs.example.com');

    const after = render(job, new Map([['other-file.png', 'plane-asset-9']]));
    assert.equal(after.includes('https://bugs.example.com/assets/asset-1'), true);
  });
});
