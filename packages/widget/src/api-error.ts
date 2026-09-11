import type { FeedbackApiError } from '@bugdeck/core/contract';

export interface ApiErrorMeta {
  status?: number;
  path?: string;
  /** ISO. Left to the caller so the normaliser stays pure and testable. */
  at?: string;
}

interface AxiosLike {
  response?: { status?: unknown; data?: unknown };
  config?: { url?: unknown; method?: unknown };
  message?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const asStatus = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Squeeze whatever the app's HTTP layer throws into the three fields the report
 * body carries. Pure so the shape can be pinned by tests: the widget is fed by
 * someone else's interceptor and we cannot assume axios, fetch, or an Error.
 */
export function normalizeApiError(err: unknown, meta: ApiErrorMeta = {}): FeedbackApiError {
  const record = asRecord(err) as AxiosLike | undefined;
  const response = asRecord(record?.response);
  const config = asRecord(record?.config);

  const status =
    meta.status ??
    asStatus(response?.status) ??
    asStatus(asRecord(err)?.status) ??
    undefined;

  const path =
    meta.path ??
    asString(config?.url) ??
    asString(asRecord(err)?.url) ??
    undefined;

  const message =
    (err instanceof Error ? asString(err.message) : undefined) ??
    asString(err) ??
    asString(record?.message) ??
    asString(asRecord(response?.data)?.message) ??
    'Unknown error';

  // The contract fields are required, so an interceptor that knows neither the
  // status nor the path still produces a readable record instead of nothing.
  return {
    status: status ?? 0,
    path: path?.slice(0, 300) ?? '',
    message: message.slice(0, 500),
    ...(meta.at ? { at: meta.at } : {}),
  };
}

let lastApiError: FeedbackApiError | undefined;

/**
 * Called by the host app's HTTP interceptor. Module-level on purpose: the
 * failing request usually happens far from where the widget is mounted, and
 * threading a context provider through every api client is not worth it.
 */
export function reportApiError(err: unknown, meta: ApiErrorMeta = {}): void {
  // Stamped here rather than in the normaliser: this is the edge that knows
  // what time it is, and a failure from twenty minutes ago reads differently
  // from one that happened as the user reached for the launcher.
  lastApiError = normalizeApiError(err, { at: new Date().toISOString(), ...meta });
}

export function getLastApiError(): FeedbackApiError | undefined {
  return lastApiError;
}

export function clearLastApiError(): void {
  lastApiError = undefined;
}
