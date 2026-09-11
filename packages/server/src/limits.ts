/**
 * Every number a request is measured against, in one object.
 *
 * The defaults are the contract's — the widget enforces the same ones for a
 * fast error and the server enforces them again because the widget is
 * untrusted. A host raises them by passing `limits`, never by editing a route.
 */
import { FEEDBACK_MAX_ASSETS, FEEDBACK_MAX_ASSET_BYTES } from '@bugdeck/core';

export interface FeedbackLimits {
  maxAssets: number;
  maxAssetBytes: number;
  /** `POST /reports` a single user may make per window. */
  reportsPerWindow: number;
  rateLimitWindowMs: number;
  /** Ceiling on `GET /reports/mine`, whatever `?limit` asks for. */
  listLimit: number;
}

export const defaultLimits: FeedbackLimits = {
  maxAssets: FEEDBACK_MAX_ASSETS,
  maxAssetBytes: FEEDBACK_MAX_ASSET_BYTES,
  reportsPerWindow: 10,
  rateLimitWindowMs: 60 * 60 * 1000,
  listLimit: 50,
};

export function resolveLimits(overrides: Partial<FeedbackLimits> = {}): FeedbackLimits {
  return { ...defaultLimits, ...overrides };
}

/**
 * The most a request body may weigh: every image at its ceiling, plus a
 * megabyte for the text fields and the multipart framing. Derived, never typed,
 * so raising the image cap raises this with it.
 */
export function maxBodyBytes(limits: FeedbackLimits): number {
  return limits.maxAssets * limits.maxAssetBytes + 1024 * 1024;
}
