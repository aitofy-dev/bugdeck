/** Full-screen layers: the drawing editor and the element picker's chrome. */
import { WIDGET_ROOT_ATTR } from '../capture.js';

const ROOT = `[${WIDGET_ROOT_ATTR}]`;

export const overlaysCss = `
${ROOT}.bd-annotate {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: rgba(8, 11, 18, 0.93);
  animation: bd-fade 150ms ease-out;
}
${ROOT} .bd-atools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;
  border-radius: 12px;
  border: 1px solid var(--bd-border);
  background: var(--bd-bg);
  box-shadow: var(--bd-shadow);
}
${ROOT} .bd-atool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 8px;
  color: var(--bd-fg);
  font-size: 13px;
  font-weight: 500;
  transition: background 120ms ease;
}
${ROOT} .bd-atool:hover { background: var(--bd-surface); }
${ROOT} .bd-atool[aria-pressed="true"] {
  background: color-mix(in srgb, var(--bd-accent) 12%, var(--bd-bg));
  color: var(--bd-accent);
  font-weight: 600;
}
${ROOT} .bd-atool[disabled] { color: var(--bd-muted); background: none; }
${ROOT} .bd-akbd { color: var(--bd-muted); font-size: 11px; font-weight: 600; }
${ROOT} .bd-atool[aria-pressed="true"] .bd-akbd { color: inherit; opacity: 0.7; }
${ROOT} .bd-swatch {
  width: 22px;
  height: 22px;
  margin: 0 1px;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.14);
}
${ROOT} .bd-swatch[aria-pressed="true"] { border-color: var(--bd-fg); }
${ROOT} .bd-sep { width: 1px; align-self: stretch; margin: 0 4px; background: var(--bd-border); }

${ROOT} .bd-canvas-wrap {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
${ROOT} .bd-canvas {
  display: block;
  max-width: 100%;
  max-height: 100%;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 16px 50px rgba(0, 0, 0, 0.5);
  touch-action: none;
  cursor: crosshair;
}
${ROOT} .bd-ahint { color: #d7dbe3; font-size: 13px; font-weight: 500; }
${ROOT} .bd-aerror { color: #fca5a5; font-size: 13px; font-weight: 500; }

${ROOT} .bd-picker-banner {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(16, 19, 26, 0.94);
  color: #f5f7fa;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}
${ROOT} .bd-picker-tip {
  position: absolute;
  padding: 3px 7px;
  border-radius: 6px;
  background: var(--bd-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  pointer-events: none;
}
`;
