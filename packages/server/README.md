# @bugdeck/server

The HTTP half of bugdeck: it stores bug reports filed by
the widget and files them into your issue tracker. Self-hosted, SQLite by default, no telemetry.

```bash
pnpm add @bugdeck/server @bugdeck/core
```

## 30 seconds

```ts
import { serve } from '@hono/node-server';
import { createPlaneTracker } from '@bugdeck/core';
import { createFeedbackApp, createSqliteStore } from '@bugdeck/server';

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
| `GET /reports/mine` | the caller's own reports, newest first, without their conversations. `?limit=` caps at 50. |
| `GET /reports/:id` | one report, with the conversation folded in. Someone else's report is a 404. |
| `GET /assets/:id` | the PNG bytes of one screenshot, `nosniff` and `inline`. Only the owner of the parent report may read it. |

Every 4xx answers with a **code, never a sentence** — `{"error":"TOO_MANY_IMAGES"}`. The widget owns
the wording so it can be translated: `UNAUTHENTICATED`, `BAD_REQUEST`, `MISSING_DESCRIPTION`,
`TOO_MANY_IMAGES`, `IMAGE_TOO_LARGE`, `UNSUPPORTED_IMAGE`, `NOT_PENDING`, `NOT_FOUND`,
`RATE_LIMITED`. Filing is limited to 10 reports per hour per user.

After the 201 the report is queued onto the tracker, off the request: a board being slow or down
never turns a filed bug into a 500. The create is idempotent on `externalSource=bugdeck` plus the
report id, so a retry adopts the issue instead of duplicating it.

## Standalone

```bash
cp .env.example .env   # fill in the Plane values
docker compose up -d
```

Or without Docker: `npx bugdeck-server`, with the same environment.

Startup resolves your board's columns and logs the map. A project with no column for one of the five
states refuses to boot — reports that file fine and never come back are worse than a server that
will not start.

| Variable | Required | Default | What it is |
|----------|----------|---------|------------|
| `TRACKER` | no | `plane` | The adapter. `plane` is the only one in this release. |
| `PLANE_BASE_URL` | **yes** | — | Your Plane instance, e.g. `https://plane.example.com`. |
| `PLANE_API_KEY` | **yes** | — | Workspace API key. |
| `PLANE_WORKSPACE_SLUG` | **yes** | — | The slug in your Plane URLs. |
| `PLANE_PROJECT_ID` | **yes** | — | The project reports are filed into. |
| `PLANE_LEGACY_PROJECT_IDS` | no | — | Comma-separated projects the poller also reads. Never written to. |
| `PLANE_STATE_MAP` | no | discovered | JSON, state → Plane state id. Only for a board that does not follow the convention. |
| `STORAGE_PATH` | no | `./storage` | Holds `reports.db` and `assets/`. Mount a volume at it. |
| `PORT` | no | `3131` | |
| `PUBLIC_URL` | no | — | How the outside world reaches this server; used for asset links on the issue. |
| `AUTH_MODE` | no | `header` | See below. |
| `CORS_ORIGIN` | no | — | The origin the widget is served from. Unset means no CORS headers. |

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

`tracker` is any `IssueTracker` from `@bugdeck/core` — two required methods. An adapter that renders
its own markup (Plane inlines images with its own element) supplies `renderBody`; one that does not
gets the plain HTML renderer in core, which is why nothing in this package imports an adapter.

## Storage

`createSqliteStore` keeps the report in SQLite (WAL, schema migrated on open) and the pixels as
files under `${STORAGE_PATH}/assets/`. A 10 MB blob per row turns every query into a file copy;
on disk they are files an operator can count, rsync and delete.

Already have a database? Implement `FeedbackStore` — seven methods — and pass it as `store`.
`createMemoryStore()` ships too, for tests and for trying the API before deciding.

## License

MIT
