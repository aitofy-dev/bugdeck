# @aitofy/bugdeck-server

The HTTP half of bugdeck: it stores bug reports filed by
the widget and files them into your issue tracker. Self-hosted, SQLite by default, no telemetry.

```bash
pnpm add @aitofy/bugdeck-server @aitofy/bugdeck-core
```

## 30 seconds

```ts
import { serve } from '@hono/node-server';
import { createPlaneTracker } from '@aitofy/bugdeck-core';
import { createFeedbackApp, createSqliteStore } from '@aitofy/bugdeck-server';

const app = createFeedbackApp({
  tracker: createPlaneTracker({
    baseUrl: process.env.PLANE_BASE_URL!,
    apiKey: process.env.PLANE_API_KEY!,
    workspaceSlug: process.env.PLANE_WORKSPACE_SLUG!,
    projectId: process.env.PLANE_PROJECT_ID!,
  }),
  store: createSqliteStore({ storagePath: './storage' }),
  // Your auth, your answer. `null` is a 401.
  resolveUser: async (request) => mySession(request.headers.get('cookie')),
});

serve({ fetch: app.fetch, port: 3131 });
```

The app is a plain [Hono](https://hono.dev) instance, so it mounts anywhere:

```ts
myHonoApp.route('/feedback', app);
```

### Express

```ts
import express from 'express';
import { getRequestListener } from '@hono/node-server';

const server = express();
server.use('/feedback', getRequestListener(app.fetch));
```

Express strips the mount path before the handler sees it, so the routes below line up as-is.

## Routes

| Route | What it does |
|-------|--------------|
| `POST /reports` | multipart: `description`, `context` (JSON), `blocks` (JSON, optional) and up to 10 screenshots under a repeated `images` key. Every image is re-encoded before anything is stored. |
| `PATCH /reports/:id` | the same body again, rewriting the report. Allowed **only while `state` is `pending`** — once someone has picked it up the answer is `409 {"error":"NOT_PENDING"}` and the way to add something is a comment. Images the report already has travel as `{"kind":"image","assetId":"…"}` blocks instead of being uploaded again; `imageIndex` counts only the files actually in this body. |
| `POST /reports/:id/comment` | the same body as a message on the conversation. Allowed in **every** state, `done` and `fail` included — "it is still broken" always arrives after the item was closed. Capped at 20 messages from the user per report. |
| `GET /reports/mine` | the caller's own reports, newest first, without their conversations. `?limit=` caps at 50. |
| `GET /reports/:id` | one report, with the conversation folded in. Someone else's report is a 404. |
| `GET /assets/:id` | the PNG bytes of one screenshot, `nosniff` and `inline`. Only the owner of the parent report may read it. |

Every 4xx answers with a **code, never a sentence** — `{"error":"TOO_MANY_IMAGES"}`. The widget owns
the wording so it can be translated: `UNAUTHENTICATED`, `BAD_REQUEST`, `MISSING_DESCRIPTION`,
`TOO_MANY_IMAGES`, `IMAGE_TOO_LARGE`, `UNSUPPORTED_IMAGE`, `NOT_PENDING`, `NOT_FOUND`,
`RATE_LIMITED`. The three write routes share one budget of 10 requests per hour per user.

After the 201 the report is queued onto the tracker, off the request: a board being slow or down
never turns a filed bug into a 500. The create is idempotent on `externalSource=bugdeck` plus the
report id, so a retry adopts the issue instead of duplicating it. Edits and comments ride the same
queue, so a message written while the issue was still being retried is posted the moment it exists
rather than lost — each one is marked with the tracker's comment id, which is what keeps a retry
from saying it twice.

A tracker that can rewrite an issue says so with an optional `updateIssue` on `IssueTracker`; both
adapters have one. A tracker without it keeps the text the report was filed with, and the edit stays
local.

## Standalone

```bash
cp .env.example .env   # fill in the tracker values
docker compose up -d
```

Or without Docker: `npx bugdeck-server`, with the same environment.

On Plane, startup resolves your board's columns and logs the map. A project with no column for one
of the five states refuses to boot — reports that file fine and never come back are worse than a
server that will not start. GitHub has open and closed and needs no such promise, so it costs no
request at startup.

| Variable | Required | Default | What it is |
|----------|----------|---------|------------|
| `TRACKER` | no | `plane` | `plane` or `github`. Decides which block below is required. |
| `STORAGE_PATH` | no | `./storage` | Holds `reports.db` and `assets/`. Mount a volume at it. |
| `PORT` | no | `3131` | |
| `PUBLIC_URL` | no | — | How the outside world reaches this server; used for asset links on the issue. |
| `POLL_INTERVAL` | no | `300` | Seconds between reads of the tracker. `0` turns the poller off. |
| `PUBLIC_REPLY_MARKER` | no | `@user` | The prefix that makes a comment visible to the reporter. |
| `AUTH_MODE` | no | `header` | See below. |
| `CORS_ORIGIN` | no | — | The origin the widget is served from. Unset means no CORS headers. |

### `TRACKER=plane`

| Variable | Required | Default | What it is |
|----------|----------|---------|------------|
| `PLANE_BASE_URL` | **yes** | — | Your Plane instance, e.g. `https://plane.example.com`. |
| `PLANE_API_KEY` | **yes** | — | Workspace API key. |
| `PLANE_WORKSPACE_SLUG` | **yes** | — | The slug in your Plane URLs. |
| `PLANE_PROJECT_ID` | **yes** | — | The project reports are filed into. |
| `PLANE_LEGACY_PROJECT_IDS` | no | — | Comma-separated projects the poller also reads. Never written to. |
| `PLANE_STATE_MAP` | no | discovered | JSON, state → Plane state id. Only for a board that does not follow the convention. |

### `TRACKER=github`

| Variable | Required | Default | What it is |
|----------|----------|---------|------------|
| `GITHUB_OWNER` | **yes** | — | The user or organisation that owns the repo. |
| `GITHUB_REPO` | **yes** | — | The repo issues are filed into. |
| `GITHUB_TOKEN` | **yes** | — | PAT or app installation token with `issues: write` on that repo. |
| `GITHUB_LABELS` | no | — | Comma-separated labels put on every issue we file, and the filter the poller reads back with. |
| `GITHUB_API_URL` | no | `https://api.github.com` | For GitHub Enterprise Server. |

GitHub has no attachment API, so every screenshot on an issue is a link back to `GET /assets/:id`
on this server — set `PUBLIC_URL` or they go unmentioned. Issues we filed are recognised by a
hidden marker in the body, which is also the dedupe: the poller ignores issues the repo's humans
filed themselves.

### Replying to the reporter

The poller reads the tracker every `POLL_INTERVAL` seconds and carries two things back: the state
(your column, or open/closed on GitHub) and your reply.

**A comment starting with `@user` is shown to the reporter. Every other comment stays internal.**
That is the whole rule, and it is opt-in on purpose — comments on an issue routinely name other
people's accounts, and nothing without the marker may ever reach a widget.

```text
@user Fixed in 1.4.2, please reload the page.   → the reporter sees this
ask the payments team whether it repeats        → the reporter never sees this
```

The marker is stripped before the reporter sees the text, the reply is added to the report's
conversation once (a second pass over the same comment adds nothing), and `publicReply` is whatever
you said last. Rename the marker with `PUBLIC_REPLY_MARKER`.

Mounting the app yourself? The poller is a separate object, so wire it up next to the app:

```ts
import { createSyncWorker } from '@aitofy/bugdeck-server';

const worker = createSyncWorker({
  tracker,
  store,
  intervalMs: 300_000,
  onStateChange: (report, state) => notify(report.ownerId, `#${report.code} is now ${state}`),
  onReply: (report, reply) => notify(report.ownerId, reply),
});
worker.start();
```

`serve()` takes the same two hooks as options, and nothing else in this package sends a
notification: the host owns the bell.

### `AUTH_MODE=header` is not authentication

The standalone server trusts `X-User-Id` and `X-User-Email`. **Run it behind your own
authenticating proxy.** Exposed directly to the internet, anyone can read anyone's reports by typing
a header. It is the default because every host already has auth and none of them want a second one —
and when you mount `createFeedbackApp` in your own server you pass your own `resolveUser` and this
mode never runs.

```bash
curl -X POST http://localhost:3131/reports \
  -H 'X-User-Id: user-1' \
  -H 'X-User-Email: reporter@example.com' \
  -F 'description=The export button does nothing. I tried twice.' \
  -F 'context={"url":"https://app.example.com","viewport":{"width":1280,"height":720},"userAgent":"curl"}' \
  -F 'images=@screenshot.png'
```

```json
{ "id": "b1d1…", "title": "The export button does nothing", "state": "pending", "assetIds": ["…"] }
```

`code` (`PROJ-12`) appears once the tracker has accepted the issue — a second later, on
`GET /reports/:id`.

## Another tracker

`tracker` is any `IssueTracker` from `@aitofy/bugdeck-core` — two required methods, the rest
optional. An adapter that renders its own markup (Plane inlines images with its own element)
supplies `renderBody` and `renderComment`; one that does not gets the plain HTML renderers in core,
which is why nothing in this package imports an adapter. `updateIssue` is how an edit reaches the
issue, and `listUpdates` is what the poller needs — an adapter with neither still files reports.

## Storage

`createSqliteStore` keeps the report in SQLite (WAL, schema migrated on open) and the pixels as
files under `${STORAGE_PATH}/assets/`. A 10 MB blob per row turns every query into a file copy;
on disk they are files an operator can count, rsync and delete.

Already have a database? Implement `FeedbackStore` — eleven methods, two of them the poll
worker's watermark — and pass it as `store`.
`createMemoryStore()` ships too, for tests and for trying the API before deciding.

## License

MIT
