import { defaultStrings, formatString, type WidgetStrings } from './strings.js';

/** Marks every node the widget owns, so the capture can leave itself out. */
export const WIDGET_ROOT_ATTR = 'data-bugdeck-widget';

export type ToPng = (node: HTMLElement, options?: Record<string, unknown>) => Promise<string>;

/** Lazy so `html-to-image` never lands in the host app's initial bundle. */
export async function loadToPng(): Promise<ToPng> {
  const mod = await import('html-to-image');
  return mod.toPng as ToPng;
}

/** `data:image/png;base64,...` → a `File` the multipart body can carry. */
export function dataUrlToFile(
  dataUrl: string,
  name: string,
  strings: WidgetStrings = defaultStrings,
): File {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error(strings.captureInvalidImage);

  const [, mime, base64Flag, payload] = match;
  const bytes = base64Flag
    ? Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload));

  return new File([bytes], name, { type: mime });
}

/**
 * A 1x1 mid-grey PNG handed to `html-to-image` for every image it cannot fetch.
 *
 * This is not cosmetic, it is the whole fix for a capture that failed with the
 * word "undefined" in production. Verified in Chrome 148:
 *
 *   a cross-origin <img> without CORS headers
 *     → html-to-image `fetch`es it to inline the bytes → blocked
 *     → its catch sets `dataURL = options.imagePlaceholder || ''`
 *     → it assigns that '' to the cloned <img>.src
 *     → the browser resolves '' against the DOCUMENT URL, loads the page's own
 *       HTML as an image, and fires `error`
 *     → html-to-image rejects with the raw DOM `Event` (no `.message`)
 *
 * So ONE uncooperative avatar or CDN logo killed the entire screenshot, and the
 * only thing the user was told was the word `undefined`. With a real data URL
 * here the assignment loads, `onload` fires, and the shot completes with a grey
 * box where that image was.
 */
export const CAPTURE_IMAGE_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC';

/** A shot nobody is waiting for any more is worse than no shot at all. */
export const CAPTURE_TIMEOUT_MS = 15_000;

export interface CaptureOptions {
  /** Injectable for tests; defaults to the lazily imported `html-to-image`. */
  toPng?: ToPng;
  fileName?: string;
  /** Keep at 1: a retina page at 2 would quadruple bytes for no extra detail. */
  pixelRatio?: number;
  /**
   * Off by default. It appends a timestamp to every image URL, which defeats
   * the browser cache the page already filled: measured at 122 ms vs 15 ms for
   * the same shot in Chrome 148, and it buys nothing now that a failed fetch
   * degrades to a placeholder instead of killing the capture.
   */
  cacheBust?: boolean;
  /** Substituted for images that cannot be inlined. See the constant above. */
  imagePlaceholder?: string;
  /** 0 disables the guard. */
  timeoutMs?: number;
  strings?: WidgetStrings;
}

/**
 * Keep everything except the widget's own subtree. Nodes without `closest`
 * (text nodes) are kept — `instanceof Element` is deliberately avoided so this
 * predicate stays callable outside a DOM.
 */
const excludesWidget = (node: HTMLElement): boolean => {
  const closest = (node as { closest?: (selector: string) => unknown }).closest;
  return typeof closest !== 'function' || !closest.call(node, `[${WIDGET_ROOT_ATTR}]`);
};

/**
 * `html-to-image` has no timeout of its own and cannot be cancelled: one image
 * whose server never answers leaves the promise pending forever, and the widget
 * sits on "Capturing…" with no way out. The losing promise is deliberately
 * swallowed — it may still reject later, and an unhandled rejection from a shot
 * we already gave up on must not surface in the host app.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  strings: WidgetStrings = defaultStrings,
): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(formatString(strings.captureTimeout, { seconds: Math.round(ms / 1000) })),
        ),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Shoot the page BEFORE the modal opens, otherwise the modal covers the very
 * thing the user is reporting.
 */
export async function captureScreenshot(
  target: HTMLElement,
  options: CaptureOptions = {},
): Promise<File> {
  const strings = options.strings ?? defaultStrings;
  const toPng = options.toPng ?? (await loadToPng());
  const shot = toPng(target, {
    pixelRatio: options.pixelRatio ?? 1,
    cacheBust: options.cacheBust ?? false,
    imagePlaceholder: options.imagePlaceholder ?? CAPTURE_IMAGE_PLACEHOLDER,
    filter: excludesWidget,
  });
  const dataUrl = await withTimeout(shot, options.timeoutMs ?? CAPTURE_TIMEOUT_MS, strings);
  return dataUrlToFile(dataUrl, options.fileName ?? 'screenshot.png', strings);
}

/** Pulls image files out of a paste event's clipboard payload. */
export function imagesFromClipboard(items: DataTransferItemList | null | undefined): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}
