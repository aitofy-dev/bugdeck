/**
 * GitHub Issues as an `IssueTracker` — the WRITE side, plus the assembly.
 *
 * Two facts decide the shape of this file:
 *
 *  1. Idempotency is OURS. GitHub has no `external_id` to dedupe on, so the
 *     report id is written into the body as an HTML comment and every create
 *     looks for it first: search, then the recent issues as a fallback. The
 *     fallback is not only for a rate-limited search — GitHub's search index
 *     lags by up to a minute, which is exactly the window a crash-retry lands
 *     in, and a duplicate issue there is the one failure this guards.
 *  2. There is no attachment API. `uploadAttachment` is therefore ABSENT
 *     rather than stubbed, and screenshots are links back to our asset route.
 */
import {
  fail,
  ok,
  type CreateIssueJob,
  type IssueTracker,
  type TrackerAttachments,
  type TrackerBody,
  type TrackerError,
} from '../../tracker.js';
import {
  githubApi,
  githubPaged,
  isConfigured,
  GithubHttpError,
  PAGE_SIZE,
  repoPath,
  resolveHttp,
  withRetries,
  type GithubConfig,
  type GithubHttp,
} from './client.js';
import { commentMarkdown, githubBody, hasMarker, markerTerm, withMarker } from './markdown.js';
import { readUpdates, type GithubIssueRow } from './updates.js';

export type { GithubConfig } from './client.js';
export { GithubHttpError } from './client.js';
export { escapeMarkdown, githubBody, markerFor } from './markdown.js';
export { mapIssueState, parseGithubDate } from './updates.js';

/** GitHub holds no attachments, so a body is rendered once and never again. */
const NO_ATTACHMENTS: TrackerAttachments = { assetIdByFileName: new Map(), uploaded: false };

function render(body: TrackerBody): string {
  return typeof body === 'string' ? body : body(NO_ATTACHMENTS);
}

/** Exceptions stay inside the adapter; the seam speaks in values. */
function toTrackerError(err: unknown): TrackerError {
  if (err instanceof GithubHttpError) {
    return {
      message: err.message,
      status: err.status,
      retryable: err.status === 429 || err.status >= 500 || err.retryAfterMs !== undefined,
    };
  }
  return { message: (err as Error)?.message ?? String(err), retryable: true };
}

/**
 * The issue already filed for this report, by marker.
 *
 * Search is a PREFILTER — it tokenises the body and would match a neighbouring
 * report id — so every candidate is verified against the whole marker comment
 * locally before it is adopted.
 */
async function findExisting(http: GithubHttp, externalId: string): Promise<number | null> {
  const term = markerTerm(externalId);
  const query = `repo:${http.config.owner}/${http.config.repo} "${term}" in:body`;
  try {
    const res = await withRetries(http, 'issues.search', () =>
      githubApi<{ items?: GithubIssueRow[] }>(
        http,
        `/search/issues?q=${encodeURIComponent(query)}&per_page=20`,
      ),
    );
    const hit = (res.data.items ?? []).find((row) => hasMarker(row.body, externalId));
    if (hit) return hit.number;
  } catch (err) {
    // Search has a rate limit of its own, ten times tighter than the REST one.
    http.logger.warn('github issue search failed, falling back to the recent list', {
      externalId,
      err: (err as Error).message,
    });
  }
  return findInRecent(http, externalId);
}

/** The newest page of issues — where an issue the search index has not seen is. */
async function findInRecent(http: GithubHttp, externalId: string): Promise<number | null> {
  const rows = await githubPaged<GithubIssueRow>(
    http,
    repoPath(http.config, `/issues?state=all&per_page=${PAGE_SIZE}`),
    'issues.recent',
  );
  return rows.find((row) => hasMarker(row.body, externalId))?.number ?? null;
}

/** `#42` is what a reporter quotes, and the number is what every call addresses. */
function issueRef(issueNumber: number): { externalId: string; code: string } {
  return { externalId: String(issueNumber), code: `#${issueNumber}` };
}

async function postIssue(http: GithubHttp, job: CreateIssueJob): Promise<number> {
  const created = await withRetries(http, 'issue.create', () =>
    githubApi<GithubIssueRow>(http, repoPath(http.config, '/issues'), {
      method: 'POST',
      body: {
        title: job.title,
        // The marker is added here rather than trusted from the renderer: a
        // host that brings its own renderer must still be dedupable.
        body: withMarker(render(job.descriptionHtml), job.externalId),
        ...(http.config.labels?.length ? { labels: http.config.labels } : {}),
      },
    }),
  );
  return created.data.number;
}

export function createGithubTracker(config: GithubConfig): IssueTracker {
  const http = resolveHttp(config);

  return {
    /** Markdown, not HTML: it is what the REST API renders. */
    renderBody(job) {
      return githubBody(job, config.publicUrl ?? '');
    },

    async createIssue(job) {
      if (!isConfigured(config)) {
        return fail({
          message: 'GitHub is not configured. Set owner, repo and token, or drop the tracker.',
          retryable: false,
        });
      }
      try {
        const existing = await findExisting(http, job.externalId);
        if (existing !== null) {
          http.logger.info('github issue already existed, adopting', {
            externalId: job.externalId,
            issueNumber: existing,
          });
          return ok(issueRef(existing));
        }
        const issueNumber = await postIssue(http, job);
        if (!issueNumber) {
          return fail({
            message: 'GitHub accepted the issue but returned no number.',
            retryable: true,
          });
        }
        return ok(issueRef(issueNumber));
      } catch (err) {
        return fail(toTrackerError(err));
      }
    },

    /**
     * `body` is Markdown. A host rendering for another tracker sends HTML,
     * which GitHub would print as literal tags, so it is flattened first.
     */
    async addComment(externalId, body) {
      try {
        const created = await withRetries(http, 'comment.create', () =>
          githubApi<{ id?: number }>(http, repoPath(config, `/issues/${externalId}/comments`), {
            method: 'POST',
            body: { body: commentMarkdown(body) },
          }),
        );
        if (!created.data?.id) {
          return fail({
            message: 'GitHub accepted the comment but returned no id.',
            retryable: true,
          });
        }
        return ok({ commentId: String(created.data.id) });
      } catch (err) {
        return fail(toTrackerError(err));
      }
    },

    listUpdates(since) {
      return readUpdates(http, since);
    },
  };
}
