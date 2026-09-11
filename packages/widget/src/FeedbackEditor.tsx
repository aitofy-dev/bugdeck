/**
 * The composing half of the widget, with the sending half taken out — so a
 * report page can reuse this exact file for "Edit" and "Comment" instead of
 * growing a second editor that drifts apart on the first fix.
 *
 * It owns everything about BUILDING a report and nothing about where it goes:
 * `onSubmit` receives the payload and the caller decides whether that is a
 * POST, a PATCH, or an append.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { WIDGET_ROOT_ATTR, type ToPng } from './capture.js';
import { ElementPicker } from './ElementPicker.js';
import { FeedbackForm } from './FeedbackModal.js';
import type { WidgetStrings } from './strings.js';
import { useWidgetStrings, WidgetStringsProvider } from './strings-context.js';
import { submitErrorMessage } from './submit.js';
import { accentStyle, themeAttrs, type WidgetTheme } from './theme.js';
import { useEditorDraft } from './use-editor-draft.js';
import { useScreenCapture } from './use-screen-capture.js';
import { usePendingImages, type PendingImage } from './use-pending-images.js';
import type { FeedbackBlockInput } from '@bugdeck/core/contract';

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
  /** `auto` follows `prefers-color-scheme`. */
  theme?: WidgetTheme;
  /** Any CSS colour; it becomes `--bd-accent` for this widget only. */
  accent?: string;
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

/** The editor proper. `FeedbackEditor` wraps it so `strings` reaches every child. */
function FeedbackEditorBody({
  zIndex = 2_147_483_000,
  theme = 'auto',
  accent,
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
  const [blocks, setBlocks] = useState<EditorBlock[]>(initialBlocks);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [seeded, setSeeded] = useState(false);
  const queue = usePendingImages();

  /**
   * `description` and `blocks` are derived from the same pass, so a server that
   * ignores `blocks` still receives every word the user wrote.
   */
  const payload = useMemo(
    () => buildBlockPayload(blocks, queue.images),
    [blocks, queue.images],
  );

  /** Whatever came out of storage becomes the document, with room left to type. */
  const seedFromDraft = useCallback((text: string, images: PendingImage[]) => {
    setBlocks([
      ...(text ? [{ kind: 'text' as const, id: 'draft-text', text }] : []),
      ...images.map((image) => imageBlock(image.key)),
      ...initialBlocks(),
    ]);
  }, []);

  const draft = useEditorDraft({
    draftSlug,
    draftUrl,
    enabled: !initialText && !initialImages?.length,
    queue,
    description: payload.description,
    strings,
    seed: seedFromDraft,
  });

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

  /** Every image lands the same way — pasted, dropped, picked or shot: a new
   * block, subject to the same cap. */
  const addFiles = useCallback(
    (files: File[], afterBlockId: string | null, captured = false) => {
      const added = queue.add(files, captured);
      if (!added.length) return;
      setBlocks((current) =>
        insertAfter(current, afterBlockId, added.map((image) => imageBlock(image.key))),
      );
      for (const image of added) draft.cache(image.key, image.file);
    },
    [draft, queue],
  );

  const camera = useScreenCapture({
    captureTarget,
    toPng,
    strings,
    onShot: (file) => addFiles([file], null, true),
    onError: setError,
  });

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
      draft.forget();
    } catch (sendError) {
      console.warn('[bugdeck] submit failed', sendError);
      setError(submitErrorMessage(sendError, strings));
    } finally {
      setSending(false);
    }
  }, [draft, onSubmit, payload, queue.images, strings]);

  /** Hide PROMISES to keep it, and the 600 ms autosave dies with this component. */
  const hide = useCallback(() => {
    draft.save();
    onClose();
  }, [draft, onClose]);

  /**
   * THROW IT AWAY: delete the draft, then close. The order matters — closing
   * first lets the pending autosave write back the draft just discarded.
   */
  const discard = useCallback(() => {
    draft.forget();
    (onDiscard ?? onClose)();
  }, [draft, onClose, onDiscard]);

  return (
    <div {...{ [WIDGET_ROOT_ATTR]: '' }} {...themeAttrs(theme)} style={accentStyle(accent)}>
      {camera.phase === 'picking' && (
        <ElementPicker
          zIndex={zIndex}
          theme={theme}
          accent={accent}
          onPick={(element) => void camera.pickElement(element)}
          onCancel={camera.cancelPicking}
        />
      )}

      {camera.phase === 'editing' && (
        <FeedbackForm
          zIndex={zIndex}
          theme={theme}
          accent={accent}
          heading={heading ?? strings.editorHeading}
          submitLabel={submitLabel}
          notice={draft.notice}
          blocks={blocks}
          images={queue.images}
          rejections={queue.rejections}
          capturing={camera.capturing}
          sending={sending}
          canSubmit={payload.description !== '' && !sending && !camera.capturing}
          error={error}
          onTextChange={(id, text) => setBlocks((current) => replaceText(current, id, text))}
          onRemoveBlock={dropBlock}
          onAddFiles={addFiles}
          onAnnotate={(key, file) => {
            queue.replaceFile(key, file);
            // New bytes: the cached data URL is now the pre-drawing picture.
            draft.cache(key, file);
          }}
          onCapture={() => void camera.captureScreen()}
          onPickRegion={camera.startPicking}
          onSubmit={() => void send()}
          // There is only something to "hide" when there is a draft. Showing
          // Hide without one promises to keep what nothing is keeping.
          canHide={Boolean(draftSlug)}
          onHide={hide}
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
