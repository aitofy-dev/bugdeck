/**
 * The dialog frame: scrim, header, scrolling body, pinned footer.
 *
 * Separate from what it contains because the composer, the confirmation and
 * the "Sent" screen are three bodies inside one frame, and the frame is where
 * every accessibility rule lives (focus trap, `aria-modal`, scroll lock, Esc).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { imagesFromClipboard, WIDGET_ROOT_ATTR } from './capture.js';
import { Icon } from './icons.js';
import { accentStyle, themeAttrs, type WidgetTheme } from './theme.js';
import { useWidgetStyles } from './styles/sheet.js';
import { useFocusTrap, useScrollLock } from './use-focus-trap.js';

export interface ModalShellProps {
  zIndex: number;
  theme: WidgetTheme;
  accent?: string;
  heading: string;
  /**
   * Escape · a click on the scrim · the ✕. ONE handler for all three: they are
   * the same gesture ("get this off my screen"), and letting them mean
   * different things is how a user loses work by pressing the wrong exit.
   */
  onDismiss: () => void;
  /** Names the ✕ for a screen reader. Omitted means no ✕ at all. */
  dismissLabel?: string;
  onPaste?: (files: File[]) => void;
  /** Off while a full-screen editor sits on top: Escape belongs to that one. */
  closeOnEscape?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

export function ModalShell({
  zIndex,
  theme,
  accent,
  heading,
  onDismiss,
  dismissLabel,
  onPaste,
  closeOnEscape = true,
  footer,
  children,
}: ModalShellProps) {
  const dialog = useRef<HTMLDivElement>(null);
  useWidgetStyles();
  useScrollLock();
  useFocusTrap(dialog);

  useEffect(() => {
    if (!closeOnEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeOnEscape, onDismiss]);

  return (
    <div
      {...{ [WIDGET_ROOT_ATTR]: '' }}
      {...themeAttrs(theme)}
      className="bd-scrim"
      style={{ zIndex, ...accentStyle(accent) }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        className="bd-dialog"
        onPaste={(event) => onPaste?.(imagesFromClipboard(event.clipboardData?.items))}
      >
        <div className="bd-head">
          <h2 className="bd-title">{heading}</h2>
          {dismissLabel && (
            <button
              type="button"
              className="bd-icon-btn"
              aria-label={dismissLabel}
              onClick={onDismiss}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="bd-body">{children}</div>
        {footer}
      </div>
    </div>
  );
}
