/**
 * The READ side of the GitHub adapter: what the repo says, as `TrackerUpdate`s.
 *
 * Split from the write side because the two have opposite failure rules. A
 * write that fails must be reported so the caller can retry it; a read that
 * fails must degrade — one issue's unreadable comments cannot cost every other
 * report its state change.
 *
 * GitHub has two booleans where we have five states, so the mapping is:
 * open → doing, closed → done, closed as `not_planned` → fail, and a label
 * wins over all three. That label is how `pending` and `review` exist at all.
 */
import { FEEDBACK_STATES, type FeedbackState } from '../../contract.js';
import type { TrackerComment, TrackerUpdate } from '../../tracker.js';
import {
  githubPaged,
  isConfigured,
  PAGE_SIZE,
  repoPath,
  type GithubConfig,
  type GithubHttp,
} from './client.js';
import { hasAnyMarker } from './markdown.js';

/** The label names a repo is assumed to use, before any operator override. */
const DEFAULT_STATE_LABELS: Partial<Record<FeedbackState, string>> = {
  pending: 'pending',
  review: 'review',
};

export interface GithubIssueRow {
  number: number;
  body?: string | null;
  state?: string;
  /** `completed` | `not_planned` | null — the only way to tell a fix from a no. */
  state_reason?: string | null;
  updated_at?: string;
  labels?: Array<{ name?: string } | string>;
  comments?: number;
  /** Present only on pull requests, which share the issues endpoint. */
  pull_request?: unknown;
}

interface GithubCommentRow {
  id?: number;
  body?: string | null;
  created_at?: string;
  user?: { login?: string };
}

export function parseGithubDate(raw: string | undefined): Date | null {
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function labelNames(row: GithubIssueRow): Set<string> {
  const names = (row.labels ?? []).map((label) =>
    typeof label === 'string' ? label : (label.name ?? ''),
  );
  return new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean));
}

/**
 * One issue's state, or undefined when it maps to none of our five.
 *
 * Labels are checked in our own state order so two of them on one issue always
 * decide the same way — a board where that happens is misconfigured, and a
 * mapping that flips with list order hides it.
 */
export function mapIssueState(
  row: GithubIssueRow,
  override: Partial<Record<FeedbackState, string>> = {},
): FeedbackState | undefined {
  const stateLabels = { ...DEFAULT_STATE_LABELS, ...override };
  const labels = labelNames(row);
  for (const state of FEEDBACK_STATES) {
    const label = stateLabels[state];
    if (label && labels.has(label.trim().toLowerCase())) return state;
  }
  if (row.state === 'open') return 'doing';
  if (row.state === 'closed') return row.state_reason === 'not_planned' ? 'fail' : 'done';
  return undefined;
}

/**
 * Every comment on one issue, newest-first order left as GitHub gave it — the
 * reply parser sorts by timestamp. A failure answers `undefined`, which means
 * "not read" and never "no replies": that is what keeps a 500 from looking
 * like a deleted conversation.
 */
async function readComments(
  http: GithubHttp,
  issueNumber: number,
  since: Date,
): Promise<TrackerComment[] | undefined> {
  const path = repoPath(
    http.config,
    `/issues/${issueNumber}/comments?since=${encodeURIComponent(since.toISOString())}&per_page=${PAGE_SIZE}`,
  );
  try {
    const rows = await githubPaged<GithubCommentRow>(http, path, 'comments.list');
    return rows.map((row) => ({
      commentId: row.id === undefined ? null : String(row.id),
      // Markdown as written: the reply parser only reads the leading `@user`.
      html: row.body ?? '',
      createdAt: parseGithubDate(row.created_at),
      ...(row.user?.login ? { author: row.user.login } : {}),
    }));
  } catch (err) {
    http.logger.warn('github comments unreadable', {
      issueNumber,
      err: (err as Error).message,
    });
    return undefined;
  }
}

function issuesPath(config: GithubConfig, since: Date): string {
  const labels = (config.labels ?? []).join(',');
  return repoPath(
    config,
    `/issues?state=all&since=${encodeURIComponent(since.toISOString())}&per_page=${PAGE_SIZE}` +
      (labels ? `&labels=${encodeURIComponent(labels)}` : ''),
  );
}

/**
 * Every issue of OURS that moved since `since`, with its comments.
 *
 * The marker is the filter, not the label: a repo is shared with humans who
 * file their own bugs, and a state change read off someone else's issue would
 * move a reporter's badge for reasons nobody can explain. A comment bumps the
 * issue's `updated_at`, so GitHub's own `since` is enough to skip the rest.
 */
export async function* readUpdates(http: GithubHttp, since: Date): AsyncGenerator<TrackerUpdate> {
  // A GitHub we cannot talk to is a GitHub we skip. Polling it with no token
  // would spend one 401 per tick, forever.
  if (!isConfigured(http.config)) return;

  // `githubPaged` retries each page itself; wrapping it again would turn three
  // attempts into nine against a rate limit we share with the repo's humans.
  const rows = await githubPaged<GithubIssueRow>(http, issuesPath(http.config, since), 'issues.list');

  for (const row of rows) {
    if (row.pull_request || !hasAnyMarker(row.body)) continue;
    const state = mapIssueState(row, http.config.stateLabels ?? {});
    yield {
      externalId: String(row.number),
      updatedAt: parseGithubDate(row.updated_at),
      ...(state ? { state } : {}),
      // An issue with no comments has nothing to read, and asking anyway is a
      // request per report per tick against a rate limit we share.
      comments: row.comments === 0 ? [] : await readComments(http, row.number, since),
    };
  }
}
