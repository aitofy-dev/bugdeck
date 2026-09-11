import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { AnnotateOverlay } from './AnnotateOverlay.js';
import type { EditorBlock } from './blocks.js';
import { imagesFromClipboard } from './capture.js';
import { exitIntent, type ExitGesture } from './exit-intent.js';
import {
  ACCEPT_ATTRIBUTE,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  formatRejection,
  isAcceptedMime,
  megabytes,
  type ImageRejection,
} from './images.js';
import { formatString } from './strings.js';
import { useWidgetStrings } from './strings-context.js';
import * as s from './styles.js';
import type { FeedbackSubmitResult } from './submit.js';
import type { PendingImage } from './use-pending-images.js';

interface ShellProps {
  zIndex: number;
  heading: string;
  /**
   * Escape · a click on the backdrop · the corner button. ONE handler for all
   * three: they are the same gesture ("get this off my screen"), and letting
   * them mean different things is how a user loses work by pressing the wrong
   * exit.
   */
  onDismiss: () => void;
  /** Corner button label. Omitted means no corner button (the "Sent" screen). */
  exitLabel?: string;
  onPaste?: (files: File[]) => void;
  /** Off while a full-screen editor sits on top: Escape belongs to that one. */
  closeOnEscape?: boolean;
  children: ReactNode;
}

function ModalShell({
  zIndex,
  heading,
  onDismiss,
  exitLabel,
  onPaste,
  closeOnEscape = true,
  children,
}: ShellProps) {
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeOnEscape, onDismiss]);

  return (
    <div
      style={s.overlay(zIndex)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        style={s.dialog}
        onPaste={(event) => onPaste?.(imagesFromClipboard(event.clipboardData?.items))}
      >
        <div style={s.titleRow}>
          <h2 style={s.title}>{heading}</h2>
          {exitLabel && (
            <button type="button" style={s.exitButton} onClick={onDismiss}>
              {/* Carries a WORD, not just a ×: the whole point of this button is
                  to say whether what is typed will be kept or thrown away. */}
              <span aria-hidden="true">✕</span>
              {exitLabel}
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Images only. A dropped .zip must not read as "nothing happened". */
export function imagesFromDataTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files = transfer.files ? Array.from(transfer.files) : [];
  return files.filter((file) => isAcceptedMime(file.type) || file.type.startsWith('image/'));
}

/** True while a drag carries files — a dragged link or selection must not arm the dropzone. */
export function dragHasFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  const types = transfer.types ? Array.from(transfer.types) : [];
  return types.includes('Files');
}

interface FormProps {
  zIndex: number;
  /** The dialog title. "Edit report" / "Add a comment" reuse this form verbatim. */
  heading?: string;
  submitLabel?: string;
  /** One line above the editor — e.g. "restored your draft". */
  notice?: string;
  blocks: EditorBlock[];
  images: PendingImage[];
  rejections: ImageRejection[];
  capturing: boolean;
  sending: boolean;
  canSubmit: boolean;
  error?: string;
  onTextChange: (id: string, text: string) => void;
  onRemoveBlock: (id: string) => void;
  onAddFiles: (files: File[], afterBlockId: string | null) => void;
  /** The user drew on one image: same slot, new bytes. */
  onAnnotate: (imageKey: string, file: File) => void;
  onCapture: () => void;
  onPickRegion: () => void;
  onSubmit: () => void;
  /**
   * Close but KEEP what is being written (as a draft). `false` when there is
   * nothing to keep — editing an existing report has no draft, so "Hide" there
   * would be Discard under a friendly name.
   */
  canHide: boolean;
  onHide: () => void;
  /** THROW AWAY what is being written. With text or images, ask once first. */
  onDiscard: () => void;
  /** The confirmation question — a new draft and an edit lose different things. */
  discardPrompt: string;
  /** Is there anything to lose. Asking about an empty dialog is just noise. */
  hasContent: boolean;
}

/**
 * One flat column of text areas and images, in the order the user built them.
 *
 * The insertion point is "the text block the caret was last in", tracked here
 * rather than lifted: it is a property of the DOM focus, nothing above this
 * component has any use for it, and threading it upward would make every
 * keystroke a parent re-render.
 */
export function FeedbackForm(props: FormProps) {
  const strings = useWidgetStrings();
  const fileInput = useRef<HTMLInputElement>(null);
  const activeId = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // The discard confirmation lives INSIDE the dialog. `window.confirm` blocks
  // the tab, looks like the browser rather than the app, and a few mobile
  // browsers suppress it silently — so the draft would vanish unasked.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // The image being drawn on, by queue key. Removing it while the editor is
  // open simply hides the editor — nothing to save onto any more.
  const [annotating, setAnnotating] = useState<string | null>(null);
  // A drag over a child fires dragleave on the parent; counting enter/leave is
  // the standard way to keep the highlight from flickering across children.
  const dragDepth = useRef(0);

  const addAtCaret = (files: File[]) => {
    if (files.length) props.onAddFiles(files, activeId.current);
  };

  const endDrag = () => {
    dragDepth.current = 0;
    setDragging(false);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    // Without this the browser navigates the tab to the dropped file.
    event.preventDefault();
    endDrag();
    addAtCaret(imagesFromDataTransfer(event.dataTransfer));
  };

  const byKey = new Map(props.images.map((image) => [image.key, image]));
  const drawingOn = annotating ? byKey.get(annotating) : undefined;

  /** The rule lives in `exit-intent.ts` — one copy, tested. This only obeys it. */
  const exit = (gesture: ExitGesture) => {
    const action = exitIntent(gesture, {
      canHide: props.canHide,
      hasContent: props.hasContent,
    });
    if (action === 'hide') props.onHide();
    else if (action === 'discard') props.onDiscard();
    else setConfirmingDiscard(true);
  };

  return (
    <>
      <ModalShell
        zIndex={props.zIndex}
        heading={props.heading ?? strings.editorHeading}
        onDismiss={() => exit('dismiss')}
        exitLabel={props.canHide ? strings.hide : strings.discard}
        onPaste={addAtCaret}
        // Escape belongs to the layer above (drawing) or to the open confirmation.
        closeOnEscape={!drawingOn && !confirmingDiscard}
      >
        {props.notice && <p style={s.noticeBox}>{props.notice}</p>}

        <div style={s.actionRow}>
          <button type="button" style={s.secondaryButton} onClick={props.onCapture} disabled={props.capturing}>
            {/* Never "Recapture": each press adds a picture, it does not redo the last one. */}
            {props.capturing ? strings.capturing : strings.captureScreen}
          </button>
          <button type="button" style={s.secondaryButton} onClick={props.onPickRegion} disabled={props.capturing}>
            {strings.pickRegion}
          </button>
          <button type="button" style={s.secondaryButton} onClick={() => fileInput.current?.click()}>
            {strings.uploadImage}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            style={s.hiddenInput}
            onChange={(event) => {
              addAtCaret(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
        </div>

        <div
          style={s.editor(dragging)}
          onDragEnter={onDragEnter}
          onDragOver={(event) => {
            if (dragHasFiles(event.dataTransfer)) event.preventDefault();
          }}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {props.blocks.map((block, index) =>
            block.kind === 'text' ? (
              <textarea
                key={block.id}
                autoFocus={index === props.blocks.length - 1}
                style={s.blockText}
                placeholder={index === 0 ? strings.descriptionPlaceholder : ''}
                value={block.text}
                onFocus={() => {
                  activeId.current = block.id;
                }}
                onChange={(event) => props.onTextChange(block.id, event.target.value)}
              />
            ) : (
              <div key={block.id} style={s.blockImage}>
                <img
                  src={byKey.get(block.imageKey)?.previewUrl}
                  alt={byKey.get(block.imageKey)?.file.name ?? strings.imageAlt}
                  style={s.blockImagePreview}
                />
                <button
                  type="button"
                  aria-label={strings.removeImage}
                  style={s.blockImageRemove}
                  onClick={() => props.onRemoveBlock(block.id)}
                >
                  ×
                </button>
                <button
                  type="button"
                  aria-label={strings.annotateImage}
                  style={s.blockImageDraw}
                  onClick={() => setAnnotating(block.imageKey)}
                >
                  {strings.annotate}
                </button>
              </div>
            ),
          )}
          {dragging && <p style={s.dropHint}>{strings.dropHere}</p>}
        </div>

        <p style={s.hint}>
          {formatString(strings.editorHint, {
            max: MAX_IMAGES,
            maxMb: megabytes(MAX_IMAGE_BYTES),
          })}
        </p>

        {props.rejections.map((rejection) => (
          <p key={`${rejection.code}:${rejection.name}`} style={s.errorBox}>
            {formatRejection(rejection, strings)}
          </p>
        ))}
        {props.error && <p style={s.errorBox}>{props.error}</p>}

        {confirmingDiscard ? (
          <div style={s.confirmBar} role="alertdialog" aria-label={props.discardPrompt}>
            <span>{props.discardPrompt}</span>
            <span style={s.confirmSpacer} />
            <button
              type="button"
              style={s.quietButton}
              onClick={() => setConfirmingDiscard(false)}
            >
              {strings.keep}
            </button>
            <button type="button" style={s.dangerButton} onClick={props.onDiscard}>
              {strings.confirmDiscard}
            </button>
          </div>
        ) : (
          <div style={s.footer}>
            {/* Discard = THROW AWAY. It stands alone on the left, far from Send:
                it is the only button in the row that destroys the user's work. */}
            <div style={s.footerDestructiveSlot}>
              <button type="button" style={s.quietButton} onClick={() => exit('discard')}>
                {strings.discard}
              </button>
            </div>
            {props.canHide && (
              <button type="button" style={s.secondaryButton} onClick={() => exit('hide')}>
                {strings.hide}
              </button>
            )}
            <button
              type="button"
              style={s.primaryButton(!props.canSubmit)}
              disabled={!props.canSubmit}
              onClick={props.onSubmit}
            >
              {props.sending ? strings.sending : props.submitLabel ?? strings.send}
            </button>
          </div>
        )}
      </ModalShell>
      {drawingOn && (
        <AnnotateOverlay
          zIndex={props.zIndex}
          file={drawingOn.file}
          onSave={(file) => {
            props.onAnnotate(drawingOn.key, file);
            setAnnotating(null);
          }}
          onCancel={() => setAnnotating(null)}
        />
      )}
    </>
  );
}

export function sentHeadline(result: FeedbackSubmitResult, headingTemplate: string, pending: string): string {
  return formatString(headingTemplate, { code: result.code ?? pending });
}

interface SentProps {
  zIndex: number;
  result: FeedbackSubmitResult;
  myReportsHref: string;
  onClose: () => void;
}

export function FeedbackSent({ zIndex, result, myReportsHref, onClose }: SentProps) {
  const strings = useWidgetStrings();
  return (
    <ModalShell
      zIndex={zIndex}
      heading={sentHeadline(result, strings.sentHeading, strings.codePending)}
      onDismiss={onClose}
    >
      <p style={s.hint}>{strings.sentBody}</p>
      <div style={s.footer}>
        <a href={myReportsHref} style={s.link}>
          {strings.myReports}
        </a>
        <button type="button" style={s.primaryButton(false)} onClick={onClose}>
          {strings.close}
        </button>
      </div>
    </ModalShell>
  );
}
