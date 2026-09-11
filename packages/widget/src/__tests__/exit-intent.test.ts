/**
 * Hide vs Discard. Both ways of getting it wrong are SILENT:
 *
 *  - discarding by mistake → the words just typed are gone, with nothing said;
 *  - keeping by mistake → a ghost draft lives a week and surfaces during an
 *    unrelated report.
 *
 * So the rule is pinned case by case here, rather than by pressing buttons.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitIntent } from '../exit-intent.js';

const withDraft = { canHide: true, hasContent: true };
const withDraftEmpty = { canHide: true, hasContent: false };
const noDraft = { canHide: false, hasContent: true };
const noDraftEmpty = { canHide: false, hasContent: false };

// ─── ✕ · Esc · backdrop click ────────────────────────────────────

test('dismiss = HIDE when there is a draft — the commonest gesture loses nothing', () => {
  assert.equal(exitIntent('dismiss', withDraft), 'hide');
  assert.equal(exitIntent('dismiss', withDraftEmpty), 'hide');
});

test('dismiss NEVER deletes a draft outright, not even with text on screen', () => {
  // This was the old bug: one reflexive Esc mid-sentence and the text was gone.
  assert.notEqual(exitIntent('dismiss', withDraft), 'discard');
});

test('with no draft, dismiss has to ask — there is nowhere to put the words', () => {
  assert.equal(exitIntent('dismiss', noDraft), 'confirm');
});

test('no draft and nothing written closes straight away, without asking', () => {
  assert.equal(exitIntent('dismiss', noDraftEmpty), 'discard');
});

// ─── the Hide button ─────────────────────────────────────────────

test('Hide always hides, with no questions', () => {
  assert.equal(exitIntent('hide', withDraft), 'hide');
  assert.equal(exitIntent('hide', noDraft), 'hide');
});

// ─── the Discard button ──────────────────────────────────────────

test('Discard with text or images asks exactly once', () => {
  assert.equal(exitIntent('discard', withDraft), 'confirm');
  assert.equal(exitIntent('discard', noDraft), 'confirm');
});

test('Discard on an empty dialog just closes — asking would be noise', () => {
  assert.equal(exitIntent('discard', withDraftEmpty), 'discard');
  assert.equal(exitIntent('discard', noDraftEmpty), 'discard');
});

test('NO gesture throws a draft away unasked while there is text', () => {
  for (const gesture of ['dismiss', 'hide', 'discard'] as const) {
    assert.notEqual(exitIntent(gesture, withDraft), 'discard', gesture);
  }
});
