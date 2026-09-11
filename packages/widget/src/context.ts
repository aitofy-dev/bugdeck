import type { FeedbackApiError, FeedbackContext } from '@bugdeck/core/contract';
import { getLastApiError } from './api-error.js';

/** The slice of `window` the context needs — injectable so this stays testable. */
export interface ContextEnv {
  href: string;
  innerWidth: number;
  innerHeight: number;
  /** Device pixels per CSS pixel — 2 on a retina laptop, 1.5 on many phones. */
  devicePixelRatio: number;
  userAgent: string;
}

export interface CollectContextOptions {
  buildCommit?: string;
  lastApiError?: FeedbackApiError;
}

export function readBrowserEnv(): ContextEnv {
  return {
    href: window.location.href,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: window.navigator.userAgent,
  };
}

const round = (value: number): number => (Number.isFinite(value) ? Math.round(value) : 0);

/**
 * Two decimals, and only when the screen is not an ordinary one. A 1 in every
 * report is noise; 2.625 on an Android phone is half the reason a screenshot
 * does not look like what the user described.
 */
const pixelRatio = (value: number): number | undefined => {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const dpr = Math.round(value * 100) / 100;
  return dpr === 1 ? undefined : dpr;
};

export function collectContext(
  env: ContextEnv,
  options: CollectContextOptions = {},
): FeedbackContext {
  const dpr = pixelRatio(env.devicePixelRatio);
  const context: FeedbackContext = {
    url: env.href,
    viewport: {
      width: round(env.innerWidth),
      height: round(env.innerHeight),
      ...(dpr ? { dpr } : {}),
    },
    userAgent: env.userAgent,
  };
  if (options.buildCommit) context.buildCommit = options.buildCommit;

  const lastApiError = options.lastApiError ?? getLastApiError();
  if (lastApiError) context.lastApiError = lastApiError;

  return context;
}
