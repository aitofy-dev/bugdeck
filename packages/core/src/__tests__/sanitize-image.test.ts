/**
 * What each case is really pinning:
 *
 *   - POLYGLOT. A file whose first bytes say GIF and whose body is a valid PNG
 *     is the classic content-sniffing trick. The point is not that we identify
 *     it "correctly" — it is that the FIRST BYTES decide, so a file cannot get
 *     one verdict from us and a different one from a browser. GIF is rejected
 *     even though the PNG payload behind it would decode fine.
 *   - SVG. Not an image to us: it is a script container, and the decoder would
 *     even resolve its external references. Rejected before sharp sees it.
 *   - DECOMPRESSION BOMB. 6000×6000 is only 36 MP — small as bombs go — but it
 *     is over the ceiling, and the ceiling has to bite on a REAL file rather
 *     than on a hand-written header, or the test proves nothing about sharp.
 *   - HAPPY PATH. The output must be PNG bytes sharp wrote, not the input
 *     echoed back: re-encoding is the actual defence, so a test that only
 *     checked `ok === true` would pass on a pass-through implementation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  MAX_INPUT_PIXELS,
  detectImageFormat,
  failureErrorCode,
  isAllowedInputMime,
  sanitizeImage,
} from '../sanitize-image.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A real, decodable PNG — built rather than hard-coded so it is never stale. */
async function smallPng(width = 8, height = 6): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 90 } },
  })
    .png()
    .toBuffer();
}

test('detect: a real PNG is a PNG', async () => {
  assert.equal(detectImageFormat(await smallPng()), 'image/png');
});

test('detect: JPEG and WebP are recognised from their own bytes', async () => {
  const raw = sharp({ create: { width: 10, height: 10, channels: 3, background: '#123456' } });
  assert.equal(detectImageFormat(await raw.clone().jpeg().toBuffer()), 'image/jpeg');
  assert.equal(detectImageFormat(await raw.clone().webp().toBuffer()), 'image/webp');
});

test('polyglot: GIF89a header wins over a valid PNG payload, and is rejected', async () => {
  const png = await smallPng();
  const polyglot = Buffer.concat([Buffer.from('GIF89a', 'latin1'), png]);

  // The header is what we go by — not the PNG magic sitting six bytes in.
  assert.equal(detectImageFormat(polyglot), 'image/gif');
  assert.equal(isAllowedInputMime(detectImageFormat(polyglot)), false);

  const result = await sanitizeImage(polyglot);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'gif_rejected');
});

test('polyglot: a PNG with GIF bytes appended still decodes, and the trailer is dropped', async () => {
  const png = await smallPng(12, 9);
  const withTrailer = Buffer.concat([
    png,
    Buffer.from('GIF89a<script>alert(1)</script>', 'latin1'),
  ]);

  const result = await sanitizeImage(withTrailer);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Re-encoding is the whole defence: the smuggled trailer cannot survive a
  // round trip through a decoded pixel buffer.
  assert.equal(result.value.buffer.includes('<script>'), false);
  assert.deepEqual([result.value.width, result.value.height], [12, 9]);
});

test('svg: rejected as a script container, not re-encoded', async () => {
  const svg = Buffer.from(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
      '<script>fetch("/api/accounts")</script></svg>',
    'utf8',
  );
  assert.equal(detectImageFormat(svg), 'image/svg+xml');
  const result = await sanitizeImage(svg);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'svg_rejected');
});

test('svg: a bare <svg> with no xml prolog is caught too', async () => {
  const svg = Buffer.from('  \n<svg width="4" height="4"></svg>', 'utf8');
  assert.equal(detectImageFormat(svg), 'image/svg+xml');
  assert.equal((await sanitizeImage(svg)).ok, false);
});

test('oversize: a real 6000x6000 PNG is refused, above the 5000px cap', async () => {
  const huge = await sharp({
    create: { width: 6000, height: 6000, channels: 3, background: '#000000' },
  })
    .png({ compressionLevel: 1 })
    .toBuffer();

  // It IS a genuine PNG — the rejection is about size, not about format.
  assert.equal(detectImageFormat(huge), 'image/png');
  assert.ok(6000 * 6000 > MAX_INPUT_PIXELS);

  const result = await sanitizeImage(huge);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'too_large');
  assert.equal(result.ok === false && failureErrorCode(result.reason), 'IMAGE_TOO_LARGE');
});

test('happy path: a JPEG comes back as freshly encoded PNG bytes', async () => {
  const jpeg = await sharp({
    create: { width: 40, height: 25, channels: 3, background: '#3366ff' },
  })
    .jpeg()
    .toBuffer();

  const result = await sanitizeImage(jpeg);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.mime, 'image/png');
  assert.deepEqual([result.value.width, result.value.height], [40, 25]);
  // Output is PNG regardless of what went in.
  assert.ok(result.value.buffer.subarray(0, 8).equals(PNG_MAGIC));
  assert.equal(result.value.bytes, result.value.buffer.length);
});

test('junk and empty input fail as values, never as throws', async () => {
  const empty = await sanitizeImage(Buffer.alloc(0));
  assert.equal(empty.ok === false && empty.reason, 'empty');

  const junk = await sanitizeImage(Buffer.from('this is a text file, honestly', 'utf8'));
  assert.equal(junk.ok === false && junk.reason, 'unsupported_format');
  assert.equal(junk.ok === false && failureErrorCode(junk.reason), 'UNSUPPORTED_IMAGE');

  // A PNG header with nothing behind it: the format check passes, the decode
  // does not — and it must come back as a value, not an exception.
  const truncated = await sanitizeImage(Buffer.concat([PNG_MAGIC, Buffer.alloc(8)]));
  assert.equal(truncated.ok, false);
});
