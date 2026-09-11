import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  ANNOTATE_COLORS,
  annotatedName,
  cropRect,
  drawCropOverlay,
  drawStroke,
  extendStroke,
  isEmptyStroke,
  isUsableCrop,
  renderStrokes,
  shiftStrokes,
  strokeWidthFor,
  toImagePoint,
  type AnnotateTool,
  type CropRect,
  type Point,
  type Stroke,
} from './annotate.js';
import { WIDGET_ROOT_ATTR } from './capture.js';
import { MAX_IMAGE_BYTES, megabytes } from './images.js';
import { formatString, type WidgetStringKey } from './strings.js';
import { useWidgetStrings } from './strings-context.js';
import * as s from './styles.js';

const TOOLS: ReadonlyArray<{ id: AnnotateTool; label: WidgetStringKey }> = [
  { id: 'pen', label: 'toolPen' },
  { id: 'rect', label: 'toolRect' },
  { id: 'arrow', label: 'toolArrow' },
  { id: 'crop', label: 'toolCrop' },
];

/**
 * The picture being drawn on, whatever it currently is: the uploaded file at
 * first, a cropped canvas afterwards. Kept together with its size because a
 * `CanvasImageSource` does not reliably carry one.
 */
interface Picture {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/** One reversible state of the editor. Undo pops one of these off the stack. */
interface Step {
  picture: Picture;
  strokes: Stroke[];
}

export interface AnnotateOverlayProps {
  zIndex: number;
  /** The picture as it stands. Saving again draws on top of what was saved. */
  file: File;
  onSave: (file: File) => void;
  onCancel: () => void;
}

/**
 * Draw on one queued image, full-screen.
 *
 * The canvas is the image at FULL resolution and is only displayed scaled down
 * (see `annotateCanvas`), so what gets exported is the picture the user
 * uploaded, not a viewport-sized copy of it. Pointer coordinates are converted
 * back into image space on the way in — that conversion is `toImagePoint`, and
 * it is the one piece of this file with tests.
 *
 * The base is the CURRENT file rather than some pristine original: opening "Draw"
 * twice must continue on top of the first pass. Undo therefore reaches back
 * only through this session's edits, which is what "undo" means to someone who
 * just drew three lines — the earlier pass is part of the picture now.
 *
 * Undo is a stack of whole editor states, not a stack of strokes, because
 * "Crop" is also undoable and a crop changes the picture rather than the mark
 * list. Keeping the pre-crop picture on the stack is the entire cost of making
 * one button honest for both kinds of edit.
 */
export function AnnotateOverlay({ zIndex, file, onSave, onCancel }: AnnotateOverlayProps) {
  const strings = useWidgetStrings();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<Stroke | null>(null);
  /** Live crop drag: an anchor plus the rect it currently describes. */
  const cropAnchor = useRef<Point | null>(null);
  const liveCrop = useRef<CropRect | null>(null);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [history, setHistory] = useState<Step[]>([]);
  const [selection, setSelection] = useState<CropRect | null>(null);
  const [tool, setTool] = useState<AnnotateTool>('pen');
  const [color, setColor] = useState<string>(ANNOTATE_COLORS[0]!.value);
  const [error, setError] = useState<string | undefined>();
  const ready = picture !== null;

  // Redrawing from the base image is what makes undo possible at all: a canvas
  // remembers pixels, not strokes, so every change repaints the whole thing.
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !picture || !ctx) return;
    // A screenshot PNG can be partly transparent, and drawing it over the old
    // frame would then leave the undone stroke showing through it. Verified in
    // Chromium: without the clear, undo appeared to do nothing.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(picture.source, 0, 0, canvas.width, canvas.height);
    renderStrokes(ctx, strokes);
    if (liveRef.current) drawStroke(ctx, liveRef.current);
    const crop = liveCrop.current ?? selection;
    if (crop) drawCropOverlay(ctx, crop, { width: canvas.width, height: canvas.height });
  }, [picture, selection, strokes]);

  useEffect(() => {
    // A superseded load must stay silent. Under React StrictMode the effect runs,
    // is torn down, and runs again; the teardown revokes the first object URL
    // while its image is still loading, so that image fires `error` — and
    // without this guard the editor showed "could not open this image" over a
    // picture that had loaded perfectly well from the second URL.
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      setError(undefined);
      setPicture({
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => {
      if (!cancelled) setError(strings.annotateLoadFailed);
    };
    image.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file, strings.annotateLoadFailed]);

  // The canvas keeps the picture's intrinsic size — after a crop that is the
  // cropped size, which is what makes the export full-res and correctly framed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !picture) return;
    canvas.width = picture.width;
    canvas.height = picture.height;
    redraw();
  }, [picture, redraw]);

  useEffect(() => {
    if (ready) redraw();
  }, [ready, redraw]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const pointAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    return toImagePoint({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect(), {
      width: canvas.width,
      height: canvas.height,
    });
  };

  /** Snapshot the current state so the next edit can be taken back. */
  const remember = useCallback(() => {
    if (!picture) return;
    setHistory((current) => [...current, { picture, strokes }]);
  }, [picture, strokes]);

  // The edit in progress lives in a ref, not in state: a drag fires pointermove
  // dozens of times a second and each one would otherwise be a React render.
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const canvas = event.currentTarget;
    const point = pointAt(event);
    if (tool === 'crop') {
      cropAnchor.current = point;
      liveCrop.current = null;
      // Starting a new selection drops the old one, so the dimming that is
      // still on screen does not belong to a rectangle nobody is dragging.
      setSelection(null);
      return;
    }
    liveRef.current = {
      tool,
      color,
      width: strokeWidthFor({ width: canvas.width, height: canvas.height }),
      points: [point],
    };
    redraw();
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    if (cropAnchor.current) {
      liveCrop.current = cropRect(cropAnchor.current, pointAt(event), {
        width: canvas.width,
        height: canvas.height,
      });
      redraw();
      return;
    }
    if (!liveRef.current) return;
    liveRef.current = extendStroke(liveRef.current, pointAt(event));
    redraw();
  };

  const onPointerUp = () => {
    if (cropAnchor.current) {
      const rect = liveCrop.current;
      cropAnchor.current = null;
      liveCrop.current = null;
      const size = { width: picture?.width ?? 0, height: picture?.height ?? 0 };
      setSelection(rect && isUsableCrop(rect, size) ? rect : null);
      return;
    }
    const stroke = liveRef.current;
    liveRef.current = null;
    if (!stroke || isEmptyStroke(stroke)) {
      redraw();
      return;
    }
    remember();
    setStrokes((current) => [...current, stroke]);
  };

  /**
   * Apply the selection: the picture becomes the selected region at FULL
   * resolution (drawn 1:1 out of the current picture, never out of the scaled
   * canvas on screen), and the marks move with it.
   */
  const applyCrop = () => {
    if (!picture || !selection) return;
    const cut = document.createElement('canvas');
    cut.width = selection.width;
    cut.height = selection.height;
    const ctx = cut.getContext('2d');
    if (!ctx) {
      setError(strings.annotateCropFailed);
      return;
    }
    ctx.drawImage(
      picture.source,
      selection.x,
      selection.y,
      selection.width,
      selection.height,
      0,
      0,
      selection.width,
      selection.height,
    );
    remember();
    setStrokes((current) => shiftStrokes(current, -selection.x, -selection.y));
    setPicture({ source: cut, width: selection.width, height: selection.height });
    setSelection(null);
    setTool('pen');
  };

  /**
   * One step back, whether that step was a stroke or a crop — the stack holds
   * whole states, so undoing a crop restores the picture it was cut from along
   * with the marks at their pre-crop coordinates.
   */
  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((current) => current.slice(0, -1));
    setStrokes(previous.strokes);
    setPicture(previous.picture);
    setSelection(null);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setError(undefined);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError(strings.annotateExportFailed);
        return;
      }
      // PNG of a large screenshot can outgrow what the route accepts; better to
      // say so here than to have the send fail after the report is written.
      if (blob.size > MAX_IMAGE_BYTES) {
        setError(
          formatString(strings.annotateTooLarge, { maxMb: megabytes(MAX_IMAGE_BYTES) }),
        );
        return;
      }
      onSave(new File([blob], annotatedName(file.name), { type: 'image/png' }));
    }, 'image/png');
  };

  return (
    <div {...{ [WIDGET_ROOT_ATTR]: '' }} style={s.annotateLayer(zIndex)}>
      <div style={s.annotateToolbar}>
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tool === item.id}
            style={s.annotateTool(tool === item.id)}
            onClick={() => setTool(item.id)}
          >
            {strings[item.label]}
          </button>
        ))}
        <span style={s.annotateSeparator} />
        {ANNOTATE_COLORS.map((swatch) => (
          <button
            key={swatch.value}
            type="button"
            aria-label={strings[swatch.label]}
            aria-pressed={color === swatch.value}
            style={s.annotateSwatch(swatch.value, color === swatch.value)}
            onClick={() => setColor(swatch.value)}
          />
        ))}
        <span style={s.annotateSeparator} />
        {tool === 'crop' && (
          <button
            type="button"
            style={s.annotateTool(true)}
            disabled={!selection}
            onClick={applyCrop}
          >
            {strings.applyCrop}
          </button>
        )}
        <button
          type="button"
          style={s.annotateTool(false)}
          disabled={history.length === 0}
          onClick={undo}
        >
          {strings.undo}
        </button>
        <button type="button" style={s.annotateTool(false)} onClick={onCancel}>
          {strings.cancel}
        </button>
        <button type="button" style={s.primaryButton(!ready)} disabled={!ready} onClick={save}>
          {strings.save}
        </button>
      </div>

      <div style={s.annotateCanvasWrap}>
        <canvas
          ref={canvasRef}
          style={s.annotateCanvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {tool === 'crop' && !error && (
        <p style={s.annotateHint}>
          {selection ? strings.cropHintAdjust : strings.cropHintDrag}
        </p>
      )}
      {error && <p style={s.annotateStatus}>{error}</p>}
    </div>
  );
}
