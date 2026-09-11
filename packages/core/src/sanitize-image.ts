/**
 * Image sanitisation for report screenshots.
 *
 * A screenshot arriving from a browser is the one place this API accepts an
 * arbitrary byte blob from a stranger, so the file is never trusted and never
 * stored as sent. Two attacks decide the shape of this file:
 *
 *   - POLYGLOT. A file can be a valid GIF *and* a valid HTML/JS document at the
 *     same time; browsers have historically sniffed the second interpretation.
 *     Trusting the multipart `Content-Type` (the client writes it) or the
 *     extension (the client writes that too) is no defence. So: read the magic
 *     bytes, allow exactly png/jpeg/webp, and then RE-ENCODE. Re-encoding is
 *     what actually kills the polyglot — the output is bytes written from a
 *     decoded pixel buffer, so whatever was smuggled in the container, the
 *     trailer or the metadata is simply not in the output.
 *   - DECOMPRESSION BOMB. A 4 KB PNG can declare 60000×60000 and cost 14 GB to
 *     decode. `limitInputPixels` makes the decoder refuse before allocating.
 *
 * SVG and GIF are rejected outright, not re-encoded: SVG is a script container
 * (the decoder would even follow its external refs), and an animated GIF has no
 * business being a bug screenshot.
 *
 * Errors are values, not throws — the route turns them into a 4xx naming the
 * offending file, and one bad attachment must not take down a report the user
 * spent time writing.
 */
import { FEEDBACK_MAX_IMAGE_DIMENSION, type ErrorCode } from './contract.js';

/** `export =` module: the default export is the callable factory. */
type SharpFactory = typeof import('sharp');

/** Formats we can safely decode. Everything else is rejected by magic bytes. */
export const ALLOWED_INPUT_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedInputMime = (typeof ALLOWED_INPUT_MIMES)[number];

/** Everything leaves as PNG — one output format, one Content-Type to serve. */
export const OUTPUT_MIME = 'image/png';

/** Max pixels the decoder will accept. Square cap, so 5000×5000 passes. */
export const MAX_INPUT_PIXELS = FEEDBACK_MAX_IMAGE_DIMENSION * FEEDBACK_MAX_IMAGE_DIMENSION;

export type SanitizeFailure =
  | 'empty'
  | 'unsupported_format'
  | 'svg_rejected'
  | 'gif_rejected'
  | 'too_large'
  | 'decode_failed';

export interface SanitizedImage {
  buffer: Buffer;
  width: number;
  height: number;
  mime: typeof OUTPUT_MIME;
  bytes: number;
}

export type SanitizeResult =
  | { ok: true; value: SanitizedImage }
  | { ok: false; reason: SanitizeFailure; detail?: string };

/** What the first bytes really say the file is — regardless of what it claims. */
export type DetectedFormat = AllowedInputMime | 'image/gif' | 'image/svg+xml' | null;

// Plain bytes, not a `Buffer`: a module-level `Buffer.from` makes importing
// this package throw in a browser, and the widget imports the same barrel.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function looksLikeSvg(buf: Buffer): boolean {
  // Skip a UTF-8 BOM and leading whitespace, then look for the two openings an
  // SVG can legally start with. Only the head is decoded: an 8 MB blob that is
  // not text must not cost a full toString().
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  const head = buf.subarray(start, start + 256).toString('latin1').trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

/** Magic-byte sniffing. Deliberately positional: no regex over attacker bytes. */
export function detectImageFormat(buf: Buffer): DetectedFormat {
  if (buf.length < 12) return looksLikeSvg(buf) ? 'image/svg+xml' : null;

  if (PNG_MAGIC.every((byte, index) => buf[index] === byte)) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // RIFF????WEBP — the 4 size bytes in between are not part of the signature.
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  const gifHead = buf.toString('latin1', 0, 6);
  if (gifHead === 'GIF87a' || gifHead === 'GIF89a') return 'image/gif';
  if (looksLikeSvg(buf)) return 'image/svg+xml';
  return null;
}

export function isAllowedInputMime(format: DetectedFormat): format is AllowedInputMime {
  return format !== null && (ALLOWED_INPUT_MIMES as readonly string[]).includes(format);
}

export interface SanitizeOptions {
  /** Reject anything larger on either side. Default: the report ceiling. */
  maxDimension?: number;
  /** Square-crop and shrink to this size. Avatars want it; screenshots do not. */
  resizeTo?: number;
}

/**
 * `sharp` is optional so a consumer that only needs the contract does not pay
 * for a native build. A server that accepts uploads does need it.
 */
async function loadSharp(): Promise<SharpFactory> {
  try {
    return (await import('sharp')).default;
  } catch {
    throw new Error(
      'sharp is required to sanitize uploaded images but is not installed. ' +
        'Install it with `pnpm add sharp`, or reject image uploads.',
    );
  }
}

/**
 * Decode → check the real dimensions → re-encode as PNG.
 *
 * `animated: false` collapses a multi-frame webp to its first frame instead of
 * decoding an animation into one very tall image (a bomb by another route).
 */
export async function sanitizeImage(
  input: Buffer,
  options: SanitizeOptions = {},
): Promise<SanitizeResult> {
  const maxDimension = options.maxDimension ?? FEEDBACK_MAX_IMAGE_DIMENSION;
  if (!input || input.length === 0) return { ok: false, reason: 'empty' };

  const format = detectImageFormat(input);
  if (format === 'image/svg+xml') return { ok: false, reason: 'svg_rejected' };
  if (format === 'image/gif') return { ok: false, reason: 'gif_rejected' };
  if (!isAllowedInputMime(format)) {
    return { ok: false, reason: 'unsupported_format', detail: 'not a png/jpeg/webp image' };
  }

  const sharp = await loadSharp();
  try {
    const pipeline = sharp(input, {
      limitInputPixels: maxDimension * maxDimension,
      animated: false,
    });
    const meta = await pipeline.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width <= 0 || height <= 0) {
      return { ok: false, reason: 'decode_failed', detail: 'no dimensions in header' };
    }
    if (width > maxDimension || height > maxDimension) {
      return {
        ok: false,
        reason: 'too_large',
        detail: `${width}x${height} exceeds ${maxDimension}px per side`,
      };
    }

    // No withMetadata(): EXIF/ICC/XMP are dropped by default, and dropping them
    // is the point — EXIF carries GPS, and a report is shared with strangers.
    const sized = options.resizeTo
      ? pipeline.resize(options.resizeTo, options.resizeTo, { fit: 'cover', position: 'centre' })
      : pipeline;
    const buffer = await sized.png({ compressionLevel: 9 }).toBuffer();
    const out = options.resizeTo
      ? { width: Math.min(width, options.resizeTo), height: Math.min(height, options.resizeTo) }
      : { width, height };
    return {
      ok: true,
      value: { buffer, ...out, mime: OUTPUT_MIME, bytes: buffer.length },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // The decoder reports the pixel ceiling as a decode error; say what it is.
    const reason: SanitizeFailure = /pixel limit|exceeds pixel/i.test(detail)
      ? 'too_large'
      : 'decode_failed';
    return { ok: false, reason, detail };
  }
}

/** The code the route answers with. The wording belongs to the widget. */
export function failureErrorCode(reason: SanitizeFailure): ErrorCode {
  return reason === 'too_large' ? 'IMAGE_TOO_LARGE' : 'UNSUPPORTED_IMAGE';
}
