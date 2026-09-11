/**
 * Neighbouring images are shown as a contact sheet, and that regrouping must
 * not disturb the order the report goes out in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupBlocks } from '../BlockList.js';
import { imageBlock, textBlock, type EditorBlock } from '../blocks.js';

const document_: EditorBlock[] = [
  textBlock('first'),
  imageBlock('img-1'),
  imageBlock('img-2'),
  textBlock('after'),
  imageBlock('img-3'),
];

test('images that sit next to each other become one grid', () => {
  const runs = groupBlocks(document_);
  assert.deepEqual(
    runs.map((run) => (run.kind === 'text' ? 'text' : run.blocks.length)),
    ['text', 2, 'text', 1],
  );
});

test('grouping never reorders the document', () => {
  const flat = groupBlocks(document_).flatMap((run) =>
    run.kind === 'text' ? [run.block.id] : run.blocks.map((block) => block.id),
  );
  assert.deepEqual(flat, document_.map((block) => block.id));
});

test('an empty document groups into nothing', () => {
  assert.deepEqual(groupBlocks([]), []);
});
