import type { FeedbackApiError, FeedbackContext } from '@bugdeck/core';
import { getLastApiError } from './api-error.js';

/** The slice of `window` the context needs — injectable so this stays testable. */
export interface ContextEnv {
  href: string;
  innerWidth: number;
  innerHeight: number;
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
    userAgent: window.navigator.userAgent,
  };
}

const round = (value: number): number => (Number.isFinite(value) ? Math.round(value) : 0);

export function collectContext(
  env: ContextEnv,
  options: CollectContextOptions = {},
): FeedbackContext {
  const context: FeedbackContext = {
    url: env.href,
    viewport: { width: round(env.innerWidth), height: round(env.innerHeight) },
    userAgent: env.userAgent,
  };
  if (options.buildCommit) context.buildCommit = options.buildCommit;

  const lastApiError = options.lastApiError ?? getLastApiError();
  if (lastApiError) context.lastApiError = lastApiError;

  return context;
}
