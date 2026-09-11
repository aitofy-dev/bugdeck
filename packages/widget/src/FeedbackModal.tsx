/**
 * The composing dialog and the confirmation that follows it.
 *
 * Everything here is presentation over state owned by `FeedbackEditor`: the
 * only judgement this file makes is where a pasted or dropped image lands,
 * which is a property of the DOM focus and has no business above this level.
 */
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { AnnotateOverlay } from './AnnotateOverlay.js';
import { BlockList } from './BlockList.js';
import type { EditorBlock } from './blocks.js';
import { EditorToolbar } from './EditorToolbar.js';
import { exitIntent, type ExitGesture } from './exit-intent.js';
import { Icon } from './icons.js';
import { dragHasFiles, imagesFromDataTransfer, pasteShortcut } from './image-intake.js';
import { MAX_IMAGES, MAX_IMAGE_BYTES, formatRejection, megabytes, type ImageRejection } from './images.js';
import { ModalShell } from './ModalShell.js';
import { formatString } from './strings.js';
import { useWidgetStrings } from './strings-context.js';
import type { WidgetTheme } from './theme.js';
import type { PendingImage } from './use-pending-images.js';

interface FormProps {
  zIndex: number;
  theme: WidgetTheme;
  accent?: string;
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

const platform = (): string => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

/** The chord is a key, not a word: it goes in a `<kbd>`, so the line is split around it. */
function pasteLine(template: string, chord: string): ReactNode {
  const [before = '', after = ''] = template.split('{shortcut}');
  return (
    <>
      {before}
      <span className="bd-kbd">{chord}</span>
      {after}
    </>
  );
}

export function FeedbackForm(props: FormProps) {
  const strings = useWidgetStrings();
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
    dragDepth.current = 0;
    setDragging(false);
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

  const footer: ReactNode = (
    <>
      {confirmingDiscard ? (
        <div className="bd-confirm" role="alertdialog" aria-label={props.discardPrompt}>
          <span>{props.discardPrompt}</span>
          <span className="bd-confirm-spacer" />
          <button type="button" className="bd-btn" onClick={() => setConfirmingDiscard(false)}>
            {strings.keep}
          </button>
          <button type="button" className="bd-btn bd-btn--danger" onClick={props.onDiscard}>
            {strings.confirmDiscard}
          </button>
        </div>
      ) : (
        <div className="bd-foot">
          {/* Discard = THROW AWAY. It stands alone on the left, far from Send:
              it is the only button in the row that destroys the user's work. */}
          <div className="bd-foot-start">
            <button type="button" className="bd-btn bd-btn--quiet" onClick={() => exit('discard')}>
              {strings.discard}
            </button>
          </div>
          {props.canHide && (
            <button type="button" className="bd-btn" onClick={() => exit('hide')}>
              {strings.hide}
            </button>
          )}
          <button
            type="button"
            className="bd-btn bd-btn--primary"
            disabled={!props.canSubmit}
            onClick={props.onSubmit}
          >
            {props.sending && <span className="bd-spinner" aria-hidden="true" />}
            {props.sending ? strings.sending : props.submitLabel ?? strings.send}
          </button>
        </div>
      )}
      {(props.rejections.length > 0 || props.error) && (
        <div className="bd-foot-errors">
          {props.rejections.map((rejection) => (
            <p key={`${rejection.code}:${rejection.name}`} className="bd-error" role="alert">
              {formatRejection(rejection, strings)}
            </p>
          ))}
          {props.error && (
            <p className="bd-error" role="alert">
              {props.error}
            </p>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      <ModalShell
        zIndex={props.zIndex}
        theme={props.theme}
        accent={props.accent}
        heading={props.heading ?? strings.editorHeading}
        onDismiss={() => exit('dismiss')}
        dismissLabel={props.canHide ? strings.hide : strings.close}
        onPaste={addAtCaret}
        // Escape belongs to the layer above (drawing) or to the open confirmation.
        closeOnEscape={!drawingOn && !confirmingDiscard}
        footer={footer}
      >
        {props.notice && <p className="bd-notice">{props.notice}</p>}
        <EditorToolbar
          capturing={props.capturing}
          onCapture={props.onCapture}
          onPickRegion={props.onPickRegion}
          onFiles={addAtCaret}
        />
        <div
          className={dragging ? 'bd-doc bd-doc--dragging' : 'bd-doc'}
          onDragEnter={onDragEnter}
          onDragOver={(event) => {
            if (dragHasFiles(event.dataTransfer)) event.preventDefault();
          }}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <BlockList
            blocks={props.blocks}
            images={byKey}
            onTextChange={props.onTextChange}
            onFocusBlock={(id) => {
              activeId.current = id;
            }}
            onRemoveBlock={props.onRemoveBlock}
            onAnnotate={setAnnotating}
          />
          {dragging && (
            <div className="bd-drop">
              <Icon name="image" />
              {strings.dropHere}
            </div>
          )}
        </div>
        <p className="bd-hints">
          <span>{pasteLine(strings.pasteHint, pasteShortcut(platform()))}</span>
          <span>
            {formatString(strings.editorHint, {
              max: MAX_IMAGES,
              maxMb: megabytes(MAX_IMAGE_BYTES),
            })}
          </span>
        </p>
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
