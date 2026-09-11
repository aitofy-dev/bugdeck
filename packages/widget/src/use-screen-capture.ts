/**
 * Taking the picture: the whole page, or the one element the user points at.
 *
 * Owns the phase as well, because "capturing" means the modal is unmounted —
 * the photograph must be of the user's page, not of our popup.
 */
import { useCallback, useState } from 'react';
import { captureScreenshot, type ToPng } from './capture.js';
import { describeError } from './describe-error.js';
import { formatString, type WidgetStrings } from './strings.js';

export type CapturePhase = 'editing' | 'picking' | 'capturing';

export interface ScreenCaptureOptions {
  /** What gets photographed. Defaults to `document.body`. */
  captureTarget?: () => HTMLElement | null;
  /** Test seam; production uses the lazily imported `html-to-image`. */
  toPng?: ToPng;
  strings: WidgetStrings;
  onShot: (file: File) => void;
  onError: (message: string | undefined) => void;
}

export interface ScreenCapture {
  phase: CapturePhase;
  /** True while a shot is being taken, so the toolbar can say so. */
  capturing: boolean;
  captureScreen: () => Promise<void>;
  startPicking: () => void;
  cancelPicking: () => void;
  pickElement: (element: HTMLElement) => Promise<void>;
}

/** Two frames: one for React to unmount the modal, one for the browser to paint without it. */
const afterModalHidden = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

export function useScreenCapture(options: ScreenCaptureOptions): ScreenCapture {
  const { captureTarget, toPng, strings, onShot, onError } = options;
  const [phase, setPhase] = useState<CapturePhase>('editing');
  const [capturing, setCapturing] = useState(false);

  const shoot = useCallback(
    async (target?: HTMLElement | null): Promise<void> => {
      const node = target ?? captureTarget?.() ?? document.body;
      if (!node) return;
      setCapturing(true);
      try {
        onShot(await captureScreenshot(node, { toPng, strings }));
      } catch (captureError) {
        // A tainted canvas or a cross-origin font kills the shot, not the report.
        console.warn('[bugdeck] capture failed', captureError);
        onError(
          formatString(strings.captureFailed, { reason: describeError(captureError, strings) }),
        );
      } finally {
        setCapturing(false);
      }
    },
    [captureTarget, onError, onShot, strings, toPng],
  );

  const captureScreen = useCallback(async () => {
    onError(undefined);
    setPhase('capturing');
    await afterModalHidden();
    try {
      await shoot();
    } finally {
      setPhase('editing');
    }
  }, [onError, shoot]);

  const pickElement = useCallback(
    async (element: HTMLElement) => {
      setPhase('editing');
      await shoot(element);
    },
    [shoot],
  );

  return {
    phase,
    capturing,
    captureScreen,
    startPicking: useCallback(() => {
      onError(undefined);
      setPhase('picking');
    }, [onError]),
    cancelPicking: useCallback(() => setPhase('editing'), []),
    pickElement,
  };
}
