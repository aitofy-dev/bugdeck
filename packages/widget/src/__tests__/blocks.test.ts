/** Pure document model — no DOM, no React. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBlockPayload,
  imagesToUpload,
  imageBlock,
  initialBlocks,
  insertAfter,
  pruneMissingImages,
  removeBlock,
  replaceText,
  textBlock,
  type EditorBlock,
} from '../blocks.js';

const kinds = (blocks: readonly EditorBlock[]) => blocks.map((b) => b.kind).join(',');

test('a fresh editor is one empty paragraph so there is somewhere to type', () => {
  const blocks = initialBlocks();
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind, 'text');
});

test('inserting after a block keeps order and leaves a trailing paragraph', () => {
  const first = textBlock('above');
  const next = insertAfter([first], first.id, [imageBlock('img-1')]);
  assert.equal(kinds(next), 'text,image,text');
  assert.equal((next[0] as { text: string }).text, 'above');
});

test('inserting with no caret appends to the end', () => {
  const blocks = insertAfter([textBlock('a')], null, [imageBlock('img-1')]);
  assert.equal(kinds(blocks), 'text,image,text');
});

test('inserting in the middle does not add a trailing paragraph that already exists', () => {
  const a = textBlock('a');
  const b = textBlock('b');
  const blocks = insertAfter([a, b], a.id, [imageBlock('img-1')]);
  assert.equal(kinds(blocks), 'text,image,text');
  assert.equal((blocks[2] as { text: string }).text, 'b');
});

test('removing an image between two paragraphs merges them instead of leaving a split', () => {
  const a = textBlock('before');
  const img = imageBlock('img-1');
  const b = textBlock('after');
  const blocks = removeBlock([a, img, b], img.id);
  assert.equal(kinds(blocks), 'text');
  assert.equal((blocks[0] as { text: string }).text, 'before\n\nafter');
});

test('removing the last block leaves an empty editor, not an empty array', () => {
  const only = textBlock('a');
  const blocks = removeBlock([only], only.id);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind, 'text');
});

test('replaceText only touches the named block', () => {
  const a = textBlock('a');
  const b = textBlock('b');
  const blocks = replaceText([a, b], b.id, 'B!');
  assert.equal((blocks[0] as { text: string }).text, 'a');
  assert.equal((blocks[1] as { text: string }).text, 'B!');
});

test('an image whose file left the queue is pruned and the seam healed', () => {
  const blocks = [textBlock('x'), imageBlock('gone'), textBlock('y')];
  const pruned = pruneMissingImages(blocks, ['still-here']);
  assert.equal(kinds(pruned), 'text');
  assert.equal((pruned[0] as { text: string }).text, 'x\n\ny');
});

// ─── the wire shape ──────────────────────────────────────────────

test('buildBlockPayload emits blocks in order with images by upload position', () => {
  const blocks = [textBlock('opening'), imageBlock('k2'), textBlock('closing')];
  const payload = buildBlockPayload(blocks, [{ key: 'k1' }, { key: 'k2' }]);

  assert.deepEqual(payload.blocks, [
    { kind: 'text', text: 'opening' },
    { kind: 'image', imageIndex: 1 },
    { kind: 'text', text: 'closing' },
  ]);
});

/**
 * The backward-compatibility guarantee: an old server reads only `description`
 * and must still get every word. So description is built from the SAME text the
 * blocks carry — never a separate field that can drift.
 */
test('description carries every text block, so a server ignoring blocks loses nothing', () => {
  const payload = buildBlockPayload(
    [textBlock('one'), imageBlock('k1'), textBlock('two'), imageBlock('k2'), textBlock('three')],
    [{ key: 'k1' }, { key: 'k2' }],
  );
  assert.equal(payload.description, 'one\n\ntwo\n\nthree');
  for (const block of payload.blocks) {
    if (block.kind === 'text') assert.ok(payload.description.includes(block.text));
  }
});

test('empty and whitespace-only paragraphs are dropped from both halves', () => {
  const payload = buildBlockPayload([textBlock('   '), textBlock(''), textBlock(' real ')], []);
  assert.equal(payload.description, 'real');
  assert.deepEqual(payload.blocks, [{ kind: 'text', text: 'real' }]);
});

test('a block pointing at a file that is no longer queued is dropped, not sent as -1', () => {
  const payload = buildBlockPayload([textBlock('a'), imageBlock('vanished')], [{ key: 'k1' }]);
  assert.deepEqual(payload.blocks, [{ kind: 'text', text: 'a' }]);
  assert.ok(!JSON.stringify(payload.blocks).includes('-1'));
});

test('an empty editor produces nothing to submit', () => {
  const payload = buildBlockPayload(initialBlocks(), []);
  assert.equal(payload.description, '');
  assert.deepEqual(payload.blocks, []);
});

// ─── editing an existing report (S9) ─────────────────────────────

test('an image the server already has goes by id, not by upload position', () => {
  const payload = buildBlockPayload(
    [textBlock('rewritten'), imageBlock('kept')],
    [{ key: 'kept', assetId: 'a1' }],
  );
  assert.deepEqual(payload.blocks, [
    { kind: 'text', text: 'rewritten' },
    { kind: 'image', assetId: 'a1' },
  ]);
});

/**
 * The index counts ONLY the files in the request body. Counting kept images too
 * would point every new image one slot too far along — silent, and it puts the
 * wrong screenshot in the report.
 */
test('a new image after a kept one is index 0, not index 1', () => {
  const payload = buildBlockPayload(
    [imageBlock('kept'), imageBlock('fresh')],
    [{ key: 'kept', assetId: 'a1' }, { key: 'fresh' }],
  );
  assert.deepEqual(payload.blocks, [
    { kind: 'image', assetId: 'a1' },
    { kind: 'image', imageIndex: 0 },
  ]);
});

test('only new images are uploaded — kept ones are not re-sent', () => {
  const file = new File(['x'], 'x.png', { type: 'image/png' });
  const files = imagesToUpload([
    { key: 'kept', assetId: 'a1', file },
    { key: 'fresh', file },
  ]);
  assert.equal(files.length, 1);
});
