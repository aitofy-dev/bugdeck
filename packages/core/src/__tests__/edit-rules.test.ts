/**
 * Which of the two "add more" routes a report is on.
 *
 * One line of logic, pinned because both endpoints branch on it: a wrong answer
 * either lets a user rewrite a report someone is already working from, or
 * forces them to file a second report for a detail they remembered ten seconds
 * later.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEditFeedback, FEEDBACK_STATES, needsUserCheck } from '../contract.js';

test('only a report nobody has picked up can be edited', () => {
  assert.equal(canEditFeedback('pending'), true);
});

test('every other state is append-only', () => {
  for (const state of FEEDBACK_STATES) {
    if (state === 'pending') continue;
    assert.equal(canEditFeedback(state), false, state);
  }
});

test('every state answers the edit question — none falls through', () => {
  // A state that answered neither "edit" nor "append" would be a report the
  // user can no longer add to at all.
  for (const state of FEEDBACK_STATES) {
    assert.equal(typeof canEditFeedback(state), 'boolean', state);
  }
});

test('exactly one state hands the work back to the reporter', () => {
  assert.deepEqual(FEEDBACK_STATES.filter(needsUserCheck), ['review']);
});
