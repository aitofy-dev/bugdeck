/** The two pure predicates behind drag-and-drop; the React wiring is not tested here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragHasFiles, imagesFromDataTransfer } from '../FeedbackModal.js';

const transfer = (types: string[], files: Array<{ name: string; type: string }>) =>
  ({ types, files }) as unknown as DataTransfer;

test('a drag carrying files arms the dropzone', () => {
  assert.equal(dragHasFiles(transfer(['Files'], [])), true);
});

test('dragging text or a link does NOT arm the dropzone', () => {
  assert.equal(dragHasFiles(transfer(['text/plain', 'text/uri-list'], [])), false);
  assert.equal(dragHasFiles(null), false);
});

test('dropped images come through', () => {
  const files = imagesFromDataTransfer(
    transfer(['Files'], [
      { name: 'a.png', type: 'image/png' },
      { name: 'b.webp', type: 'image/webp' },
    ]),
  );
  assert.deepEqual(files.map((f) => f.name), ['a.png', 'b.webp']);
});

test('a dropped non-image is filtered out rather than sent to the server to be rejected', () => {
  const files = imagesFromDataTransfer(
    transfer(['Files'], [
      { name: 'shot.png', type: 'image/png' },
      { name: 'logs.zip', type: 'application/zip' },
      { name: 'notes.txt', type: 'text/plain' },
    ]),
  );
  assert.deepEqual(files.map((f) => f.name), ['shot.png']);
});

test('a drop with no dataTransfer is not a crash', () => {
  assert.deepEqual(imagesFromDataTransfer(null), []);
});
