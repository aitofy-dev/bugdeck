/**
 * The case that prompted this reached the board as
 * "?, can I pick a dom node and capture only that? capturing the whole scre…" —
 * leading punctuation, and a cut mid-word.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEDBACK_TITLE_MAX } from '../contract.js';
import { deriveTitle } from '../derive-title.js';

const RAW_REPORT =
  '?, can I pick a dom node and capture only that one? capturing the whole screen works too but it is not very convenient, and can I drag and drop an image?';

test('a raw report body now reads as a headline', () => {
  const title = deriveTitle(RAW_REPORT);
  assert.equal(title, 'can I pick a dom node and capture only that one');
  assert.ok(title.length <= FEEDBACK_TITLE_MAX);
  assert.doesNotMatch(title, /^[^\p{L}\p{N}]/u);
});

test('leading punctuation and whitespace are stripped', () => {
  assert.equal(deriveTitle('   ... !!! Send button is broken'), 'Send button is broken');
  assert.equal(deriveTitle('>>> error 500'), 'error 500');
});

test('letters outside ASCII are letters, not leading noise', () => {
  assert.equal(deriveTitle('Übersicht is empty'), 'Übersicht is empty');
  assert.equal(deriveTitle('— Ошибка on load'), 'Ошибка on load');
});

test('the title stops at the first sentence', () => {
  assert.equal(deriveTitle('Send button is broken. I keep clicking.'), 'Send button is broken');
  assert.equal(deriveTitle('What is this? I clicked twice'), 'What is this');
});

test('a hard line break also ends the title', () => {
  assert.equal(deriveTitle('Blank page\nReloading does not help'), 'Blank page');
});

test('a long first sentence is cut on a word boundary, not mid-word', () => {
  const long =
    'When I click the button that exports the monthly revenue report the page freezes completely';
  const title = deriveTitle(long);
  assert.ok(title.length <= FEEDBACK_TITLE_MAX, `length ${title.length}`);
  assert.ok(title.endsWith('…'));
  // The cut lands between words: everything before the ellipsis is whole words.
  const body = title.slice(0, -1);
  assert.ok(long.startsWith(body), `"${body}" is not a prefix of the description`);
  assert.equal(long[body.length], ' ', 'cut in the middle of a word');
});

test('an unbroken run longer than the cap is chopped rather than left whole', () => {
  const title = deriveTitle('a'.repeat(200));
  assert.ok(title.length <= FEEDBACK_TITLE_MAX);
  assert.ok(title.endsWith('…'));
});

test('an empty description falls back to the reporter, not to a blank line', () => {
  assert.equal(deriveTitle('', 'sam@example.com'), 'Bug report from sam@example.com');
  assert.equal(deriveTitle('   ...  ', 'sam@example.com'), 'Bug report from sam@example.com');
});

test('with no email either, the title still says something', () => {
  assert.equal(deriveTitle(''), 'Bug report with no description');
});

test('every title fits the board column', () => {
  const samples = [RAW_REPORT, 'x', 'Order missing '.repeat(40), '?!?!', 'A sentence long enough.'];
  for (const sample of samples) {
    assert.ok(deriveTitle(sample, 'a@b.c').length <= FEEDBACK_TITLE_MAX, sample.slice(0, 30));
  }
});
