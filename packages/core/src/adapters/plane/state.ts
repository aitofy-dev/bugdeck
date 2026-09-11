/**
 * Reading a Plane board's columns: which of our five states an issue is in, and
 * which column id to create one in.
 *
 * Pure on purpose — no fetch, no storage, no env. Both directions fail SILENTLY
 * when they are wrong (a column that maps to nothing freezes the reporter's
 * badge forever; a wrong create column files every report in the wrong place),
 * so they get to be unit tests rather than something a user tells us about.
 *
 * DIRECTION: Plane → report, one way. `resolveStateMap` is the only inverse,
 * and it exists to pick the state an issue is CREATED in, not to push updates
 * back — two boards that write to each other chase each other.
 */
import { FEEDBACK_STATES, type FeedbackState } from '../../contract.js';

/** One row of `GET /workspaces/{slug}/projects/{id}/states/`. */
export interface PlaneState {
  id: string;
  name?: string;
  /** Plane's own coarse bucket: backlog | unstarted | started | completed | cancelled. */
  group?: string;
}

/**
 * Plane's five groups, collapsed onto ours. Used only when a state's NAME is
 * not one of the five we know — i.e. when someone adds "Blocked" or renames
 * "Doing" to "In progress".
 *
 * `unstarted` and `backlog` both land on `pending` because from the user's
 * side they are the same sentence: nobody has picked this up yet.
 */
const BY_GROUP: Readonly<Record<string, FeedbackState>> = {
  backlog: 'pending',
  unstarted: 'pending',
  started: 'doing',
  completed: 'done',
  cancelled: 'fail',
};

const BY_NAME = new Map<string, FeedbackState>(
  FEEDBACK_STATES.map((state) => [state, state] as const),
);

const normalize = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/**
 * state id → our state, built from what Plane says today.
 *
 * Name first, group second. A state we can map by neither is LEFT OUT rather
 * than guessed: an unknown state means the sync leaves the report where it is,
 * which is visibly stale — much easier to notice than a report silently marked
 * done.
 */
export function buildStateMap(states: readonly PlaneState[]): Map<string, FeedbackState> {
  const map = new Map<string, FeedbackState>();
  for (const state of states) {
    if (!state?.id) continue;
    const mapped = BY_NAME.get(normalize(state.name)) ?? BY_GROUP[normalize(state.group)];
    if (mapped) map.set(state.id, mapped);
  }
  return map;
}

// ─── our state → a state id to write ─────────────────────────────

/** Which Plane groups can stand in for each of our states, best first. */
const GROUPS_FOR: Readonly<Record<FeedbackState, readonly string[]>> = {
  pending: ['unstarted', 'backlog'],
  doing: ['started'],
  review: ['started'],
  done: ['completed'],
  fail: ['cancelled'],
};

/** `review` is a convention, not a Plane group: it is a started state named so. */
const REVIEW_NAME = /review/i;

export type StateMapResult =
  | { ok: true; value: Record<FeedbackState, string> }
  | { ok: false; missing: FeedbackState[] };

function findByName(states: readonly PlaneState[], state: FeedbackState): string | undefined {
  return states.find((row) => row.id && normalize(row.name) === state)?.id;
}

function findByGroup(states: readonly PlaneState[], state: FeedbackState): string | undefined {
  for (const group of GROUPS_FOR[state]) {
    const match = states.find(
      (row) =>
        row.id &&
        normalize(row.group) === group &&
        // A board ordered Todo → In progress → Review must not resolve `doing`
        // to the Review column just because Plane calls both "started".
        !(state === 'doing' && REVIEW_NAME.test(row.name ?? '')),
    );
    if (match) return match.id;
  }
  return undefined;
}

/**
 * The state id to use for each of our five states, discovered from the live
 * board.
 *
 * Hardcoding ids is how a board that was deleted and recreated silently stops
 * receiving reports, so they are read every time and matched by name first,
 * group second. `override` wins outright — it is the operator telling us their
 * board does not follow the convention, and we are not in a position to argue.
 *
 * A missing REQUIRED group is returned as a value, not thrown: the caller logs
 * exactly which states could not be resolved and refuses to start.
 */
export function resolveStateMap(
  states: readonly PlaneState[],
  override: Partial<Record<FeedbackState, string>> = {},
): StateMapResult {
  const resolved: Partial<Record<FeedbackState, string>> = {};
  const missing: FeedbackState[] = [];

  for (const state of FEEDBACK_STATES) {
    const found =
      state === 'review'
        ? (override.review ?? findReviewState(states))
        : (override[state] ?? findByName(states, state) ?? findByGroup(states, state));
    if (found) resolved[state] = found;
    else if (state !== 'review') missing.push(state);
  }

  // A board with no Review column is normal: reports then move straight from
  // doing to done, and `review` never needs a column of its own.
  const review = resolved.review ?? resolved.doing;
  if (missing.length || !review) return { ok: false, missing };

  return {
    ok: true,
    value: {
      pending: resolved.pending as string,
      doing: resolved.doing as string,
      review,
      done: resolved.done as string,
      fail: resolved.fail as string,
    },
  };
}

function findReviewState(states: readonly PlaneState[]): string | undefined {
  const named = states.filter((row) => row.id && REVIEW_NAME.test(row.name ?? ''));
  return (named.find((row) => normalize(row.group) === 'started') ?? named[0])?.id;
}
