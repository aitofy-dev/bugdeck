/**
 * The HTTP surface: five routes, mountable anywhere.
 *
 *   POST /reports      multipart — description, context, an optional block
 *                      layout and up to `maxAssets` screenshots under a
 *                      repeated `images` key
 *   GET  /reports/mine my reports, newest first, without their threads
 *   GET  /reports/:id  one report, with the conversation folded in
 *   GET  /assets/:id   the PNG bytes of one screenshot
 *
 * Three rules run through all of it:
 *
 *  1. A refusal is a CODE, never a sentence — `{error: 'TOO_MANY_IMAGES'}`. The
 *     widget owns the wording so it can be translated; a server that answers in
 *     English decides that for every host.
 *  2. Ownership, not tenancy. Someone else's report answers 404, not 403: a
 *     stranger has no business learning that an id exists.
 *  3. The tracker enters after the response and never before. The report is
 *     saved either way, and a board being down must not turn a filed bug into a
 *     500.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  deriveTitle,
  parseFeedbackBlocks,
  type ErrorCode,
  type IssueTracker,
  type Logger,
  type SanitizedImage,
} from '@aitofy/bugdeck-core';
import { createIssueBridge } from './bridge.js';
import { maxBodyBytes, resolveLimits, type FeedbackLimits } from './limits.js';
import { createRateLimiter } from './rate-limit.js';
import { toReportDto } from './report-record.js';
import { readSubmission, type ParsedForm } from './submission.js';
import type { FeedbackStore, FeedbackUser } from './store.js';

export interface FeedbackAppOptions {
  tracker: IssueTracker;
  store: FeedbackStore;
  /**
   * The host's auth, as a function. `null` is a 401 — this package never
   * decides who someone is, it only asks.
   */
  resolveUser: (request: Request) => Promise<FeedbackUser | null>;
  limits?: Partial<FeedbackLimits>;
  logger?: Logger;
  /** Base for asset links the tracker gets when it refuses an upload. */
  publicUrl?: string;
}

/** Exported so a host mounting this app can type its own middleware alongside. */
export interface FeedbackEnv {
  Variables: { user: FeedbackUser };
}

const refuse = (c: Context, status: ContentfulStatusCode, error: ErrorCode): Response =>
  c.json({ error }, status);

/** A body we could not read is not a body we can name a code for. */
async function readForm(c: Context, logger: Logger | undefined): Promise<ParsedForm | null> {
  try {
    return await c.req.parseBody({ all: true });
  } catch (err) {
    logger?.warn('bugdeck could not read the request body', { err: String(err) });
    return null;
  }
}

/**
 * Assets before the report, all carrying its id: the widget references an
 * upload by its position among the files it just sent, and those positions only
 * become ids once the rows exist.
 */
async function storeImages(
  store: FeedbackStore,
  reportId: string,
  images: readonly SanitizedImage[],
): Promise<string[]> {
  const assetIds: string[] = [];
  for (const image of images) {
    assetIds.push(
      await store.putAsset(reportId, {
        mime: image.mime,
        width: image.width,
        height: image.height,
        bytes: image.buffer,
      }),
    );
  }
  return assetIds;
}

function requestedLimit(raw: string | undefined, ceiling: number): number {
  const asked = Number(raw);
  return Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), ceiling) : ceiling;
}

export function createFeedbackApp(options: FeedbackAppOptions): Hono<FeedbackEnv> {
  const { store, logger } = options;
  const limits = resolveLimits(options.limits);
  const bodyCeiling = maxBodyBytes(limits);
  const rateLimiter = createRateLimiter({
    max: limits.reportsPerWindow,
    windowMs: limits.rateLimitWindowMs,
  });
  const bridge = createIssueBridge({
    tracker: options.tracker,
    store,
    ...(logger ? { logger } : {}),
    ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}),
  });

  const app = new Hono<FeedbackEnv>();

  app.use('*', async (c, next): Promise<Response | void> => {
    const user = await options.resolveUser(c.req.raw);
    if (!user) return refuse(c, 401, 'UNAUTHENTICATED');
    c.set('user', user);
    return next();
  });

  app.post('/reports', async (c) => {
    const user = c.get('user');
    if (!rateLimiter.take(user.id)) return refuse(c, 429, 'RATE_LIMITED');
    if (Number(c.req.header('content-length') ?? 0) > bodyCeiling) {
      return refuse(c, 413, 'IMAGE_TOO_LARGE');
    }

    const form = await readForm(c, logger);
    if (!form) return refuse(c, 400, 'BAD_REQUEST');

    const submission = await readSubmission(form, limits);
    if (!submission.ok) return refuse(c, 400, submission.error);
    const { description, blocksRaw, context, images } = submission.value;

    const id = crypto.randomUUID();
    const assetIds = await storeImages(store, id, images);
    const report = await store.createReport({
      id,
      ownerId: user.id,
      ...(user.email ? { ownerEmail: user.email } : {}),
      title: deriveTitle(description, user.email),
      description,
      context,
      assetIds,
      blocks: parseFeedbackBlocks(blocksRaw, assetIds),
    });

    bridge.enqueue(report.id);
    return c.json(toReportDto(report, { thread: true }), 201);
  });

  app.get('/reports/mine', async (c) => {
    const user = c.get('user');
    const limit = requestedLimit(c.req.query('limit'), limits.listLimit);
    const reports = await store.listReportsByUser(user.id, limit);
    // Wrapped rather than passed by reference: `Array.map` would hand the index
    // in as the options argument and every second report would carry a thread.
    return c.json({ reports: reports.map((report) => toReportDto(report)) });
  });

  app.get('/reports/:id', async (c) => {
    const user = c.get('user');
    const report = await store.getReport(c.req.param('id'));
    if (!report || report.ownerId !== user.id) return refuse(c, 404, 'NOT_FOUND');
    return c.json(toReportDto(report, { thread: true }));
  });

  /**
   * `nosniff` + an explicit image Content-Type + an inline disposition: every
   * stored byte was re-encoded by sharp, but serving user-supplied bytes
   * without nosniff is how a stored XSS ends up in someone's session.
   */
  app.get('/assets/:id', async (c) => {
    const user = c.get('user');
    const asset = await store.getAsset(c.req.param('id'));
    if (!asset) return refuse(c, 404, 'NOT_FOUND');
    const report = await store.getReport(asset.reportId);
    if (!report || report.ownerId !== user.id) return refuse(c, 404, 'NOT_FOUND');

    // A bare Response, not `c.body`: the bytes are a `Uint8Array` and this is
    // the one route whose payload is not text.
    return new Response(asset.bytes, {
      headers: {
        'Content-Type': asset.mime,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="bugdeck-${asset.id}.png"`,
        'Cache-Control': 'private, max-age=86400',
      },
    });
  });

  return app;
}
