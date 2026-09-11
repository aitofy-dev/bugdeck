import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { FEEDBACK_MAX_ASSETS, type FeedbackReport } from '@bugdeck/core';
import { createHarness, OTHER_USER, pngBlob, reportForm, USER } from './harness.js';

const fileReport = async (
  harness: ReturnType<typeof createHarness>,
  form: FormData,
  user = USER,
): Promise<Response> => harness.request('/reports', { method: 'POST', body: form }, user);

describe('POST /reports', () => {
  it('stores the report, derives a title and answers 201', async () => {
    const harness = createHarness();
    const response = await fileReport(
      harness,
      reportForm({ description: 'The export button does nothing. I tried twice.' }),
    );

    assert.equal(response.status, 201);
    const report = (await response.json()) as FeedbackReport;
    assert.equal(report.title, 'The export button does nothing');
    assert.equal(report.state, 'pending');
    assert.equal(report.description, 'The export button does nothing. I tried twice.');
    assert.deepEqual(report.assetIds, []);
    assert.equal('ownerId' in report, false);
  });

  it('swaps image positions in the block layout for the ids it just minted', async () => {
    const harness = createHarness();
    const response = await fileReport(
      harness,
      reportForm({
        description: 'Broken layout',
        images: [await pngBlob(), await pngBlob()],
        blocks: [
          { kind: 'text', text: 'before' },
          { kind: 'image', imageIndex: 1 },
        ],
      }),
    );

    const report = (await response.json()) as FeedbackReport;
    assert.equal(report.assetIds.length, 2);
    assert.deepEqual(report.blocks?.[0], { kind: 'text', text: 'before' });
    assert.deepEqual(report.blocks?.[1], { kind: 'image', assetId: report.assetIds[1] });
  });

  it('refuses a report with no description', async () => {
    const harness = createHarness();
    const response = await fileReport(harness, reportForm({ description: '   ' }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'MISSING_DESCRIPTION' });
  });

  it('refuses more images than the contract allows', async () => {
    const harness = createHarness();
    const image = await pngBlob();
    const response = await fileReport(
      harness,
      reportForm({
        description: 'Too many screenshots',
        images: Array.from({ length: FEEDBACK_MAX_ASSETS + 1 }, () => image),
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'TOO_MANY_IMAGES' });
  });

  it('refuses a file that is not a png, jpeg or webp', async () => {
    const harness = createHarness();
    const response = await fileReport(
      harness,
      reportForm({
        description: 'Here is my screenshot',
        images: [new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'image/png' })],
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'UNSUPPORTED_IMAGE' });
  });

  it('answers 429 once the hourly budget is spent, and says nothing else', async () => {
    const harness = createHarness({});
    for (let attempt = 0; attempt < 10; attempt++) {
      const allowed = await fileReport(harness, reportForm({ description: `report ${attempt}` }));
      assert.equal(allowed.status, 201);
    }

    const refused = await fileReport(harness, reportForm({ description: 'one too many' }));
    assert.equal(refused.status, 429);
    const body = (await refused.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ['error']);
    assert.equal(body.error, 'RATE_LIMITED');
  });

  it('counts the budget per user, not per server', async () => {
    const harness = createHarness();
    for (let attempt = 0; attempt < 10; attempt++) {
      await fileReport(harness, reportForm({ description: `report ${attempt}` }));
    }

    const other = await fileReport(harness, reportForm({ description: 'mine' }), OTHER_USER);
    assert.equal(other.status, 201);
  });

  it('files the report on the tracker after the response', async () => {
    const harness = createHarness();
    const response = await fileReport(
      harness,
      reportForm({ description: 'Files into the tracker', images: [await pngBlob()] }),
    );
    const report = (await response.json()) as FeedbackReport;

    const job = await harness.tracker.filed;
    assert.equal(job.externalSource, 'bugdeck');
    assert.equal(job.externalId, report.id);
    assert.equal(job.images.length, 1);
  });
});

describe('authentication', () => {
  it('answers 401 with no code when the host recognises nobody', async () => {
    const harness = createHarness();
    const response = await harness.request('/reports/mine', {}, null);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {});
  });
});

describe('GET /reports', () => {
  it('lists only my own reports, newest first, without their threads', async () => {
    const harness = createHarness();
    await fileReport(harness, reportForm({ description: 'mine one' }));
    await fileReport(harness, reportForm({ description: 'theirs' }), OTHER_USER);

    const response = await harness.request('/reports/mine');
    const body = (await response.json()) as { reports: FeedbackReport[] };
    assert.equal(body.reports.length, 1);
    assert.equal(body.reports[0]?.description, 'mine one');
    assert.equal('thread' in (body.reports[0] as object), false);
  });

  it('answers NOT_FOUND for a report belonging to someone else', async () => {
    const harness = createHarness();
    const created = (await (
      await fileReport(harness, reportForm({ description: 'private words' }))
    ).json()) as FeedbackReport;

    const mine = await harness.request(`/reports/${created.id}`);
    assert.equal(mine.status, 200);

    const theirs = await harness.request(`/reports/${created.id}`, {}, OTHER_USER);
    assert.equal(theirs.status, 404);
    assert.deepEqual(await theirs.json(), { error: 'NOT_FOUND' });
  });

  it('merges the stored thread into the single-report answer', async () => {
    const harness = createHarness();
    const created = (await (
      await fileReport(harness, reportForm({ description: 'still broken' }))
    ).json()) as FeedbackReport;
    await harness.store.appendThread(created.id, [
      { source: 'admin', text: 'fixed in 1.2', assetIds: [], at: '2026-01-02T00:00:00.000Z' },
      { source: 'user', text: 'not for me', assetIds: [], at: '2026-01-01T00:00:00.000Z' },
    ]);

    const response = await harness.request(`/reports/${created.id}`);
    const report = (await response.json()) as FeedbackReport;
    assert.deepEqual(
      report.thread?.map((entry) => entry.text),
      ['not for me', 'fixed in 1.2'],
    );
  });
});

describe('GET /assets/:id', () => {
  it('serves the owner the sanitised bytes, marked not to be sniffed', async () => {
    const harness = createHarness();
    const created = (await (
      await fileReport(harness, reportForm({ description: 'shot', images: [await pngBlob()] }))
    ).json()) as FeedbackReport;

    const response = await harness.request(`/assets/${created.assetIds[0]}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-disposition') ?? '', /^inline; /);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  });

  it('hides an asset from everyone but the owner of its report', async () => {
    const harness = createHarness();
    const created = (await (
      await fileReport(harness, reportForm({ description: 'shot', images: [await pngBlob()] }))
    ).json()) as FeedbackReport;

    const response = await harness.request(`/assets/${created.assetIds[0]}`, {}, OTHER_USER);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'NOT_FOUND' });
  });

  it('answers NOT_FOUND for an id that was never minted', async () => {
    const harness = createHarness();
    const response = await harness.request('/assets/00000000-0000-0000-0000-000000000000');
    assert.equal(response.status, 404);
  });
});
