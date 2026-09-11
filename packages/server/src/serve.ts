/**
 * The standalone server: environment in, listening socket out.
 *
 * Everything it does is assembly — read the config, resolve the board's
 * columns, wire the store and the tracker into `createFeedbackApp`. There is no
 * logic here that a host mounting the app in its own server would miss.
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
  createPlaneTracker,
  resolveHttp,
  resolveProjectStates,
  type FeedbackState,
  type Logger,
} from '@aitofy/bugdeck-core';
import { createFeedbackApp, type FeedbackEnv } from './app.js';
import { AUTH_HEADER_WARNING, headerUser, USER_EMAIL_HEADER, USER_ID_HEADER, USER_NAME_HEADER } from './auth-header.js';
import { readServerConfig, type Environment, type ServerConfig } from './config.js';
import { createSqliteStore } from './sqlite-store.js';

export interface RunningServer {
  port: number;
  /** The column ids the board resolved to, as logged at startup. */
  states: Record<FeedbackState, string>;
  close(): Promise<void>;
}

export type ServeResult = { ok: true; value: RunningServer } | { ok: false; message: string };

export interface ServeOptions {
  env?: Environment;
  logger?: Logger;
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

export async function serve(options: ServeOptions = {}): Promise<ServeResult> {
  const logger = options.logger ?? consoleLogger;
  const parsed = readServerConfig(options.env ?? process.env);
  if (!parsed.ok) return parsed;
  const config = parsed.value;

  // Before the socket, not after: a board we cannot map is a deployment that
  // would accept reports and never show a state change.
  const plane = { ...config.plane, logger };
  const states = await resolveProjectStates(resolveHttp(plane));
  if (!states.ok) return { ok: false, message: states.error.message };
  logger.info('plane states resolved', states.value);
  if (config.authMode === 'header') logger.warn(AUTH_HEADER_WARNING);

  const store = createSqliteStore({ storagePath: config.storagePath });
  const app = createFeedbackApp({
    tracker: createPlaneTracker(plane),
    store,
    resolveUser: headerUser,
    logger,
    ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
  });

  const server = nodeServe({ fetch: withCors(config, app).fetch, port: config.port });
  logger.info('bugdeck server listening', { port: config.port, storagePath: config.storagePath });

  return {
    ok: true,
    value: {
      port: config.port,
      states: states.value,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => {
            store.close();
            resolve();
          });
        }),
    },
  };
}
