/**
 * Unsent reports survive the tab.
 *
 * People start writing a bug report, then go check the thing they were about to
 * describe — another page, a reload, a tab they close by reflex. Every one of
 * those used to throw the report away, including the screenshots they had
 * already annotated. This keeps it.
 *
 * ONE DRAFT PER PAGE, not one global draft. Two decisions live in that:
 *
 *  - Come back to the page you were reporting about and your words are there.
 *  - Hit a DIFFERENT bug on a DIFFERENT page and it is a NEW report, not an
 *    appendix to the old one. A single global draft would silently merge two
 *    unrelated bugs into one workitem, which is worse than losing one of them:
 *    an admin reads the first paragraph, fixes that, and closes it.
 *
 * The key is `location.pathname`, normalised. Not the full URL: `?page=2` and
 * `#tab=x` are the same screen, and keying on them would scatter one report
 * across three drafts. Not the route pattern either — the widget has no router.
 *
 * localStorage, deliberately, even though images have to be base64'd into it:
 * it is SYNCHRONOUS, so the `beforeunload` save actually lands. IndexedDB is
 * the better store for blobs right up until the moment the tab is closing,
 * which is exactly the moment this exists for.
 *
 * Everything here is pure except the four functions at the bottom that touch
 * `localStorage`, and every one of those swallows — a browser in private mode,
 * a full quota, or a disabled store must never break the report the user is
 * writing.
 */
import { defaultStrings, type WidgetStrings } from './strings.js';


export const DRAFT_KEY_PREFIX = 'bugdeck.draft.';

/** A draft nobody came back to is noise. Swept on every read. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Roughly half of the usual 5 MB localStorage budget, in UTF-16 code units
 * (what browsers actually count). Half, because this widget shares the origin's
 * quota with the whole app — filling it would break the app to save a draft.
 */
export const DRAFT_BUDGET_CHARS = 2_000_000;

export interface DraftImage {
  /** Queue key, so a restored image lands back in the block that showed it. */
  key: string;
  name: string;
  type: string;
  dataUrl: string;
}

export interface FeedbackDraft {
  slug: string;
  /** The full URL it was written on, kept so the restore notice can say so. */
  url: string;
  /** Flattened text of the editor. Blocks are rebuilt around the images. */
  text: string;
  images: DraftImage[];
  savedAt: number;
}

/**
 * `/settings/billing/` and `/settings/billing` are the same screen. Query and
 * hash are dropped for the same reason (see the module doc).
 */
export function draftSlug(href: string): string {
  let path = href;
  try {
    path = new URL(href, 'http://x').pathname;
  } catch {
    // A caller passing a bare path rather than a URL — use it as given.
    path = href.split(/[?#]/)[0] ?? href;
  }
  const trimmed = path.replace(/\/+$/, '').toLowerCase();
  return trimmed || '/';
}

export function draftKey(slug: string): string {
  return `${DRAFT_KEY_PREFIX}${slug}`;
}

/** Anything a previous version (or a hostile page) may have left behind. */
function isDraftImage(value: unknown): value is DraftImage {
  if (!value || typeof value !== 'object') return false;
  const image = value as Record<string, unknown>;
  return (
    typeof image.key === 'string' &&
    typeof image.name === 'string' &&
    typeof image.type === 'string' &&
    typeof image.dataUrl === 'string' &&
    image.dataUrl.startsWith('data:')
  );
}

/**
 * Parse defensively, field by field.
 *
 * A stored draft is data the user's browser held for a week across however many
 * versions of this widget. Trusting its shape means one bad key blanks the
 * editor; the worst this may do is lose a draft.
 */
export function parseDraft(raw: string | null | undefined): FeedbackDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const draft = parsed as Record<string, unknown>;

  const text = typeof draft.text === 'string' ? draft.text : '';
  const images = Array.isArray(draft.images) ? draft.images.filter(isDraftImage) : [];
  // Nothing to restore — an empty draft would put a "restored" banner over an
  // empty editor.
  if (!text.trim() && !images.length) return null;

  return {
    slug: typeof draft.slug === 'string' ? draft.slug : '/',
    url: typeof draft.url === 'string' ? draft.url : '',
    text,
    images,
    savedAt: typeof draft.savedAt === 'number' ? draft.savedAt : 0,
  };
}

export function isExpired(draft: FeedbackDraft, now = Date.now()): boolean {
  return !draft.savedAt || now - draft.savedAt > DRAFT_TTL_MS;
}

export interface SerializedDraft {
  json: string;
  /** Images that did not fit the budget — the UI has to say so. */
  dropped: number;
}

/**
 * Serialise, shedding images from the END until it fits.
 *
 * The text is never dropped: it is the part that cannot be recreated by
 * pressing a button, and it is small. Images go newest-first because the
 * earlier ones are usually the screenshot the report is about, and dropping is
 * reported rather than silent — a draft that quietly loses a picture teaches
 * people not to trust the feature.
 */
export function serializeDraft(draft: FeedbackDraft): SerializedDraft {
  let images = draft.images;
  for (;;) {
    const json = JSON.stringify({ ...draft, images });
    if (json.length <= DRAFT_BUDGET_CHARS || images.length === 0) {
      return { json, dropped: draft.images.length - images.length };
    }
    images = images.slice(0, -1);
  }
}

// ─── localStorage shell ──────────────────────────────────────────

function store(): Storage | null {
  try {
    // Private mode and locked-down profiles both throw on ACCESS, not on use.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadDraft(slug: string, now = Date.now()): FeedbackDraft | null {
  const ls = store();
  if (!ls) return null;
  let draft: FeedbackDraft | null = null;
  try {
    draft = parseDraft(ls.getItem(draftKey(slug)));
  } catch {
    return null;
  }
  if (!draft) return null;
  if (isExpired(draft, now)) {
    clearDraft(slug);
    return null;
  }
  return draft;
}

export function saveDraft(draft: FeedbackDraft): { saved: boolean; dropped: number } {
  const ls = store();
  if (!ls) return { saved: false, dropped: 0 };
  const { json, dropped } = serializeDraft(draft);
  try {
    ls.setItem(draftKey(draft.slug), json);
    return { saved: true, dropped };
  } catch {
    // Quota exceeded even after shedding — try the text alone before giving up.
    try {
      ls.setItem(draftKey(draft.slug), JSON.stringify({ ...draft, images: [] }));
      return { saved: true, dropped: draft.images.length };
    } catch {
      return { saved: false, dropped: draft.images.length };
    }
  }
}

export function clearDraft(slug: string): void {
  const ls = store();
  if (!ls) return;
  try {
    ls.removeItem(draftKey(slug));
  } catch {
    // Nothing to do; a stale draft expires on its own.
  }
}

/**
 * Drop every draft past its TTL.
 *
 * Cheap and worth doing on open: without it a user who reports on many pages
 * accumulates drafts they abandoned months ago, each holding base64 screenshots
 * against the origin's shared quota.
 */
export function pruneDrafts(now = Date.now()): number {
  const ls = store();
  if (!ls) return 0;
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const draft = parseDraft(ls.getItem(key));
      if (!draft || isExpired(draft, now)) {
        ls.removeItem(key);
        removed += 1;
      }
    }
  } catch {
    // Best effort only.
  }
  return removed;
}

// ─── files ↔ data urls ───────────────────────────────────────────

/** Async by necessity — which is why the result is CACHED, see FeedbackEditor. */
export function fileToDataUrl(
  file: File,
  strings: WidgetStrings = defaultStrings,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(strings.draftImageUnreadable));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
