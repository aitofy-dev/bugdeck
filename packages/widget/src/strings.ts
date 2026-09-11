/**
 * Every word the widget can show, in one object.
 *
 * The server never sends a sentence — it answers 4xx with an `ErrorCode` — so
 * this file is the only place a user-visible string exists. Pass `strings` to
 * `<FeedbackWidget>` to translate the whole surface without forking the UI.
 *
 * Placeholders are `{name}` and are substituted by `formatString`.
 */
import { ERROR_CODES, FEEDBACK_MAX_ASSETS, type ErrorCode } from '@aitofy/bugdeck-core/contract';

export interface WidgetStrings {
  // ─── launcher ──────────────────────────────────────────────────
  launcherLabel: string;
  /** Names the dot on the launcher, for a screen reader and on hover. */
  launcherDraftTitle: string;

  // ─── dialog chrome ─────────────────────────────────────────────
  editorHeading: string;
  hide: string;
  discard: string;
  cancel: string;
  close: string;
  send: string;
  sending: string;

  // ─── capture toolbar ───────────────────────────────────────────
  captureScreen: string;
  capturing: string;
  pickRegion: string;
  uploadImage: string;
  pickRegionBanner: string;

  // ─── editor body ───────────────────────────────────────────────
  descriptionPlaceholder: string;
  /** `{max}` images, `{maxMb}` MB each. */
  editorHint: string;
  /** `{shortcut}` — the paste chord, which differs on macOS. */
  pasteHint: string;
  dropHere: string;
  imageAlt: string;
  removeImage: string;
  annotateImage: string;
  annotate: string;
  remove: string;

  // ─── drafts and leaving ────────────────────────────────────────
  discardPrompt: string;
  keep: string;
  confirmDiscard: string;
  draftRestored: string;
  /** `{count}` images shed to fit the draft budget. */
  draftImagesDropped: string;

  // ─── after sending ─────────────────────────────────────────────
  /** `{code}` — the tracker reference, or `codePending` while it is minted. */
  sentHeading: string;
  codePending: string;
  sentBody: string;
  myReports: string;

  // ─── annotation ────────────────────────────────────────────────
  toolPen: string;
  toolRect: string;
  toolArrow: string;
  toolCrop: string;
  colorRed: string;
  colorYellow: string;
  applyCrop: string;
  undo: string;
  save: string;
  cropHintDrag: string;
  cropHintAdjust: string;
  annotateLoadFailed: string;
  annotateCropFailed: string;
  annotateExportFailed: string;
  /** `{maxMb}` — the per-image ceiling. */
  annotateTooLarge: string;

  // ─── failures the user reads ───────────────────────────────────
  /** `{reason}` — whatever `describeError` made of the throw. */
  captureFailed: string;
  captureInvalidImage: string;
  /** `{seconds}` — the capture timeout. */
  captureTimeout: string;
  /** `{reason}` — used when the failure carries no `ErrorCode`. */
  submitFailed: string;
  errorUnknown: string;
  /** `{target}` — e.g. `img https://cdn.example.com/logo.png`. */
  errorResourceFailed: string;
  /** `{type}` — a DOM event type. */
  errorEvent: string;
  draftImageUnreadable: string;

  // ─── image validation, per file ────────────────────────────────
  /** `{name}`. */
  imageBadType: string;
  /** `{name}`, `{size}` MB, `{max}` MB. */
  imageTooLarge: string;
  /** `{name}`, `{max}` images. */
  imageTooMany: string;

  /** One line per server `ErrorCode`. The server sends the code, never this. */
  errors: Record<ErrorCode, string>;
}

/** The keys that hold a plain string — everything but the `errors` table. */
export type WidgetStringKey = {
  [K in keyof WidgetStrings]: WidgetStrings[K] extends string ? K : never;
}[keyof WidgetStrings];

export const defaultStrings: WidgetStrings = {
  launcherLabel: 'Report a bug',
  launcherDraftTitle: 'You have an unsent draft on this page',

  editorHeading: 'Report a bug',
  hide: 'Hide',
  discard: 'Discard',
  cancel: 'Cancel',
  close: 'Close',
  send: 'Send',
  sending: 'Sending…',

  captureScreen: 'Capture screen',
  capturing: 'Capturing…',
  pickRegion: 'Pick element',
  uploadImage: 'Upload image',
  pickRegionBanner: 'Click the part that is broken · Esc to cancel',

  descriptionPlaceholder: 'What were you doing? What happened? What did you expect?',
  editorHint: 'Up to {max} images, {maxMb} MB each',
  pasteHint: 'Paste an image with {shortcut}',
  dropHere: 'Drop to attach',
  imageAlt: 'Attached image',
  removeImage: 'Remove this image',
  annotateImage: 'Draw on this image',
  annotate: 'Draw',
  remove: 'Remove',

  discardPrompt: 'Discard this draft?',
  keep: 'Keep',
  confirmDiscard: 'Discard',
  draftRestored: 'Restored the draft you left on this page.',
  draftImagesDropped: '{count} image(s) were too large to keep.',

  sentHeading: 'Sent · {code}',
  codePending: 'assigning a number…',
  sentBody: 'Thanks — we have it. You can follow its status here.',
  myReports: 'My reports',

  toolPen: 'Pen',
  toolRect: 'Box',
  toolArrow: 'Arrow',
  toolCrop: 'Crop',
  colorRed: 'Red',
  colorYellow: 'Yellow',
  applyCrop: 'Apply crop',
  undo: 'Undo',
  save: 'Save',
  cropHintDrag: 'Drag on the image to choose the area to keep.',
  cropHintAdjust: 'Drag again for another area, or apply the crop.',
  annotateLoadFailed: 'Could not open this image for drawing.',
  annotateCropFailed: 'Could not crop this image.',
  annotateExportFailed: 'Could not export the drawing.',
  annotateTooLarge: 'The drawing is over {maxMb} MB. Crop the area down and draw again.',

  captureFailed: 'Could not capture the screen ({reason}). You can upload an image instead.',
  captureInvalidImage: 'The capture produced an invalid image.',
  captureTimeout: 'the capture did not finish within {seconds}s',
  submitFailed: 'Send failed: {reason}',
  errorUnknown: 'Something went wrong. Please try again.',
  errorResourceFailed: 'could not load {target}',
  errorEvent: '{type} event',
  draftImageUnreadable: 'could not read the image',

  imageBadType: '{name}: only PNG, JPEG and WEBP are accepted',
  imageTooLarge: '{name}: {size} MB, the limit is {max} MB',
  imageTooMany: '{name}: up to {max} images per report',

  errors: {
    UNAUTHENTICATED: 'Please sign in again, then send this report.',
    BAD_REQUEST: 'That report could not be read. Try again, or remove the last image.',
    MISSING_DESCRIPTION: 'Write a short description before sending.',
    TOO_MANY_IMAGES: `A report holds at most ${FEEDBACK_MAX_ASSETS} images. Remove a few and send again.`,
    IMAGE_TOO_LARGE: 'One of the images is too large.',
    UNSUPPORTED_IMAGE: 'One of the images is not a supported format.',
    NOT_PENDING: 'Someone is already working on this report, so it can no longer be edited. Add a comment instead.',
    NOT_FOUND: 'This report no longer exists.',
    RATE_LIMITED: 'Too many reports in the last hour. Please try again later.',
  },
};

/**
 * Merge a partial override over the defaults. `errors` is merged one level
 * deeper so a caller can translate a single code without restating all seven.
 */
export function mergeStrings(overrides?: Partial<WidgetStrings>): WidgetStrings {
  if (!overrides) return defaultStrings;
  return {
    ...defaultStrings,
    ...overrides,
    errors: { ...defaultStrings.errors, ...overrides.errors },
  };
}

/** `{name}` substitution. A placeholder with no value is left as written. */
export function formatString(
  template: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
