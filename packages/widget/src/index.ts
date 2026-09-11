export { FeedbackWidget, type FeedbackWidgetProps } from './FeedbackWidget.js';
/**
 * The composing half on its own — a block editor with capture, picker and
 * annotation, and no opinion about where the result goes. A report page uses it
 * for "Edit" and "Comment" so there is exactly ONE editor to fix.
 */
export {
  FeedbackEditor,
  type ExistingImage,
  type FeedbackEditorPayload,
  type FeedbackEditorProps,
} from './FeedbackEditor.js';
export { FeedbackForm } from './FeedbackModal.js';
export { FeedbackSent, sentHeadline, type FeedbackSentProps } from './FeedbackSent.js';
/** Look and placement: tokens as CSS variables, one injected stylesheet. */
export {
  DEFAULT_ACCENT,
  DEFAULT_LAUNCHER_OFFSET,
  THEME_ATTR,
  type LauncherPosition,
  type WidgetTheme,
} from './theme.js';
export { injectWidgetStyles, widgetCss, STYLE_ELEMENT_ID } from './styles/sheet.js';
export { dragHasFiles, imagesFromDataTransfer, pasteShortcut } from './image-intake.js';
/** Every word the widget shows, and the hook that reads the active dictionary. */
export {
  defaultStrings,
  formatString,
  isErrorCode,
  mergeStrings,
  type WidgetStrings,
} from './strings.js';
export {
  useWidgetStrings,
  WidgetStringsProvider,
  type WidgetStringsProviderProps,
} from './strings-context.js';
export {
  reportApiError,
  normalizeApiError,
  getLastApiError,
  clearLastApiError,
  type ApiErrorMeta,
} from './api-error.js';
export { collectContext, readBrowserEnv, type ContextEnv, type CollectContextOptions } from './context.js';
export {
  ACCEPTED_MIME_TYPES,
  ACCEPT_ATTRIBUTE,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  formatRejection,
  isAcceptedMime,
  megabytes,
  selectImages,
  validateImageFile,
  type FileLike,
  type ImageRejection,
  type ImageRejectionCode,
} from './images.js';
export {
  assetEndpoint,
  buildFeedbackFormData,
  commentEndpoint,
  commentOnReport,
  reportEndpoint,
  reportsEndpoint,
  submitErrorMessage,
  submitFeedback,
  updateReport,
  FeedbackSubmitError,
  type FeedbackFormInput,
  type FeedbackSubmitResult,
  type SubmitFeedbackInput,
  type UpdateReportInput,
} from './submit.js';
export { describeError } from './describe-error.js';
/**
 * Hide (keep the draft) vs Discard (throw it away) — two gestures, two
 * outcomes, one rule. ✕ · Esc · a backdrop click all mean Hide when there is a
 * draft: the most reflexive gesture must be the one that loses nothing.
 */
export {
  exitIntent,
  type ExitAction,
  type ExitContext,
  type ExitGesture,
} from './exit-intent.js';
/**
 * Unsent reports survive the tab, one draft PER PAGE — a different bug on a
 * different screen is a different report, not an appendix to the last one.
 */
export {
  clearDraft,
  draftKey,
  draftSlug,
  fileToDataUrl,
  isExpired,
  loadDraft,
  parseDraft,
  pruneDrafts,
  saveDraft,
  serializeDraft,
  DRAFT_BUDGET_CHARS,
  DRAFT_KEY_PREFIX,
  DRAFT_TTL_MS,
  type DraftImage,
  type FeedbackDraft,
} from './draft-store.js';
export { AnnotateOverlay, type AnnotateOverlayProps } from './AnnotateOverlay.js';
export {
  annotatedName,
  arrowHead,
  cropRect,
  drawCropOverlay,
  drawStroke,
  extendStroke,
  isEmptyStroke,
  isUsableCrop,
  normalizeCrop,
  renderStrokes,
  shiftStrokes,
  strokeWidthFor,
  toImagePoint,
  ANNOTATE_COLORS,
  MIN_CROP_PX,
  type AnnotateColor,
  type AnnotateTool,
  type CropRect,
  type Ctx2D,
  type Point,
  type Size,
  type Stroke,
} from './annotate.js';
export {
  ElementPicker,
  elementLabel,
  firstForeignElement,
  isOwnUi,
  toRect,
  type ElementPickerProps,
  type PickedRect,
} from './ElementPicker.js';
export {
  buildBlockPayload,
  imagesToUpload,
  imageBlock,
  initialBlocks,
  insertAfter,
  pruneMissingImages,
  removeBlock,
  replaceText,
  textBlock,
  type BlockPayload,
  type EditorBlock,
  type ImageRef,
  type ImageBlock,
  type TextBlock,
} from './blocks.js';
export {
  captureScreenshot,
  dataUrlToFile,
  imagesFromClipboard,
  loadToPng,
  withTimeout,
  CAPTURE_IMAGE_PLACEHOLDER,
  CAPTURE_TIMEOUT_MS,
  WIDGET_ROOT_ATTR,
  type CaptureOptions,
  type ToPng,
} from './capture.js';
export { usePendingImages, type PendingImage, type PendingImagesApi } from './use-pending-images.js';
/** Re-exported so a TypeScript consumer needs one import, not two. */
export type {
  ErrorCode,
  FeedbackApiError,
  FeedbackBlock,
  FeedbackBlockInput,
  FeedbackContext,
  FeedbackReport,
  FeedbackState,
} from '@bugdeck/core';
