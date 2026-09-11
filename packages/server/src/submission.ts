/**
 * One multipart write request, parsed and sanitised into a value.
 *
 * Sanitising happens BEFORE anything is written. A report whose image was
 * rejected is a 400 the user can fix; sanitising after the insert would leave a
 * half-saved report with a missing picture.
 *
 * The form arrives as an already-decoded map (Hono's `parseBody`), which keeps
 * this file a pure function of untrusted data: no request, no store, no HTTP.
 */
import {
  FEEDBACK_BLOCKS_FIELD,
  FEEDBACK_CONTEXT_FIELD,
  FEEDBACK_DESCRIPTION_FIELD,
  FEEDBACK_IMAGE_FIELD,
  FEEDBACK_MAX_DESCRIPTION,
  failureErrorCode,
  sanitizeImage,
  type ErrorCode,
  type FeedbackContext,
  type SanitizedImage,
} from '@bugdeck/core';
import type { FeedbackLimits } from './limits.js';

/** What a decoded multipart body looks like, repeated keys included. */
export type FormValue = string | File;
export type ParsedForm = Record<string, FormValue | FormValue[]>;

export interface Submission {
  description: string;
  /** Still raw: it needs the asset ids, which do not exist until after the write. */
  blocksRaw: string | undefined;
  context: FeedbackContext;
  images: SanitizedImage[];
}

export type SubmissionResult = { ok: true; value: Submission } | { ok: false; error: ErrorCode };

const asArray = (value: FormValue | FormValue[] | undefined): FormValue[] => {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

function textField(form: ParsedForm, name: string): string | undefined {
  const first = asArray(form[name]).find((value) => typeof value === 'string');
  return typeof first === 'string' ? first : undefined;
}

/**
 * Screenshots arrive as a REPEATED `images` key. Anything under another field
 * name is ignored rather than refused: a stray part must not cost the user the
 * description they just wrote.
 */
function imageFiles(form: ParsedForm): File[] {
  return asArray(form[FEEDBACK_IMAGE_FIELD]).filter(
    (value): value is File => typeof value !== 'string',
  );
}

const clampString = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

const finiteInt = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

/**
 * The widget sends `context` as a JSON string. Every field is clamped rather
 * than trusted: this ends up in an issue description someone reads, and an
 * unbounded userAgent is a free wall of text on their board.
 */
export function parseContext(raw: string | undefined): FeedbackContext {
  let parsed: Record<string, unknown> = {};
  if (raw) {
    try {
      const decoded: unknown = JSON.parse(raw);
      if (decoded && typeof decoded === 'object') parsed = decoded as Record<string, unknown>;
    } catch {
      // A malformed context must not lose the report — the description is the
      // part that carries meaning.
    }
  }
  const viewport = (parsed.viewport ?? {}) as Record<string, unknown>;
  const apiError = parsed.lastApiError as Record<string, unknown> | undefined;
  const buildCommit = clampString(parsed.buildCommit, 60);
  return {
    url: clampString(parsed.url, 2000),
    viewport: { width: finiteInt(viewport.width), height: finiteInt(viewport.height) },
    userAgent: clampString(parsed.userAgent, 500),
    ...(buildCommit ? { buildCommit } : {}),
    ...(apiError && typeof apiError === 'object'
      ? {
          lastApiError: {
            status: finiteInt(apiError.status),
            path: clampString(apiError.path, 500),
            message: clampString(apiError.message, 1000),
          },
        }
      : {}),
  };
}

export async function readSubmission(
  form: ParsedForm,
  limits: FeedbackLimits,
): Promise<SubmissionResult> {
  const description = clampString(
    textField(form, FEEDBACK_DESCRIPTION_FIELD),
    FEEDBACK_MAX_DESCRIPTION,
  ).trim();
  if (!description) return { ok: false, error: 'MISSING_DESCRIPTION' };

  const files = imageFiles(form);
  if (files.length > limits.maxAssets) return { ok: false, error: 'TOO_MANY_IMAGES' };

  const images: SanitizedImage[] = [];
  for (const file of files) {
    if (file.size > limits.maxAssetBytes) return { ok: false, error: 'IMAGE_TOO_LARGE' };
    const sanitized = await sanitizeImage(Buffer.from(await file.arrayBuffer()));
    if (!sanitized.ok) return { ok: false, error: failureErrorCode(sanitized.reason) };
    images.push(sanitized.value);
  }

  return {
    ok: true,
    value: {
      description,
      blocksRaw: textField(form, FEEDBACK_BLOCKS_FIELD),
      context: parseContext(textField(form, FEEDBACK_CONTEXT_FIELD)),
      images,
    },
  };
}
