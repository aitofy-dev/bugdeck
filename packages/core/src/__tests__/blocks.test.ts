/**
 * `blocks` arrives as a JSON string written by a browser and ends up as HTML
 * someone reads, so what is pinned here is mostly what must NOT get through: an
 * image index that points outside this request's own uploads would put another
 * user's screenshot in the report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEDBACK_MAX_BLOCKS } from '../contract.js';
import { blockAssetIds, parseFeedbackBlocks } from '../blocks.js';

const ASSETS = ['aaa111', 'bbb222'];
const json = (value: unknown) => JSON.stringify(value);

test('image positions become the asset ids minted for this request', () => {
  const blocks = parseFeedbackBlocks(
    json([
      { kind: 'text', text: 'before' },
      { kind: 'image', imageIndex: 1 },
      { kind: 'text', text: 'after' },
    ]),
    ASSETS,
  );
  assert.deepEqual(blocks, [
    { kind: 'text', text: 'before' },
    { kind: 'image', assetId: 'bbb222' },
    { kind: 'text', text: 'after' },
  ]);
});

test('an index past the uploaded files is dropped, never resolved to some other asset', () => {
  const blocks = parseFeedbackBlocks(json([{ kind: 'image', imageIndex: 9 }]), ASSETS);
  assert.equal(blocks, null);
});

test('a negative or fractional index is dropped', () => {
  for (const imageIndex of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
    assert.equal(parseFeedbackBlocks(json([{ kind: 'image', imageIndex }]), ASSETS), null);
  }
});

test('a non-numeric index cannot smuggle an asset id in', () => {
  assert.equal(parseFeedbackBlocks(json([{ kind: 'image', imageIndex: 'aaa111' }]), ASSETS), null);
  assert.equal(parseFeedbackBlocks(json([{ kind: 'image', assetId: 'aaa111' }]), ASSETS), null);
});

test('malformed JSON loses the layout, never the report', () => {
  assert.equal(parseFeedbackBlocks('{not json', ASSETS), null);
  assert.equal(parseFeedbackBlocks(json({ kind: 'text' }), ASSETS), null);
  assert.equal(parseFeedbackBlocks(undefined, ASSETS), null);
});

test('empty text blocks and unknown kinds are skipped', () => {
  const blocks = parseFeedbackBlocks(
    json([
      { kind: 'text', text: '   ' },
      { kind: 'heading', text: 'x' },
      null,
      'nope',
      { kind: 'text', text: ' real ' },
    ]),
    ASSETS,
  );
  assert.deepEqual(blocks, [{ kind: 'text', text: 'real' }]);
});

test('a report with nothing usable is null, so readers fall back to description', () => {
  assert.equal(parseFeedbackBlocks(json([]), ASSETS), null);
  assert.equal(parseFeedbackBlocks(json([{ kind: 'text', text: '' }]), ASSETS), null);
});

test('a flood of blocks is capped rather than stored whole', () => {
  const many = Array.from({ length: FEEDBACK_MAX_BLOCKS + 50 }, (_, i) => ({
    kind: 'text',
    text: `d${i}`,
  }));
  const blocks = parseFeedbackBlocks(json(many), ASSETS);
  assert.equal(blocks?.length, FEEDBACK_MAX_BLOCKS);
});

test('blockAssetIds lists the images the layout shows, in order', () => {
  const blocks = parseFeedbackBlocks(
    json([
      { kind: 'image', imageIndex: 1 },
      { kind: 'text', text: 'between' },
      { kind: 'image', imageIndex: 0 },
    ]),
    ASSETS,
  );
  assert.deepEqual(blockAssetIds(blocks), ['bbb222', 'aaa111']);
  assert.deepEqual(blockAssetIds(null), []);
});

// ─── images kept across an edit ──────────────────────────────────

test('an assetId the report already owns survives an edit', () => {
  const blocks = parseFeedbackBlocks(
    json([
      { kind: 'text', text: 'still broken' },
      { kind: 'image', assetId: 'aaa' },
      { kind: 'image', imageIndex: 0 },
    ]),
    ['new1'],
    ['aaa', 'bbb'],
  );
  assert.deepEqual(blocks, [
    { kind: 'text', text: 'still broken' },
    { kind: 'image', assetId: 'aaa' },
    { kind: 'image', assetId: 'new1' },
  ]);
});

test('an assetId the report does NOT own is dropped, not trusted', () => {
  // Guessing an id is one request away from putting someone else's screenshot
  // into your report.
  const blocks = parseFeedbackBlocks(
    json([
      { kind: 'text', text: 'stealing a screenshot' },
      { kind: 'image', assetId: 'someone-elses' },
    ]),
    [],
    ['mine'],
  );
  assert.deepEqual(blocks, [{ kind: 'text', text: 'stealing a screenshot' }]);
});

test('POST keeps nothing — with no keep-list an assetId means nothing', () => {
  const blocks = parseFeedbackBlocks(json([{ kind: 'image', assetId: 'aaa' }]), ['new1']);
  assert.equal(blocks, null);
});
