/**
 * The composing half of the widget, with the sending half taken out.
 *
 * Extracted when the "Edit" / "Comment" buttons on a report page needed the
 * same thing the launcher gives: a block editor, an image queue, the screen
 * capture, the element picker, and the annotation overlay. Copying that into
 * the host app would have meant two editors drifting apart on the first fix —
 * and the capture path alone has three measured gotchas in it (cross-origin
 * images, the modal photographing itself, the picker eating clicks).
 *
 * So this owns everything about BUILDING a report and nothing about where it
 * goes: `onSubmit` receives the finished payload and the caller decides whether
 * that is a POST, a PATCH, or an append.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildBlockPayload,
  imageBlock,
  imagesToUpload,
  initialBlocks,
  insertAfter,
  removeBlock,
  replaceText,
  type EditorBlock,
} from './blocks.js';
import { captureScreenshot, WIDGET_ROOT_ATTR, type ToPng } from './capture.js';
import { describeError } from './describe-error.js';
import { ElementPicker } from './ElementPicker.js';
import { FeedbackForm } from './FeedbackModal.js';
import { formatString, type WidgetStrings } from './strings.js';
import { useWidgetStrings, WidgetStringsProvider } from './strings-context.js';
import { submitErrorMessage } from './submit.js';
import { usePendingImages, type PendingImage } from './use-pending-images.js';
import { dataUrlToFile } from './capture.js';
import {
  clearDraft,
  fileToDataUrl,
  loadDraft,
  pruneDrafts,
  saveDraft,
  type FeedbackDraft,
} from './draft-store.js';
import type { FeedbackBlockInput } from '@bugdeck/core';

/** Long enough that typing does not hit localStorage per keystroke. */
const DRAFT_SAVE_DELAY_MS = 600;

/** What a finished edit looks like, whatever the caller does with it. */
export interface FeedbackEditorPayload {
  description: string;
  blocks: FeedbackBlockInput[];
  /** New files only — images already on the server travel as ids in `blocks`. */
  images: File[];
}

/** An image the report already has, handed in so it can be edited in place. */
export interface ExistingImage {
  assetId: string;
  file: File;
}

export interface FeedbackEditorProps {
  zIndex?: number;
  heading?: string;
  /** Override any of the widget's words; the rest fall back to English. */
  strings?: Partial<WidgetStrings>;
  submitLabel?: string;
  /** Prefill for an edit; omitted for a fresh report. */
  initialText?: string;
  initialImages?: readonly ExistingImage[];
  /** Throws to show its message in the dialog; resolves to close it. */
  onSubmit: (payload: FeedbackEditorPayload) => Promise<void>;
  /**
   * Close the dialog. For a NEW report (one with a `draftSlug`) this is **Hide**
   * — text and images stay in the draft and the launcher shows the draft dot.
   * For an existing report there is no draft, so it is close-and-drop.
   */
  onClose: () => void;
  /**
   * The user chose to THROW IT AWAY. The draft is already deleted by the time
   * this runs. Omitted falls back to `onClose` — same closing, different meaning.
   */
  onDiscard?: () => void;
  /** The confirmation question. A new draft and an edit lose different things. */
  discardPrompt?: string;
  /** What gets photographed. Defaults to `document.body`. */
  captureTarget?: () => HTMLElement | null;
  /** Test seam; production uses the lazily imported `html-to-image`. */
  toPng?: ToPng;
  /**
   * Keep unsent work under this key (one draft per page — see draft-store).
   * Omitted for editing an EXISTING report: that already has a source of truth
   * on the server, and drafting it under a page key would restore one report's
   * text into another report's editor.
   */
  draftSlug?: string | null;
  /** Where the draft says it came from, for the restore notice. */
  draftUrl?: string;
}

type Phase = 'editing' | 'picking' | 'capturing';

/** Two frames: one for React to unmount the modal, one for the browser to paint without it. */
const afterModalHidden = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

/** The editor proper. `FeedbackEditor` wraps it so `strings` reaches every child. */
function FeedbackEditorBody({
  zIndex = 2_147_483_000,
  heading,
  submitLabel,
  initialText,
  initialImages,
  onSubmit,
  onClose,
  onDiscard,
  discardPrompt,
  captureTarget,
  toPng,
  draftSlug,
  draftUrl,
}: FeedbackEditorProps) {
  const strings = useWidgetStrings();
  const [phase, setPhase] = useState<Phase>('editing');
  const [blocks, setBlocks] = useState<EditorBlock[]>(initialBlocks);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [seeded, setSeeded] = useState(false);
  const [restored, setRestored] = useState<FeedbackDraft | null>(null);
  const [droppedFromDraft, setDroppedFromDraft] = useState(0);
  const queue = usePendingImages();

  /**
   * Queue key → data URL, filled as images arrive.
   *
   * Cached rather than computed at save time because the save that matters most
   * runs on `beforeunload`, where there is no room for a FileReader to finish.
   * A ref, not state: writing it must not re-render the editor mid-typing.
   */
  const dataUrls = useRef(new Map<string, string>());

  /**
   * Load an existing report into the editor exactly once.
   *
   * Guarded by a flag rather than by an empty-deps effect: `initialImages` is a
   * new array on every parent render, and re-seeding would duplicate every
   * screenshot the user is looking at.
   */
  useEffect(() => {
    if (seeded) return;
    if (!initialText && !initialImages?.length) return;
    setSeeded(true);

    const added = initialImages?.length
      ? queue.add(
          initialImages.map((image) => image.file),
          false,
          initialImages.map((image) => image.assetId),
        )
      : [];
    setBlocks([
      ...(initialText ? [{ kind: 'text' as const, id: 'seed-text', text: initialText }] : []),
      ...added.map((image) => imageBlock(image.key)),
      ...initialBlocks(),
    ]);
  }, [initialText, initialImages, queue, seeded]);

  /**
   * Restore this page's draft, once, and only in "new report" mode.
   *
   * Runs on mount so the user sees their words the moment the editor opens.
   * Pruning happens here too: it is the one place guaranteed to run, and a user
   * who reports on many pages otherwise accumulates months of base64 screenshots
   * against the origin's shared quota.
   */
  useEffect(() => {
    if (seeded || !draftSlug || initialText || initialImages?.length) return;
    setSeeded(true);
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
    for (const [i, image] of added.entries()) {
      const dataUrl = draft.images.find((d) => d.key === keys[i])?.dataUrl;
      if (dataUrl) dataUrls.current.set(image.key, dataUrl);
    }

    setBlocks([
      ...(draft.text ? [{ kind: 'text' as const, id: 'draft-text', text: draft.text }] : []),
      ...added.map((image) => imageBlock(image.key)),
      ...initialBlocks(),
    ]);
    setRestored(draft);
    setDroppedFromDraft(draft.images.length - added.length);
  }, [draftSlug, initialImages, initialText, queue, seeded, strings]);

  const capture = useCallback(
    async (target?: HTMLElement | null): Promise<File | null> => {
      const node = target ?? captureTarget?.() ?? document.body;
      if (!node) return null;
      setCapturing(true);
      try {
        return await captureScreenshot(node, { toPng, strings });
      } catch (captureError) {
        // A tainted canvas or a cross-origin font kills the shot, not the report.
        console.warn('[bugdeck] capture failed', captureError);
        setError(
          formatString(strings.captureFailed, { reason: describeError(captureError, strings) }),
        );
        return null;
      } finally {
        setCapturing(false);
      }
    },
    [captureTarget, strings, toPng],
  );

  /**
   * Every image lands the same way — pasted, dropped, picked, or shot: a new
   * block, subject to the same cap. When the queue is full, `add` returns
   * nothing and files the same rejection the paste path shows.
   */
  const addFiles = useCallback(
    (files: File[], afterBlockId: string | null, captured = false) => {
      const added = queue.add(files, captured);
      if (!added.length) return;
      setBlocks((current) =>
        insertAfter(current, afterBlockId, added.map((image) => imageBlock(image.key))),
      );
      // Read the bytes NOW, in the background, so the unload save has them.
      if (draftSlug) {
        for (const image of added) {
          void fileToDataUrl(image.file, strings)
            .then((dataUrl) => dataUrls.current.set(image.key, dataUrl))
            .catch(() => {
              // Unreadable file: the draft simply keeps the text.
            });
        }
      }
    },
    [draftSlug, queue, strings],
  );

  /**
   * Hide the modal for real before shooting (phase unmounts it, then wait for a
   * paint) — the DOM filter that strips the widget from the render is kept as a
   * second net, but the user should see their page, not our popup, get captured.
   */
  const captureScreen = useCallback(async () => {
    setError(undefined);
    setPhase('capturing');
    await afterModalHidden();
    try {
      const shot = await capture();
      if (shot) addFiles([shot], null, true);
    } finally {
      setPhase('editing');
    }
  }, [addFiles, capture]);

  const pick = useCallback(
    async (element: HTMLElement) => {
      setPhase('editing');
      const shot = await capture(element);
      if (shot) addFiles([shot], null, true);
    },
    [addFiles, capture],
  );

  const dropBlock = useCallback(
    (id: string) => {
      setBlocks((current) => {
        const target = current.find((block) => block.id === id);
        if (target?.kind === 'image') queue.remove(target.imageKey);
        return removeBlock(current, id);
      });
    },
    [queue],
  );

  /**
   * `description` and `blocks` are derived from the same pass, so a server that
   * ignores `blocks` still receives every word the user wrote.
   */
  const payload = useMemo(
    () => buildBlockPayload(blocks, queue.images),
    [blocks, queue.images],
  );

  /** The draft as it stands right now — cheap, and used by both save paths. */
  const snapshot = useCallback((): FeedbackDraft | null => {
    if (!draftSlug) return null;
    const text = payload.description;
    const images = queue.images.flatMap((image) => {
      const dataUrl = dataUrls.current.get(image.key);
      return dataUrl
        ? [{ key: image.key, name: image.file.name, type: image.file.type, dataUrl }]
        : [];
    });
    if (!text.trim() && !images.length) return null;
    return { slug: draftSlug, url: draftUrl ?? '', text, images, savedAt: Date.now() };
  }, [draftSlug, draftUrl, payload.description, queue.images]);

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

  // The save that matters: closing the tab. Synchronous by necessity, which is
  // the whole reason the store is localStorage and the data URLs are cached.
  useEffect(() => {
    if (!draftSlug) return;
    const onLeave = () => {
      const draft = snapshot();
      if (draft) saveDraft(draft);
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [draftSlug, snapshot]);

  const send = useCallback(async () => {
    setSending(true);
    setError(undefined);
    try {
      await onSubmit({
        description: payload.description,
        blocks: payload.blocks,
        images: imagesToUpload(queue.images as readonly (PendingImage & { file: File })[]),
      });
      // Sent — the draft has served its purpose. Only after `onSubmit` resolves:
      // a failed send must leave the words exactly where they were.
      if (draftSlug) clearDraft(draftSlug);
    } catch (sendError) {
      console.warn('[bugdeck] submit failed', sendError);
      setError(submitErrorMessage(sendError, strings));
    } finally {
      setSending(false);
    }
  }, [draftSlug, onSubmit, payload, queue.images, strings]);

  /**
   * THROW IT AWAY: delete the draft, then close.
   *
   * The order matters — closing first lets the pending autosave (600 ms debounce)
   * run afterwards and write back the very draft that was just discarded. Here
   * `clearDraft` is synchronous and the autosave effect is torn down with the
   * component.
   */
  const discard = useCallback(() => {
    if (draftSlug) clearDraft(draftSlug);
    (onDiscard ?? onClose)();
  }, [draftSlug, onClose, onDiscard]);

  /**
   * Say the draft came back, and say what it cost if anything was shed.
   * A restore the user did not notice reads as "the app remembered wrong".
   */
  const notice = restored
    ? [
        strings.draftRestored,
        droppedFromDraft > 0
          ? formatString(strings.draftImagesDropped, { count: droppedFromDraft })
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    : undefined;

  return (
    <div {...{ [WIDGET_ROOT_ATTR]: '' }}>
      {phase === 'picking' && (
        <ElementPicker
          zIndex={zIndex}
          onPick={(element) => void pick(element)}
          onCancel={() => setPhase('editing')}
        />
      )}

      {phase === 'editing' && (
        <FeedbackForm
          zIndex={zIndex}
          heading={heading ?? strings.editorHeading}
          submitLabel={submitLabel}
          notice={notice}
          blocks={blocks}
          images={queue.images}
          rejections={queue.rejections}
          capturing={capturing}
          sending={sending}
          canSubmit={payload.description !== '' && !sending && !capturing}
          error={error}
          onTextChange={(id, text) => setBlocks((current) => replaceText(current, id, text))}
          onRemoveBlock={dropBlock}
          onAddFiles={addFiles}
          onAnnotate={(key, file) => {
            queue.replaceFile(key, file);
            // New bytes: the cached data URL is now the pre-drawing picture.
            if (draftSlug) {
              void fileToDataUrl(file, strings)
                .then((dataUrl) => dataUrls.current.set(key, dataUrl))
                .catch(() => dataUrls.current.delete(key));
            }
          }}
          onCapture={() => void captureScreen()}
          onPickRegion={() => {
            setError(undefined);
            setPhase('picking');
          }}
          onSubmit={() => void send()}
          // There is only something to "hide" when there is a draft. Showing
          // Hide without one promises to keep what nothing is keeping.
          canHide={Boolean(draftSlug)}
          onHide={onClose}
          onDiscard={discard}
          discardPrompt={discardPrompt ?? strings.discardPrompt}
          hasContent={payload.description !== '' || queue.images.length > 0}
        />
      )}
    </div>
  );
}

/**
 * The public editor: the same thing, with the string dictionary installed for
 * everything below it.
 */
export function FeedbackEditor(props: FeedbackEditorProps) {
  return (
    <WidgetStringsProvider strings={props.strings}>
      <FeedbackEditorBody {...props} />
    </WidgetStringsProvider>
  );
}
