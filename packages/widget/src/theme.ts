/**
 * The knobs a host app turns on the widget's look: colour scheme, accent,
 * where the launcher sits. Everything else is a CSS variable in `styles/`.
 */
import type { CSSProperties } from 'react';

export type WidgetTheme = 'light' | 'dark' | 'auto';

export type LauncherPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

/**
 * Also the literal the element picker's ring falls back to.
 *
 * The ring is the one colour read back out of a screenshot by the pixel test,
 * so it must have a value that does not depend on a stylesheet having loaded.
 */
export const DEFAULT_ACCENT = '#2563eb';

export const DEFAULT_LAUNCHER_OFFSET = 20;

/**
 * The token host attribute. Tokens are declared on `[data-bd-theme]` rather
 * than on every widget root, so a nested root (the annotate overlay inside the
 * dialog) INHERITS the resolved scheme instead of re-declaring the light one.
 */
export const THEME_ATTR = 'data-bd-theme';

/** Spread onto a top-level widget root: the launcher, the dialog, the picker layer. */
export function themeAttrs(theme: WidgetTheme): Record<string, string> {
  return { [THEME_ATTR]: theme };
}

/**
 * Inline because it is a runtime value, which is the only thing inline style is
 * still for here. Cast once: `CSSProperties` has no room for custom properties.
 */
export function accentStyle(accent?: string): CSSProperties {
  if (!accent) return {};
  return { '--bd-accent': accent } as Record<string, string> as CSSProperties;
}

/** Which two edges the launcher pins itself to, as inline offsets. */
export function launcherAnchor(
  position: LauncherPosition,
  offset: number,
): CSSProperties {
  const [vertical, horizontal] = position.split('-') as ['bottom' | 'top', 'right' | 'left'];
  return { [vertical]: offset, [horizontal]: offset };
}
