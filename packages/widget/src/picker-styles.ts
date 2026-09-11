/**
 * The picker's geometry, written inline and with `!important`.
 *
 * Everything else the widget draws is a class in `styles/`. These declarations
 * are not, because they are the ones that decide whether the highlight is
 * VISIBLE AT ALL inside a host app whose CSS we do not control — and a host's
 * own `!important` outranks a stylesheet we inject but not an inline
 * `!important`. Kept as raw declarations so they can be tested without a DOM.
 */
import type { CSSProperties } from 'react';
import { DEFAULT_ACCENT } from './theme.js';

/**
 * The full-viewport, click-through sheet that owns the stacking context for
 * everything the picker draws. Measured against a real admin app: the outline
 * used to be a bare `position:fixed` div with NO z-index, so a sidebar
 * (`fixed … z-10`) and a sticky header painted straight over it — the ring
 * existed, had the right rect, and was invisible on half the screen.
 */
export const pickerLayerDecls = (zIndex: number): Record<string, string> => ({
  position: 'fixed',
  top: '0px',
  left: '0px',
  right: '0px',
  bottom: '0px',
  width: 'auto',
  height: 'auto',
  margin: '0px',
  padding: '0px',
  border: '0px',
  'z-index': String(zIndex),
  'pointer-events': 'none',
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  // A transform/filter/contain on the layer itself makes it the containing
  // block for its fixed children and can clip them.
  transform: 'none',
  filter: 'none',
  contain: 'none',
  'clip-path': 'none',
  overflow: 'visible',
});

export interface LayerRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The outline over the element under the cursor. Never takes the pointer.
 *
 * The ring is an INSET shadow at exactly the element's rect, not a border on a
 * grown box: a 2px border outside the rect leaves the viewport as soon as the
 * hovered element reaches a screen edge, and a full-width panel reaches three
 * at once. Inset cannot leave.
 */
export const pickerBox = (rect: LayerRect, accent = DEFAULT_ACCENT): CSSProperties => ({
  position: 'absolute',
  top: rect.top,
  left: rect.left,
  width: rect.width,
  height: rect.height,
  boxSizing: 'border-box',
  boxShadow: `inset 0 0 0 2px ${accent}`,
  borderRadius: 4,
  background: `color-mix(in srgb, ${accent} 14%, transparent)`,
  pointerEvents: 'none',
});

/** Roughly the size of the tooltip, used only to keep it inside the viewport. */
const TIP = { width: 150, height: 22, gap: 14 };

/** Below-right of the cursor, flipped at the edges so it is never half off-screen. */
export function tipPosition(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
): CSSProperties {
  const left = Math.min(point.x + TIP.gap, Math.max(0, viewport.width - TIP.width));
  const below = point.y + TIP.gap;
  const top = below + TIP.height > viewport.height ? point.y - TIP.gap - TIP.height : below;
  return { left, top: Math.max(0, top) };
}

/**
 * Write declarations with `!important` onto an element. Takes the minimal shape
 * of a style declaration so it can be tested without a DOM.
 */
export interface ImportantStyleTarget {
  setProperty(property: string, value: string, priority?: string): void;
}

export function applyImportant(
  target: ImportantStyleTarget,
  decls: Record<string, string>,
): void {
  for (const [property, value] of Object.entries(decls)) {
    target.setProperty(property, value, 'important');
  }
}
