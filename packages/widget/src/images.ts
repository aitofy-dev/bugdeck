/**
 * Client-side image rules. The server enforces the same limits and re-encodes
 * everything anyway; this exists so the user is refused in a millisecond
 * instead of after a 10 MB upload. Both numbers come from the shared contract,
 * so there is nothing here to drift.
 */
import { FEEDBACK_MAX_ASSETS, FEEDBACK_MAX_ASSET_BYTES } from '@aitofy/bugdeck-core/contract';
import { defaultStrings, formatString, type WidgetStrings } from './strings.js';

export const MAX_IMAGES = FEEDBACK_MAX_ASSETS;
export const MAX_IMAGE_BYTES = FEEDBACK_MAX_ASSET_BYTES;

/** Server re-encodes anyway, but rejecting here saves a 10 MB round trip. */
export const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_MIME_TYPES.join(',');

export type ImageRejectionCode = 'bad_type' | 'too_large' | 'too_many';

/** Data, not a sentence: the wording is chosen by whoever renders it. */
export interface ImageRejection {
  code: ImageRejectionCode;
  name: string;
  /** Bytes, on `too_large` only. */
  size?: number;
}

/** Only what validation needs — a real `File` satisfies it, a fixture object too. */
export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export function isAcceptedMime(mime: string): boolean {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mime.toLowerCase());
}

export const megabytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

export function validateImageFile(file: FileLike): ImageRejection | null {
  if (!isAcceptedMime(file.type)) return { code: 'bad_type', name: file.name };
  if (file.size > MAX_IMAGE_BYTES) {
    return { code: 'too_large', name: file.name, size: file.size };
  }
  return null;
}

/** One rejection, in words, naming the file and the reason. */
export function formatRejection(
  rejection: ImageRejection,
  strings: WidgetStrings = defaultStrings,
): string {
  switch (rejection.code) {
    case 'bad_type':
      return formatString(strings.imageBadType, { name: rejection.name });
    case 'too_large':
      return formatString(strings.imageTooLarge, {
        name: rejection.name,
        size: megabytes(rejection.size ?? 0),
        max: megabytes(MAX_IMAGE_BYTES),
      });
    case 'too_many':
      return formatString(strings.imageTooMany, { name: rejection.name, max: MAX_IMAGES });
  }
}

export interface SelectionResult<T extends FileLike> {
  accepted: T[];
  rejections: ImageRejection[];
}

/**
 * Decides what a drop of new files adds to a queue that already holds
 * `existingCount` images. Type/size are checked before the slot count so a
 * broken file never eats a slot and never silently masks the real reason.
 */
export function selectImages<T extends FileLike>(
  existingCount: number,
  incoming: readonly T[],
): SelectionResult<T> {
  const accepted: T[] = [];
  const rejections: ImageRejection[] = [];

  for (const file of incoming) {
    const rejection = validateImageFile(file);
    if (rejection) {
      rejections.push(rejection);
      continue;
    }
    if (existingCount + accepted.length >= MAX_IMAGES) {
      rejections.push({ code: 'too_many', name: file.name });
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejections };
}
