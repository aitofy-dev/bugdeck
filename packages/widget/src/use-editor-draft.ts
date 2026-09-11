/**
 * Unsent work, kept per page: restoring it on open, saving it while typing,
 * and saving it once more on the way out of the tab.
 *
 * Split from the editor because none of it is about composing a report — and
 * all of it is about one store with three write paths that must agree.
 */
import { useCallback, useEffect, useRef } from 'react';
import { dataUrlToFile } from './capture.js';
import {
  clearDraft,
  fileToDataUrl,
  loadDraft,
  pruneDrafts,
  saveDraft,
  type FeedbackDraft,
} from './draft-store.js';
import { formatString, type WidgetStrings } from './strings.js';
import type { PendingImage, PendingImagesApi } from './use-pending-images.js';

/** Long enough that typing does not hit localStorage per keystroke. */
const DRAFT_SAVE_DELAY_MS = 600;

export interface EditorDraftOptions {
  /** One draft per page. Null while editing a report that already exists. */
  draftSlug?: string | null;
  draftUrl?: string;
  /** False when the editor was seeded from a report: that has a source of truth. */
  enabled: boolean;
  queue: PendingImagesApi;
  description: string;
  strings: WidgetStrings;
  /** Called once, with what came back out of storage. */
  seed: (text: string, images: PendingImage[]) => void;
}

export interface EditorDraft {
  /** Read an image's bytes NOW, so the unload save has them without a reader. */
  cache: (key: string, file: File) => void;
  /** Write it out this instant. The debounce dies with the component. */
  save: () => void;
  /** Throw the draft away. Synchronous, so it beats the pending autosave. */
  forget: () => void;
  /** A restore the user did not notice reads as "the app remembered wrong". */
  notice?: string;
}

export function useEditorDraft(options: EditorDraftOptions): EditorDraft {
  const { draftSlug, draftUrl, enabled, queue, description, strings, seed } = options;
  const dataUrls = useRef(new Map<string, string>());
  const restored = useRef<{ dropped: number } | null>(null);
  const done = useRef(false);

  const cache = useCallback(
    (key: string, file: File) => {
      if (!draftSlug) return;
      void fileToDataUrl(file, strings)
        .then((dataUrl) => dataUrls.current.set(key, dataUrl))
        .catch(() => dataUrls.current.delete(key));
    },
    [draftSlug, strings],
  );

  /**
   * Restore once, on mount, so the user sees their words the moment the editor
   * opens. Pruning happens here too: it is the one place guaranteed to run, and
   * a user who reports on many pages otherwise accumulates months of base64
   * screenshots against the origin's shared quota.
   */
  useEffect(() => {
    if (done.current || !enabled || !draftSlug) return;
    done.current = true;
    pruneDrafts();

    const draft = loadDraft(draftSlug);
    if (!draft) return;

    const files: File[] = [];
    const keys: string[] = [];
    for (const image of draft.images) {
      try {
        files.push(dataUrlToFile(image.dataUrl, image.name, strings));
        keys.push(image.key);
      } catch {
        // One corrupt image must not cost the words.
      }
    }
    const added = files.length ? queue.add(files) : [];
    for (const [index, image] of added.entries()) {
      const dataUrl = draft.images.find((stored) => stored.key === keys[index])?.dataUrl;
      if (dataUrl) dataUrls.current.set(image.key, dataUrl);
    }

    restored.current = { dropped: draft.images.length - added.length };
    seed(draft.text, added);
  }, [draftSlug, enabled, queue, seed, strings]);

  /** The draft as it stands right now — cheap, and used by both save paths. */
  const snapshot = useCallback((): FeedbackDraft | null => {
    if (!draftSlug) return null;
    const images = queue.images.flatMap((image) => {
      const dataUrl = dataUrls.current.get(image.key);
      return dataUrl
        ? [{ key: image.key, name: image.file.name, type: image.file.type, dataUrl }]
        : [];
    });
    if (!description.trim() && !images.length) return null;
    return { slug: draftSlug, url: draftUrl ?? '', text: description, images, savedAt: Date.now() };
  }, [description, draftSlug, draftUrl, queue.images]);

  // Debounced autosave. An empty editor CLEARS rather than stores nothing —
  // deleting everything is how a user says "forget it".
  useEffect(() => {
    if (!draftSlug) return;
    const timer = setTimeout(() => {
      const draft = snapshot();
      if (draft) saveDraft(draft);
      else clearDraft(draftSlug);
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftSlug, snapshot]);

  const save = useCallback(() => {
    const draft = snapshot();
    if (draft) saveDraft(draft);
  }, [snapshot]);

  // The save that matters: closing the tab. Synchronous by necessity, which is
  // the whole reason the store is localStorage and the data URLs are cached.
  useEffect(() => {
    if (!draftSlug) return;
    window.addEventListener('beforeunload', save);
    return () => window.removeEventListener('beforeunload', save);
  }, [draftSlug, save]);

  const forget = useCallback(() => {
    if (draftSlug) clearDraft(draftSlug);
  }, [draftSlug]);

  const dropped = restored.current?.dropped;
  const notice =
    dropped === undefined
      ? undefined
      : [
          strings.draftRestored,
          dropped > 0 ? formatString(strings.draftImagesDropped, { count: dropped }) : '',
        ]
          .filter(Boolean)
          .join(' ');

  return { cache, save, forget, notice };
}
