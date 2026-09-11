# bugdeck

Open-source [Marker.io](https://marker.io) / [BugHerd](https://bugherd.com) alternative — a floating "Report a bug" button for React apps. The user screenshots the page (or points at one element), draws on the shot, writes the report with the pictures inline, and presses Send. It lands on your own server, which files it into Plane, GitHub or Linear.

**Zero UI dependencies**: one `<style>` tag, injected once, every rule scoped to the widget's own root so nothing leaks either way. Colours are CSS variables, so `theme` and `accent` are the whole design system. The single runtime dependency is `html-to-image`, imported lazily so it never enters the host app's initial bundle.

```
user clicks 🐞 → modal (block editor) → POST {apiBase}/reports (multipart)
                                            └→ @aitofy/bugdeck-server → tracker issue
```

## Install

```sh
pnpm add @aitofy/bugdeck        # react and react-dom >= 18 are peers
```

## Use

```tsx
import { FeedbackWidget, reportApiError } from '@aitofy/bugdeck';

<FeedbackWidget
  apiBase="/api"                                        // required
  fetchAuthHeaders={async () => ({ Authorization: t })} // awaited per send — tokens stay fresh
  buildCommit={__COMMIT__}                              // the most useful context field there is
  myReportsHref="/reports"
/>;

// In the app's HTTP interceptor, so the last API failure rides along:
apiClient.interceptors.response.use(undefined, (err) => {
  reportApiError(err);
  throw err;
});
```

### Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| `apiBase` | `string` | — | Base of the bugdeck server, e.g. `/api` or `http://localhost:3131`. Required. |
| `fetchAuthHeaders` | `() => Record<string,string> \| Promise<…>` | — | Awaited on every send, so a short-lived token is never stale. |
| `buildCommit` | `string` | — | Commit the running bundle was built from. Attached to the report context. |
| `myReportsHref` | `string` | `'/reports'` | Where the "My reports" link on the confirmation points. |
| `captureTarget` | `() => HTMLElement \| null` | `document.body` | What gets photographed. |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | `auto` follows the reader's `prefers-color-scheme`. |
| `accent` | `string` | `#2563eb` | Any CSS colour. Becomes `--bd-accent` for this widget only. |
| `position` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'` | `'bottom-right'` | Which corner the launcher sits in. |
| `offset` | `number` | `20` | Launcher distance from both edges of that corner, in px. |
| `zIndex` | `number` | `2147483000` | Stacking for every layer the widget draws. |
| `label` | `string` | `strings.launcherLabel` | Launcher label. Prefer `strings` when translating everything. |
| `strings` | `Partial<WidgetStrings>` | English | Every user-visible word, including one line per server error code. |
| `toPng` | `ToPng` | lazy `html-to-image` | Test seam. |

`FeedbackEditor` — the composing half with no opinion about where the report goes — takes the same `strings`, `captureTarget`, `toPng` and `zIndex`, plus `initialText` / `initialImages` / `onSubmit`. A report page uses it for "Edit" and "Comment", so there is exactly one editor to fix.

### Styling

Ten CSS variables, declared on the widget root and nothing else:

`--bd-bg` · `--bd-fg` · `--bd-muted` · `--bd-border` · `--bd-accent` · `--bd-accent-fg` · `--bd-danger` · `--bd-radius` · `--bd-shadow` · `--bd-font`

Light values are declared unconditionally, dark ones under `prefers-color-scheme` and under `[data-bd-theme="dark"]`, so `theme="dark"` works on a host that is otherwise light. Inline style is left for the values that are genuinely dynamic: coordinates, sizes, `zIndex`, the accent override. Animations are dropped under `prefers-reduced-motion`.

Override a token from the host app if a prop is not enough — the widget sets no `!important` except on the element picker's layer, which has to survive hostile host CSS:

```css
[data-bugdeck-widget] { --bd-radius: 4px; --bd-font: "Inter", sans-serif; }
```

### Translating

The server answers `{ "error": "RATE_LIMITED" }` and never a sentence, so every word lives in the widget and one object translates all of it:

```tsx
<FeedbackWidget
  apiBase="/api"
  strings={{
    launcherLabel: 'Signaler un bug',
    send: 'Envoyer',
    errors: { RATE_LIMITED: 'Trop de rapports cette heure-ci.' },
  }}
/>
```

Anything you leave out falls back to English; `errors` merges one level deeper, so a single code can be overridden on its own. `defaultStrings` is exported if you want to diff against it.

## What the user can do

| Task | How |
|---|---|
| Capture the page | **Capture screen** — the modal unmounts and a paint is awaited before the shot; the widget's own subtree is filtered out as a second net |
| Capture one element | **Pick element** — a devtools-style overlay: hover highlights, click captures exactly that box, Esc cancels without losing the text already typed |
| Add images | Drag-and-drop · paste Ctrl/Cmd+V · **Upload image**. Every route (capture included) **adds a block**, never replaces one. Cap: `FEEDBACK_MAX_ASSETS` (10), 10 MB each |
| Draw on an image | **Draw** on a thumbnail → canvas editor: Pen / Box / Arrow / **Crop**, red or yellow, Undo, Save. Exports a full-resolution PNG; touch works |
| Crop | In the draw editor: **Crop** → drag a selection (outside dims) → **Apply crop**. The picture becomes exactly that region at full resolution (cut from the source image, not from the scaled canvas), and the marks move with it. **Undo reverses a crop too** |
| Interleave text and images | Block editor (`text \| image`): an image is inserted at the caret, and the order survives all the way to the tracker |
| Come back later | Drafts autosave **per page** (localStorage). Closing the modal, F5 and closing the tab all keep them; reopening the same page restores text and images with a one-line notice. The launcher shows a draft marker |
| Leave the dialog | **Hide** (✕ · Esc · backdrop · the Hide button) puts it away and KEEPS everything · **Discard** throws it away, asking once inline when there is anything to lose |

**One draft per PAGE** (`draftSlug` = `location.pathname`, query and hash dropped). A different bug on a different screen is a **different report**, not an appendix to the last one — a single global draft would merge two unrelated bugs into one issue that gets read to the end of the first paragraph and closed. Drafts live 7 days and are swept when the widget opens.

## Wire format

`POST {apiBase}/reports`, multipart. Field names come from `@aitofy/bugdeck-core/contract` — the
browser-safe entry point, so bundling the widget never reaches `sharp` — and the widget and the
route cannot drift:

| Field | Contents |
|---|---|
| `description` | Text — every text block joined by a blank line. A server that only reads this field still gets the whole report |
| `context` | JSON: `url`, `viewport{width,height,dpr?}`, `userAgent`, `buildCommit?`, `lastApiError?{status,path,message,at?}` |
| `blocks` | JSON, ordered; new images referenced by their index among the uploaded files. Additive — a server that ignores it loses only the interleaving |
| `images` | A REPEATED `images` key (not `images[]`), ≤ `FEEDBACK_MAX_ASSETS` files, ≤ 10 MB each, png/jpeg/webp |

Editing (`PATCH /reports/:id`) and commenting (`POST /reports/:id/comment`) use the **same three fields**. One difference: an image the report ALREADY has travels as `{kind:'image', assetId}` inside `blocks` instead of being uploaded again — stable ids are how a tracker adapter recognises its own attachments instead of adding a second copy of every screenshot. `imageIndex` therefore counts only the files actually in the body.

Stored images are served from `GET {apiBase}/assets/:id`, to the report's owner only.

**Editing vs commenting are different things:**

| | Edit the body | Comment |
|---|---|---|
| Route | `PATCH /reports/:id` | `POST /reports/:id/comment` |
| When | ONLY while `pending` | **Every state**, including `done` |
| Why | Nobody has read it yet, so a real edit is honest. From `doing` on, someone has — rewriting under them is how two people debug different bugs | The most valuable sentence a user writes is *"it is still broken"*, and it always arrives after the report is closed |

Success is `201 { id, code? }` (`code` may arrive later: the tracker bridge runs async). Failures are `{ error: ErrorCode }` — the widget throws a `FeedbackSubmitError` carrying the code and `submitErrorMessage(err, strings)` turns it into a sentence. The server re-encodes every image (magic bytes, no SVG or GIF, capped at 5000×5000); client validation only buys a faster refusal, **the rules live on the server**.

## Architecture

```
FeedbackWidget.tsx   launcher + filing a NEW report + the "Sent" screen
Launcher.tsx         the floating pill: icon, label, draft dot, corner + offset
FeedbackEditor.tsx   the shared composer (blocks + images + capture + picker + drafts).
                     A report page reuses this exact file for Edit and Comment
FeedbackModal.tsx    the composing dialog (the insertion point is the last focused text block)
ModalShell.tsx       scrim, header, body, footer — and every a11y rule: focus trap,
                     aria-modal, scroll lock, Esc
FeedbackSent.tsx     the confirmation, with the tracker reference
EditorToolbar.tsx    Capture screen · Pick element · Upload, one segmented group
BlockList.tsx        the document: auto-growing paragraphs, images as a contact sheet
AnnotateToolbar.tsx  the bar over the canvas, and the keys that drive it (P R A C)
icons.tsx            eleven outlines as path data. No icon dependency
theme.ts             theme, accent, launcher corner — the whole look, as three props
styles/              the stylesheet, by area: tokens, chrome, editor, overlays; `sheet.ts`
                     injects it once, keyed by id
picker-styles.ts     the picker's geometry, inline and `!important` (see Gotchas)
image-intake.ts      how an image gets in: dropped, dragged over, pasted
use-focus-trap.ts    Tab stays in the dialog; the page behind it stops scrolling
use-editor-draft.ts  restore on open, autosave while typing, save again on unload
use-screen-capture.ts the shot, and the phase that unmounts the modal before it
use-annotate-picture.ts loading the image being drawn on (StrictMode-safe)
strings.ts           every user-visible word, English defaults, `{name}` placeholders
strings-context.tsx  the merged dictionary, handed down without prop drilling
exit-intent.ts       Hide (keep) vs Discard (drop) — ✕/Esc/backdrop mean Hide. Pure rule
draft-store.ts       per-page drafts: slug, defensive parse, budget, 7-day TTL
AnnotateOverlay.tsx  canvas editor  ─┐
ElementPicker.tsx    element picker (portalled to body — see Gotchas) ─┤ thin UI over:
annotate.ts          stroke→canvas, pointer→image coordinates, crop (rect + stroke shift).
                     Pure, tested without a DOM
blocks.ts            the block document model and the payload it serialises to
capture.ts           html-to-image wrapper: imagePlaceholder, 15s timeout, widget filter
images.ts            size/type/count validation against the contract's limits
submit.ts            multipart body, endpoints, `FeedbackSubmitError`
context.ts           url / viewport + pixel ratio / UA / commit / last API failure
api-error.ts         `reportApiError()` — module-level store for an HTTP interceptor
describe-error.ts    Event/Error → a readable line (html-to-image rejects raw Events)
```

Every node the widget owns carries `WIDGET_ROOT_ATTR` (`data-bugdeck-widget`): the capture filter and the element picker both use it to avoid seeing themselves.

## Gotchas

Hard-won. Each one cost a production bug; please do not undo them.

- **A cross-origin image without CORS headers used to kill the whole capture**, with the message `undefined`. `html-to-image` fetches every image to inline it; on failure its catch sets `dataURL = options.imagePlaceholder || ''`, assigns that `''` to the cloned `<img>.src`, and the browser resolves `''` against the DOCUMENT URL — loading the page's own HTML as an image, firing `error`, and rejecting with a raw DOM `Event` that has no `.message`. Its module-level cache then remembers the failure for the life of the tab. The fix is four things: `CAPTURE_IMAGE_PLACEHOLDER` (a real 1×1 PNG, so a broken image becomes a grey box), no `cacheBust`, a 15 s `withTimeout`, and `describeError`.
- **`cacheBust` is off deliberately.** It appends a timestamp to every image URL and defeats the cache the page already filled: 122 ms vs 15 ms for the same shot in Chrome 148, and it buys nothing now that a failed fetch degrades to a placeholder.
- **`html-to-image` has no timeout and cannot be cancelled.** One image whose server never answers leaves the promise pending forever and the widget stuck on "Capturing…". 15 s, then give up; the losing promise is swallowed so a shot we abandoned cannot surface as an unhandled rejection in the host app.
- **A transparent PNG makes Undo look dead** — redrawing over the old frame leaves the undone stroke showing through. `clearRect` before every repaint.
- **The element picker must not have a pointer-catching overlay.** `elementFromPoint` would return the overlay itself. The design instead is: the widget's UI is `pointer-events:none`, `pointermove`/`click` are listened for on `document` in the capture phase (with `preventDefault`, so a link cannot navigate), and the widget's own chrome is skipped via `firstForeignElement`.
- **Tokens are declared on `[data-bd-theme]`, never on the widget root.** Every widget root would re-declare the LIGHT palette on itself, and the annotate overlay is a nested root — it would have flipped back to light inside a dark dialog. Only the tops of each tree (launcher, dialog, picker layer) carry the attribute; everything below inherits.
- **The highlight MUST declare its own z-index and MUST live on `document.body`.** An earlier version drew a `position:fixed` div with no z-index, rendered in place inside the host's tree. On a bare demo page it looked perfect; in a real app (fixed sidebar at `z-10`, sticky header) it was **painted over** — still present, rect correct to the pixel, completely invisible. The banner declared `zIndex+1` and did show, producing exactly the reported symptom: "I click Pick element, I see the banner, nothing highlights." Measured with Playwright: hovering a content card gave `rgb(37,99,235)` on all four edges; hovering a sidebar item gave the sidebar's own `rgb(24,20,17)` on all four. The picker now draws into a **layer portalled to `document.body`** whose style is written with `!important` (`pickerLayerDecls` + `applyImportant`), so the host cannot change its position, stacking or visibility — and `position:fixed` cannot be broken by an ancestor with `transform`/`filter`/`contain`. That layer carries `WIDGET_ROOT_ATTR`; remove the attribute and the widget photographs and picks itself.
- **The ring is `box-shadow: inset`, never a `border` on an inflated rect.** A 2 px border drawn OUTSIDE the rect leaves the viewport as soon as the hovered element reaches a screen edge — and a full-width panel reaches three at once, so the "highlight" vanishes while its rect is still correct.
- **A DOM test for the picker is a blind test.** Both earlier fixes passed, because they asked "is there a div, is its rect right" and the broken build answered yes to both. The only check that separates "drawn" from "drawn under the sidebar" is **reading pixels out of a screenshot**: `e2e/picker-highlight.mjs`.
- **Capture behaviour, if you change it:** opening the modal does NOT capture anything (nobody wants to be photographed by surprise), and a second capture ADDS an image rather than replacing the first.
- **Drafts must be localStorage, not IndexedDB.** IndexedDB is the better store for blobs, right up until the instant the tab is closing — which is exactly when the draft is worth the most, and `beforeunload` cannot await anything. Two consequences: an image's data URL is **cached when the image is added** (a `FileReader` will not finish during unload), and there is a **budget** (~2 MB) — over it, IMAGES are shed newest-first, **text is never shed**, and the number of images lost is said out loud.
- **Undo is a stack of STATES, not a stack of strokes.** Since Crop exists, one step back can mean "drop a stroke" or "restore the picture before the crop" — different kinds of thing. The stack holds whole `{picture, strokes}` pairs, which is what makes one Undo button honest about both. Strokes that fall outside the crop are **not deleted**; they take negative coordinates and draw nowhere, because deleting them would make Undo a liar.
- **Crop cuts from the IMAGE, never from the displayed canvas.** The canvas is shown fit-contain; measuring the selection on screen and cutting there gives the wrong box at the wrong resolution. Every crop coordinate lives in image space (`cropRect`, `shiftStrokes` in `annotate.ts`, both tested).
- **`URL.revokeObjectURL` in a cleanup + StrictMode = a phantom error.** The effect runs, tears down, runs again; the teardown revokes the first URL while its image is still loading, that image fires `error`, and the editor showed "could not open this image" over a picture that had loaded perfectly from the second URL. A `cancelled` flag is required.
- **Drawing on an image DROPS its `assetId`** (when editing an existing report). Those are new bytes; keeping the id tells the server "same image as before" and the drawing never leaves the browser.
- **Hide has to FLUSH the draft, not trust the autosave.** The 600 ms debounce is cleared when the editor unmounts, so everything typed in the last 600 ms — which, for a one-sentence report, is everything — went away with the dialog that promised to keep it. `Hide` writes the snapshot synchronously before closing, the same way `beforeunload` does.
- **"Cancel" that KEEPS the draft is one word saying two things.** Once drafts autosaved, the old Cancel only closed the modal: whoever wanted to keep their text was afraid to press it, and whoever wanted it gone pressed it and met the draft again later. It is now two buttons with one rule in `exit-intent.ts` (pure, tested): **✕ · Esc · backdrop click all mean Hide** when there is a draft — the most reflexive gesture must be the one that loses nothing. With no draft (editing an existing report, commenting) the Hide button is not shown at all: promising to keep something nothing is keeping is a lie. The confirmation is **inline in the dialog**, never `window.confirm` (some mobile browsers suppress it silently, so the draft would vanish unasked), and `clearDraft` runs **before** closing — close first and the pending autosave writes the discarded draft back.

## Screens

`docs/screens/` — light and dark, straight out of the demo app: `launcher-*.png`, `modal-*.png`, `annotate-*.png`.

## Test and build

```sh
pnpm --filter @aitofy/bugdeck build       # tsc → dist/
pnpm --filter @aitofy/bugdeck typecheck
pnpm --filter @aitofy/bugdeck test        # node:test via tsx — no DOM needed
```

The pure halves (annotate, blocks, images, submit, context, drafts, exit-intent) are tested without a browser.

### The pixel test

`e2e/picker-highlight.mjs` is the check for "Pick element". It hovers five points spread across the viewport and **reads the four edge pixels of the highlight out of a screenshot**. How it locates the highlight deliberately does NOT depend on how the highlight is drawn — it only asks "which piece of widget chrome has the same box as the hovered element" — so changing the implementation cannot make it pass falsely.

It needs a page with a **fixed sidebar and a sticky header**; that is what `examples/vite-react` provides, and it is the whole reason the bug survived two fixes against a bare demo page.

```sh
pnpm --filter @aitofy/bugdeck build
pnpm --filter @bugdeck/example-vite-react dev   # serves http://localhost:5173
pnpm --filter @aitofy/bugdeck e2e:picker
```

Playwright is not a dependency of this repo. The script imports `playwright` from wherever it is installed; point `PLAYWRIGHT_MODULE` at a copy if that fails.

| Env | Default | |
|---|---|---|
| `WIDGET_DEMO_URL` | `http://localhost:5173` | the page to test against |
| `PLAYWRIGHT_MODULE` | bare `import('playwright')` | path to an installed Playwright |
| `HEADED` | — | `1` to watch it happen |

The remaining DOM work (capturing, drawing) is verified in a real Chromium while developing — unit tests are blind to it.

## Notes

- Inline images on Plane use `<image-component>`, the Plane editor's internal format rather than a public API. Images are always attachments as well, so a format change costs the layout, never the pictures.
- Embedding outside React needs a `<script>` build (bundled React, or a Preact port) — not done yet.

## License

MIT
