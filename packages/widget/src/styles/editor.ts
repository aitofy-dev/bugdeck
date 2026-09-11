/** The composing surface: capture toolbar, the block document, thumbnails. */
import { WIDGET_ROOT_ATTR } from '../capture.js';

const ROOT = `[${WIDGET_ROOT_ATTR}]`;

export const editorCss = `
${ROOT} .bd-toolbar {
  display: inline-flex;
  align-items: stretch;
  border-radius: var(--bd-radius);
  border: 1px solid var(--bd-border);
  background: var(--bd-bg);
  overflow: hidden;
}
${ROOT} .bd-seg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 11px;
  color: var(--bd-fg);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transition: background 120ms ease;
}
${ROOT} .bd-seg + .bd-seg { border-left: 1px solid var(--bd-border); }
${ROOT} .bd-seg:hover { background: var(--bd-surface); }
${ROOT} .bd-seg[disabled] { color: var(--bd-muted); background: var(--bd-surface); }
${ROOT} .bd-seg svg { color: var(--bd-muted); }
${ROOT} .bd-seg:hover svg { color: var(--bd-accent); }

${ROOT} .bd-doc {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 116px;
  margin-top: 12px;
  padding: 2px 0;
  border-radius: var(--bd-radius);
  border: 1px dashed transparent;
  transition: border-color 120ms ease, background 120ms ease;
}
${ROOT} .bd-doc--dragging {
  border-color: var(--bd-accent);
  background: color-mix(in srgb, var(--bd-accent) 7%, var(--bd-bg));
}
${ROOT} .bd-drop {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: var(--bd-radius);
  background: color-mix(in srgb, var(--bd-accent) 10%, var(--bd-bg));
  color: var(--bd-accent);
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
}

${ROOT} .bd-text {
  width: 100%;
  min-height: 46px;
  padding: 4px 2px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--bd-fg);
  font-size: 14px;
  line-height: 1.55;
  resize: none;
  overflow: hidden;
}
${ROOT} .bd-text::placeholder { color: var(--bd-muted); }

${ROOT} .bd-shots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
  padding: 4px 0 6px;
}
${ROOT} .bd-shot {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 8px;
  border: 1px solid var(--bd-border);
  background: var(--bd-surface);
  overflow: hidden;
}
${ROOT} .bd-shot img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
${ROOT} .bd-shot-actions {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(8, 12, 20, 0.55);
  opacity: 0;
  transition: opacity 120ms ease;
}
${ROOT} .bd-shot:hover .bd-shot-actions,
${ROOT} .bd-shot:focus-within .bd-shot-actions { opacity: 1; }
${ROOT} .bd-shot-act {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.94);
  color: #10131a;
  font-size: 12px;
  font-weight: 600;
}
${ROOT} .bd-shot-act:hover { background: #fff; }
${ROOT} .bd-shot-act--danger { color: #b91c1c; }

${ROOT} .bd-hints {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-top: 8px;
  color: var(--bd-muted);
  font-size: 12px;
}
${ROOT} .bd-kbd {
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid var(--bd-border);
  background: var(--bd-surface);
  font-size: 11px;
  font-weight: 600;
}
${ROOT} .bd-hidden-input { display: none; }
`;

export const editorPhoneCss = `
@media (max-width: 480px) {
  [data-bugdeck-widget] .bd-toolbar { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
  [data-bugdeck-widget] .bd-seg { justify-content: center; gap: 5px; padding: 9px 4px; font-size: 12px; }
  /* The sheet is the page now: let the writing surface take the height. */
  [data-bugdeck-widget] .bd-body { display: flex; flex-direction: column; }
  [data-bugdeck-widget] .bd-doc { flex: 1; }
  [data-bugdeck-widget] .bd-hints { margin-top: auto; }
}
`;
