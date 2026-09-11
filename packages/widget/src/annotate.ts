/**
 * The drawing model behind "Draw": strokes in IMAGE space, rendered onto a canvas.
 *
 * Everything here is pure and DOM-free so the two things that are easy to get
 * wrong can be pinned by tests without a browser: the pointer→image coordinate
 * mapping (the canvas is displayed scaled down, the export must stay full-res)
 * and what each tool actually emits onto the context.
 *
 * Three drawing tools only. A bug report needs a circle around the thing, a box
 * around the area, or an arrow pointing at it; anything more is a paint program.
 * The fourth tool, `crop`, does not draw — it changes the picture, so it has its
 * own pure half at the bottom of this file.
 */

export type AnnotateTool = 'pen' | 'rect' | 'arrow' | 'crop';

export interface AnnotateColor {
  value: string;
  /** Key in `WidgetStrings` for the accessible name — the wording is not here. */
  label: 'colorRed' | 'colorYellow';
}

/** Red first: it is what people reach for, and it survives on light screenshots. */
export const ANNOTATE_COLORS: readonly AnnotateColor[] = [
  { value: '#ef4444', label: 'colorRed' },
  { value: '#facc15', label: 'colorYellow' },
];

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The canvas' on-screen box, i.e. what `getBoundingClientRect()` returns. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Stroke {
  tool: AnnotateTool;
  color: string;
  /** In image pixels, so a stroke keeps its weight when the canvas is scaled. */
  width: number;
  points: Point[];
}

/**
 * Line weight scaled to the picture: 2 px on a 4000 px-wide screenshot is
 * invisible, 8 px on a 300 px thumbnail is a blindfold. Fixed per image, not
 * per user — a thickness picker is one more decision nobody wants to make while
 * reporting a bug.
 */
export function strokeWidthFor(size: Size): number {
  const longest = Math.max(size.width, size.height);
  return Math.max(3, Math.round(longest / 240));
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Pointer → image pixels. The canvas is shown fit-contain (its box is the
 * scaled image, never letterboxed inside a bigger element), so the ratio
 * between box and image is the only conversion needed. Clamped because a
 * pointer capture keeps delivering moves after the cursor has left the canvas.
 */
export function toImagePoint(client: Point, box: Box, image: Size): Point {
  const scaleX = box.width > 0 ? image.width / box.width : 1;
  const scaleY = box.height > 0 ? image.height / box.height : 1;
  return {
    x: clamp((client.x - box.left) * scaleX, 0, image.width),
    y: clamp((client.y - box.top) * scaleY, 0, image.height),
  };
}

/**
 * What a drag adds to the stroke in progress. Freehand keeps every point; a box
 * and an arrow are two points, so dragging moves the far corner instead of
 * leaving a trail behind.
 */
export function extendStroke(stroke: Stroke, point: Point): Stroke {
  const points =
    stroke.tool === 'pen' ? [...stroke.points, point] : [stroke.points[0] ?? point, point];
  return { ...stroke, points };
}

/** Nothing to draw: a click that never moved leaves a dot, a box leaves nothing. */
export function isEmptyStroke(stroke: Stroke): boolean {
  if (stroke.tool === 'pen') return stroke.points.length === 0;
  return stroke.points.length < 2;
}

/** The subset of the 2D context the renderer touches — makes it stubbable. */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'strokeStyle'
  | 'fillStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'stroke'
  | 'fill'
  | 'strokeRect'
  | 'fillRect'
>;

/** The three points of the head, tip first. Split out because it is geometry. */
export function arrowHead(from: Point, to: Point, width: number): [Point, Point, Point] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const size = Math.max(width * 3.5, 8);
  // Unit vector along the shaft, and its perpendicular.
  const ux = dx / length;
  const uy = dy / length;
  const baseX = to.x - ux * size;
  const baseY = to.y - uy * size;
  const spread = size * 0.45;
  return [
    to,
    { x: baseX - uy * spread, y: baseY + ux * spread },
    { x: baseX + uy * spread, y: baseY - ux * spread },
  ];
}

export function drawStroke(ctx: Ctx2D, stroke: Stroke): void {
  if (isEmptyStroke(stroke)) return;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const first = stroke.points[0]!;
  const last = stroke.points[stroke.points.length - 1]!;

  if (stroke.tool === 'rect') {
    ctx.strokeRect(
      Math.min(first.x, last.x),
      Math.min(first.y, last.y),
      Math.abs(last.x - first.x),
      Math.abs(last.y - first.y),
    );
    return;
  }

  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  if (stroke.tool === 'pen') {
    // A single point still gets a lineTo: without it a tap draws nothing at all.
    for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
    if (stroke.points.length === 1) ctx.lineTo(first.x, first.y);
    ctx.stroke();
    return;
  }

  ctx.lineTo(last.x, last.y);
  ctx.stroke();

  const [tip, left, right] = arrowHead(first, last, stroke.width);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  ctx.fill();
}

export function renderStrokes(ctx: Ctx2D, strokes: readonly Stroke[]): void {
  for (const stroke of strokes) drawStroke(ctx, stroke);
}

/** The export is always PNG, so the name must not keep claiming to be a JPEG. */
export function annotatedName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.png`;
}

// ─── crop ────────────────────────────────────────────────────────
//
// A screenshot of a 4K admin screen with one broken cell in it makes the
// reporter's point badly and costs 3 MB doing it. Cropping is the only edit
// here that changes the PICTURE rather than drawing on it, so everything about
// it that can be got wrong — which rectangle a backwards drag means, staying
// inside the image, and where the strokes end up afterwards — is pure and
// tested. All of it is in IMAGE pixels, never screen pixels: the canvas is
// displayed scaled down, and a crop measured on screen would cut the wrong box.

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Below this a "crop" is a slip of the hand, not an intent — and a 2px picture
 * is worse than no crop at all.
 */
export const MIN_CROP_PX = 8;

/** Two drag points → a rectangle, whichever corner the drag started from. */
export function normalizeCrop(a: Point, b: Point): CropRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * The rectangle a drag actually selects: normalized, clamped inside the image,
 * and on whole pixels. Rounded rather than floored so a drag to the very edge
 * keeps the last column instead of shaving it off.
 */
export function cropRect(a: Point, b: Point, image: Size): CropRect {
  const raw = normalizeCrop(a, b);
  const left = Math.round(Math.max(0, Math.min(raw.x, image.width)));
  const top = Math.round(Math.max(0, Math.min(raw.y, image.height)));
  const right = Math.round(Math.max(0, Math.min(raw.x + raw.width, image.width)));
  const bottom = Math.round(Math.max(0, Math.min(raw.y + raw.height, image.height)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Worth applying? A sliver, or a "crop" that keeps the whole picture, is not. */
export function isUsableCrop(rect: CropRect, image: Size): boolean {
  if (rect.width < MIN_CROP_PX || rect.height < MIN_CROP_PX) return false;
  return rect.width < image.width || rect.height < image.height;
}

/**
 * Strokes after the crop: the same marks, in the new picture's coordinates.
 *
 * Marks that fell outside the kept area are NOT dropped. They land at negative
 * coordinates, draw nowhere, and come back intact if the crop is undone —
 * throwing them away would make undo a lie.
 */
export function shiftStrokes(strokes: readonly Stroke[], dx: number, dy: number): Stroke[] {
  if (dx === 0 && dy === 0) return [...strokes];
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  }));
}

/**
 * What the user looks at while choosing: everything outside the selection goes
 * dark, and the selection gets a hairline. Four rects rather than a
 * even-odd path so the stubbable `Ctx2D` stays small.
 */
export function drawCropOverlay(ctx: Ctx2D, rect: CropRect, image: Size): void {
  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  ctx.fillRect(0, 0, image.width, rect.y);
  ctx.fillRect(0, rect.y + rect.height, image.width, image.height - rect.y - rect.height);
  ctx.fillRect(0, rect.y, rect.x, rect.height);
  ctx.fillRect(rect.x + rect.width, rect.y, image.width - rect.x - rect.width, rect.height);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(2, Math.round(Math.max(image.width, image.height) / 500));
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
}
