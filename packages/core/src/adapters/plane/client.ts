/**
 * The one HTTP mouth that talks to Plane.
 *
 * Every quirk this edition of Plane has is recorded here so that no caller has
 * to rediscover it:
 *
 *  - Retries only on 429/5xx/network. A 4xx is Plane saying "no".
 *  - `GET` list endpoints are CURSOR paginated (`next_cursor` /
 *    `next_page_results`), not offset paginated. The default page is 12, so a
 *    project with 13 items silently answers with 12 if you forget to page.
 *  - A list endpoint can also answer with a BARE array (the attachment list
 *    does), which must not read as an empty page.
 *  - Every workitem path is project-scoped, comments included. Reading an issue
 *    that lives in another project means naming that project here.
 *
 * Nothing in here knows what a feedback report is.
 */
import { consoleLogger, type Logger } from '../../tracker.js';
import type { FeedbackState } from '../../contract.js';

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;

/** Plane's own default is 12 — small enough to bite unnoticed. */
const PAGE_SIZE = 100;

/** Guard against a cursor that never advances turning into an endless loop. */
const MAX_PAGES = 200;

export interface PlaneConfig {
  baseUrl: string;
  apiKey: string;
  workspaceSlug: string;
  projectId: string;
  /**
   * Projects the poller also READS. Nothing is ever written to them; they exist
   * because issues filed before the board moved still live there.
   */
  legacyProjectIds?: readonly string[];
  /**
   * Ours, not Plane's: the base an auth-scoped asset link points at when Plane
   * refuses an upload. Without it a refused screenshot is simply omitted.
   */
  publicUrl?: string;
  /**
   * The operator telling us their board does not follow the convention. Exactly
   * the `override` argument of `resolveStateMap`.
   */
  stateMap?: Partial<Record<FeedbackState, string>>;
  /**
   * The prefix that makes a comment on this board visible to the reporter.
   * Defaults to `@user`; the poll worker reads comments back with it.
   */
  publicReplyMarker?: string;
  /** Injectable seam: swap it in a test, or wrap it for a proxy. */
  fetch?: typeof fetch;
  logger?: Logger;
  /** Only the retry backoff sleeps; a test makes it instant. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A configured client. The identifier cache lives on the INSTANCE, never at
 * module level: a module-level cache is global mutable state that leaks between
 * two workspaces in one process and between two cases in one test file.
 */
export interface PlaneHttp {
  config: PlaneConfig;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  logger: Logger;
  identifiers: Map<string, string>;
}

export function resolveHttp(config: PlaneConfig): PlaneHttp {
  return {
    config,
    fetchImpl: config.fetch ?? ((...args) => fetch(...args)),
    sleep: config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    logger: config.logger ?? consoleLogger,
    identifiers: new Map(),
  };
}

/** A Plane we cannot talk to is a Plane we skip, not a run we crash. */
export function isConfigured(config: PlaneConfig): boolean {
  return Boolean(config.apiKey && config.projectId);
}

export class PlaneHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`plane http ${status}: ${body.slice(0, 200)}`);
  }
}

/** 429 and 5xx are the server saying "later"; a 4xx is it saying "no". */
export function isTransient(err: unknown): boolean {
  if (err instanceof PlaneHttpError) return err.status === 429 || err.status >= 500;
  return true; // network/DNS/abort — the request never got an answer
}

export async function withRetries<T>(
  http: PlaneHttp,
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
      http.logger.warn('plane call failed, retrying', {
        label,
        attempt,
        err: (err as Error).message,
      });
      await http.sleep(BACKOFF_BASE_MS * 3 ** (attempt - 1));
    }
  }
  throw last;
}

/** Project-scoped: `…/workspaces/{slug}/projects/{id}/{path}`. */
export async function planeApi<T>(
  http: PlaneHttp,
  path: string,
  init: { method: string; body?: unknown; projectId?: string } = { method: 'GET' },
): Promise<T> {
  const config = http.config;
  const projectId = init.projectId || config.projectId;
  const url = `${config.baseUrl.replace(/\/+$/, '')}/api/v1/workspaces/${config.workspaceSlug}/projects/${projectId}/${path}`;
  const res = await http.fetchImpl(url, {
    method: init.method,
    headers: {
      'X-API-Key': config.apiKey,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new PlaneHttpError(res.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}

interface PlanePage<T> {
  results?: T[];
  next_cursor?: string;
  next_page_results?: boolean;
}

/**
 * Every page of a list endpoint, concatenated.
 *
 * A bare array is accepted rather than treated as an empty page — reading "no
 * comments" off a successful response is exactly the failure that would make an
 * admin's reply vanish forever.
 */
export async function planeApiList<T>(
  http: PlaneHttp,
  path: string,
  projectId?: string,
): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?';
  const all: T[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const qs: string = `${sep}per_page=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body: PlanePage<T> | T[] = await planeApi<PlanePage<T> | T[]>(http, `${path}${qs}`, {
      method: 'GET',
      projectId,
    });
    if (Array.isArray(body)) return body;

    all.push(...(body.results ?? []));
    if (!body.next_page_results || !body.next_cursor || body.next_cursor === cursor) break;
    cursor = body.next_cursor;
  }
  return all;
}

/**
 * `DEMO-14` is `{identifier}-{sequence_id}`. Read rather than hardcoded, so
 * pointing `projectId` at another project cannot silently mint codes under the
 * old prefix. Fetched once per client and BEFORE the issue is created: failing
 * here costs a retry, failing after the create would leave a report holding an
 * issue id but no code a user can quote.
 */
export async function projectIdentifier(http: PlaneHttp, projectId?: string): Promise<string> {
  const id = projectId || http.config.projectId;
  const cached = http.identifiers.get(id);
  if (cached) return cached;

  const project = await withRetries(http, 'project.retrieve', () =>
    planeApi<{ identifier?: string }>(http, '', { method: 'GET', projectId: id }),
  );
  const identifier = (project.identifier || '').trim();
  if (!identifier) {
    throw new Error(
      `Plane project ${id} has no identifier. Check the project id and that the API key can read it.`,
    );
  }
  http.identifiers.set(id, identifier);
  return identifier;
}
