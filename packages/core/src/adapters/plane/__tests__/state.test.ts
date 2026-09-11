/**
 * State mapping, the rule that fails silently.
 *
 * A wrong mapping marks someone's open bug "done"; it never throws, never logs,
 * and is invisible from the board — which is exactly why it is pinned here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTerminal } from '../../../contract.js';
import { buildStateMap, resolveStateMap, type PlaneState } from '../state.js';

/** A default Plane project: five columns, one per group. */
const BOARD: PlaneState[] = [
  { id: 's-pending', name: 'Backlog', group: 'backlog' },
  { id: 's-todo', name: 'Todo', group: 'unstarted' },
  { id: 's-doing', name: 'Doing', group: 'started' },
  { id: 's-review', name: 'Review', group: 'started' },
  { id: 's-done', name: 'Done', group: 'completed' },
  { id: 's-fail', name: 'Cancelled', group: 'cancelled' },
];

// ─── reading: plane state id → our state ─────────────────────────

test('every column of a default board maps onto one of the five states', () => {
  const map = buildStateMap(BOARD);
  assert.equal(map.get('s-pending'), 'pending');
  assert.equal(map.get('s-todo'), 'pending');
  assert.equal(map.get('s-doing'), 'doing');
  assert.equal(map.get('s-review'), 'review');
  assert.equal(map.get('s-done'), 'done');
  assert.equal(map.get('s-fail'), 'fail');
});

test('name beats group — "Review" stays review even though Plane calls it started', () => {
  const map = buildStateMap(BOARD);
  assert.equal(map.get('s-review'), 'review');
  assert.notEqual(map.get('s-review'), 'doing');
});

test('a renamed column still maps, via its group', () => {
  const map = buildStateMap([{ id: 'x', name: 'In progress', group: 'started' }]);
  assert.equal(map.get('x'), 'doing');
});

test('an unknown column maps to NOTHING rather than to a guess', () => {
  const map = buildStateMap([{ id: 'blocked', name: 'Blocked', group: 'weird' }]);
  assert.equal(map.get('blocked'), undefined);
});

test('a board that answers with nothing maps nothing — no id is ever assumed', () => {
  assert.equal(buildStateMap([]).size, 0);
});

test('only done and fail are terminal', () => {
  assert.equal(isTerminal('done'), true);
  assert.equal(isTerminal('fail'), true);
  assert.equal(isTerminal('review'), false);
  assert.equal(isTerminal('pending'), false);
});

// ─── writing: our state → a plane state id ───────────────────────

test('a default board resolves all five states from its groups', () => {
  const result = resolveStateMap(BOARD);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    pending: 's-todo',
    doing: 's-doing',
    review: 's-review',
    done: 's-done',
    fail: 's-fail',
  });
});

test('unstarted wins over backlog for pending — a new report is queued, not shelved', () => {
  const result = resolveStateMap(BOARD);
  assert.equal(result.ok && result.value.pending, 's-todo');
});

test('doing never resolves to the Review column just because both are started', () => {
  const result = resolveStateMap([
    { id: 'a', name: 'Todo', group: 'unstarted' },
    { id: 'b', name: 'In review', group: 'started' },
    { id: 'c', name: 'In progress', group: 'started' },
    { id: 'd', name: 'Shipped', group: 'completed' },
    { id: 'e', name: 'Wontfix', group: 'cancelled' },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.doing, 'c');
  assert.equal(result.value.review, 'b');
});

test('a board with no review column maps review onto doing rather than failing', () => {
  const result = resolveStateMap([
    { id: 'a', name: 'Todo', group: 'unstarted' },
    { id: 'b', name: 'In progress', group: 'started' },
    { id: 'c', name: 'Done', group: 'completed' },
    { id: 'd', name: 'Cancelled', group: 'cancelled' },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.review, 'b');
});

test('a missing group is reported by name, not silently guessed', () => {
  const result = resolveStateMap([
    { id: 'a', name: 'Todo', group: 'unstarted' },
    { id: 'b', name: 'In progress', group: 'started' },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.missing, ['done', 'fail']);
});

test('an override wins over anything discovered on the board', () => {
  const result = resolveStateMap(BOARD, { done: 'forced-done' });
  assert.equal(result.ok && result.value.done, 'forced-done');
});

test('an override supplies a state the board has no column for', () => {
  const result = resolveStateMap(
    [
      { id: 'a', name: 'Todo', group: 'unstarted' },
      { id: 'b', name: 'In progress', group: 'started' },
      { id: 'c', name: 'Done', group: 'completed' },
    ],
    { fail: 'forced-fail' },
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.fail, 'forced-fail');
});
