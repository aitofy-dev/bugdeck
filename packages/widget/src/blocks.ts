/**
 * The document model behind the editor: a flat, ordered list of text and image
 * blocks, the way a tracker's own editor reads.
 *
 * Deliberately NOT a rich-text tree and deliberately no editor dependency. A
 * bug report needs exactly two things interleaved — what happened, and a
 * picture of it — and a flat array of two variants is the smallest thing that
 * expresses that. Everything here is pure so the wire shape can be pinned by
 * tests without a DOM.
 *
 * Images are referenced by the queue key rather than embedded: `usePendingImages`
 * already owns the files and the object URLs, and duplicating a File into the
 * block list would mean two places to revoke.
 */
import type { FeedbackBlockInput } from '@aitofy/bugdeck-core/contract';

export interface TextBlock {
  kind: 'text';
  id: string;
  text: string;
}

export interface ImageBlock {
  kind: 'image';
  id: string;
  /** `PendingImage.key`. Dangling keys are dropped at serialise time. */
  imageKey: string;
}

export type EditorBlock = TextBlock | ImageBlock;

let blockSeq = 0;
export const nextBlockId = (): string => `blk-${++blockSeq}`;

export const textBlock = (text = ''): TextBlock => ({ kind: 'text', id: nextBlockId(), text });
export const imageBlock = (imageKey: string): ImageBlock => ({
  kind: 'image',
  id: nextBlockId(),
  imageKey,
});

/** A fresh editor is one empty paragraph, so there is always somewhere to type. */
export const initialBlocks = (): EditorBlock[] => [textBlock()];

/**
 * Insert `inserted` after `afterId`, and make sure the user still has a text
 * block to keep typing in. Without the trailing paragraph, dropping an image at
 * the end of a report leaves the caret nowhere.
 */
export function insertAfter(
  blocks: readonly EditorBlock[],
  afterId: string | null,
  inserted: readonly EditorBlock[],
): EditorBlock[] {
  const index = afterId === null ? -1 : blocks.findIndex((b) => b.id === afterId);
  const at = index === -1 ? blocks.length : index + 1;
  const next = [...blocks.slice(0, at), ...inserted, ...blocks.slice(at)];
  return next[next.length - 1]?.kind === 'text' ? next : [...next, textBlock()];
}

/**
 * Merge text blocks that ended up adjacent, so deleting an image from between
 * two paragraphs joins them rather than leaving a phantom split that shows up
 * as a blank line in Plane.
 */
function heal(blocks: readonly EditorBlock[]): EditorBlock[] {
  const healed: EditorBlock[] = [];
  for (const block of blocks) {
    const prev = healed[healed.length - 1];
    if (block.kind === 'text' && prev?.kind === 'text') {
      healed[healed.length - 1] = {
        ...prev,
        text: [prev.text, block.text].filter(Boolean).join('\n\n'),
      };
      continue;
    }
    healed.push(block);
  }
  return healed.length ? healed : initialBlocks();
}

export function removeBlock(blocks: readonly EditorBlock[], id: string): EditorBlock[] {
  return heal(blocks.filter((b) => b.id !== id));
}

export function replaceText(
  blocks: readonly EditorBlock[],
  id: string,
  text: string,
): EditorBlock[] {
  return blocks.map((b) => (b.kind === 'text' && b.id === id ? { ...b, text } : b));
}

/** Drops image blocks whose file left the queue (the user removed the thumbnail). */
export function pruneMissingImages(
  blocks: readonly EditorBlock[],
  liveKeys: readonly string[],
): EditorBlock[] {
  const live = new Set(liveKeys);
  const kept = blocks.filter((b) => b.kind === 'text' || live.has(b.imageKey));
  return kept.length === blocks.length ? [...blocks] : heal(kept);
}

export interface BlockPayload {
  /** Text blocks joined by a blank line — what a server that ignores `blocks` sees. */
  description: string;
  /** Wire order, images by position in `imageKeys`. Empty when there is nothing to say. */
  blocks: FeedbackBlockInput[];
}

/** What `buildBlockPayload` needs to know about one queued image. */
export interface ImageRef {
  key: string;
  /** Present only for an image the server already has (edits). */
  assetId?: string;
}

/**
 * Flatten the editor into the two fields the request carries.
 *
 * `description` is built from the same text this returns as blocks, on purpose:
 * the two must never disagree, and a server that does not know about `blocks`
 * has to still receive the whole report.
 *
 * An image the server already has is referenced by ITS ID; a new one by its
 * position among the files being uploaded. The index therefore counts only the
 * images actually in the request body — counting all of them would point every
 * new image one slot too far along, which is silent and puts the wrong
 * screenshot in the report.
 */
export function buildBlockPayload(
  blocks: readonly EditorBlock[],
  images: readonly ImageRef[],
): BlockPayload {
  const wire: FeedbackBlockInput[] = [];
  const texts: string[] = [];
  const byKey = new Map(images.map((image) => [image.key, image]));
  const uploadKeys = images.filter((image) => !image.assetId).map((image) => image.key);

  for (const block of blocks) {
    if (block.kind === 'text') {
      const text = block.text.trim();
      if (!text) continue;
      texts.push(text);
      wire.push({ kind: 'text', text });
      continue;
    }
    const image = byKey.get(block.imageKey);
    if (!image) continue; // file left the queue
    if (image.assetId) {
      wire.push({ kind: 'image', assetId: image.assetId });
      continue;
    }
    const imageIndex = uploadKeys.indexOf(image.key);
    if (imageIndex === -1) continue;
    wire.push({ kind: 'image', imageIndex });
  }

  return { description: texts.join('\n\n'), blocks: wire };
}

/** The files that actually go in the request body — kept images do not. */
export function imagesToUpload<T extends ImageRef & { file: File }>(
  images: readonly T[],
): File[] {
  return images.filter((image) => !image.assetId).map((image) => image.file);
}
