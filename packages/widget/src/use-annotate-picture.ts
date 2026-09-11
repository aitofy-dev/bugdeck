/**
 * Loading the file being drawn on, and nothing else.
 *
 * Split out because the load has one hard-won rule in it (see the `cancelled`
 * flag) that has nothing to do with drawing, cropping or exporting.
 */
import { useEffect, useState } from 'react';

/**
 * The picture as it currently stands: the uploaded file at first, a cropped
 * canvas afterwards. Carries its own size — `CanvasImageSource` does not.
 */
export interface Picture {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface LoadedPicture {
  picture: Picture | null;
  setPicture: (picture: Picture) => void;
  /** The image could not be decoded; the caller words it. */
  failed: boolean;
}

export function useAnnotatePicture(file: File): LoadedPicture {
  const [picture, setPicture] = useState<Picture | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // A superseded load must stay silent. Under StrictMode the effect runs, is
    // torn down and runs again; the teardown revokes the first object URL while
    // its image is still loading, and that image then fires `error` — which
    // showed "could not open this image" over a picture that had loaded fine.
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      setFailed(false);
      setPicture({
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => {
      if (!cancelled) setFailed(true);
    };
    image.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return { picture, setPicture, failed };
}
