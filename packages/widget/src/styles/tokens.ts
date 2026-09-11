/**
 * Design tokens and the reset, as CSS text.
 *
 * Light is declared unconditionally so a host that pins a colour scheme still
 * gets a complete palette; dark only re-declares what changes. Every rule is
 * scoped to a widget root, so host CSS and widget CSS cannot bleed either way.
 */
import { DEFAULT_ACCENT, THEME_ATTR } from '../theme.js';
import { WIDGET_ROOT_ATTR } from '../capture.js';

const ROOT = `[${WIDGET_ROOT_ATTR}]`;
const HOST = `[${THEME_ATTR}]`;

const DARK = `
  --bd-bg: #16181d;
  --bd-surface: #1e2128;
  --bd-fg: #e8eaed;
  --bd-muted: #9aa1ad;
  --bd-border: #2c313a;
  --bd-accent: #4d86f7;
  --bd-danger: #f87171;
  --bd-scrim: rgba(2, 5, 12, 0.74);
  --bd-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
`;

export const tokensCss = `
${HOST} {
  --bd-bg: #ffffff;
  --bd-surface: #f7f8fa;
  --bd-fg: #10131a;
  --bd-muted: #6b7280;
  --bd-border: #e3e6eb;
  --bd-accent: ${DEFAULT_ACCENT};
  --bd-accent-fg: #ffffff;
  --bd-danger: #dc2626;
  --bd-scrim: rgba(15, 23, 42, 0.55);
  --bd-radius: 10px;
  --bd-shadow: 0 16px 44px rgba(15, 23, 42, 0.22);
  --bd-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
}
@media (prefers-color-scheme: dark) {
  ${HOST}:not([${THEME_ATTR}="light"]) {${DARK}}
}
${HOST}[${THEME_ATTR}="dark"] {${DARK}}

${ROOT} {
  font-family: var(--bd-font);
  font-size: 14px;
  line-height: 1.5;
  font-weight: 400;
  letter-spacing: normal;
  text-align: left;
  color: var(--bd-fg);
  -webkit-font-smoothing: antialiased;
}
${ROOT} *,
${ROOT} *::before,
${ROOT} *::after { box-sizing: border-box; }
${ROOT} button,
${ROOT} textarea,
${ROOT} input {
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-transform: none;
  margin: 0;
}
${ROOT} button {
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}
${ROOT} button[disabled] { cursor: not-allowed; }
${ROOT} p, ${ROOT} h2, ${ROOT} figure, ${ROOT} figcaption { margin: 0; }
${ROOT} :focus-visible {
  outline: 2px solid var(--bd-accent);
  outline-offset: 2px;
  border-radius: 4px;
}
@media (prefers-reduced-motion: reduce) {
  ${ROOT} *, ${ROOT} *::before, ${ROOT} *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
