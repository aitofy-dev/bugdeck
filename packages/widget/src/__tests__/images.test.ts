/**
 * Fixture-only.
 *
 * Client-side validation is a courtesy, not a security boundary — the server
 * re-encodes anyway. What it buys is the user not waiting on a 30 MB upload
 * that the route was always going to reject, so the rules must match the
 * server's exactly and must say WHY, per file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStrings } from '../strings.js';
import { FEEDBACK_MAX_ASSETS, FEEDBACK_MAX_ASSET_BYTES } from '@bugdeck/core';
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  formatRejection,
  isAcceptedMime,
  selectImages,
  validateImageFile,
  type FileLike,
} from '../images.js';

const file = (name: string, type: string, size = 1024): FileLike => ({ name, type, size });

test('only png, jpeg and webp pass; svg and gif are refused', () => {
  assert.equal(isAcceptedMime('image/png'), true);
  assert.equal(isAcceptedMime('IMAGE/JPEG'), true);
  assert.equal(isAcceptedMime('image/webp'), true);
  assert.equal(isAcceptedMime('image/svg+xml'), false);
  assert.equal(isAcceptedMime('image/gif'), false);
  assert.equal(isAcceptedMime(''), false);
});

test('validateImageFile names the file and the reason', () => {
  assert.equal(validateImageFile(file('shot.png', 'image/png')), null);

  const badType = validateImageFile(file('logo.svg', 'image/svg+xml'));
  assert.equal(badType?.code, 'bad_type');
  assert.match(formatRejection(badType!), /logo\.svg/);

  const tooLarge = validateImageFile(file('huge.png', 'image/png', MAX_IMAGE_BYTES + 1));
  assert.equal(tooLarge?.code, 'too_large');
  assert.match(formatRejection(tooLarge!), /10\.0 MB/);

  assert.equal(validateImageFile(file('edge.png', 'image/png', MAX_IMAGE_BYTES)), null);
});

/** A rejection is DATA; the wording comes from whichever dictionary is active. */
test('a rejection is worded by the caller, not baked into the rule', () => {
  const rejected = validateImageFile(file('logo.svg', 'image/svg+xml'))!;
  assert.equal(
    formatRejection(rejected, { ...defaultStrings, imageBadType: 'nope: {name}' }),
    'nope: logo.svg',
  );
});

test('selectImages stops at the cap and says which files were dropped', () => {
  const incoming = Array.from({ length: MAX_IMAGES + 2 }, (_, n) =>
    file(`s${n}.png`, 'image/png'),
  );
  const { accepted, rejections } = selectImages(0, incoming);
  assert.equal(accepted.length, MAX_IMAGES);
  assert.equal(rejections.length, 2);
  assert.ok(rejections.every((rejection) => rejection.code === 'too_many'));
});

test('selectImages counts what the queue already holds', () => {
  const { accepted, rejections } = selectImages(MAX_IMAGES - 1, [
    file('a.png', 'image/png'),
    file('b.png', 'image/png'),
  ]);
  assert.deepEqual(accepted.map((f) => f.name), ['a.png']);
  assert.deepEqual(rejections.map((r) => r.name), ['b.png']);
});

/**
 * The capture button now goes through the same queue as paste and upload — it
 * used to own a slot it swapped in place, which meant the second shot replaced
 * the first. At the cap it has to be refused like any other file, out loud.
 */
test('a screenshot taken while the queue is full is refused, not swapped in', () => {
  const { accepted, rejections } = selectImages(MAX_IMAGES, [
    file('screenshot.png', 'image/png'),
  ]);
  assert.equal(accepted.length, 0);
  assert.equal(rejections[0]?.code, 'too_many');
  assert.match(formatRejection(rejections[0]!), new RegExp(`up to ${MAX_IMAGES} images`));
});

test('a broken file never eats a slot and never masks the real reason', () => {
  const { accepted, rejections } = selectImages(0, [
    file('bad.gif', 'image/gif'),
    file('ok1.png', 'image/png'),
    file('ok2.png', 'image/png'),
    file('ok3.png', 'image/png'),
  ]);
  assert.equal(accepted.length, 3);
  assert.deepEqual(rejections.map((r) => r.code), ['bad_type']);
});

/** The cap is ONE number and it is the contract's; nothing here may redefine it. */
test('the limits come straight from the shared contract', () => {
  assert.equal(MAX_IMAGES, FEEDBACK_MAX_ASSETS);
  assert.equal(MAX_IMAGE_BYTES, FEEDBACK_MAX_ASSET_BYTES);
});
