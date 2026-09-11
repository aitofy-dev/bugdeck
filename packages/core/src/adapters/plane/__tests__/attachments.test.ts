/**
 * Plane's three-step attachment flow, and the bookkeeping around it.
 *
 * Every fact here was measured, and every one of them is invisible when broken:
 * skip the PATCH and the file sits in storage while Plane shows nothing; send
 * the file part before the presigned fields and object storage rejects it;
 * declare a size that is not the exact byte count and the presign policy does
 * the same; forget the name-based dedupe and a retried run decorates the issue
 * with a second copy of every screenshot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { silentLogger, type CreateIssueJob } from '../../../tracker.js';
import { createPlaneTracker, planeBody, type PlaneJob } from '../index.js';
import { CONFIG, fakePlane, OK_PROJECT, OK_STATES, png } from './fake-plane.js';

const PRESIGN = (assetId: string) => ({
  asset_id: assetId,
  upload_data: { url: 'https://storage.example/uploads', fields: { key: 'k', policy: 'p' } },
});

function tracker(fetchImpl: typeof fetch) {
  return createPlaneTracker({
    ...CONFIG,
    fetch: fetchImpl,
    logger: silentLogger,
    sleep: async () => {},
  });
}

function job(over: Partial<CreateIssueJob> = {}): CreateIssueJob {
  return {
    title: 'broken',
    descriptionHtml: '<p>broken</p>',
    externalSource: 'bugdeck',
    externalId: 'report-1',
    images: [],
    ...over,
  };
}

function reportJob(over: Partial<PlaneJob> = {}): PlaneJob {
  return {
    reportId: 'report-1',
    title: 'broken',
    description: 'broken',
    userEmail: 'reporter@example.com',
    teamName: null,
    url: 'https://app.example/x',
    viewport: { width: 1440, height: 900 },
    userAgent: 'UA',
    buildCommit: null,
    lastApiError: null,
    assetIds: [],
    blocks: null,
    externalId: null,
    ...over,
  };
}

test('an upload is three steps: presign, storage, then mark uploaded', async () => {
  const plane = fakePlane({
    'POST /issues/issue-1/issue-attachments/': () => [200, PRESIGN('asset-1')],
    'POST /uploads': () => [204, {}],
    'PATCH /issues/issue-1/issue-attachments/asset-1/': () => [204, {}],
  });
  const out = await tracker(plane.impl).uploadAttachment?.('issue-1', png([1, 2, 3]));

  assert.equal(out?.ok, true);
  if (!out?.ok) return;
  assert.deepEqual(out.value, { assetId: 'asset-1', name: 'feedback-a1.png' });
  assert.deepEqual(
    plane.calls.map((call) => `${call.method} ${call.url}`),
    [
      'POST https://plane.example.com/api/v1/workspaces/demo/projects/proj-1/issues/issue-1/issue-attachments/',
      'POST https://storage.example/uploads',
      'PATCH https://plane.example.com/api/v1/workspaces/demo/projects/proj-1/issues/issue-1/issue-attachments/asset-1/',
    ],
  );
});

test('the declared size is the exact byte count, because the policy pins it', async () => {
  const plane = fakePlane({
    'POST /issues/issue-1/issue-attachments/': () => [200, PRESIGN('asset-1')],
    'POST /uploads': () => [204, {}],
    'PATCH /issues/issue-1/issue-attachments/asset-1/': () => [204, {}],
  });
  await tracker(plane.impl).uploadAttachment?.('issue-1', png([1, 2, 3, 4, 5]));

  const meta = plane.calls[0].body as { name: string; type: string; size: number };
  assert.deepEqual(meta, { name: 'feedback-a1.png', type: 'image/png', size: 5 });
});

test('the storage POST sends the fields first, the file last, and no API key', async () => {
  let form: FormData | null = null;
  const plane = fakePlane({
    'POST /issues/issue-1/issue-attachments/': () => [200, PRESIGN('asset-1')],
    'POST /uploads': () => [204, {}],
    'PATCH /issues/issue-1/issue-attachments/asset-1/': () => [204, {}],
  });
  const spy: typeof fetch = async (input, init) => {
    if (String(input) === 'https://storage.example/uploads') {
      form = init?.body as FormData;
      assert.equal((init?.headers as Record<string, string> | undefined)?.['X-API-Key'], undefined);
    }
    return plane.impl(input, init);
  };
  await tracker(spy).uploadAttachment?.('issue-1', png([7]));

  assert.ok(form, 'the storage step never ran');
  // Insertion order into FormData is the wire order, and S3 form posts require
  // the file part LAST.
  assert.deepEqual([...(form as FormData).keys()], ['key', 'policy', 'file']);
});

// ─── dedupe ──────────────────────────────────────────────────────

test('adopting an issue does not re-upload the screenshots it already has', async () => {
  let uploads = 0;
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => [409, { error: 'duplicate', id: 'issue-old' }],
    'GET /issues/issue-old/': () => [200, { id: 'issue-old', sequence_id: 7 }],
    'GET /issues/issue-old/issue-attachments/': () => [
      200,
      [{ attributes: { name: 'feedback-a1.png' } }],
    ],
    'POST /issues/issue-old/issue-attachments/': () => {
      uploads++;
      return [200, PRESIGN('x')];
    },
  });

  const out = await tracker(plane.impl).createIssue(job({ images: [png([1])] }));
  assert.equal(out.ok, true);
  // Observed for real before this guard existed: the adopted issue ended up
  // holding two copies of the same screenshot.
  assert.equal(uploads, 0);
});

test('an image the adopted issue lacks is still uploaded', async () => {
  const uploaded: string[] = [];
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => [409, { error: 'duplicate', id: 'issue-old' }],
    'GET /issues/issue-old/': () => [200, { id: 'issue-old', sequence_id: 7 }],
    'GET /issues/issue-old/issue-attachments/': () => [
      200,
      [{ attributes: { name: 'feedback-a1.png' } }],
    ],
    'POST /issues/issue-old/issue-attachments/': () => [200, PRESIGN('x')],
    'POST /uploads': () => [204, {}],
    'PATCH /issues/issue-old/issue-attachments/x/': () => [204, {}],
  });
  const spy: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/issues/issue-old/issue-attachments/') && init?.method === 'POST') {
      uploaded.push(String(JSON.parse(String(init.body)).name));
    }
    return plane.impl(input, init);
  };

  assert.equal((await tracker(spy).createIssue(job({ images: [png([1]), png([2])] }))).ok, true);
  assert.deepEqual(uploaded, ['feedback-a2.png']);
});

// ─── what the body does about it ─────────────────────────────────

test('a screenshot Plane refuses becomes a link, and the report still files', async () => {
  const patched: string[] = [];
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => [201, { id: 'issue-1', sequence_id: 5 }],
    'POST /issues/issue-1/issue-attachments/': () => [413, { error: 'too large' }],
    'PATCH /issues/issue-1/': () => [204, {}],
  });
  const spy: typeof fetch = async (input, init) => {
    if (init?.method === 'PATCH' && String(input).endsWith('/issues/issue-1/')) {
      patched.push(String(JSON.parse(String(init.body)).description_html));
    }
    return plane.impl(input, init);
  };

  const out = await tracker(spy).createIssue(
    job({
      images: [png([1])],
      descriptionHtml: planeBody(reportJob({ assetIds: ['a1'] }), CONFIG.publicUrl),
    }),
  );
  // The user's report is not held hostage by a screenshot.
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.value.code, 'DEMO-5');
  // The create carried the plain body; only once the upload had actually
  // failed is the link worth showing.
  assert.equal(patched.length, 1);
  assert.ok(patched[0].includes('/assets/a1'));
  assert.ok(patched[0].startsWith('<p>user:'));
});

test('a layout with images is rewritten once the uploads have ids', async () => {
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => [201, { id: 'issue-1', sequence_id: 21 }],
    'POST /issues/issue-1/issue-attachments/': () => [200, PRESIGN('plane-asset-9')],
    'POST /uploads': () => [204, {}],
    'PATCH /issues/issue-1/issue-attachments/plane-asset-9/': () => [204, {}],
    'PATCH /issues/issue-1/': () => [200, {}],
  });

  await tracker(plane.impl).createIssue(
    job({
      images: [png([1])],
      descriptionHtml: planeBody(
        reportJob({
          assetIds: ['a1'],
          blocks: [
            { kind: 'text', text: 'before the picture' },
            { kind: 'image', assetId: 'a1' },
          ],
        }),
        CONFIG.publicUrl,
      ),
    }),
  );

  const patch = plane.calls.find(
    (call) => call.method === 'PATCH' && call.url.endsWith('/issues/issue-1/'),
  );
  assert.ok(patch, 'the description was never rewritten');
  const html = String((patch.body as { description_html: string }).description_html);
  assert.ok(html.includes('<image-component src="plane-asset-9"></image-component>'));
  assert.ok(html.includes('before the picture'));
});

test('a report whose images all landed is not rewritten either', async () => {
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => [201, { id: 'issue-1', sequence_id: 21 }],
    'POST /issues/issue-1/issue-attachments/': () => [200, PRESIGN('plane-asset-9')],
    'POST /uploads': () => [204, {}],
    'PATCH /issues/issue-1/issue-attachments/plane-asset-9/': () => [204, {}],
  });

  // No blocks, so there is no layout to inline and nothing to correct: the
  // screenshot is on the issue and the body never mentioned it.
  await tracker(plane.impl).createIssue(
    job({
      images: [png([1])],
      descriptionHtml: planeBody(reportJob({ assetIds: ['a1'] }), CONFIG.publicUrl),
    }),
  );
  assert.equal(
    plane.calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/issues/issue-1/'))
      .length,
    0,
  );
});

test('a report with no images is not rewritten at all — one call less to Plane', async () => {
  const plane = fakePlane({
    'GET /projects/proj-1/': OK_PROJECT,
    'GET /states/': OK_STATES,
    'POST /issues/': () => [201, { id: 'issue-1', sequence_id: 21 }],
  });

  await tracker(plane.impl).createIssue(
    job({ descriptionHtml: planeBody(reportJob(), CONFIG.publicUrl) }),
  );
  assert.equal(
    plane.calls.filter((call) => call.method === 'PATCH').length,
    0,
  );
});
