/**
 * The one HTTP mouth that talks to GitHub.
 *
 * Every quirk of the REST API this adapter depends on is recorded here:
 *
 *  - Auth is `Authorization: Bearer <token>` plus a pinned API version, so a
 *    future default cannot change the shapes below under us.
 *  - Lists are LINK-header paginated (`rel="next"`), not cursor paginated, and
 *    the default page is 30 — a repo with 31 matching issues silently answers
 *    with 30 if you forget to follow the header.
 *  - A rate limit is a 403 or 429 carrying `retry-after`, or
 *    `x-ratelimit-remaining: 0` with a unix `x-ratelimit-reset`. Both say WHEN
 *    to come back, and honouring that is the difference between one pause and
 *    an hour of 403s.
 *
 * Nothing in here knows what a feedback report is.
 */
import { consoleLogger, type Logger } from '../../tracker.js';
import type { FeedbackState } from '../../contract.js';

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;

/** A poller must not sleep out a whole rate-limit hour inside one tick. */
const MAX_RATE_LIMIT_WAIT_MS = 60_000;

/** GitHub's own default is 30 — small enough to bite unnoticed. */
export const PAGE_SIZE = 100;

/** Guard against a `rel="next"` loop pointing at itself. */
const MAX_PAGES = 50;

const API_VERSION = '2022-11-28';
const DEFAULT_BASE_URL = 'https://api.github.com';

export interface GithubConfig {
  owner: string;
  repo: string;
  /** PAT or app installation token with `issues: write` on the repo. */
  token: string;
  /** Defaults to `https://api.github.com`; set it for GitHub Enterprise. */
  baseUrl?: string;
  /** Put on every issue we file, and the filter the poller reads back with. */
  labels?: string[];
  /**
   * Ours, not GitHub's: the base an auth-scoped asset link points at. The REST
   * API has no attachment upload, so without it a screenshot goes unmentioned.
   */
  publicUrl?: string;
  /**
   * Labels that override the open/closed mapping, e.g. `{ review: 'needs-qa' }`.
   * Defaults to a `pending` and a `review` label of those names.
   */
  stateLabels?: Partial<Record<FeedbackState, string>>;
  /** Injectable seam: swap it in a test, or wrap it for a proxy. */
  fetch?: typeof fetch;
  logger?: Logger;
  /** Only the retry backoff sleeps; a test makes it instant. */
  sleep?: (ms: number) => Promise<void>;
}

export interface GithubHttp {
  config: GithubConfig;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  logger: Logger;
}

export function resolveHttp(config: GithubConfig): GithubHttp {
  return {
    config,
    fetchImpl: config.fetch ?? ((...args) => fetch(...args)),
    sleep: config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    logger: config.logger ?? consoleLogger,
  };
}

/** A GitHub we cannot talk to is a GitHub we skip, not a run we crash. */
export function isConfigured(config: GithubConfig): boolean {
  return Boolean(config.token && config.owner && config.repo);
}

export function repoPath(config: GithubConfig, suffix: string): string {
  return `/repos/${config.owner}/${config.repo}${suffix}`;
}

export class GithubHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    /** How long GitHub asked us to wait, when it said. */
    readonly retryAfterMs?: number,
  ) {
    super(`github http ${status}: ${body.slice(0, 200)}`);
  }
}

/** What the response headers say about coming back, in ms. */
export function retryAfterMs(headers: Headers, now = Date.now()): number | undefined {
  const clamp = (ms: number): number => Math.min(Math.max(ms, 0), MAX_RATE_LIMIT_WAIT_MS);
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null && Number.isFinite(Number(retryAfter))) {
    return clamp(Number(retryAfter) * 1000);
  }
  if (headers.get('x-ratelimit-remaining') !== '0') return undefined;
  const reset = Number(headers.get('x-ratelimit-reset'));
  return Number.isFinite(reset) ? clamp(reset * 1000 - now) : undefined;
}

/**
 * 429, 5xx and a rate-limited 403 are GitHub saying "later". Any other 4xx is
 * it saying "no", and repeating that three times only delays the log line.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof GithubHttpError) {
    if (err.status === 429 || err.status >= 500) return true;
    return err.status === 403 && err.retryAfterMs !== undefined;
  }
  return true; // network/DNS/abort — the request never got an answer
}

export async function withRetries<T>(
  http: GithubHttp,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransient(err) || attempt === MAX_ATTEMPTS) break;
      http.logger.warn('github call failed, retrying', {
        label,
        attempt,
        err: (err as Error).message,
      });
      // GitHub's own answer beats our guess: it knows when the window resets.
      const asked = err instanceof GithubHttpError ? err.retryAfterMs : undefined;
      await http.sleep(asked ?? BACKOFF_BASE_MS * 3 ** (attempt - 1));
    }
  }
  throw last;
}

export interface GithubResponse<T> {
  data: T;
  headers: Headers;
}

/** `path` is `/repos/...`, or a whole URL when following a `rel="next"`. */
export async function githubApi<T>(
  http: GithubHttp,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<GithubResponse<T>> {
  const base = (http.config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = path.startsWith('http') ? path : `${base}${path}`;
  const res = await http.fetchImpl(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${http.config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new GithubHttpError(res.status, text, retryAfterMs(res.headers));
  return { data: (text ? JSON.parse(text) : {}) as T, headers: res.headers };
}

/** The `rel="next"` URL of a Link header, which is the only page cursor there is. */
export function nextPageUrl(headers: Headers): string | null {
  const link = headers.get('link');
  if (!link) return null;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return null;
}

/** Every page of a list endpoint, concatenated. */
export async function githubPaged<T>(
  http: GithubHttp,
  path: string,
  label: string,
): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = path;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const target: string = url;
    const res = await withRetries(http, label, () => githubApi<T[]>(http, target));
    if (!Array.isArray(res.data)) break;
    all.push(...res.data);
    url = nextPageUrl(res.headers);
  }
  return all;
}
