/**
 * useCullingPreview - resolves the right-pane preview for the culling loupe.
 *
 * Extracted verbatim from CullingModule. Owns the preview URL/loading/error
 * state and the folder nonce that forces an in-place re-export of the current
 * file to reload. JPEGs are stat-settled + cache-busted; RAW files go through
 * the NEF->JPG conversion pipeline (debounced), with the next RAW prefetched.
 *
 * The folder-watch handler in the shell calls `bumpPreview()` so an on-disk
 * change to the current file re-checks it.
 *
 * @param {object} api - backend client (post()).
 * @param {string|undefined} currentPath - path of the selected file.
 * @param {Array} files - the current file list (for RAW prefetch).
 * @param {number} currentIndex - index of the selected file (for RAW prefetch).
 * @returns {{ previewUrl: string|null, previewLoading: boolean,
 *             previewError: string|null, bumpPreview: () => void }}
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { t } from '../../../i18n/index.js';
import { toFileUrl, bustedFileUrl } from '../../shared/fileUrl.js';
import { isRaw } from './cullingQueryUtils.js';

// Delay RAW conversion until the selection settles, so fast keyboard stepping
// only converts the file the user rests on, not every file passed through.
const PREVIEW_DEBOUNCE_MS = 150;
// Delay before showing a loading indicator on a new JPEG selection — an
// already-settled file resolves faster than this, so stepping through old
// photos never flashes a placeholder; only a fresh, still-writing file waits.
const PREVIEW_LOADING_DELAY_MS = 150;
// If a file is still being written when the stat settle-wait times out, wait
// this long before re-checking rather than swapping in a possibly-partial decode.
const PREVIEW_RECHECK_MS = 800;

export function useCullingPreview(api, currentPath, files, currentIndex) {
  // Resolved preview for the right pane. JPEGs load directly; RAW goes through
  // the NEF->JPG pipeline, so resolution is async.
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  // Bumped on every folder-change so the current JPEG preview re-checks the file
  // on disk — a Lightroom re-export overwrites it in place (same path), so this
  // is what lets the preview pick up the fresh bytes.
  const [folderNonce, setFolderNonce] = useState(0);
  const bumpPreview = useCallback(() => setFolderNonce((n) => n + 1), []);

  // Resolve the preview for a plain JPEG. We wait (in the main process) for the
  // file to finish being written before reading it, so a Lightroom export that's
  // still flushing can't decode into a truncated strip; then we cache-bust the
  // <img> URL by the file's mtime+size so a re-export in place reloads the fresh
  // bytes instead of the browser's cached (possibly stale) decode. Re-runs on
  // folderNonce so an in-place re-export of the current file is picked up.
  const lastPreviewPathRef = useRef(null);
  useEffect(() => {
    if (!currentPath) {
      lastPreviewPathRef.current = null;
      setPreviewUrl(null); setPreviewError(null); setPreviewLoading(false);
      return;
    }
    if (isRaw(currentPath)) {
      // RAW is handled by the conversion effect below. Clear the ref so returning
      // to a JPEG counts as a new path (the current frame is now the RAW preview,
      // not that JPEG) and doesn't keep showing the wrong photo.
      lastPreviewPathRef.current = null;
      return;
    }
    // A genuine selection change vs. a same-path folderNonce re-check (in-place
    // re-export). On a change we must not keep showing the previous photo; on a
    // re-check we keep the current frame so the update is seamless.
    const isNewPath = currentPath !== lastPreviewPathRef.current;
    lastPreviewPathRef.current = currentPath;
    let cancelled = false;
    setPreviewError(null);
    // Clear any loading state inherited from the previous selection (e.g. a RAW
    // conversion or a still-writing JPEG that left it true) so an already-settled
    // JPEG doesn't briefly show the placeholder. The delayed timer below re-sets
    // it only if this file's stat is actually slow.
    setPreviewLoading(false);
    // Only blank + show a loading indicator if the stat is slow (a fresh,
    // still-writing file). Already-settled files resolve first, so stepping
    // through old photos swaps without a flash.
    let loadingTimer = null;
    let recheckTimer = null;
    if (isNewPath) {
      loadingTimer = setTimeout(() => {
        if (!cancelled) { setPreviewUrl(null); setPreviewLoading(true); }
      }, PREVIEW_LOADING_DELAY_MS);
    }
    window.ansiktenAPI.invoke('stat-file-stable', { filePath: currentPath })
      .then((res) => {
        if (cancelled) return;
        if (loadingTimer) clearTimeout(loadingTimer);
        if (!res?.ok) {
          setPreviewLoading(false);
          setPreviewUrl(null);
          setPreviewError(res?.reason === 'not-found' ? t('culling.errors.fileNotFound') : t('culling.errors.fileUnreadable'));
          return;
        }
        if (res.settled === false) {
          // The settle-wait timed out while the file was still being written.
          // Don't swap in a possibly-truncated decode — keep the loading
          // indicator and re-check shortly (the ongoing write also bumps
          // folderNonce via the watcher, so this is a fallback either way).
          setPreviewLoading(true);
          recheckTimer = setTimeout(() => { if (!cancelled) setFolderNonce((n) => n + 1); }, PREVIEW_RECHECK_MS);
          return;
        }
        setPreviewLoading(false);
        setPreviewUrl(bustedFileUrl(currentPath, `${res.mtimeMs}-${res.size}`));
      })
      .catch((err) => {
        if (cancelled) return;
        if (loadingTimer) clearTimeout(loadingTimer);
        console.error('[Culling] preview stat failed:', err);
        setPreviewLoading(false);
        setPreviewUrl(null);
        setPreviewError(t('culling.errors.imageLoadFailed'));
      });
    return () => {
      cancelled = true;
      if (loadingTimer) clearTimeout(loadingTimer);
      if (recheckTimer) clearTimeout(recheckTimer);
    };
  }, [currentPath, folderNonce]);

  // Resolve the preview for a RAW file via the NEF conversion pipeline. The
  // cancelled guard prevents a slow conversion from painting over a newer
  // selection when the user steps quickly.
  useEffect(() => {
    if (!currentPath || !isRaw(currentPath)) return;
    let cancelled = false;
    setPreviewLoading(true); setPreviewError(null); setPreviewUrl(null);
    // Debounced: clearing the timer on a fast step cancels the POST before it
    // fires, so no abandoned conversions pile up behind the one the user lands on.
    const timer = setTimeout(() => {
      api.post('/api/v1/preprocessing/nef', { file_path: currentPath })
        .then((res) => {
          if (cancelled) return;
          if (res.status === 'error' || !res.nef_jpg_path) {
            setPreviewError(res.error || t('culling.errors.nefConvertFailed'));
          } else {
            setPreviewUrl(toFileUrl(res.nef_jpg_path));
          }
        })
        .catch((err) => { if (!cancelled) setPreviewError(err.message || String(err)); })
        .finally(() => { if (!cancelled) setPreviewLoading(false); });
    }, PREVIEW_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [currentPath, api]);

  // Prefetch the next RAW so stepping through is usually a cache hit - also
  // debounced, so a fast run of keypresses only warms the file after the rest.
  useEffect(() => {
    const next = files[currentIndex + 1];
    if (!next || !isRaw(next.path)) return;
    const timer = setTimeout(() => {
      api.post('/api/v1/preprocessing/nef', { file_path: next.path }).catch(() => {});
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [currentIndex, files, api]);

  return { previewUrl, previewLoading, previewError, bumpPreview };
}

export default useCullingPreview;
