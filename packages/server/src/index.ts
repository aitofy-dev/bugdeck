/**
 * The public surface of `@aitofy/bugdeck-server`. Nothing is public unless it is here.
 *
 * Two ways in: `createFeedbackApp` for a host that already has a server and its
 * own auth, and `serve` for a host that wants a container. Both call the same
 * routes — the standalone binary holds no logic of its own.
 */
export { createFeedbackApp, type FeedbackAppOptions, type FeedbackEnv } from './app.js';
export {
  createIssueBridge,
  type IssueBridge,
  type IssueBridgeOptions,
} from './bridge.js';
export type { EditableTracker, IssueUpdateInput } from './editable-tracker.js';
export { BUGDECK_EXTERNAL_SOURCE, buildCreateIssueJob, toIssueBodyInput } from './issue-job.js';
export {
  commentOnReport,
  editReport,
  editedAssetIds,
  type AmendContext,
} from './amend-report.js';
export { mirrorComments, mirrorEdit, renderCommentHtml, type MirrorDeps } from './mirror.js';
export { defaultLimits, resolveLimits, maxBodyBytes, type FeedbackLimits } from './limits.js';
export { createRateLimiter, type RateLimiter, type RateLimitOptions } from './rate-limit.js';
export { createMemoryStore } from './memory-store.js';
export { createSqliteStore, type SqliteFeedbackStore, type SqliteStoreOptions } from './sqlite-store.js';
export {
  AUTH_HEADER_WARNING,
  headerUser,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  USER_NAME_HEADER,
} from './auth-header.js';
export {
  readServerConfig,
  AUTH_MODES,
  type AuthMode,
  type ConfigResult,
  type Environment,
  type ServerConfig,
} from './config.js';
export { serve, type RunningServer, type ServeOptions, type ServeResult } from './serve.js';
export { parseContext, readSubmission, type ParsedForm, type Submission } from './submission.js';
export { toReportDto, userTurnCount } from './report-record.js';
export type {
  FeedbackStore,
  FeedbackUser,
  NewAsset,
  NewReport,
  ReportUpdate,
  StoredAsset,
  StoredReport,
  StoredThreadEntry,
} from './store.js';
