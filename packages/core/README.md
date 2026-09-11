# @aitofy/bugdeck-core

The pure half of [bugdeck](https://github.com/aitofy-dev/bugdeck): the wire contract the widget and
the server both speak, the functions over it, and the `IssueTracker` seam every tracker adapter
plugs into. No framework, no server, no global state.

```bash
pnpm add @aitofy/bugdeck-core
```

You need this package directly only if you are writing a tracker adapter, a storage backend, or a
client in something other than React. The [widget](https://www.npmjs.com/package/@aitofy/bugdeck) and the
[server](https://www.npmjs.com/package/@aitofy/bugdeck-server) depend on it for you.

## Two entry points

```ts
import { FEEDBACK_MAX_ASSETS, parseFeedbackBlocks } from '@aitofy/bugdeck-core/contract'; // browser-safe
import { createPlaneTracker, sanitizeImage } from '@aitofy/bugdeck-core';                 // Node
```

`@aitofy/bugdeck-core/contract` is the wire contract, block parsing, derived titles and thread folding —
nothing that has ever heard of a filesystem, so a bundler following it never reaches `sharp`. The
root adds image sanitisation and the adapters.

## What is in it

| Module | What it decides |
|---|---|
| `contract` | Field names, limits, `FeedbackState`, `ErrorCode`, the report and context shapes. One fact, one place — the widget and the route cannot drift. |
| `blocks` | Parses the untrusted ordered text+image document. An image index becomes the asset id just minted for it; an id this report does not own is dropped. |
| `derive-title` | The one line triage reads, derived from the first sentence. Nobody filing a bug also writes a headline. |
| `thread` | Folds legacy appends and tracker replies into one chronological conversation, deduped by comment id. |
| `sanitize-image` | Re-encodes every upload through `sharp`: magic bytes, no SVG or GIF, 5000×5000 ceiling. `sharp` is an optional dependency — install it only if you accept images. |
| `issue-body` | One report as plain HTML: who, what they wrote, where it happened. The default for any tracker with no markup of its own. |
| `tracker` | `IssueTracker` — two required methods, the rest optional. Failures are values (`Result<T>`), never throws. |
| `adapters/plane` | Plane as an `IssueTracker`: idempotent create, three-step attachments, state discovery by group, comment polling. |
| `adapters/github` | GitHub Issues as an `IssueTracker`: Markdown bodies, a hidden marker for idempotency, `open`/`closed` mapped to states, Link-header polling. |

## Adapters: Plane, GitHub

```ts
import { createPlaneTracker, createGithubTracker } from '@aitofy/bugdeck-core';

const plane = createPlaneTracker({
  baseUrl: 'https://plane.example.com',
  apiKey: process.env.PLANE_API_KEY!,
  workspaceSlug: 'acme',
  projectId: '0d4f…',            // the project uuid, not its identifier
  publicUrl: 'https://bugs.example.com', // asset links when an upload is refused
});

const github = createGithubTracker({
  owner: 'acme',
  repo: 'app',
  token: process.env.GITHUB_TOKEN!, // PAT or app token with `issues: write`
  labels: ['bugdeck'],              // put on every issue, and the poll filter
  publicUrl: 'https://bugs.example.com', // screenshots are links: GitHub has no upload API
});
```

|  | Plane | GitHub |
|---|---|---|
| Body | HTML, images inline | Markdown, images as links to `publicUrl/assets/:id` |
| Comments | HTML, images inline again | Markdown |
| Editing | `updateIssue` PATCHes name + description | `updateIssue` PATCHes title + body, marker kept |
| Screenshots | uploaded as attachments | not uploaded — the REST API has none |
| Idempotency | `external_id` on the create | a hidden `<!-- bugdeck:report:<id> -->` in the body, found by search |
| Code | `DEMO-42`, read off the project | `#42`, the issue number |
| States | the board's columns, matched by name then group | `open` → `doing`, `closed` → `done`, closed as *not planned* → `fail`; a `pending` or `review` **label** overrides (`stateLabels`) |
| Polling | `listUpdates` over the project's issues | `listUpdates` over `since` + `labels`, Link-header paged |

Replying to a reporter is the same gesture on both: write a comment that **starts with `@user`**.
Nothing else on the tracker is ever shown to them — comments there routinely name other people's
accounts. On GitHub that comment is Markdown and reaches the widget as written. Rename the marker
with `publicReplyMarker` on either config.

Both are optional: importing one is what ships it. A server that imports neither files nothing.

## Writing an adapter

```ts
import { ok, fail, type IssueTracker } from '@aitofy/bugdeck-core';

export function createMyTracker(config: MyConfig): IssueTracker {
  return {
    async createIssue(job) {
      // job.descriptionHtml is a string, or a function to render again once
      // your uploads have ids. job.externalSource + job.externalId are the
      // idempotency key: a retry must adopt the issue, never file a second one.
      return ok({ externalId: '42', code: 'MY-42' });
    },
    async addComment(externalId, html) {
      return ok({ commentId: '…' });
    },
    // Optional. Omit uploadAttachment and the caller links the images instead;
    // omit listUpdates and nothing polls; omit updateIssue and an edited report
    // stays local; omit renderBody / renderComment and both are written as the
    // plain HTML in `issue-body`.
  };
}
```

One adapter is one file plus one registration line. An adapter never reaches back into the server
or the widget.

## States

Five, from the reporter's point of view: `pending · doing · review · done · fail`. `review` means
the issue has been **fixed and the reporter is asked to confirm** — not that someone is still
looking at it; any label you write for it has to say so. A report body is editable only while
`pending`; a comment is allowed in every state, including `done`, because *"it is still broken"* is
the most valuable message on the page and it always arrives late.

## License

MIT
