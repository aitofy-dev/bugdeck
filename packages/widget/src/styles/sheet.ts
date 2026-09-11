/**
 * One `<style>` tag for the whole widget, injected once and keyed by its id.
 *
 * Idempotent by id rather than by a module flag: a host that renders two
 * widgets, or remounts one, must not accumulate stylesheets — and the tag has
 * to survive a React tree that unmounts.
 */
import { useEffect } from 'react';
import { chromeCss } from './chrome.js';
import { editorCss, editorPhoneCss } from './editor.js';
import { overlaysCss } from './overlays.js';
import { tokensCss } from './tokens.js';

export const STYLE_ELEMENT_ID = 'bugdeck-widget-styles';

export const widgetCss = [tokensCss, chromeCss, editorCss, overlaysCss, editorPhoneCss].join('\n');

export function injectWidgetStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = widgetCss;
  doc.head.appendChild(style);
}

/** Called by every entry point, because each one can be mounted on its own. */
export function useWidgetStyles(): void {
  useEffect(() => {
    if (typeof document !== 'undefined') injectWidgetStyles(document);
  }, []);
}
