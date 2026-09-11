/**
 * The wire. Field names and limits come from `@bugdeck/core`, so the widget and
 * the route cannot drift: a renamed field would be a 400 on a report the user
 * believes was sent, and nobody reports the bug reporter.
 */
import {
  FEEDBACK_BLOCKS_FIELD,
  FEEDBACK_CONTEXT_FIELD,
  FEEDBACK_DESCRIPTION_FIELD,
  FEEDBACK_IMAGE_FIELD,
  FEEDBACK_MAX_DESCRIPTION,
  type ErrorCode,
  type FeedbackBlockInput,
  type FeedbackContext,
} from '@bugdeck/core';
import { describeError } from './describe-error.js';
import { defaultStrings, formatString, isErrorCode, type WidgetStrings } from './strings.js';

const trimBase = (apiBase: string): string => apiBase.replace(/\/+$/, '');

/** `POST` a new report. */
export function reportsEndpoint(apiBase: string): string {
  return `${trimBase(apiBase)}/reports`;
}

/** `PATCH` an existing report — the server accepts it only while `pending`. */
export function reportEndpoint(apiBase: string, reportId: string): string {
  return `${reportsEndpoint(apiBase)}/${encodeURIComponent(reportId)}`;
}

/** `POST` a comment. Allowed in every state, including `done`. */
export function commentEndpoint(apiBase: string, reportId: string): string {
  return `${reportEndpoint(apiBase, reportId)}/comment`;
}

/** Where one stored image is served from. Only the report's owner may read it. */
export function assetEndpoint(apiBase: string, assetId: string): string {
  return `${trimBase(apiBase)}/assets/${encodeURIComponent(assetId)}`;
}

/** What the write routes answer with on success. */
export interface FeedbackSubmitResult {
  id: string;
  /** `PROJ-12`. Absent while the tracker bridge is still creating the issue. */
  code?: string;
}

export interface FeedbackFormInput {
  description: string;
  context: FeedbackContext;
  images: readonly File[];
  /** Omitted when the report is a single paragraph — nothing to interleave. */
  blocks?: readonly FeedbackBlockInput[];
}

/** Pure builder — the exact multipart shape the route parses. */
export function buildFeedbackFormData(
  input: FeedbackFormInput,
  imagesField: string = FEEDBACK_IMAGE_FIELD,
): FormData {
  const form = new FormData();
  form.append(
    FEEDBACK_DESCRIPTION_FIELD,
    input.description.trim().slice(0, FEEDBACK_MAX_DESCRIPTION),
  );
  form.append(FEEDBACK_CONTEXT_FIELD, JSON.stringify(input.context));
  if (input.blocks?.length) form.append(FEEDBACK_BLOCKS_FIELD, JSON.stringify(input.blocks));
  for (const image of input.images) {
    form.append(imagesField, image, image.name);
  }
  return form;
}

/**
 * A refusal the server named. The server answers `{error: ErrorCode}` and never
 * a sentence, so the wording stays in `WidgetStrings` and can be translated.
 */
export class FeedbackSubmitError extends Error {
  constructor(
    readonly code: ErrorCode | undefined,
    readonly status: number,
  ) {
    super(code ?? `HTTP ${status}`);
    this.name = 'FeedbackSubmitError';
  }
}

/** The line to show a user for any failure coming out of a submit function. */
export function submitErrorMessage(
  err: unknown,
  strings: WidgetStrings = defaultStrings,
): string {
  if (err instanceof FeedbackSubmitError) {
    return err.code ? strings.errors[err.code] : strings.errorUnknown;
  }
  return formatString(strings.submitFailed, { reason: describeError(err, strings) });
}

const readErrorCode = async (response: Response): Promise<ErrorCode | undefined> => {
  try {
    const body: unknown = await response.json();
    const code = (body as { error?: unknown } | null)?.error;
    return isErrorCode(code) ? code : undefined;
  } catch {
    // Non-JSON error body (a proxy's HTML, an empty 502) — status is all we get.
    return undefined;
  }
};

export interface SubmitFeedbackInput extends FeedbackFormInput {
  apiBase: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface UpdateReportInput extends SubmitFeedbackInput {
  reportId: string;
}

async function send(
  url: string,
  method: 'POST' | 'PATCH',
  input: SubmitFeedbackInput,
): Promise<FeedbackSubmitResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const response = await doFetch(url, {
    method,
    body: buildFeedbackFormData(input),
    // No Content-Type: the browser must set the multipart boundary itself.
    headers: input.headers,
    credentials: 'include',
    signal: input.signal,
  });

  if (!response.ok) {
    throw new FeedbackSubmitError(await readErrorCode(response), response.status);
  }

  const body = (await response.json()) as Partial<FeedbackSubmitResult>;
  if (typeof body?.id !== 'string') throw new FeedbackSubmitError(undefined, response.status);
  return typeof body.code === 'string' ? { id: body.id, code: body.code } : { id: body.id };
}

/** File a new report. */
export function submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackSubmitResult> {
  return send(reportsEndpoint(input.apiBase), 'POST', input);
}

/**
 * Rewrite a report that nobody has read yet. Images the report ALREADY has
 * travel as `{kind: 'image', assetId}` blocks instead of being uploaded again,
 * which is what keeps asset ids stable across an edit.
 */
export function updateReport(input: UpdateReportInput): Promise<FeedbackSubmitResult> {
  return send(reportEndpoint(input.apiBase, input.reportId), 'PATCH', input);
}

/** Add to the conversation on a report, in any state. */
export function commentOnReport(input: UpdateReportInput): Promise<FeedbackSubmitResult> {
  return send(commentEndpoint(input.apiBase, input.reportId), 'POST', input);
}
