/**
 * Tab must not walk out of the dialog. The wrap is the whole rule, so it is
 * the whole test — the DOM plumbing around it has nothing to decide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextFocusTarget } from '../use-focus-trap.js';

const items = ['close', 'capture', 'send'];

test('Tab walks forward and wraps at the end', () => {
  assert.equal(nextFocusTarget(items, 'close', false), 'capture');
  assert.equal(nextFocusTarget(items, 'send', false), 'close');
});

test('Shift+Tab walks back and wraps at the start', () => {
  assert.equal(nextFocusTarget(items, 'capture', true), 'close');
  assert.equal(nextFocusTarget(items, 'close', true), 'send');
});

test('focus outside the dialog is pulled back in, not left where it was', () => {
  assert.equal(nextFocusTarget(items, null, false), 'close');
  assert.equal(nextFocusTarget(items, null, true), 'send');
});

test('an empty dialog traps nothing rather than throwing', () => {
  assert.equal(nextFocusTarget([], null, false), null);
});
