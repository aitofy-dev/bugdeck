/**
 * No DOM: the renderer talks to a stub that records the calls, which is the
 * whole reason `drawStroke` takes a context instead of a canvas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotatedName,
  arrowHead,
  cropRect,
  drawCropOverlay,
  drawStroke,
  extendStroke,
  isEmptyStroke,
  isUsableCrop,
  normalizeCrop,
  renderStrokes,
  shiftStrokes,
  strokeWidthFor,
  toImagePoint,
  type Ctx2D,
  type Stroke,
} from '../annotate.js';

interface Recorder {
  ctx: Ctx2D;
  calls: string[];
}

const recorder = (): Recorder => {
  const calls: string[] = [];
  const log =
    (name: string) =>
    (...args: number[]) => {
      calls.push(`${name}(${args.map((n) => Math.round(n)).join(',')})`);
    };
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    beginPath: log('beginPath'),
    moveTo: log('moveTo'),
    lineTo: log('lineTo'),
    closePath: log('closePath'),
    stroke: log('stroke'),
    fill: log('fill'),
    strokeRect: log('strokeRect'),
  } as unknown as Ctx2D;
  return { ctx, calls };
};

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  tool: 'pen',
  color: '#ef4444',
  width: 4,
  points: [],
  ...over,
});

/**
 * The canvas keeps the image's own pixel size and is only displayed smaller, so
 * a click halfway across a 600 px-wide box on a 1200 px image is x=600 — this
 * is what keeps the exported PNG full-resolution instead of viewport-sized.
 */
test('pointer coordinates are converted into image space, not screen space', () => {
  const box = { left: 100, top: 50, width: 600, height: 300 };
  const image = { width: 1200, height: 600 };

  assert.deepEqual(toImagePoint({ x: 100, y: 50 }, box, image), { x: 0, y: 0 });
  assert.deepEqual(toImagePoint({ x: 400, y: 200 }, box, image), { x: 600, y: 300 });
  assert.deepEqual(toImagePoint({ x: 700, y: 350 }, box, image), { x: 1200, y: 600 });
});

test('a pointer dragged off the canvas is clamped instead of drawing outside it', () => {
  const box = { left: 0, top: 0, width: 400, height: 200 };
  const image = { width: 400, height: 200 };
  assert.deepEqual(toImagePoint({ x: -80, y: -10 }, box, image), { x: 0, y: 0 });
  assert.deepEqual(toImagePoint({ x: 9999, y: 9999 }, box, image), { x: 400, y: 200 });
});

test('an image shown at 1:1 needs no conversion at all', () => {
  const box = { left: 0, top: 0, width: 800, height: 600 };
  assert.deepEqual(toImagePoint({ x: 123, y: 45 }, box, { width: 800, height: 600 }), {
    x: 123,
    y: 45,
  });
});

test('line weight follows the picture size and never gets hairline-thin', () => {
  assert.equal(strokeWidthFor({ width: 100, height: 80 }), 3);
  assert.equal(strokeWidthFor({ width: 1200, height: 800 }), 5);
  assert.equal(strokeWidthFor({ width: 3840, height: 2160 }), 16);
});

test('freehand keeps every point; a box and an arrow keep only two', () => {
  const pen = extendStroke(extendStroke(stroke({ points: [{ x: 0, y: 0 }] }), { x: 5, y: 5 }), {
    x: 9,
    y: 9,
  });
  assert.equal(pen.points.length, 3);

  const rect = extendStroke(
    extendStroke(stroke({ tool: 'rect', points: [{ x: 0, y: 0 }] }), { x: 5, y: 5 }),
    { x: 9, y: 9 },
  );
  assert.deepEqual(rect.points, [
    { x: 0, y: 0 },
    { x: 9, y: 9 },
  ]);
});

test('a click that never moved is a dot, a box that never moved is nothing', () => {
  assert.equal(isEmptyStroke(stroke({ points: [{ x: 1, y: 1 }] })), false);
  assert.equal(isEmptyStroke(stroke({ tool: 'rect', points: [{ x: 1, y: 1 }] })), true);
  assert.equal(isEmptyStroke(stroke({ points: [] })), true);
});

test('the pen emits one path through every point, in order', () => {
  const { ctx, calls } = recorder();
  drawStroke(
    ctx,
    stroke({
      color: '#facc15',
      width: 6,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ],
    }),
  );
  assert.deepEqual(calls, [
    'beginPath()',
    'moveTo(0,0)',
    'lineTo(10,20)',
    'lineTo(30,40)',
    'stroke()',
  ]);
  assert.equal(ctx.strokeStyle, '#facc15');
  assert.equal(ctx.lineWidth, 6);
  assert.equal(ctx.lineCap, 'round');
});

test('a single-point pen stroke still puts a dot down', () => {
  const { ctx, calls } = recorder();
  drawStroke(ctx, stroke({ points: [{ x: 7, y: 8 }] }));
  assert.deepEqual(calls, ['beginPath()', 'moveTo(7,8)', 'lineTo(7,8)', 'stroke()']);
});

test('a box drawn upwards-left still has positive width and height', () => {
  const { ctx, calls } = recorder();
  drawStroke(
    ctx,
    stroke({
      tool: 'rect',
      points: [
        { x: 90, y: 70 },
        { x: 30, y: 20 },
      ],
    }),
  );
  assert.deepEqual(calls, ['strokeRect(30,20,60,50)']);
});

test('an arrow is a shaft plus a filled head at the far end', () => {
  const { ctx, calls } = recorder();
  drawStroke(
    ctx,
    stroke({
      tool: 'arrow',
      width: 4,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    }),
  );
  assert.deepEqual(calls.slice(0, 4), ['beginPath()', 'moveTo(0,0)', 'lineTo(100,0)', 'stroke()']);
  assert.deepEqual(calls.slice(4, 5), ['beginPath()']);
  assert.equal(calls.includes('closePath()'), true);
  assert.equal(calls[calls.length - 1], 'fill()');
});

test('the arrow head sits at the tip and spans across the shaft', () => {
  const [tip, left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
  assert.deepEqual(tip, { x: 100, y: 0 });
  // Head is behind the tip along the shaft, one wing either side of it.
  assert.ok(left.x < tip.x && right.x < tip.x);
  assert.ok(left.y > 0 && right.y < 0);
  assert.equal(Math.round(left.y), -Math.round(right.y));
});

test('an arrow with no length still draws instead of dividing by zero', () => {
  const [tip, left, right] = arrowHead({ x: 10, y: 10 }, { x: 10, y: 10 }, 4);
  for (const point of [tip, left, right]) {
    assert.equal(Number.isFinite(point.x) && Number.isFinite(point.y), true);
  }
});

test('strokes are replayed in the order they were drawn, so undo is just the tail', () => {
  const { ctx, calls } = recorder();
  const first = stroke({ points: [{ x: 1, y: 1 }] });
  const second = stroke({ tool: 'rect', points: [{ x: 0, y: 0 }, { x: 4, y: 4 }] });
  renderStrokes(ctx, [first, second]);
  assert.equal(calls[calls.length - 1], 'strokeRect(0,0,4,4)');

  const afterUndo = recorder();
  renderStrokes(afterUndo.ctx, [first, second].slice(0, -1));
  assert.equal(afterUndo.calls.includes('strokeRect(0,0,4,4)'), false);
});

test('the saved file is named as the PNG it now is', () => {
  assert.equal(annotatedName('screenshot.png'), 'screenshot.png');
  assert.equal(annotatedName('screen shot.jpeg'), 'screen shot.png');
  assert.equal(annotatedName('no-extension'), 'no-extension.png');
  assert.equal(annotatedName(''), 'image.png');
});

// ─── crop ────────────────────────────────────────────────────────

test('a backwards drag selects the same rectangle as a forwards one', () => {
  const a = normalizeCrop({ x: 10, y: 20 }, { x: 110, y: 220 });
  const b = normalizeCrop({ x: 110, y: 220 }, { x: 10, y: 20 });
  assert.deepEqual(a, { x: 10, y: 20, width: 100, height: 200 });
  assert.deepEqual(a, b);
});

test('a drag that leaves the picture is clamped to it, not extrapolated', () => {
  const rect = cropRect({ x: -50, y: -80 }, { x: 900, y: 700 }, { width: 800, height: 600 });
  assert.deepEqual(rect, { x: 0, y: 0, width: 800, height: 600 });
});

test('crop coordinates land on whole pixels — a canvas cannot cut half of one', () => {
  const rect = cropRect({ x: 10.4, y: 10.6 }, { x: 99.5, y: 200.4 }, { width: 800, height: 600 });
  for (const value of Object.values(rect)) assert.equal(Number.isInteger(value), true);
});

test('a slip of the hand is not a crop, and neither is keeping the whole picture', () => {
  const image = { width: 800, height: 600 };
  assert.equal(isUsableCrop({ x: 0, y: 0, width: 4, height: 300 }, image), false);
  assert.equal(isUsableCrop({ x: 0, y: 0, width: 800, height: 600 }, image), false);
  assert.equal(isUsableCrop({ x: 10, y: 10, width: 100, height: 100 }, image), true);
});

test('cropping moves the marks with the picture, in image pixels', () => {
  const strokes: Stroke[] = [
    { tool: 'pen', color: '#ef4444', width: 4, points: [{ x: 120, y: 90 }, { x: 130, y: 95 }] },
  ];
  const moved = shiftStrokes(strokes, -100, -50);
  assert.deepEqual(moved[0]!.points, [{ x: 20, y: 40 }, { x: 30, y: 45 }]);
  // The originals are untouched — undo hands the pre-crop list straight back.
  assert.deepEqual(strokes[0]!.points, [{ x: 120, y: 90 }, { x: 130, y: 95 }]);
});

test('a mark outside the kept area survives the crop, so undo can bring it back', () => {
  const strokes: Stroke[] = [
    { tool: 'rect', color: '#facc15', width: 4, points: [{ x: 5, y: 5 }, { x: 20, y: 20 }] },
  ];
  const moved = shiftStrokes(strokes, -400, -300);
  assert.equal(moved.length, 1);
  assert.deepEqual(moved[0]!.points[0], { x: -395, y: -295 });
});

test('the crop overlay darkens exactly the four bands outside the selection', () => {
  const fills: number[][] = [];
  const strokes: number[][] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect: (x: number, y: number, w: number, h: number) => fills.push([x, y, w, h]),
    strokeRect: (x: number, y: number, w: number, h: number) => strokes.push([x, y, w, h]),
  } as unknown as Ctx2D;
  drawCropOverlay(ctx, { x: 100, y: 50, width: 200, height: 100 }, { width: 400, height: 300 });
  assert.deepEqual(fills, [
    [0, 0, 400, 50],      // above
    [0, 150, 400, 150],   // below
    [0, 50, 100, 100],    // left
    [300, 50, 100, 100],  // right
  ]);
  assert.deepEqual(strokes, [[100, 50, 200, 100]]);
});
