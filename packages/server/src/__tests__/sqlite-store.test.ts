import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createSqliteStore, type SqliteFeedbackStore } from '../sqlite-store.js';
import type { NewReport } from '../store.js';

const report = (id: string, ownerId = 'user-1'): NewReport => ({
  id,
  ownerId,
  ownerEmail: 'reporter@example.com',
  title: 'Export is broken',
  description: 'Export is broken, every time',
  context: {
    url: 'https://app.example.com',
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0',
    buildCommit: 'abc1234',
  },
  assetIds: [],
  blocks: [{ kind: 'text', text: 'before' }],
});

describe('createSqliteStore', () => {
  let storagePath = '';
  let store: SqliteFeedbackStore;

  before(async () => {
    storagePath = await mkdtemp(join(tmpdir(), 'bugdeck-store-'));
    store = createSqliteStore({ storagePath });
  });

  after(async () => {
    store.close();
    await rm(storagePath, { recursive: true, force: true });
  });

  it('round-trips a report through columns and JSON alike', async () => {
    const created = await store.createReport(report('report-1'));
    const read = await store.getReport('report-1');

    assert.deepEqual(read, created);
    assert.equal(read?.context.buildCommit, 'abc1234');
    assert.deepEqual(read?.blocks, [{ kind: 'text', text: 'before' }]);
    assert.equal(read?.state, 'pending');
  });

  it('patches only the named fields', async () => {
    await store.createReport(report('report-2'));
    await store.updateReport('report-2', { externalId: 'issue-9', code: 'DEMO-9' });

    const read = await store.getReport('report-2');
    assert.equal(read?.code, 'DEMO-9');
    assert.equal(read?.externalId, 'issue-9');
    assert.equal(read?.description, 'Export is broken, every time');
  });

  it('appends to the thread instead of replacing it', async () => {
    await store.createReport(report('report-3'));
    await store.appendThread('report-3', [
      { source: 'user', text: 'first', assetIds: [], at: '2026-01-01T00:00:00.000Z' },
    ]);
    await store.appendThread('report-3', [
      { source: 'admin', text: 'second', assetIds: [], at: '2026-01-02T00:00:00.000Z' },
    ]);

    const read = await store.getReport('report-3');
    assert.deepEqual(
      read?.thread?.map((entry) => entry.text),
      ['first', 'second'],
    );
  });

  it('lists one owner reports, newest first', async () => {
    await store.createReport(report('report-4', 'owner-a'));
    await store.createReport(report('report-5', 'owner-b'));

    const mine = await store.listReportsByUser('owner-a', 50);
    assert.deepEqual(
      mine.map((row) => row.id),
      ['report-4'],
    );
  });

  it('writes the pixels to a file and keeps only the metadata in the database', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const assetId = await store.putAsset('report-1', {
      mime: 'image/png',
      width: 4,
      height: 4,
      bytes,
    });

    const onDisk = await readFile(join(storagePath, 'assets', `${assetId}.png`));
    assert.deepEqual(new Uint8Array(onDisk), bytes);

    const asset = await store.getAsset(assetId);
    assert.equal(asset?.reportId, 'report-1');
    assert.equal(asset?.width, 4);
    assert.deepEqual(asset && new Uint8Array(asset.bytes), bytes);
  });

  it('answers null for an asset nobody stored', async () => {
    assert.equal(await store.getAsset('missing'), null);
  });

  it('re-opens an existing database without re-running the schema', async () => {
    const reopened = createSqliteStore({ storagePath });
    try {
      assert.equal((await reopened.getReport('report-1'))?.title, 'Export is broken');
    } finally {
      reopened.close();
    }
  });

  it('finds a report by the tracker id, which is all the poll worker knows', async () => {
    await store.createReport(report('report-external'));
    await store.updateReport('report-external', { externalId: 'issue-42' });

    assert.equal((await store.getReportByExternalId('issue-42'))?.id, 'report-external');
    assert.equal(await store.getReportByExternalId('issue-nobody'), null);
  });

  it('keeps the poll watermark across a restart', async () => {
    assert.equal(await store.getMeta('sync.since'), null);
    await store.setMeta('sync.since', '2026-09-12T10:00:00.000Z');
    await store.setMeta('sync.since', '2026-09-12T10:05:00.000Z');

    const reopened = createSqliteStore({ storagePath });
    try {
      assert.equal(await reopened.getMeta('sync.since'), '2026-09-12T10:05:00.000Z');
    } finally {
      reopened.close();
    }
  });
});
