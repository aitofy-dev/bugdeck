# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`PATCH /reports/:id`** — rewrite a report while nobody has read it. Allowed only in `pending`;
  anything later answers `409 {"error":"NOT_PENDING"}`, because silently changing the sentence an
  admin planned from is how two people end up debugging different bugs. Images the report already
  has are kept by id rather than re-uploaded, so the tracker recognises its own attachments instead
  of collecting a second copy of every screenshot.
- **`POST /reports/:id/comment`** — say something on a report in **every** state, `done` included.
  "It is still broken" is the most valuable message on the page and it always arrives after the
  item was closed. Capped at 20 messages from the user per report.
- **Comments survive a tracker that is not ready.** The message is stored first and posted after,
  on the same queue as the create — so one written while the issue was still being retried is
  posted the moment the issue exists. Each is marked with the tracker's comment id, which is what
  keeps a retry from saying it twice.
- **`EditableTracker`** in `@aitofy/bugdeck-server`: `IssueTracker` plus an optional `updateIssue`.
  `serve` wraps the Plane adapter with it; a tracker without it keeps the text the report was filed
  with.
- **`FeedbackStore.markThreadMirrored`** records that one thread entry reached the tracker. A store
  written against 0.1.0 needs this one method added.

## [0.1.0] - 2026-09-12

First release. Three packages, published together: `@aitofy/bugdeck` (the React widget), `@aitofy/bugdeck-server`
(the API) and `@aitofy/bugdeck-core` (the contract and the tracker adapters).

### Added

- **The widget.** One import, one element, a floating "Report a bug" button:

  ```tsx
  <FeedbackWidget apiBase="http://localhost:3131" />
  ```

  It captures the page or **one element** (a devtools-style picker highlights what is under the
  cursor and photographs exactly that box), opens a canvas editor over the shot — **pen, box,
  arrow and a real crop** that cuts from the full-resolution image, with an Undo that covers the
  crop too — and composes the report as **text and images interleaved**, in the order they were
  written. Images also arrive by paste, drag-and-drop or upload.
- **Drafts that survive a refresh.** Autosaved per page, restored with one line of notice; closing
  the tab keeps them. ✕, Esc and a backdrop click all mean *hide and keep*; throwing a draft away
  takes a deliberate Discard and one inline confirmation.
- **Automatic context** on every report: URL, viewport with its device pixel ratio, user agent,
  build commit, and the last API failure the host app saw before the report was filed.
- **Theme and position as props.** `theme` (light/dark/auto), `accent`, `position`, `offset`,
  `zIndex`. The look is ten CSS variables on the widget's own root; nothing leaks either way.
- **Full translation through one object.** The server answers 4xx with a CODE, never a sentence, so
  `strings` — including one line per error code — is the entire user-visible surface.
- **The server.** `createFeedbackApp({ tracker, store, resolveUser })` returns a
  [Hono](https://hono.dev) app that mounts anywhere, and `serve()` reads the environment and
  listens. Routes: `POST /reports`, `GET /reports/mine`, `GET /reports/:id`, `GET /assets/:id`.
- **`npx @aitofy/bugdeck-server`** and a Dockerfile + Compose file: four Plane variables and a volume.
- **SQLite storage by default.** Reports in `reports.db` (WAL), pixels as files under
  `STORAGE_PATH/assets/`. `FeedbackStore` is seven methods if you already have a database;
  `createMemoryStore()` ships for tests.
- **Your auth, not ours.** `resolveUser(request)` decides who is calling and `null` is a 401.
  Someone else's report answers 404, not 403.
- **Every upload is re-encoded** before it is stored: magic bytes, no SVG or GIF, a 5000×5000
  ceiling, `nosniff` and an inline disposition on the way out. Ten images per report, 10 MB each,
  ten reports per hour per user.
- **Filing runs after the response.** A tracker that is slow or down never turns a filed bug into a
  500; three retries with backoff, and the create is idempotent on `externalSource=bugdeck` plus the
  report id, so a retry adopts the issue instead of filing a second one.
- **Plane adapter.** Issue create with inline screenshots (`<image-component>`, the same asset ids
  the attachment upload returns, so the pictures are attachments as well), the three-step attachment
  flow with name-based dedupe, board columns discovered by group with a `PLANE_STATE_MAP` override,
  and comment reading for the conversation sync.
- **`IssueTracker` is the seam.** Two required methods, the rest optional; failures are values
  (`Result<T>`), never throws. An adapter that renders its own markup supplies `renderBody`;
  everything else is filed as the plain HTML in `@aitofy/bugdeck-core`.
- **`@aitofy/bugdeck-core/contract`** — a browser-safe entry point with the wire contract, block parsing,
  derived titles and thread folding, so a bundler following it never reaches `sharp`.
- **Examples.** `examples/vite-react` is the dashboard in the README's GIF (and the page the pixel
  test for the element picker runs against); `examples/server-plane` is the server in one file.

[0.1.0]: https://github.com/aitofy-dev/bugdeck/releases/tag/v0.1.0
