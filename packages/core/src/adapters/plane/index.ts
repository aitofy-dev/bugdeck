/**
 * Plane as an `IssueTracker` — the WRITE side, plus the assembly.
 *
 * Two facts decide the shape of this file:
 *
 *  1. Idempotency is Plane's, not ours. `external_source` + `external_id` on
 *     the create means a second attempt answers 409 carrying the id of the
 *     issue that already exists, which we adopt. That is the only thing
 *     covering the gap between "Plane created the issue" and "our store learned
 *     its id".
 *  2. A screenshot is never allowed to cost a report. Every upload failure ends
 *     in a warning and, where a public URL is configured, a link — never in a
 *     rejected create.
 */
import {
  fail,
  ok,
  type CreateIssueJob,
  type IssueTracker,
  type Result,
  type TrackerAttachments,
  type TrackerBody,
  type TrackerError,
} from '../../tracker.js';
import type { FeedbackState } from '../../contract.js';
import {
  isConfigured,
  planeApi,
  PlaneHttpError,
  projectIdentifier,
  resolveHttp,
  withRetries,
  type PlaneConfig,
  type PlaneHttp,
} from './client.js';
import { uploadAttachment, uploadFiles } from './attachments.js';
import { resolveProjectStates, readUpdates } from './updates.js';

export type { PlaneConfig } from './client.js';
export { isConfigured, PlaneHttpError, resolveHttp } from './client.js';
export { attachmentName } from './attachments.js';
export * from './html.js';
export * from './state.js';
export * from './reply.js';
export * from './sync.js';
export { resolveProjectStates, readUpdates, parsePlaneDate } from './updates.js';

/** The first render: the issue has to exist before anything can be uploaded. */
const BEFORE_UPLOAD: TrackerAttachments = { assetIdByFileName: new Map(), uploaded: false };

interface PlaneIssue {
  id: string;
  sequence_id: number;
}

function render(body: TrackerBody, attachments: TrackerAttachments): string {
  return typeof body === 'string' ? body : body(attachments);
}

/** Exceptions stay inside the adapter; the seam speaks in values. */
function toTrackerError(err: unknown): TrackerError {
  if (err instanceof PlaneHttpError) {
    return {
      message: err.message,
      status: err.status,
      retryable: err.status === 429 || err.status >= 500,
    };
  }
  return { message: (err as Error)?.message ?? String(err), retryable: true };
}

/** `adopted` = the issue was already there; an earlier run may have attached files. */
async function createOrAdopt(
  http: PlaneHttp,
  job: CreateIssueJob,
  stateId: string | undefined,
): Promise<PlaneIssue & { adopted: boolean }> {
  return withRetries(http, 'issue.create', async () => {
    try {
      const created = await planeApi<PlaneIssue>(http, 'issues/', {
        method: 'POST',
        body: {
          name: job.title,
          description_html: render(job.descriptionHtml, BEFORE_UPLOAD),
          ...(stateId ? { state: stateId } : {}),
          external_source: job.externalSource,
          external_id: job.externalId,
        },
      });
      return { ...created, adopted: false };
    } catch (err) {
      // 409 = we already created this exact report on an earlier attempt that
      // died before our store heard about it. Adopt it, never duplicate it.
      if (err instanceof PlaneHttpError && err.status === 409) {
        const existingId = (JSON.parse(err.body) as { id?: string }).id;
        if (existingId) {
          http.logger.info('plane issue already existed, adopting', {
            externalId: job.externalId,
            issueId: existingId,
          });
          const existing = await planeApi<PlaneIssue>(http, `issues/${existingId}/`);
          return { ...existing, adopted: true };
        }
      }
      throw err;
    }
  });
}

export function createPlaneTracker(config: PlaneConfig): IssueTracker {
  const http = resolveHttp(config);
  let states: Record<FeedbackState, string> | null = null;

  /**
   * The column a new report lands in. Resolved once, lazily, and a failure is
   * survivable: an issue created without `state` lands in Plane's own default
   * column, which is visible — unlike a report that never reached the board.
   */
  async function pendingStateId(): Promise<string | undefined> {
    if (!states) {
      const resolved = await resolveProjectStates(http);
      if (!resolved.ok) {
        http.logger.warn('plane states unresolved, using the board default', {
          err: resolved.error.message,
        });
        return undefined;
      }
      states = resolved.value;
    }
    return states.pending;
  }

  return {
    async createIssue(job) {
      if (!isConfigured(config)) {
        return fail({
          message: 'Plane is not configured. Set apiKey and projectId, or drop the tracker.',
          retryable: false,
        });
      }
      try {
        // BEFORE the create: failing here costs a retry, failing after would
        // leave a report holding an issue id but no code a user can quote.
        const identifier = await projectIdentifier(http);
        const issue = await createOrAdopt(http, job, await pendingStateId());
        const code = `${identifier}-${issue.sequence_id}`;

        // `adopted` = an earlier run may have attached files; a fresh issue is
        // missing everything by definition, so asking Plane would be wasted.
        const upload = await uploadFiles(http, issue.id, job.images, issue.adopted);

        // The body is rewritten only if it would CHANGE: the issue was created
        // before any asset id existed, and inline images are the only reason to
        // go back for a second pass.
        const before = render(job.descriptionHtml, BEFORE_UPLOAD);
        const after = render(job.descriptionHtml, {
          assetIdByFileName: upload.assetIdByFileName,
          uploaded: true,
        });
        if (after !== before) {
          try {
            await planeApi(http, `issues/${issue.id}/`, {
              method: 'PATCH',
              body: { description_html: after },
            });
          } catch (err) {
            upload.warnings.push(`description rewrite: ${(err as Error).message}`);
          }
        }

        for (const warning of upload.warnings) {
          http.logger.warn('plane create finished with a warning', {
            externalId: job.externalId,
            warning,
          });
        }
        return ok({ externalId: issue.id, code });
      } catch (err) {
        return fail(toTrackerError(err));
      }
    },

    async addComment(externalId, html) {
      try {
        const comment = await withRetries(http, 'comment.create', () =>
          planeApi<{ id?: string }>(http, `issues/${externalId}/comments/`, {
            method: 'POST',
            body: { comment_html: html },
          }),
        );
        if (!comment?.id) {
          return fail({
            message: 'Plane accepted the comment but returned no id.',
            retryable: true,
          });
        }
        return ok({ commentId: comment.id });
      } catch (err) {
        return fail(toTrackerError(err));
      }
    },

    async uploadAttachment(externalId, file) {
      try {
        return ok({ assetId: await uploadAttachment(http, externalId, file), name: file.name });
      } catch (err) {
        return fail(toTrackerError(err));
      }
    },

    listUpdates(since) {
      return readUpdates(http, since);
    },
  };
}

/**
 * Rewrite an existing issue's title and body.
 *
 * Not on `IssueTracker`: only reports nobody has read yet are editable, and a
 * tracker that cannot edit should not have to say so. Reachable through the
 * adapter for the hosts whose tracker is Plane.
 */
export async function updateIssue(
  config: PlaneConfig,
  externalId: string,
  job: Pick<CreateIssueJob, 'title' | 'descriptionHtml' | 'images'>,
  http: PlaneHttp = resolveHttp(config),
): Promise<Result<{ warnings: string[] }>> {
  try {
    // `true`: the issue already carries the original report's screenshots, so
    // the listing is what keeps this from re-uploading them.
    const upload = await uploadFiles(http, externalId, job.images, true);
    await withRetries(http, 'issue.update', () =>
      planeApi(http, `issues/${externalId}/`, {
        method: 'PATCH',
        body: {
          name: job.title,
          description_html: render(job.descriptionHtml, {
            assetIdByFileName: upload.assetIdByFileName,
            uploaded: true,
          }),
        },
      }),
    );
    return ok({ warnings: upload.warnings });
  } catch (err) {
    return fail(toTrackerError(err));
  }
}
