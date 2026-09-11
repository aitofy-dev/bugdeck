/**
 * "Pick element" — let the user point at the thing that is broken.
 *
 * A full-page shot of a dense admin screen is mostly chrome, and the one panel
 * that matters is a tenth of it.
 *
 * Built by hand rather than pulled from a package, because the mechanism is one
 * idea: nothing of ours takes the pointer, `elementsFromPoint` reports the whole
 * stack under the cursor, and the first entry that is not ours is what the user
 * means. Clicks are then swallowed at `document` in the CAPTURE phase, so the
 * host app never sees them — pointing at a dropdown cannot open it, pointing at
 * a link cannot navigate away.
 *
 * The earlier version did the opposite: a transparent full-screen layer took
 * the pointer, and every hit test hid that layer for the length of one
 * `elementFromPoint` call. On prod the outline never appeared, and a synthetic
 * pointer could not reproduce it (a scripted Chromium run passes on that code) —
 * which fits the likeliest mechanism: hiding the layer while the cursor is over
 * it makes the browser fire `mouseleave` on it, and that handler cleared the
 * highlight. One event per move at scripted speed lands harmlessly between
 * steps; a real hand moving a real mouse produces dozens a second, so the
 * outline is set and wiped continuously and never becomes visible.
 *
 * Rather than chase the exact ordering, the layer is gone: nothing of ours takes
 * the pointer, so there is no hit test to win, nothing to hide, and no boundary
 * event to race.
 *
 * That rewrite still did not highlight inside a real app, and the reason was
 * never the hit test: the outline was a bare `position:fixed` div with NO
 * z-index, sitting wherever React happened to render it in the host's tree. A
 * sidebar that is `fixed … z-10` and a sticky header painted OVER the ring.
 * Measured with Playwright against a real app: hovering a card in the content
 * area produced ring pixels rgb(37,99,235) on all four edges; hovering a
 * sidebar item produced the sidebar's own rgb(24,20,17) on all four, with the
 * box's rect correct to the pixel. The banner declared `zIndex + 1` and did
 * show — hence "the picker starts but nothing highlights". A synthetic run that
 * only asserts on rects passes either way, which is how that shipped twice.
 *
 * The fix is a layer that does not care what the host's CSS says: one
 * click-through sheet portalled onto `document.body`, its stacking and geometry
 * written with `!important`, everything the picker draws positioned inside it.
 *
 * Accepted trade-off: the app underneath still sees `:hover`, so a menu that
 * opens on hover will open. Presses are eaten, which is what actually damages
 * things — and the shot is of a rect, so a highlighted row is no worse.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { WIDGET_ROOT_ATTR } from './capture.js';
import { Icon } from './icons.js';
import { applyImportant, pickerBox, pickerLayerDecls, tipPosition } from './picker-styles.js';
import { useWidgetStrings } from './strings-context.js';
import { useWidgetStyles } from './styles/sheet.js';
import { THEME_ATTR, type WidgetTheme } from './theme.js';

export interface PickedRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ElementPickerProps {
  zIndex: number;
  theme: WidgetTheme;
  accent?: string;
  onPick: (element: HTMLElement) => void;
  onCancel: () => void;
}

/** `tag.class` for the tooltip — what devtools would call the thing under the cursor. */
export function elementLabel(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const first = element.classList.item(0);
  return first ? `${tag}.${first}` : tag;
}

/** Never let the user select the picker itself, or the widget it belongs to. */
export function isOwnUi(element: Element | null): boolean {
  if (!element) return true;
  const closest = (element as { closest?: (selector: string) => unknown }).closest;
  return typeof closest !== 'function' || !!closest.call(element, `[${WIDGET_ROOT_ATTR}]`);
}

/**
 * The topmost element under the cursor that the widget does not own.
 *
 * Pure and stack-shaped on purpose: `elementsFromPoint` returns front-to-back,
 * and the only judgement involved — "skip our own chrome" — is the thing that
 * was broken, so it is the thing under test. An `<iframe>` or `<canvas>` comes
 * back as itself (a same-origin iframe's inner document is never entered), which
 * is what we want: the shot is of that box.
 */
export function firstForeignElement(stack: readonly Element[]): HTMLElement | null {
  for (const element of stack) {
    if (!isOwnUi(element)) return element as HTMLElement;
  }
  return null;
}

export function toRect(element: Element): PickedRect {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/** A crosshair everywhere, since no layer of ours is under the cursor to carry one. */
function useCrosshairCursor(): void {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '*{cursor:crosshair !important}';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
}

/**
 * The sheet everything the picker draws lives on.
 *
 * Portalled to `document.body` rather than rendered in place: a host container
 * with a `transform`/`filter`/`contain` turns `position:fixed` into "fixed
 * relative to that box", and the widget cannot know where a host app mounts it.
 * Carries `WIDGET_ROOT_ATTR` so the screenshot filter and `isOwnUi` still
 * recognise it as ours even though it is no longer a DOM descendant of the
 * widget root.
 */
function PickerLayer({
  zIndex,
  theme,
  accent,
  children,
}: {
  zIndex: number;
  theme: WidgetTheme;
  accent?: string;
  children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const node = document.createElement('div');
    node.setAttribute(WIDGET_ROOT_ATTR, '');
    node.setAttribute(THEME_ATTR, theme);
    if (accent) node.style.setProperty('--bd-accent', accent);
    applyImportant(node.style, pickerLayerDecls(zIndex));
    document.body.appendChild(node);
    setHost(node);
    return () => {
      node.remove();
      setHost(null);
    };
  }, [accent, theme, zIndex]);

  return host ? createPortal(children, host) : null;
}

export function ElementPicker({ zIndex, theme, accent, onPick, onCancel }: ElementPickerProps) {
  const strings = useWidgetStrings();
  const [rect, setRect] = useState<PickedRect | null>(null);
  const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null);
  const hovered = useRef<HTMLElement | null>(null);

  useWidgetStyles();
  useCrosshairCursor();

  const under = useCallback(
    (x: number, y: number): HTMLElement | null => firstForeignElement(document.elementsFromPoint(x, y)),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stop it here: the modal behind us also closes on Escape, and cancelling
      // the picker must not throw away the report the user already typed.
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };

    const onMove = (event: PointerEvent) => {
      const element = under(event.clientX, event.clientY);
      hovered.current = element;
      setRect(element ? toRect(element) : null);
      setTip(
        element
          ? { label: elementLabel(element), x: event.clientX, y: event.clientY }
          : null,
      );
    };

    // Nothing of ours intercepts the pointer any more, so every press has to be
    // eaten here or the click lands on the app underneath.
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const onClick = (event: MouseEvent) => {
      swallow(event);
      const element = hovered.current ?? under(event.clientX, event.clientY);
      if (element) onPick(element);
      else onCancel();
    };

    const swallowed = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'contextmenu'] as const;
    document.addEventListener('pointermove', onMove, true);
    for (const type of swallowed) document.addEventListener(type, swallow, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointermove', onMove, true);
      for (const type of swallowed) document.removeEventListener(type, swallow, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onCancel, onPick, under]);

  return (
    <PickerLayer zIndex={zIndex} theme={theme} accent={accent}>
      <div className="bd-picker-banner">
        <Icon name="target" />
        {strings.pickRegionBanner}
      </div>
      {rect && <div style={pickerBox(rect, accent)} />}
      {tip && (
        <div
          className="bd-picker-tip"
          style={tipPosition(
            { x: tip.x, y: tip.y },
            { width: window.innerWidth, height: window.innerHeight },
          )}
        >
          {tip.label}
        </div>
      )}
    </PickerLayer>
  );
}
