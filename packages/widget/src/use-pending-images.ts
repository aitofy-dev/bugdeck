import { useCallback, useEffect, useRef, useState } from 'react';
import { selectImages, type ImageRejection } from './images.js';

/** An image queued for upload — captured, pasted, dropped or picked. */
export interface PendingImage {
  /** Stable key for React lists and for the block that shows it; never sent. */
  key: string;
  file: File;
  previewUrl: string;
  /** True when produced by the automatic `html-to-image` capture. */
  captured: boolean;
  /**
   * Set only when EDITING: the id this image already has on the server.
   *
   * Such an image is referenced by id instead of being re-uploaded, which is
   * what keeps asset ids stable across an edit — and stable ids are how a
   * tracker adapter recognises the attachments it already made rather than
   * decorating the issue with a second copy of every screenshot.
   */
  assetId?: string;
}

let keySeq = 0;
const nextKey = (): string => `img-${++keySeq}`;

export interface PendingImagesApi {
  images: PendingImage[];
  /** Data, not sentences: the dialog words them with the active `WidgetStrings`. */
  rejections: ImageRejection[];
  /**
   * Returns the images that made it in — the block editor needs their keys.
   * `assetIds` (positional) marks images the SERVER already has, so an edit
   * references them by id instead of uploading them again.
   */
  add: (files: readonly File[], captured?: boolean, assetIds?: readonly string[]) => PendingImage[];
  /** Swaps the bytes behind one queued image, keeping its key (and its block). */
  replaceFile: (key: string, file: File) => void;
  remove: (key: string) => void;
  reset: () => void;
  clearRejections: () => void;
}

/**
 * Owns the image queue and the object URLs behind the previews. Kept in one
 * place because every add/remove path has to revoke, and a leak here pins a
 * full-page screenshot in memory for as long as the tab lives.
 *
 * State is mirrored in a ref and written whole: validation needs to know the
 * current count, and doing that inside a `setState` updater would run twice
 * under StrictMode and double-report rejections.
 */
export function usePendingImages(): PendingImagesApi {
  const [images, setImages] = useState<PendingImage[]>([]);
  const [rejections, setRejections] = useState<ImageRejection[]>([]);
  const imagesRef = useRef<PendingImage[]>([]);
  const urlsRef = useRef<Set<string>>(new Set());

  const commit = useCallback((next: PendingImage[]) => {
    imagesRef.current = next;
    setImages(next);
  }, []);

  const preview = useCallback((file: File): string => {
    const previewUrl = URL.createObjectURL(file);
    urlsRef.current.add(previewUrl);
    return previewUrl;
  }, []);

  const track = useCallback(
    (file: File, captured: boolean, assetId?: string): PendingImage => ({
      key: nextKey(),
      file,
      previewUrl: preview(file),
      captured,
      ...(assetId ? { assetId } : {}),
    }),
    [preview],
  );

  const release = useCallback((image: PendingImage) => {
    if (urlsRef.current.delete(image.previewUrl)) URL.revokeObjectURL(image.previewUrl);
  }, []);

  const add = useCallback(
    (files: readonly File[], captured = false, assetIds?: readonly string[]): PendingImage[] => {
      if (files.length === 0) return [];
      const current = imagesRef.current;
      const { accepted, rejections: rejected } = selectImages(current.length, files);
      setRejections(rejected);
      if (accepted.length === 0) return [];
      // Positional: `selectImages` may drop some, so the id is looked up by the
      // file's place in the ORIGINAL list, not in the accepted one.
      const tracked = accepted.map((file) =>
        track(file, captured, assetIds?.[files.indexOf(file)]),
      );
      commit([...current, ...tracked]);
      return tracked;
    },
    [commit, track],
  );

  /**
   * Annotation edits an image in place. The key is deliberately kept: it is what
   * the block list points at, so re-keying here would orphan the block showing
   * the picture the user just drew on.
   *
   * `assetId` is DROPPED, though. These are new bytes — keeping the id would
   * tell the server "same image as before" and the drawing would never leave
   * the browser.
   */
  const replaceFile = useCallback(
    (key: string, file: File) => {
      commit(
        imagesRef.current.map((image) => {
          if (image.key !== key) return image;
          release(image);
          // Rebuilt field by field so the dropped `assetId` is visible, not implied.
          return { key: image.key, captured: image.captured, file, previewUrl: preview(file) };
        }),
      );
    },
    [commit, preview, release],
  );

  const remove = useCallback(
    (key: string) => {
      commit(
        imagesRef.current.filter((image) => {
          if (image.key === key) release(image);
          return image.key !== key;
        }),
      );
    },
    [commit, release],
  );

  const reset = useCallback(() => {
    for (const image of imagesRef.current) release(image);
    commit([]);
    setRejections([]);
  }, [commit, release]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  return {
    images,
    rejections,
    add,
    replaceFile,
    remove,
    reset,
    clearRejections: useCallback(() => setRejections([]), []),
  };
}
