/** The launcher and the dialog around the editor: shell, buttons, footer. */
import { WIDGET_ROOT_ATTR } from '../capture.js';

const ROOT = `[${WIDGET_ROOT_ATTR}]`;

export const chromeCss = `
${ROOT} .bd-launcher {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 15px 9px 13px;
  border-radius: 999px;
  background: var(--bd-fg);
  color: var(--bd-bg);
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.2), 0 1px 2px rgba(15, 23, 42, 0.16);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
${ROOT} .bd-launcher:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.26), 0 1px 2px rgba(15, 23, 42, 0.16);
}
${ROOT} .bd-launcher:active { transform: translateY(0); }
${ROOT} .bd-launcher-dot {
  width: 6px;
  height: 6px;
  margin-left: 1px;
  border-radius: 50%;
  background: var(--bd-accent);
}

${ROOT}.bd-scrim {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--bd-scrim);
  animation: bd-fade 150ms ease-out;
}
${ROOT} .bd-dialog {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(90vh, 720px);
  border-radius: calc(var(--bd-radius) + 4px);
  border: 1px solid var(--bd-border);
  background: var(--bd-bg);
  box-shadow: var(--bd-shadow);
  overflow: hidden;
  animation: bd-enter 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes bd-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes bd-enter {
  from { opacity: 0; transform: translateY(6px) scale(0.985); }
  to { opacity: 1; transform: none; }
}
@keyframes bd-spin { to { transform: rotate(360deg); } }

${ROOT} .bd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 12px 18px;
  border-bottom: 1px solid var(--bd-border);
}
${ROOT} .bd-title { font-size: 15px; font-weight: 600; }
${ROOT} .bd-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 18px 4px;
}
${ROOT} .bd-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px 14px;
}
${ROOT} .bd-foot-start { margin-right: auto; }

${ROOT} .bd-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 13px;
  border-radius: var(--bd-radius);
  border: 1px solid var(--bd-border);
  background: var(--bd-bg);
  color: var(--bd-fg);
  font-size: 13px;
  font-weight: 500;
  transition: background 120ms ease, border-color 120ms ease;
}
${ROOT} .bd-btn:hover { background: var(--bd-surface); }
${ROOT} .bd-btn--primary {
  padding: 8px 17px;
  border-color: transparent;
  background: var(--bd-accent);
  color: var(--bd-accent-fg);
  font-weight: 600;
}
${ROOT} .bd-btn--primary:hover { background: var(--bd-accent); filter: brightness(1.08); }
${ROOT} .bd-btn--primary[disabled] { opacity: 0.55; filter: none; }
${ROOT} .bd-btn--quiet { border-color: transparent; color: var(--bd-muted); }
${ROOT} .bd-btn--danger {
  border-color: transparent;
  background: var(--bd-danger);
  color: #fff;
  font-weight: 600;
}
${ROOT} .bd-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--bd-muted);
}
${ROOT} .bd-icon-btn:hover { background: var(--bd-surface); color: var(--bd-fg); }
${ROOT} .bd-spinner {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: bd-spin 700ms linear infinite;
}

${ROOT} .bd-error,
${ROOT} .bd-notice {
  margin-top: 10px;
  padding: 8px 11px;
  border-radius: var(--bd-radius);
  font-size: 13px;
}
${ROOT} .bd-error {
  border: 1px solid color-mix(in srgb, var(--bd-danger) 35%, transparent);
  background: color-mix(in srgb, var(--bd-danger) 10%, var(--bd-bg));
  color: var(--bd-danger);
}
${ROOT} .bd-notice {
  border: 1px solid color-mix(in srgb, var(--bd-accent) 30%, transparent);
  background: color-mix(in srgb, var(--bd-accent) 8%, var(--bd-bg));
  color: var(--bd-accent);
}
${ROOT} .bd-confirm {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 18px 14px;
  padding: 10px 12px;
  border-radius: var(--bd-radius);
  border: 1px solid color-mix(in srgb, var(--bd-danger) 35%, transparent);
  background: color-mix(in srgb, var(--bd-danger) 10%, var(--bd-bg));
  font-size: 13px;
}
${ROOT} .bd-confirm-spacer { margin-left: auto; }
${ROOT} .bd-foot-errors { padding: 0 18px 14px; }
${ROOT} .bd-foot-errors .bd-error:first-child { margin-top: 0; }

${ROOT} .bd-sent { padding: 18px 18px 6px; text-align: center; }
${ROOT} .bd-sent-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-bottom: 12px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bd-accent) 14%, var(--bd-bg));
  color: var(--bd-accent);
}
${ROOT} .bd-sent-code { font-size: 16px; font-weight: 600; }
${ROOT} .bd-sent-body { margin-top: 6px; color: var(--bd-muted); font-size: 13px; }
${ROOT} .bd-link { color: var(--bd-accent); font-weight: 600; text-decoration: none; }
${ROOT} .bd-link:hover { text-decoration: underline; }

@media (max-width: 480px) {
  ${ROOT}.bd-scrim { padding: 0; }
  ${ROOT} .bd-dialog {
    width: 100%;
    height: 100%;
    max-height: none;
    border: 0;
    border-radius: 0;
  }
}
`;
