import type { CSSProperties } from 'react';

/**
 * Inline styles on purpose: the widget must drop into any host app without
 * dragging a CSS framework, a build-time stylesheet, or a class-name collision.
 */

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const launcher = (zIndex: number): CSSProperties => ({
  position: 'fixed',
  right: 20,
  bottom: 20,
  zIndex,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  border: 'none',
  borderRadius: 999,
  background: '#1f2937',
  color: '#f9fafb',
  font: `600 14px/1 ${FONT}`,
  cursor: 'pointer',
  boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
});

export const overlay = (zIndex: number): CSSProperties => ({
  position: 'fixed',
  inset: 0,
  zIndex,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(15,23,42,0.55)',
});

export const dialog: CSSProperties = {
  width: 'min(560px, 100%)',
  maxHeight: '90vh',
  overflowY: 'auto',
  padding: 20,
  borderRadius: 12,
  background: '#ffffff',
  color: '#111827',
  font: `400 14px/1.5 ${FONT}`,
  boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
};

export const title: CSSProperties = {
  margin: '0 0 12px',
  font: `700 17px/1.3 ${FONT}`,
};

export const thumbRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 12,
};

export const thumbBox: CSSProperties = {
  position: 'relative',
  width: 120,
  height: 80,
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid #e5e7eb',
  background: '#f9fafb',
};

export const thumbImage: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

export const thumbRemove: CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 2,
  width: 22,
  height: 22,
  border: 'none',
  borderRadius: '50%',
  background: 'rgba(17,24,39,0.75)',
  color: '#fff',
  font: `700 13px/1 ${FONT}`,
  cursor: 'pointer',
};

export const actionRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 12,
};

export const secondaryButton: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#111827',
  font: `500 13px/1 ${FONT}`,
  cursor: 'pointer',
};

export const primaryButton = (disabled: boolean): CSSProperties => ({
  padding: '9px 18px',
  borderRadius: 8,
  border: 'none',
  background: disabled ? '#9ca3af' : '#2563eb',
  color: '#fff',
  font: `600 14px/1 ${FONT}`,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

export const textarea: CSSProperties = {
  width: '100%',
  minHeight: 110,
  padding: 10,
  borderRadius: 8,
  border: '1px solid #d1d5db',
  font: `400 14px/1.5 ${FONT}`,
  resize: 'vertical',
  boxSizing: 'border-box',
};

export const hint: CSSProperties = {
  margin: '8px 0 0',
  color: '#6b7280',
  font: `400 12px/1.5 ${FONT}`,
};

export const errorBox: CSSProperties = {
  margin: '10px 0 0',
  padding: '8px 10px',
  borderRadius: 8,
  background: '#fef2f2',
  color: '#b91c1c',
  font: `400 13px/1.5 ${FONT}`,
};

/** Calm, informational — the restore notice is good news, not an error. */
export const noticeBox: CSSProperties = {
  margin: '10px 0 0',
  padding: '8px 10px',
  borderRadius: 8,
  background: '#eff6ff',
  color: '#1d4ed8',
  font: `400 13px/1.5 ${FONT}`,
};

export const footer: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 10,
  marginTop: 14,
};

/**
 * Discard stands ALONE on the left, away from the cluster on the right.
 *
 * It is the only button in the row that destroys the user's work, so it must
 * not sit next to the one they press most. `marginRight: auto` pushes the rest
 * right without inventing a filler cell.
 */
export const footerDestructiveSlot: CSSProperties = { marginRight: 'auto' };

/** Muted text, muted border: present and readable, but not inviting. */
export const quietButton: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  background: '#fff',
  color: '#6b7280',
  font: `500 13px/1 ${FONT}`,
  cursor: 'pointer',
};

/** Title row: the dialog name on the left, the exit button on the right. */
export const titleRow: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  margin: '0 0 12px',
};

/**
 * The corner exit — it carries a WORD, not just a ×.
 *
 * "Close" used to be ambiguous: does it keep what is typed or throw it away? A
 * × cannot answer that, and a tooltip never appears on touch.
 */
export const exitButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  background: '#fff',
  color: '#374151',
  font: `500 12px/1 ${FONT}`,
  cursor: 'pointer',
  flexShrink: 0,
};

/** The discard confirmation — inside the dialog, never `window.confirm`. */
export const confirmBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 14,
  padding: '10px 12px',
  borderRadius: 8,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  font: `400 13px/1.4 ${FONT}`,
  color: '#991b1b',
};

export const confirmSpacer: CSSProperties = { marginLeft: 'auto' };

export const dangerButton: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 8,
  border: 'none',
  background: '#dc2626',
  color: '#fff',
  font: `600 13px/1 ${FONT}`,
  cursor: 'pointer',
};

export const link: CSSProperties = {
  color: '#2563eb',
  fontWeight: 600,
};

export const hiddenInput: CSSProperties = { display: 'none' };

// ─── S7: block editor, dropzone, element picker ──────────────────

const FONT_S7 = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const editor = (dragging: boolean): CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  marginBottom: 10,
  minHeight: 140,
  maxHeight: '46vh',
  overflowY: 'auto',
  borderRadius: 8,
  border: `1px ${dragging ? 'dashed #2563eb' : 'solid #d1d5db'}`,
  background: dragging ? '#eff6ff' : '#ffffff',
});

export const blockText: CSSProperties = {
  width: '100%',
  minHeight: 56,
  padding: 6,
  border: 'none',
  outline: 'none',
  resize: 'vertical',
  background: 'transparent',
  color: '#111827',
  font: `400 14px/1.55 ${FONT_S7}`,
};

export const blockImage: CSSProperties = {
  position: 'relative',
  alignSelf: 'flex-start',
  maxWidth: '100%',
  padding: 4,
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  background: '#f9fafb',
};

export const blockImagePreview: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  maxHeight: 220,
  borderRadius: 4,
};

export const blockImageRemove: CSSProperties = {
  position: 'absolute',
  top: -8,
  right: -8,
  width: 22,
  height: 22,
  borderRadius: 999,
  border: '1px solid #e5e7eb',
  background: '#ffffff',
  color: '#374151',
  font: `600 13px/1 ${FONT_S7}`,
  cursor: 'pointer',
};

export const dropHint: CSSProperties = {
  margin: '2px 0 0',
  color: '#2563eb',
  font: `600 12px/1.4 ${FONT_S7}`,
};

/**
 * The one element of the picker whose style must survive the HOST app.
 *
 * A full-viewport, click-through sheet that owns the stacking context for
 * everything the picker draws. Measured on the admin app (Tailwind v4, 2026-08-27):
 * the outline used to be a bare `position:fixed` div with **no z-index**, so the
 * sidebar (`fixed … z-10`) and the sticky header painted straight over it — the
 * ring existed, had the right rect, and was invisible on roughly half the screen.
 * The banner had `zIndex + 1` and did show, which is why the bug read as "the
 * picker starts but nothing highlights".
 *
 * Returned as raw CSS declarations (not `CSSProperties`) because they are
 * applied with `!important` via `applyImportant`: a host stylesheet must not be
 * able to reposition, hide, or re-stack this layer. Everything drawn inside it
 * is positioned against it, so no child needs a z-index of its own.
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
  // A transform/filter/contain on the layer itself would make the fixed sheet a
  // containing block for nothing useful and can clip its children.
  transform: 'none',
  filter: 'none',
  contain: 'none',
  'clip-path': 'none',
  overflow: 'visible',
});

/**
 * The outline drawn over the element under the cursor. Never takes the pointer.
 *
 * The ring is an INSET shadow at exactly the element's rect, not a border on a
 * grown box. A 2px border outside the rect leaves the viewport whenever the
 * hovered element reaches the screen edge — and a full-width panel on an admin
 * page reaches three of them at once, so all four edges of the "highlight" ended
 * up either off-screen or under the app's chrome. Inset can't leave.
 */
export const pickerBox = (rect: {
  top: number;
  left: number;
  width: number;
  height: number;
}): CSSProperties => ({
  position: 'absolute',
  top: rect.top,
  left: rect.left,
  width: rect.width,
  height: rect.height,
  boxSizing: 'border-box',
  boxShadow: 'inset 0 0 0 2px #2563eb',
  borderRadius: 4,
  background: 'rgba(37,99,235,0.14)',
  pointerEvents: 'none',
});

export const pickerBanner = (): CSSProperties => ({
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '8px 14px',
  borderRadius: 999,
  background: '#1f2937',
  color: '#f9fafb',
  font: `600 13px/1 ${FONT_S7}`,
  boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
  pointerEvents: 'none',
});

// ─── S8: annotate overlay ────────────────────────────────────────

/** Above the modal it was opened from — the picture is the whole screen now. */
export const annotateLayer = (zIndex: number): CSSProperties => ({
  position: 'fixed',
  inset: 0,
  zIndex: zIndex + 5,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  padding: 12,
  background: 'rgba(15,23,42,0.92)',
});

export const annotateToolbar: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderRadius: 10,
  background: '#ffffff',
  color: '#111827',
  font: `400 13px/1 ${FONT}`,
  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
};

export const annotateTool = (active: boolean): CSSProperties => ({
  padding: '7px 12px',
  borderRadius: 8,
  border: `1px solid ${active ? '#2563eb' : '#d1d5db'}`,
  background: active ? '#eff6ff' : '#ffffff',
  color: active ? '#1d4ed8' : '#111827',
  font: `${active ? 600 : 500} 13px/1 ${FONT}`,
  cursor: 'pointer',
});

export const annotateSwatch = (color: string, active: boolean): CSSProperties => ({
  width: 26,
  height: 26,
  padding: 0,
  borderRadius: '50%',
  border: `2px solid ${active ? '#111827' : '#e5e7eb'}`,
  background: color,
  cursor: 'pointer',
});

export const annotateSeparator: CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: '#e5e7eb',
};

export const annotateCanvasWrap: CSSProperties = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * The canvas keeps its intrinsic (full-resolution) size; both max constraints
 * let the browser scale it down fit-contain while preserving the ratio, and
 * `touchAction: none` is what makes a finger draw instead of scrolling the page.
 */
export const annotateCanvas: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  maxHeight: '100%',
  touchAction: 'none',
  cursor: 'crosshair',
  background: '#ffffff',
  borderRadius: 4,
  boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
};

export const annotateStatus: CSSProperties = {
  margin: 0,
  color: '#fecaca',
  font: `500 13px/1.5 ${FONT}`,
};

/** Sits on the thumbnail, opposite the remove button. */
export const blockImageDraw: CSSProperties = {
  position: 'absolute',
  left: -8,
  bottom: -8,
  padding: '3px 9px',
  borderRadius: 999,
  border: '1px solid #e5e7eb',
  background: '#ffffff',
  color: '#374151',
  font: `600 12px/1.4 ${FONT}`,
  cursor: 'pointer',
};

/**
 * Write declarations with `!important` onto an element.
 *
 * Inline style already beats a host's class rules, but it loses to a host's own
 * `!important`. This widget ships into apps whose CSS it does not control, so
 * the few declarations that decide whether the picker is *visible at all* are
 * written at the same weight. Takes the minimal shape of a style declaration so
 * it can be tested without a DOM.
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

/** One line under the image while choosing a crop — a hint, not an error. */
export const annotateHint: CSSProperties = {
  margin: 0,
  color: '#e5e7eb',
  font: `500 13px/1.5 ${FONT}`,
};
