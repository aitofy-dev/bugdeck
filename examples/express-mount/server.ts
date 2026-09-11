/**
 * bugdeck inside an Express app you already have, authenticated by the session
 * that app already issues. No second login, no second port.
 *
 * Express is YOUR dependency, not this repository's: `pnpm add express` here
 * first, or copy the twenty lines that matter into the server you already run.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { getRequestListener } from '@hono/node-server';
import { createPlaneTracker } from '@aitofy/bugdeck-core';
import {
  createFeedbackApp,
  createSqliteStore,
  type FeedbackUser,
} from '@aitofy/bugdeck-server';
import express from 'express';

/**
 * The Fetch `Request` the app sees carries headers, not your session object, so
 * the user travels beside it. A header would be spoofable by the browser.
 */
const currentUser = new AsyncLocalStorage<FeedbackUser>();

const app = createFeedbackApp({
  tracker: createPlaneTracker({
    baseUrl: process.env.PLANE_BASE_URL!,
    apiKey: process.env.PLANE_API_KEY!,
    workspaceSlug: process.env.PLANE_WORKSPACE_SLUG!,
    projectId: process.env.PLANE_PROJECT_ID!,
  }),
  store: createSqliteStore({ storagePath: './storage' }),
  resolveUser: async () => currentUser.getStore() ?? null,
});

const handleFeedback = getRequestListener(app.fetch);

const server = express();

// Replace with your auth: whatever already tells this app who is asking.
server.use('/feedback', (req, res) => {
  const session = (req as { session?: { userId?: string; email?: string } }).session;
  if (!session?.userId) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }
  const user: FeedbackUser = { id: session.userId, email: session.email };
  // Express strips the mount path before the handler sees it, so the bugdeck
  // routes line up as-is: POST /feedback/reports hits POST /reports.
  currentUser.run(user, () => handleFeedback(req, res));
});

server.listen(3000, () => {
  console.log('app on http://localhost:3000, widget apiBase="/feedback"');
});
