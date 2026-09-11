import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { FEEDBACK_MAX_COMMENTS, type FeedbackReport } from '@aitofy/bugdeck-core';
import { createHarness, OTHER_USER, pngBlob, reportForm, until, USER } from './harness.js';
import type { StoredThreadEntry } from '../store.js';

type Harness = ReturnType<typeof createHarness>;

async function fileReport(harness: Harness, form: FormData): Promise<FeedbackReport> {
  const response = await harness.request('/reports', { method: 'POST', body: form });
  assert.equal(response.status, 201);
  return (await response.json()) as FeedbackReport;
}

const patch = (harness: Harness, id: string, form: FormData, user = USER): Promise<Response> =>
  harness.request(`/reports/${id}`, { method: 'PATCH', body: form }, user);

const comment = (harness: Harness, id: string, form: FormData, user = USER): Promise<Response> =>
  harness.request(`/reports/${id}/comment`, { method: 'POST', body: form }, user);

describe('PATCH /reports/:id', () => {
  it('rewrites the description and re-derives the title while nobody has read it', async () => {
    const harness = createHarness();
    const report = await fileReport(harness, reportForm({ description: 'Export is brokn' }));

    const response = await patch(
      harness,
      report.id,
      reportForm({ description: 'Export is broken. It downloads an empty file.' }),
    );

    assert.equal(response.status, 200);
    const updated = (await response.json()) as FeedbackReport;
    assert.equal(updated.title, 'Export is broken');
    assert.equal(updated.description, 'Export is broken. It downloads an empty file.');
    assert.equal(updated.state, 'pending');
  });

  it('refuses an edit once the report has been picked up', async () => {
    const harness = createHarness();
    const report = await fileReport(harness, reportForm({ description: 'Export is broken' }));
    await harness.store.updateReport(report.id, { state: 'doing' });

    const response = await patch(harness, report.id, reportForm({ description: 'Actually fine' }));

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'NOT_PENDING' });
  });

  it('keeps the images it is handed by id and appends the ones it is handed as files', async () => {
    const harness = createHarness();
    const report = await fileReport(
      harness,
      reportForm({
        description: 'Broken layout',
        images: [await pngBlob(), await pngBlob()],
        blocks: [
          { kind: 'image', imageIndex: 0 },
          { kind: 'image', imageIndex: 1 },
        ],
      }),
    );
    const [kept, dropped] = report.assetIds;

    // One file in the body, so the annotated image is `imageIndex: 0` — the
    // index counts the parts actually sent, never the images the report has.
    const response = await patch(
      harness,
      report.id,
      reportForm({
        description: 'Broken layout, annotated',
        images: [await pngBlob()],
        blocks: [
          { kind: 'image', assetId: kept },
          { kind: 'text', text: 'this one is wrong' },
          { kind: 'image', imageIndex: 0 },
        ],
      }),
    );

    const updated = (await response.json()) as FeedbackReport;
    const added = updated.assetIds.find((assetId) => assetId !== kept);
    assert.equal(updated.assetIds.length, 2);
    assert.deepEqual(updated.blocks?.[0], { kind: 'image', assetId: kept });
    assert.deepEqual(updated.blocks?.[2], { kind: 'image', assetId: added });
    assert.equal(updated.assetIds.includes(dropped as string), false);
  });

  it('refuses an id the caller does not own, as a 404', async () => {
    const harness = createHarness();
    const report = await fileReport(harness, reportForm({ description: 'Export is broken' }));

    const response = await patch(
      harness,
      report.id,
      reportForm({ description: 'Not mine' }),
      OTHER_USER,
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'NOT_FOUND' });
  });

  it('pushes the edit onto the issue once the tracker has one', async () => {
    const harness = createHarness();
    const report = await fileReport(harness, reportForm({ description: 'Export is brokn' }));
    await harness.tracker.filed;
    await until(async () => Boolean((await harness.store.getReport(report.id))?.externalId));

    await patch(harness, report.id, reportForm({ description: 'Export is broken for real' }));
    await until(() => harness.tracker.updates.length === 1);

    const update = harness.tracker.updates[0];
    assert.equal(update?.externalId, 'issue-1');
    assert.equal(update?.input.title, 'Export is broken for real');
  });
});

describe('POST /reports/:id/comment', () => {
  it('is allowed on a report the admin already closed', async () => {
    const harness = createHarness();
    const report = await fileReport(harness, reportForm({ description: 'Export is broken' }));
    await harness.store.updateReport(report.id, { state: 'done' });

    const response = await comment(
      harness,
      report.id,
      reportForm({ description: 'Still broken on my machine.', images: [await pngBlob()] }),
    );

    assert.equal(response.status, 201);
    const updated = (await response.json()) as FeedbackReport;
    const entry = updated.thread?.[0];
    assert.equal(updated.thread?.length, 1);
    assert.equal(entry?.source, 'user');
    assert.equal(entry?.text, 'Still broken on my machine.');
    assert.equal(entry?.assetIds.length, 1);
    assert.equal(typeof entry?.at, 'string');
  });

  it('shows the new entry on GET /reports/:id', async () => {
    const harness = createHarness();
    const report = await fileReport(harness, reportForm({ description: 'Export is broken' }));
    await comment(harness, report.id, reportForm({ description: 'Any news?' }));

    const response = await harness.request(`/reports/${report.id}`);
    const fetched = (await response.json()) as FeedbackReport;

    assert.equal(fetched.thread?.length, 1);
    assert.equal(fetched.thread?.[0]?.text, 'Any news?');
    assert.equal('commentId' in (fetched.thread?.[0] ?? {}), false);
  });

  it('keeps a message written before the issue existed, and posts it after', async () => {
    const harness = createHarness({ held: true });
    const report = await fileReport(harness, reportForm({ description: 'Export is broken' }));

    const response = await comment(harness, report.id, reportForm({ description: 'Any news?' }));
    assert.equal(response.status, 201);
    assert.equal(harness.tracker.comments.length, 0);
    const held = await harness.store.getReport(report.id);
    assert.equal(held?.thread?.length, 1);
    assert.equal((held?.thread?.[0] as StoredThreadEntry | undefined)?.commentId, undefined);

    harness.tracker.release();
    await until(() => harness.tracker.comments.length === 1);

    assert.match(harness.tracker.comments[0]?.html ?? '', /Any news\?/);
    const flushed = await harness.store.getReport(report.id);
    assert.equal((flushed?.thread?.[0] as StoredThreadEntry | undefined)?.commentId, 'comment-1');
  });

  it('uploads the images it brought and links only what the tracker refused', async () => {
    const harness = createHarness();
    const report = await fileReport(harness, reportForm({ description: 'Export is broken' }));
    await harness.tracker.filed;

    await comment(
      harness,
      report.id,
      reportForm({ description: 'Here is the console', images: [await pngBlob()] }),
    );
    await until(() => harness.tracker.comments.length === 1);

    assert.equal(harness.tracker.uploads.length, 1);
    assert.equal((harness.tracker.comments[0]?.html ?? '').includes('/assets/'), false);
  });

  it('refuses one message past the cap', async () => {
    const harness = createHarness();
    const report = await fileReport(harness, reportForm({ description: 'Export is broken' }));
    const full: StoredThreadEntry[] = Array.from({ length: FEEDBACK_MAX_COMMENTS }, (_, turn) => ({
      source: 'user',
      text: `message ${turn}`,
      assetIds: [],
      at: new Date().toISOString(),
      commentId: `comment-${turn}`,
    }));
    await harness.store.appendThread(report.id, full);

    const response = await comment(harness, report.id, reportForm({ description: 'One more' }));

    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: 'RATE_LIMITED' });
  });
});
