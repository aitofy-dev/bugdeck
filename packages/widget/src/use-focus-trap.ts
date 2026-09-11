/**
 * Keeping the keyboard inside the dialog, and the page still behind it.
 *
 * Tab is handled rather than merely wrapped at the edges: the widget mounts
 * into apps full of `tabindex` of their own, and "where does Tab go next" has
 * to be answered from the dialog's own list or it eventually answers "the host
 * app's sidebar".
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Pure: the element Tab (or Shift+Tab) should land on, wrapping at both ends. */
export function nextFocusTarget<T>(
  items: readonly T[],
  active: T | null,
  backwards: boolean,
): T | null {
  if (!items.length) return null;
  const index = active ? items.indexOf(active) : -1;
  const last = items.length - 1;
  if (backwards) return items[index <= 0 ? last : index - 1] ?? null;
  return items[index === -1 || index === last ? 0 : index + 1] ?? null;
}

export function useFocusTrap(container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const restoreTo = document.activeElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      const target = nextFocusTarget(
        items,
        items.find((item) => item === document.activeElement) ?? null,
        event.shiftKey,
      );
      if (!target) return;
      event.preventDefault();
      target.focus();
    };

    node.addEventListener('keydown', onKeyDown);
    if (!node.contains(document.activeElement)) {
      node.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) restoreTo.focus();
    };
  }, [container]);
}

/** The page must not scroll under a modal; the host's own value is put back. */
export function useScrollLock(): void {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
}
