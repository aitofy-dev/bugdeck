/**
 * The READ side of the Plane adapter: what the board says, as `TrackerUpdate`s.
 *
 * Split from the write side because the two have opposite failure rules. A
 * write that fails must be reported so the caller can retry it; a read that
 * fails must degrade — one issue's unreadable comments cannot be allowed to
 * cost every other report its state change.
 */
import { fail, ok, type Result, type TrackerComment, type TrackerUpdate } from '../../tracker.js';
import type { FeedbackState } from '../../contract.js';
import { isConfigured, planeApiList, withRetries, type PlaneConfig, type PlaneHttp } from './client.js';
import { buildStateMap, resolveStateMap, type PlaneState } from './state.js';

export interface PlaneIssueRow {
  id: string;
  state?: string;
  updated_at?: string;
}

interface PlaneCommentRow {
  id?: string;
  comment_html?: string;
  created_at?: string;
}

export function parsePlaneDate(raw: string | undefined): Date | null {
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * The column id for each of our five states, read off the live board.
 *
 * Exported so a host can call it at startup and refuse to boot when a group is
 * missing, rather than discovering it on the first report. `config.stateMap` is
 * the operator override and wins outright.
 */
export async function resolveProjectStates(
  http: PlaneHttp,
): Promise<Result<Record<FeedbackState, string>>> {
  try {
    const states = await withRetries(http, 'states.list', () =>
      planeApiList<PlaneState>(http, 'states/'),
    );
    const resolved = resolveStateMap(states, http.config.stateMap ?? {});
    if (!resolved.ok) {
      return fail({
        message: `Plane project ${http.config.projectId} has no column for: ${resolved.missing.join(', ')}. Add the columns or pass an explicit stateMap.`,
        retryable: false,
      });
    }
    return ok(resolved.value);
  } catch (err) {
    return fail({ message: (err as Error).message, retryable: true });
  }
}

/**
 * Every comment on one issue. A failure answers `undefined` rather than
 * throwing, and `undefined` means "not read" — never "no replies", which is
 * what keeps a 500 from looking like a deleted conversation.
 */
async function readComments(
  http: PlaneHttp,
  issueId: string,
  projectId: string,
): Promise<TrackerComment[] | undefined> {
  try {
    const rows = await withRetries(http, 'comments.list', () =>
      planeApiList<PlaneCommentRow>(http, `issues/${issueId}/comments/`, projectId),
    );
    return rows.map((row) => ({
      commentId: row.id ?? null,
      html: row.comment_html ?? '',
      createdAt: parsePlaneDate(row.created_at),
    }));
  } catch (err) {
    http.logger.warn('plane comments unreadable', { issueId, err: (err as Error).message });
    return undefined;
  }
}

/** The live board first, then every board reports used to live on. */
function projectsToRead(config: PlaneConfig): string[] {
  return [config.projectId, ...(config.legacyProjectIds ?? [])].filter(
    (id, index, all) => id && all.indexOf(id) === index,
  );
}

/**
 * Every issue that moved since `since`, with its comments.
 *
 * ONE list call per board, then matching in memory: this edition of Plane has
 * no query language, so per-report lookups would be N requests every few
 * minutes for a board that fits in one page.
 */
export async function* readUpdates(http: PlaneHttp, since: Date): AsyncGenerator<TrackerUpdate> {
  // A Plane we cannot talk to is a Plane we skip. Polling it with no key would
  // spend one 401 per board per tick, forever.
  if (!isConfigured(http.config)) return;

  for (const projectId of projectsToRead(http.config)) {
    let stateMap: Map<string, FeedbackState>;
    let issues: PlaneIssueRow[];
    try {
      const rows = await withRetries(http, 'states.list', () =>
        planeApiList<PlaneState>(http, 'states/', projectId),
      );
      stateMap = buildStateMap(rows);
      issues = await withRetries(http, 'issues.list', () =>
        planeApiList<PlaneIssueRow>(http, 'issues/', projectId),
      );
    } catch (err) {
      // A legacy board being unreadable costs its own reports this pass. It
      // must not cost the live board its whole pass.
      if (projectId === http.config.projectId) throw err;
      http.logger.warn('plane legacy project unreadable', {
        projectId,
        err: (err as Error).message,
      });
      continue;
    }

    for (const issue of issues) {
      const updatedAt = parsePlaneDate(issue.updated_at);
      // A comment bumps the issue's `updated_at`, so an issue untouched since
      // our last look cannot be hiding a new reply. An unreadable timestamp
      // reads as changed: a wasted request is cheaper than a lost answer.
      if (updatedAt && updatedAt.getTime() <= since.getTime()) continue;

      // A state that maps to none of our five is LEFT OUT, never guessed — the
      // caller then leaves the reporter's badge where it is.
      const state = issue.state ? stateMap.get(issue.state) : undefined;
      yield {
        externalId: issue.id,
        updatedAt,
        ...(state ? { state } : {}),
        comments: await readComments(http, issue.id, projectId),
      };
    }
  }
}
