/**
 * The standalone server: environment in, listening socket out.
 *
 * Everything it does is assembly — read the config, resolve the board's
 * columns, wire the store, the tracker and the poll worker into
 * `createFeedbackApp`. There is no logic here that a host mounting the app in
 * its own server would miss.
 *
 * Startup is deliberately LOUD and deliberately fails: a Plane project with no
 * column for `done` means reports would file fine and never come back, which is
 * the kind of break nobody notices for a week. Better to refuse to boot.
 */
import { serve as nodeServe } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  consoleLogger,
  createGithubTracker,
  createPlaneTracker,
  resolveHttp,
  resolveProjectStates,
  type FeedbackState,
  type IssueTracker,
  type Logger,
} from '@aitofy/bugdeck-core';
import { createFeedbackApp, type FeedbackEnv } from './app.js';
import { AUTH_HEADER_WARNING, headerUser, USER_EMAIL_HEADER, USER_ID_HEADER, USER_NAME_HEADER } from './auth-header.js';
import { readServerConfig, type Environment, type ServerConfig, type TrackerConfig } from './config.js';
import { createSqliteStore } from './sqlite-store.js';
import { createSyncWorker, type SyncWorkerOptions } from './sync-worker.js';

export interface RunningServer {
  port: number;
  /** The column ids the board resolved to, or null on a tracker with none. */
  states: Record<FeedbackState, string> | null;
  close(): Promise<void>;
}

export type ServeResult = { ok: true; value: RunningServer } | { ok: false; message: string };

export interface ServeOptions {
  env?: Environment;
  logger?: Logger;
  /**
   * Told when the poll worker moves a report or reads a public reply. This is
   * where a host hangs its own bell or email; the package sends neither.
   */
  onStateChange?: SyncWorkerOptions['onStateChange'];
  onReply?: SyncWorkerOptions['onReply'];
}

function withCors(config: ServerConfig, app: Hono<FeedbackEnv>): Hono<FeedbackEnv> {
  const root = new Hono<FeedbackEnv>();
  if (config.corsOrigin) {
    root.use(
      '*',
      cors({
        origin: config.corsOrigin,
        credentials: true,
        allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
        allowHeaders: ['Content-Type', USER_ID_HEADER, USER_EMAIL_HEADER, USER_NAME_HEADER],
      }),
    );
  }
  root.route('/', app);
  return root;
}

type TrackerResult =
  | { ok: true; tracker: IssueTracker; states: Record<FeedbackState, string> | null }
  | { ok: false; message: string };

/**
 * The tracker, and everything that must be true before a socket is opened.
 *
 * Plane's columns are resolved here because a board we cannot map is a
 * deployment that would accept reports and never show a state change. GitHub
 * has open and closed and needs no such promise, so it costs no request.
 */
async function buildTracker(config: TrackerConfig, logger: Logger): Promise<TrackerResult> {
  if (config.kind === 'github') {
    const github = { ...config.github, logger };
    logger.info('bugdeck tracker ready', { tracker: 'github', repo: `${github.owner}/${github.repo}` });
    return { ok: true, tracker: createGithubTracker(github), states: null };
  }

  const plane = { ...config.plane, logger };
  const states = await resolveProjectStates(resolveHttp(plane));
  if (!states.ok) return { ok: false, message: states.error.message };
  logger.info('plane states resolved', states.value);
  return { ok: true, tracker: createPlaneTracker(plane), states: states.value };
}

export async function serve(options: ServeOptions = {}): Promise<ServeResult> {
  const logger = options.logger ?? consoleLogger;
  const parsed = readServerConfig(options.env ?? process.env);
  if (!parsed.ok) return parsed;
  const config = parsed.value;

  const built = await buildTracker(config.tracker, logger);
  if (!built.ok) return built;
  if (config.authMode === 'header') logger.warn(AUTH_HEADER_WARNING);

  const store = createSqliteStore({ storagePath: config.storagePath });
  const app = createFeedbackApp({
    tracker: built.tracker,
    store,
    resolveUser: headerUser,
    logger,
    ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
  });

  const worker = createSyncWorker({
    tracker: built.tracker,
    store,
    logger,
    intervalMs: config.pollIntervalMs,
    publicReplyMarker: config.publicReplyMarker,
    ...(options.onStateChange ? { onStateChange: options.onStateChange } : {}),
    ...(options.onReply ? { onReply: options.onReply } : {}),
  });
  worker.start();

  const server = nodeServe({ fetch: withCors(config, app).fetch, port: config.port });
  logger.info('bugdeck server listening', {
    port: config.port,
    storagePath: config.storagePath,
    pollIntervalMs: config.pollIntervalMs,
  });

  return {
    ok: true,
    value: {
      port: config.port,
      states: built.states,
      close: () =>
        new Promise<void>((resolve) => {
          worker.stop();
          server.close(() => {
            store.close();
            resolve();
          });
        }),
    },
  };
}
