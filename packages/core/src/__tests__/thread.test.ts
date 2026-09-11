/**
 * The two rules the conversation depends on, both of which fail silently.
 *
 * Wrong order → the page shows an answer above the question it answers, and
 * everything still renders. Wrong dedupe → the sync re-appends the same reply
 * every five minutes, forever, and nothing logs an error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildThread,
  countUserTurns,
  newAdminEntries,
  type LegacyAppendLike,
  type ThreadEntryLike,
} from '../thread.js';

const at = (iso: string) => new Date(iso);

const userTurn = (text: string, iso: string, id: string | null = null): ThreadEntryLike => ({
  source: 'user',
  text,
  blocks: null,
  assetIds: [],
  at: at(iso),
  commentId: id,
});

const adminTurn = (text: string, iso: string, id: string | null = null): ThreadEntryLike => ({
  ...userTurn(text, iso, id),
  source: 'admin',
});

const legacy = (text: string, iso: string): LegacyAppendLike => ({
  description: text,
  blocks: null,
  assetIds: [],
  createdAt: at(iso),
  commentId: null,
});

// ─── buildThread ─────────────────────────────────────────────────

test('both sides interleave by time, oldest first', () => {
  const thread = buildThread(
    [
      adminTurn('looking into it', '2026-08-26T10:00:00Z'),
      userTurn('still broken', '2026-08-26T12:00:00Z'),
    ],
    [legacy('forgot to say: Chrome only', '2026-08-26T11:00:00Z')],
  );

  assert.deepEqual(
    thread.map((entry) => [entry.source, entry.text]),
    [
      ['admin', 'looking into it'],
      ['user', 'forgot to say: Chrome only'],
      ['user', 'still broken'],
    ],
  );
});

test('legacy appends are folded in as USER turns — an old report keeps its words', () => {
  const thread = buildThread([], [legacy('added a screenshot', '2026-08-20T09:00:00Z')]);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].source, 'user');
  assert.equal(thread[0].text, 'added a screenshot');
});

test('an empty report has an empty thread, not a crash', () => {
  assert.deepEqual(buildThread(), []);
  assert.deepEqual(buildThread(undefined, undefined), []);
});

test('two turns in the same second keep the order they were stored in', () => {
  const thread = buildThread([
    adminTurn('first', '2026-08-26T10:00:00Z', 'a'),
    adminTurn('second', '2026-08-26T10:00:00Z', 'b'),
  ]);
  assert.deepEqual(
    thread.map((entry) => entry.text),
    ['first', 'second'],
  );
});

test('the same comment id appears once, however many lists it came from', () => {
  const thread = buildThread(
    [userTurn('still broken', '2026-08-26T12:00:00Z', 'c9')],
    [{ ...legacy('still broken', '2026-08-26T12:00:00Z'), commentId: 'c9' }],
  );
  assert.equal(thread.length, 1);
});

// ─── newAdminEntries ─────────────────────────────────────────────

test('a reply we already stored is not added again', () => {
  const existing = [adminTurn('fixed', '2026-08-26T11:00:00Z', 'c1')];
  const added = newAdminEntries(
    [{ commentId: 'c1', text: 'fixed', at: at('2026-08-26T11:00:00Z') }],
    existing,
  );
  assert.deepEqual(added, []);
});

test('an EDITED reply keeps its id, so it stays one entry rather than becoming two', () => {
  // The tracker keeps the comment id when a typo is fixed. Matching on id means
  // the thread shows what we first read; matching on text would append the
  // correction as a second message. One stale line beats two contradictory ones.
  const existing = [adminTurn('fixd', '2026-08-26T11:00:00Z', 'c1')];
  const added = newAdminEntries(
    [{ commentId: 'c1', text: 'fixed', at: at('2026-08-26T11:00:00Z') }],
    existing,
  );
  assert.deepEqual(added, []);
});

test('with no id from the tracker, text + time still stops the duplicate', () => {
  const existing = [adminTurn('fixed', '2026-08-26T11:00:00Z', null)];
  const added = newAdminEntries(
    [{ commentId: null, text: '  Fixed  ', at: at('2026-08-26T11:00:00Z') }],
    existing,
  );
  assert.deepEqual(added, []);
});

test('a list that repeats a row across pages stores it once', () => {
  const added = newAdminEntries(
    [
      { commentId: 'c1', text: 'fixed', at: at('2026-08-26T11:00:00Z') },
      { commentId: 'c1', text: 'fixed', at: at('2026-08-26T11:00:00Z') },
    ],
    [],
  );
  assert.equal(added.length, 1);
});

test('a reply with no usable timestamp is kept and stamped now — losing the answer is worse', () => {
  const now = at('2026-08-26T13:00:00Z');
  const added = newAdminEntries([{ commentId: 'c1', text: 'fixed', at: null }], [], now);
  assert.equal(added.length, 1);
  assert.equal(added[0].at.toISOString(), now.toISOString());
});

test('new replies come back oldest first', () => {
  const added = newAdminEntries(
    [
      { commentId: 'b', text: 'second', at: at('2026-08-26T12:00:00Z') },
      { commentId: 'a', text: 'first', at: at('2026-08-26T10:00:00Z') },
    ],
    [],
  );
  assert.deepEqual(
    added.map((entry) => entry.text),
    ['first', 'second'],
  );
});

test('an empty reply is not a message', () => {
  assert.deepEqual(newAdminEntries([{ commentId: 'c1', text: '   ', at: null }], []), []);
});

// ─── the cap ─────────────────────────────────────────────────────

test('only the user side is counted against the cap', () => {
  const stored = [
    userTurn('one', '2026-08-26T10:00:00Z'),
    adminTurn('answered', '2026-08-26T10:30:00Z'),
    userTurn('two', '2026-08-26T11:00:00Z'),
  ];
  // Somebody who answers a lot must never be able to lock the user out of
  // answering back.
  assert.equal(countUserTurns(stored, [legacy('old', '2026-08-20T10:00:00Z')]), 3);
});
