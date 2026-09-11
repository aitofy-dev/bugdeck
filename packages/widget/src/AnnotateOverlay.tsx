import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { AnnotateToolbar, ANNOTATE_TOOLS } from './AnnotateToolbar.js';
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
import { useAnnotatePicture, type Picture } from './use-annotate-picture.js';
import { MAX_IMAGE_BYTES, megabytes } from './images.js';
import { formatString } from './strings.js';
import { useWidgetStrings } from './strings-context.js';
import { useWidgetStyles } from './styles/sheet.js';

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
 * Draw on one queued image, full-screen. The canvas holds the image at FULL
 * resolution and is only displayed scaled down, so the export is the picture
 * the user uploaded; pointer coordinates come back through `toImagePoint`.
 *
 * Undo is a stack of whole editor states rather than of strokes, because Crop
 * is undoable too and it changes the picture, not the mark list.
 */
export function AnnotateOverlay({ zIndex, file, onSave, onCancel }: AnnotateOverlayProps) {
  const strings = useWidgetStrings();
  useWidgetStyles();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<Stroke | null>(null);
  /** Live crop drag: an anchor plus the rect it currently describes. */
  const cropAnchor = useRef<Point | null>(null);
  const liveCrop = useRef<CropRect | null>(null);
  const { picture, setPicture, failed } = useAnnotatePicture(file);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [history, setHistory] = useState<Step[]>([]);
  const [selection, setSelection] = useState<CropRect | null>(null);
  const [tool, setTool] = useState<AnnotateTool>('pen');
  const [color, setColor] = useState<string>(ANNOTATE_COLORS[0]!.value);
  const [error, setError] = useState<string | undefined>();
  const ready = picture !== null;
  const shownError = failed ? strings.annotateLoadFailed : error;

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

  /** The region at FULL resolution, cut from the picture and never from the
   * scaled canvas on screen; the marks move with it. */
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

  /** One step back, whether that step was a stroke or a crop. */
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

  /** Shortcuts: the toolbar is a strip of chrome on a canvas the user is drawing on. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const picked = ANNOTATE_TOOLS.find((item) => item.shortcut === event.key.toUpperCase());
      if (picked) setTool(picked.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, undo]);

  return (
    <div
      {...{ [WIDGET_ROOT_ATTR]: '' }}
      className="bd-annotate"
      style={{ zIndex: zIndex + 5 }}
    >
      <AnnotateToolbar
        tool={tool}
        color={color}
        ready={ready}
        canUndo={history.length > 0}
        canApplyCrop={selection !== null}
        onTool={setTool}
        onColor={setColor}
        onApplyCrop={applyCrop}
        onUndo={undo}
        onCancel={onCancel}
        onSave={save}
      />

      <div className="bd-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="bd-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {tool === 'crop' && !shownError && (
        <p className="bd-ahint">{selection ? strings.cropHintAdjust : strings.cropHintDrag}</p>
      )}
      {shownError && (
        <p className="bd-aerror" role="alert">
          {shownError}
        </p>
      )}
    </div>
  );
}
