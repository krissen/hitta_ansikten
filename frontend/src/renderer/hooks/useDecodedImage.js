/**
 * useDecodedImage - decode a URL into a ready-to-paint drawable.
 *
 * Turns an image URL (typically the `previewUrl` from useCullingPreview) into a
 * decoded drawable that <CanvasImageView> can paint: an ImageBitmap when the
 * platform supports `createImageBitmap` (already decoded, cheap to draw and to
 * hand to the canvas), otherwise the HTMLImageElement itself (with `decode()`
 * awaited so the first paint doesn't block).
 *
 * `imageOrientation: 'from-image'` bakes EXIF orientation into the bitmap so it
 * matches how Chromium draws an HTMLImageElement, keeping the two decode paths
 * visually identical.
 *
 * Cancellation: a URL change or unmount marks the in-flight decode stale. A
 * bitmap that finishes decoding after that point is closed immediately so it
 * cannot leak, and the committed drawable is closed when it is replaced or on
 * unmount. The previous frame is kept on screen while a new URL decodes so
 * stepping through files doesn't flash; a decode error clears it.
 *
 * @param {string|null|undefined} url - the image URL to decode.
 * @returns {{ image: (ImageBitmap|HTMLImageElement|null), loading: boolean,
 *             error: Error|null }}
 */
import { useState, useEffect } from 'react';

export function useDecodedImage(url) {
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!url) {
      // No source: drop any current drawable (the [image] effect closes it).
      setImage(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Keep the previous frame visible while this URL decodes (seamless steps);
    // only success or error swaps it out.
    let cancelled = false;
    setLoading(true);
    setError(null);

    const img = new Image();

    const finalize = async () => {
      // Already stale (the user stepped past this file before onload ran):
      // skip the decode entirely — createImageBitmap on a full-res photo is
      // exactly the expensive work cancellation exists to avoid.
      if (cancelled) return;

      let drawable = img;
      try {
        if (typeof createImageBitmap === 'function') {
          drawable = await createImageBitmap(img, {
            imageOrientation: 'from-image',
          });
        } else if (typeof img.decode === 'function') {
          await img.decode();
        }
      } catch {
        // createImageBitmap/decode can fail on odd inputs; fall back to the raw
        // element, which onload already guarantees is drawable.
        drawable = img;
      }

      if (cancelled) {
        // A newer URL (or unmount) won while decoding: never commit a stale
        // drawable, and close the bitmap we just created so it can't leak.
        if (drawable !== img && typeof drawable.close === 'function')
          drawable.close();
        return;
      }

      setImage(drawable);
      setLoading(false);
    };

    img.onload = () => {
      finalize();
    };
    img.onerror = () => {
      if (cancelled) return;
      setImage(null);
      setLoading(false);
      setError(new Error(`Failed to decode image: ${url}`));
    };

    img.src = url;

    return () => {
      cancelled = true;
      // Abort the in-flight load (standard idiom: detach handlers and blank
      // src) so the browser stops fetching/decoding a file the user already
      // stepped past, instead of finishing it just to be discarded.
      img.onload = null;
      img.onerror = null;
      img.src = '';
    };
  }, [url]);

  // Close the committed drawable when it is replaced or on unmount.
  // HTMLImageElement has no close(); the guard keeps the fallback path safe.
  useEffect(() => {
    return () => {
      if (image && typeof image.close === 'function') image.close();
    };
  }, [image]);

  return { image, loading, error };
}

export default useDecodedImage;
