/**
 * ReviewModule - React component for reviewing detected faces
 *
 * Features:
 * - Displays detected faces in a grid
 * - Keyboard navigation (Tab, Arrow keys, 1-9)
 * - Confirm/Ignore actions (A/Enter, I)
 * - Autocomplete for person names
 * - Batch mode with auto-save
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useModuleEvent, useEmitEvent } from '../hooks/useModuleEvent.js';
import { useBackend } from '../context/BackendContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { debug, debugWarn, debugError } from '../shared/debug.js';
import { NetworkError } from '../shared/api-client.js';
import { preferences } from '../workspace/preferences.js';
import { useThumbnail } from '../shared/thumbnail-cache.js';
import { Icon } from './Icon.jsx';
import { t } from '../../i18n/index.js';
import './ReviewModule.css';

/**
 * Hook for calculating dropdown position with flip logic.
 * Renders dropdown below input if space available, otherwise above.
 * @param {boolean} open - Whether dropdown is open
 * @param {HTMLElement|null} anchorEl - The input element to anchor to
 * @param {Object} options - Configuration options
 * @returns {Object} Style object for the dropdown
 */
function useDropdownPosition(open, anchorEl, { maxHeight = 200, gap = 4 } = {}) {
  const [style, setStyle] = useState({ display: 'none' });

  useEffect(() => {
    if (!open || !anchorEl) {
      setStyle({ display: 'none' });
      return;
    }

    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      const spaceBelow = viewportHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;

      const placeAbove = spaceBelow < maxHeight && spaceAbove > spaceBelow;
      const availableHeight = placeAbove ? Math.min(spaceAbove, maxHeight) : Math.min(spaceBelow, maxHeight);

      const newStyle = {
        position: 'fixed',
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        maxHeight: `${availableHeight}px`,
        zIndex: 10001,
      };

      if (placeAbove) {
        newStyle.bottom = `${viewportHeight - rect.top + gap}px`;
        newStyle.top = 'auto';
      } else {
        newStyle.top = `${rect.bottom + gap}px`;
        newStyle.bottom = 'auto';
      }

      setStyle(newStyle);
    };

    updatePosition();

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, anchorEl, maxHeight, gap]);

  return style;
}

/**
 * ReviewModule Component
 */
export function ReviewModule({ node }) {
  const { api } = useBackend();
  const emit = useEmitEvent();
  const showToast = useToast();

  // State
  const [currentImagePath, setCurrentImagePath] = useState(null);
  const [currentFileHash, setCurrentFileHash] = useState(null);
  const [detectedFaces, setDetectedFaces] = useState([]);
  // True only after a detection completed successfully (0 or more faces). Gates
  // the "no faces — add a name manually" affordance so it never appears on a
  // detection error or before an image has actually been detected.
  const [detectionOk, setDetectionOk] = useState(false);
  const [people, setPeople] = useState([]);
  const [currentFaceIndex, setCurrentFaceIndex] = useState(0);
  const [pendingConfirmations, setPendingConfirmations] = useState([]);
  const [pendingIgnores, setPendingIgnores] = useState([]);
  const [status, setStatus] = useState(t('review.status.waitingForImage'));
  const [isLoading, setIsLoading] = useState(false);
  const [clearInputTrigger, setClearInputTrigger] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [queueStatus, setQueueStatus] = useState(null);

  // Refs
  const moduleRef = useRef(null);
  const gridRef = useRef(null);
  const inputRefs = useRef({});
  const cardRefs = useRef({});
  const detectAbortRef = useRef(null);
  const detectedFacesRef = useRef(detectedFaces);

  // Keep detectedFacesRef in sync with state (for use in timeout callbacks)
  useEffect(() => { detectedFacesRef.current = detectedFaces; }, [detectedFaces]);

  /**
   * Load people names for autocomplete
   */
  const loadPeopleNames = useCallback(async () => {
    try {
      const response = await api.get('/api/v1/database/people/names');
      setPeople(response || []);
    } catch (err) {
      debugError('ReviewModule', 'Failed to load people names:', err);
    }
  }, [api]);

  // Load people names on mount
  useEffect(() => {
    loadPeopleNames();
  }, [loadPeopleNames]);

  const detectFaces = useCallback(async (imagePath) => {
    if (detectAbortRef.current) {
      detectAbortRef.current.abort();
    }
    const abortController = new AbortController();
    detectAbortRef.current = abortController;

    setCurrentImagePath(imagePath);
    setCurrentFileHash(null);
    setIsLoading(true);
    setStatus(t('review.status.detecting'));
    setDetectedFaces([]);
    setDetectionOk(false);
    setCurrentFaceIndex(0);
    setPendingConfirmations([]);
    setPendingIgnores([]);
    setUndoStack([]);

    try {
      const result = await api.post(
        '/api/v1/detect-faces',
        { image_path: imagePath, force_reprocess: false },
        { signal: abortController.signal }
      );

      if (abortController.signal.aborted) return;

      const faces = result.faces || [];
      setDetectedFaces(faces);
      setDetectionOk(true);
      setCurrentFileHash(result.file_hash || null);
      setStatus(t('review.status.found', { count: faces.length, ms: result.processing_time_ms?.toFixed(0) || 0 }));

      emit('faces-detected', { faces, imagePath });

      if (faces.length > 0) {
        setTimeout(() => {
          moduleRef.current?.focus();
        }, 100);
      } else {
        const fileName = imagePath.split('/').pop();
        showToast(t('review.toasts.noFacesFound', { fileName }), 'info');
        // Keep focus on the module so the manual-name affordance is reachable
        // (button + the 'm' shortcut) instead of the panel losing focus.
        setTimeout(() => {
          moduleRef.current?.focus();
        }, 100);
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        setStatus(t('review.status.detectionCancelled'));
        return;
      }
      debugError('ReviewModule', 'Face detection failed:', err);
      if (err instanceof NetworkError) {
        const msg = err.isOffline ? t('review.toasts.backendUnreachable') : err.message;
        showToast(msg, 'error');
        setStatus(t('review.status.connectionError'));
      } else {
        setStatus(t('review.status.detectionFailed'));
      }
    } finally {
      if (detectAbortRef.current === abortController) {
        detectAbortRef.current = null;
      }
      setIsLoading(false);
    }
  }, [api, emit, showToast]);

  /**
   * Navigate to face
   */
  const navigateToFace = useCallback((direction, skipIndex = null) => {
    if (detectedFaces.length === 0) return;

    setCurrentFaceIndex(prev => {
      let newIndex = prev + direction;

      if (newIndex >= detectedFaces.length) newIndex = 0;
      if (newIndex < 0) newIndex = detectedFaces.length - 1;

      // Skip confirmed faces AND explicitly skipped index (handles stale closure)
      let attempts = 0;
      while ((detectedFaces[newIndex]?.is_confirmed || newIndex === skipIndex) && attempts < detectedFaces.length) {
        newIndex += direction;
        if (newIndex >= detectedFaces.length) newIndex = 0;
        if (newIndex < 0) newIndex = detectedFaces.length - 1;
        attempts++;
      }

      // Only emit if we found an unconfirmed face (avoid centering on old face when all done)
      const targetFace = detectedFaces[newIndex];
      if (targetFace && !targetFace.is_confirmed) {
        emit('active-face-changed', { index: newIndex });
      }
      return newIndex;
    });
  }, [detectedFaces, emit]);

  const HIGH_CONFIDENCE_THRESHOLD = 75;

  const getTopMatch = useCallback((face) => {
    if (!face?.match_alternatives?.length) return null;
    const top = face.match_alternatives[0];
    if (top.confidence >= HIGH_CONFIDENCE_THRESHOLD && !top.is_ignored) {
      return { name: top.name, confidence: top.confidence };
    }
    return null;
  }, []);

  const doConfirmFace = useCallback((index, personName) => {
    const face = detectedFaces[index];
    if (!face || face.is_confirmed) return;

    setUndoStack(prev => [...prev, { type: 'confirm', index, face: { ...face } }]);

    const updatedFaces = [...detectedFaces];
    updatedFaces[index] = { ...updatedFaces[index], is_confirmed: true, person_name: personName.trim() };

    setDetectedFaces(updatedFaces);

    emit('faces-detected', { faces: updatedFaces, imagePath: currentImagePath });

    setPendingConfirmations(prev => {
      const existing = prev.findIndex(p => p.face_id === face.face_id);
      const suggestedName = face.person_name || null;
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], person_name: personName.trim() };
        return updated;
      }
      return [...prev, {
        face_id: face.face_id,
        person_name: personName.trim(),
        image_path: currentImagePath,
        suggested_name: suggestedName !== personName.trim() ? suggestedName : null
      }];
    });

    // Skip navigation if all faces will be done - auto-save will handle transition
    const willAllBeDone = detectedFaces.every((f, i) =>
      i === index || f.is_confirmed || f.is_rejected
    );
    if (!willAllBeDone) {
      navigateToFace(1, index);
    }
  }, [detectedFaces, currentImagePath, navigateToFace, emit]);

  const doIgnoreFace = useCallback((index) => {
    const face = detectedFaces[index];
    if (!face || face.is_confirmed) return;

    setUndoStack(prev => [...prev, { type: 'ignore', index, face: { ...face } }]);

    const updatedFaces = [...detectedFaces];
    updatedFaces[index] = { ...updatedFaces[index], is_confirmed: true, is_rejected: true, person_name: '(ignored)' };

    setDetectedFaces(updatedFaces);

    emit('faces-detected', { faces: updatedFaces, imagePath: currentImagePath });

    setPendingIgnores(prev => {
      if (prev.some(p => p.face_id === face.face_id)) return prev;
      return [...prev, { face_id: face.face_id, image_path: currentImagePath }];
    });

    // Skip navigation if all faces will be done - auto-save will handle transition
    const willAllBeDone = detectedFaces.every((f, i) =>
      i === index || f.is_confirmed || f.is_rejected
    );
    if (!willAllBeDone) {
      navigateToFace(1, index);
    }
  }, [detectedFaces, currentImagePath, navigateToFace, emit]);

  const confirmFace = useCallback((index, personName) => {
    if (!personName?.trim()) return;

    const face = detectedFaces[index];
    if (!face || face.is_confirmed) return;

    const topMatch = getTopMatch(face);
    if (topMatch && topMatch.name.toLowerCase() !== personName.trim().toLowerCase()) {
      setConfirmDialog({
        type: 'name-mismatch',
        topMatch,
        chosenName: personName.trim(),
        onConfirm: () => {
          doConfirmFace(index, personName);
          setConfirmDialog(null);
        },
        onCancel: () => setConfirmDialog(null)
      });
      return;
    }

    doConfirmFace(index, personName);
  }, [detectedFaces, getTopMatch, doConfirmFace]);

  const ignoreFace = useCallback((index) => {
    const face = detectedFaces[index];
    if (!face || face.is_confirmed) return;

    const topMatch = getTopMatch(face);
    if (topMatch) {
      setConfirmDialog({
        type: 'ignore-high-confidence',
        topMatch,
        onConfirm: () => {
          doIgnoreFace(index);
          setConfirmDialog(null);
        },
        onCancel: () => setConfirmDialog(null)
      });
      return;
    }

    doIgnoreFace(index);
  }, [detectedFaces, getTopMatch, doIgnoreFace]);

  const cancelDetection = useCallback(() => {
    if (detectAbortRef.current) {
      detectAbortRef.current.abort();
      detectAbortRef.current = null;
    }
  }, []);

  const undoLastAction = useCallback(() => {
    if (undoStack.length === 0) return null;

    const lastAction = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));

    const { type, index, face } = lastAction;

    debug('ReviewModule', 'Undo action:', type, 'face:', face.face_id);

    const updatedFaces = [...detectedFaces];
    updatedFaces[index] = { ...face };
    setDetectedFaces(updatedFaces);

    emit('faces-detected', { faces: updatedFaces, imagePath: currentImagePath });

    if (type === 'confirm') {
      setPendingConfirmations(prev => prev.filter(p => p.face_id !== face.face_id));
    } else if (type === 'ignore') {
      setPendingIgnores(prev => prev.filter(p => p.face_id !== face.face_id));
    }

    setCurrentFaceIndex(index);
    emit('active-face-changed', { index });

    return lastAction;
  }, [undoStack, detectedFaces, currentImagePath, emit]);

  /**
   * Unconfirm a face - revert to unconfirmed state for re-review
   */
  const unconfirmFace = useCallback((index) => {
    const face = detectedFaces[index];
    if (!face || !face.is_confirmed) return;

    debug('ReviewModule', 'Unconfirming face at index:', index);

    // Create updated faces array for both state and event
    const updatedFaces = [...detectedFaces];
    const originalFace = updatedFaces[index];
    updatedFaces[index] = {
      ...originalFace,
      is_confirmed: false,
      is_rejected: false,
      person_name: originalFace._original_person_name || null
    };

    setDetectedFaces(updatedFaces);

    // Emit updated faces to sync ImageViewer
    emit('faces-detected', { faces: updatedFaces, imagePath: currentImagePath });

    setPendingConfirmations(prev => prev.filter(p => p.face_id !== face.face_id));
    setPendingIgnores(prev => prev.filter(p => p.face_id !== face.face_id));

    setCurrentFaceIndex(index);
    emit('active-face-changed', { index });

    setTimeout(() => {
      inputRefs.current[index]?.focus();
    }, 50);
  }, [detectedFaces, currentImagePath, emit]);

  /**
   * Accept all suggestions - confirm/ignore all unconfirmed faces using their top suggestion
   */
  const acceptAllSuggestions = useCallback(() => {
    let accepted = 0;
    let ignored = 0;
    let skipped = 0;
    const confirmations = [];
    const ignores = [];

    const updatedFaces = detectedFaces.map((face) => {
      if (face.is_confirmed) return face;

      const firstAlt = face.match_alternatives?.[0];
      if (!firstAlt) {
        skipped++;
        return face;
      }

      if (firstAlt.is_ignored || firstAlt.name === 'ign') {
        ignored++;
        if (face.face_id) {
          ignores.push({ face_id: face.face_id, image_path: currentImagePath });
        }
        return { ...face, is_confirmed: true, is_rejected: true, person_name: '(ignored)' };
      }

      const trimmedName = firstAlt.name?.trim() || firstAlt.name;
      accepted++;

      if (face.face_id) {
        const suggestedName = face.person_name || null;
        confirmations.push({
          face_id: face.face_id,
          person_name: trimmedName,
          image_path: currentImagePath,
          suggested_name: suggestedName && suggestedName.toLowerCase() !== trimmedName.toLowerCase()
            ? suggestedName
            : null
        });
      }

      return { ...face, is_confirmed: true, is_rejected: false, person_name: trimmedName };
    });

    if (confirmations.length > 0 || ignores.length > 0) {
      setDetectedFaces(updatedFaces);
      emit('faces-detected', { faces: updatedFaces, imagePath: currentImagePath });

      setPendingConfirmations((prev) => {
        if (confirmations.length === 0) return prev;
        const next = [...prev];
        confirmations.forEach((confirmation) => {
          const existingIndex = next.findIndex(item => item.face_id === confirmation.face_id);
          if (existingIndex >= 0) {
            next[existingIndex] = { ...next[existingIndex], person_name: confirmation.person_name, suggested_name: confirmation.suggested_name };
          } else {
            next.push(confirmation);
          }
        });
        return next;
      });

      setPendingIgnores((prev) => {
        if (ignores.length === 0) return prev;
        const next = [...prev];
        ignores.forEach((ignoreEntry) => {
          if (!next.some(item => item.face_id === ignoreEntry.face_id)) {
            next.push(ignoreEntry);
          }
        });
        return next;
      });
    }

    setStatus(
      t('review.status.accepted', { accepted, ignored }) +
      (skipped > 0 ? t('review.status.acceptedSkippedSuffix', { skipped }) : '')
    );
  }, [detectedFaces, currentImagePath, emit]);

  /**
   * Build reviewedFaces array for rename functionality
   */
  const buildReviewedFaces = useCallback(() => {
    return detectedFaces.map((face, index) => ({
      faceIndex: index,
      faceId: face.face_id,
      encodingHash: face.encoding_hash,  // Permanent identifier for undo/rename operations
      personName: face.is_confirmed && !face.is_rejected ? face.person_name : null,
      isIgnored: face.is_rejected || false
    }));
  }, [detectedFaces]);

  /**
   * Mark review as complete (logs to attempt_stats.jsonl for rename)
   */
  const markReviewComplete = useCallback(async (imagePath, reviewedFaces, fileHash = null) => {
    try {
      await api.post('/api/v1/mark-review-complete', {
        image_path: imagePath,
        reviewed_faces: reviewedFaces.map(f => ({
          face_index: f.faceIndex,
          face_id: f.faceId,
          encoding_hash: f.encodingHash,  // Permanent identifier (face_id is ephemeral)
          person_name: f.personName,
          is_ignored: f.isIgnored
        })),
        file_hash: fileHash  // Reuse hash from detection to avoid re-reading file
      });
      debug('ReviewModule', 'Review marked complete for rename');
    } catch (err) {
      debugError('ReviewModule', 'Failed to mark review complete:', err);
      // Non-fatal - continue even if this fails
    }
  }, [api]);

  /**
   * Save all changes
   * @returns {Promise<boolean>} true if save succeeded, false if failed
   */
  const saveAllChanges = useCallback(async () => {
    if (pendingConfirmations.length === 0 && pendingIgnores.length === 0) return true;

    const totalChanges = pendingConfirmations.length + pendingIgnores.length;
    setStatus(t('review.status.saving', { count: totalChanges }));

    try {
      // Batch save: single request instead of N individual calls
      await api.post('/api/v1/batch-confirm', {
        confirmations: pendingConfirmations,
        ignores: pendingIgnores
      });

      setPendingConfirmations([]);
      setPendingIgnores([]);
      await loadPeopleNames();
      setStatus(t('review.status.saved', { count: totalChanges }));
      return true;
    } catch (err) {
      debugError('ReviewModule', 'Failed to save:', err);
      setStatus(t('review.status.saveError'));
      return false;
    }
  }, [pendingConfirmations, pendingIgnores, api, loadPeopleNames]);

  /**
   * Discard all changes
   */
  const discardChanges = useCallback(() => {
    if (pendingConfirmations.length === 0 && pendingIgnores.length === 0) return;

    if (!confirm(t('review.dialog.discardConfirm', { count: pendingConfirmations.length + pendingIgnores.length }))) return;

    // Reset face states
    setDetectedFaces(prev => prev.map(face => {
      if (face.is_rejected || face.is_confirmed) {
        return { ...face, is_confirmed: false, is_rejected: false, person_name: null };
      }
      return face;
    }));

    setPendingConfirmations([]);
    setPendingIgnores([]);
    setStatus(t('review.status.changesDiscarded'));
  }, [pendingConfirmations.length, pendingIgnores.length]);

  /**
   * Skip image - save pending changes and advance to next image
   */
  const skipImage = useCallback(async () => {
    if (!currentImagePath) return;

    debug('ReviewModule', 'Skipping image:', currentImagePath);

    // Save any pending changes first
    if (pendingConfirmations.length > 0 || pendingIgnores.length > 0) {
      const saveSuccess = await saveAllChanges();
      if (!saveSuccess) {
        // Don't proceed if save failed - user needs to retry or discard
        return;
      }
    }

    // Build reviewed faces for rename functionality
    const reviewedFaces = buildReviewedFaces();

    // Mark review complete (logs to attempt_stats.jsonl)
    await markReviewComplete(currentImagePath, reviewedFaces, currentFileHash);

    // Emit review-complete to advance to next image
    emit('review-complete', {
      imagePath: currentImagePath,
      facesReviewed: detectedFaces.filter(f => f.is_confirmed).length,
      skipped: true,
      success: true,
      reviewedFaces
    });

    setStatus(t('review.status.imageSkipped'));
  }, [currentImagePath, pendingConfirmations.length, pendingIgnores.length, saveAllChanges, buildReviewedFaces, markReviewComplete, emit, detectedFaces, currentFileHash]);

  /**
   * Add manual face - for when a person exists but wasn't detected
   */
  const addManualFace = useCallback(() => {
    if (!currentImagePath) return;

    const insertIndex = detectedFaces.length === 0 ? 0 : currentFaceIndex + 1;
    debug('ReviewModule', 'Adding manual face at index:', insertIndex, '(faces:', detectedFaces.length, ')');

    const manualFaceId = `manual_${Date.now()}`;
    const manualFace = {
      face_id: manualFaceId,
      bounding_box: null,
      confidence: null,
      person_name: '',
      is_manual: true,
      is_confirmed: false
    };

    setDetectedFaces(prev => {
      const updated = [...prev];
      updated.splice(insertIndex, 0, manualFace);

      // Sync updated faces array to ImageViewer so indices stay aligned
      setTimeout(() => {
        emit('faces-detected', { faces: updated, imagePath: currentImagePath });
      }, 0);

      return updated;
    });

    setCurrentFaceIndex(insertIndex);
    emit('active-face-changed', { index: insertIndex });

    setTimeout(() => {
      inputRefs.current[insertIndex]?.focus();
    }, 100);

    setStatus(t('review.status.manualFaceAdded'));
  }, [currentImagePath, currentFaceIndex, detectedFaces.length, emit]);

  /**
   * Auto-save when all faces reviewed
   */
  useEffect(() => {
    const allDone = detectedFaces.length > 0 && detectedFaces.every(f => f.is_confirmed || f.is_rejected);
    const hasChanges = pendingConfirmations.length > 0 || pendingIgnores.length > 0;

    if (allDone && hasChanges) {
      const timeout = setTimeout(async () => {
        // Re-check with current ref — new faces may have been added since timeout was scheduled
        const currentFaces = detectedFacesRef.current;
        const stillAllDone = currentFaces.length > 0 &&
          currentFaces.every(f => f.is_confirmed || f.is_rejected);
        if (!stillAllDone) return;

        const saveSuccess = await saveAllChanges();
        if (!saveSuccess) {
          // Don't proceed if save failed - user needs to retry or discard
          return;
        }

        // Build reviewed faces for rename functionality
        const reviewedFaces = buildReviewedFaces();

        // Mark review complete (logs to attempt_stats.jsonl)
        await markReviewComplete(currentImagePath, reviewedFaces, currentFileHash);

        // Emit review-complete event for FileQueue auto-advance
        emit('review-complete', {
          imagePath: currentImagePath,
          facesReviewed: detectedFaces.length,
          success: true,
          reviewedFaces
        });
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [detectedFaces, pendingConfirmations, pendingIgnores, saveAllChanges, buildReviewedFaces, markReviewComplete, emit, currentImagePath, currentFileHash]);

  /**
   * Signal "dirty" state for the current file so the file queue can hold it out of
   * rename until the review is persisted. Pending confirmations/ignores are cleared
   * only after the batch save succeeds, so a non-empty pending set is exactly the
   * window where the database has not yet caught up with the user's edits — renaming
   * during it would drop a just-added (but unsaved) manual face from the filename.
   */
  useEffect(() => {
    if (!currentImagePath) return;
    const dirty = pendingConfirmations.length + pendingIgnores.length > 0;
    emit('review-dirty', { imagePath: currentImagePath, dirty });
  }, [pendingConfirmations.length, pendingIgnores.length, currentImagePath, emit]);

  /**
   * Clear the dirty flag for a file when the user leaves it (manual file switch that
   * bypasses saveAllChanges), so a file is never stuck unrenamable. review-complete
   * also clears it on the normal save path.
   */
  useEffect(() => {
    const leftPath = currentImagePath;
    return () => {
      if (leftPath) emit('review-dirty', { imagePath: leftPath, dirty: false });
    };
  }, [currentImagePath, emit]);

  /**
   * Update status when pending changes
   */
  useEffect(() => {
    if (detectedFaces.length === 0) return;

    const reviewedCount = detectedFaces.filter(f => f.is_confirmed).length;
    const pendingCount = pendingConfirmations.length + pendingIgnores.length;

    if (pendingCount > 0) {
      setStatus(t('review.status.reviewProgress', { reviewed: reviewedCount, total: detectedFaces.length, pending: pendingCount }));
    }
  }, [detectedFaces, pendingConfirmations.length, pendingIgnores.length]);

  /**
   * Auto-scroll active face when navigating (but don't focus input)
   */
  useEffect(() => {
    const cardEl = cardRefs.current[currentFaceIndex];
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    // Note: We don't auto-focus the input anymore - user must press 'r' to type
  }, [currentFaceIndex]);

  /**
   * Ask the file queue to soft-delete the file currently under review (and
   * advance). The path is passed explicitly so the queue trashes exactly the
   * file being reviewed — the queue module stays mounted in other layouts (e.g.
   * culling), where its own "current file" ref is stale. Routing delete from
   * here (a review-only, visibility-gated surface) instead of a global menu
   * accelerator keeps culling's own Cmd+Backspace intact and never trashes the
   * wrong file. Deleting discards any unsaved review of that file (it's gone).
   */
  const requestDeleteCurrentFile = useCallback(() => {
    if (!currentImagePath) return;
    emit('file-queue:trash', { imagePath: currentImagePath });
  }, [currentImagePath, emit]);

  /**
   * Keyboard handler
   * Shortcuts active when ReviewModule is visible (rendered in DOM)
   * Blocked in input fields and modules that capture keyboard (Preferences, etc.)
   */
  useEffect(() => {
    const handleKeyboard = (e) => {
      // Skip keyboard handling when this tab is hidden in FlexLayout
      if (node && !node.isVisible()) return;

      const activeEl = document.activeElement;
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
      const inBlockingModule =
        activeEl?.closest('.log-viewer') !== null ||
        activeEl?.closest('.preferences-module') !== null ||
        activeEl?.closest('.database-management') !== null ||
        activeEl?.closest('.theme-editor') !== null;

      if (inBlockingModule) {
        return;
      }

      if (e.key === 'ArrowDown' && !isInput) {
        e.preventDefault();
        navigateToFace(1);
        return;
      }

      if (e.key === 'ArrowUp' && !isInput) {
        e.preventDefault();
        navigateToFace(-1);
        return;
      }

      // Number keys - select alternative (1-N) for current face
      const maxAlt = preferences.get('reviewModule.maxAlternatives', 5);
      const keyNum = parseInt(e.key, 10);
      if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= maxAlt && !isInput) {
        e.preventDefault();
        const currentFace = detectedFaces[currentFaceIndex];
        const alternatives = currentFace?.match_alternatives || [];
        const idx = keyNum - 1;

        if (idx < alternatives.length && !currentFace?.is_confirmed) {
          const alt = alternatives[idx];
          if (alt.name === 'ign') {
            ignoreFace(currentFaceIndex);
          } else {
            confirmFace(currentFaceIndex, alt.name);
          }
        }
        return;
      }

      // Enter to confirm (works both in input and outside)
      if (e.key === 'Enter') {
        e.preventDefault();
        const currentFace = detectedFaces[currentFaceIndex];
        if (currentFace?.is_confirmed) return;

        const inputValue = isInput
          ? e.target.value?.trim()
          : inputRefs.current[currentFaceIndex]?.value?.trim();

        if (inputValue) {
          confirmFace(currentFaceIndex, inputValue);
        } else if (currentFace?.match_alternatives?.length > 0) {
          const firstAlt = currentFace.match_alternatives[0];
          if (firstAlt.is_ignored || firstAlt.name === 'ign') {
            ignoreFace(currentFaceIndex);
          } else {
            confirmFace(currentFaceIndex, firstAlt.name);
          }
        }
        return;
      }

      // Shift+Cmd+A to accept all suggestions
      if ((e.key === 'a' || e.key === 'A') && e.shiftKey && e.metaKey) {
        e.preventDefault();
        acceptAllSuggestions();
        return;
      }

      // A to confirm
      if ((e.key === 'a' || e.key === 'A') && !isInput) {
        e.preventDefault();
        const currentFace = detectedFaces[currentFaceIndex];
        if (currentFace?.is_confirmed) return;

        const input = inputRefs.current[currentFaceIndex];
        if (input?.value?.trim()) {
          confirmFace(currentFaceIndex, input.value);
        } else if (currentFace?.match_alternatives?.length > 0) {
          const firstAlt = currentFace.match_alternatives[0];
          if (firstAlt.is_ignored || firstAlt.name === 'ign') {
            ignoreFace(currentFaceIndex);
          } else {
            confirmFace(currentFaceIndex, firstAlt.name);
          }
        }
        return;
      }

      // I to ignore
      if ((e.key === 'i' || e.key === 'I') && !isInput) {
        e.preventDefault();
        ignoreFace(currentFaceIndex);
        return;
      }

      // R to focus input
      if ((e.key === 'r' || e.key === 'R') && !isInput) {
        e.preventDefault();
        const input = inputRefs.current[currentFaceIndex];
        if (input && !detectedFaces[currentFaceIndex]?.is_confirmed) {
          setClearInputTrigger(prev => prev + 1);
          input.focus();
        }
        return;
      }

      // X to skip image (save pending and advance)
      if ((e.key === 'x' || e.key === 'X') && !isInput) {
        e.preventDefault();
        skipImage();
        return;
      }

      // M to add manual face
      if ((e.key === 'm' || e.key === 'M') && !isInput) {
        e.preventDefault();
        addManualFace();
        return;
      }

      // Cmd+Z to undo last face action
      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !isInput) {
        e.preventDefault();
        const undone = undoLastAction();
        if (undone) {
          const msg = undone.type === 'confirm'
            ? t('review.toasts.undo', { label: undone.face.person_name || t('review.toasts.undoConfirmFallback') })
            : t('review.toasts.undoIgnore');
          showToast(msg, 'info', 1500);
        }
        return;
      }

      // Cmd+Backspace - soft-delete the current file to trash (Finder convention).
      if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !isInput) {
        e.preventDefault();
        requestDeleteCurrentFile();
        return;
      }

      // Cmd+Shift+Backspace - undo the last delete-to-trash.
      if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey) && e.shiftKey && !isInput) {
        e.preventDefault();
        emit('file-queue:undo-trash');
        return;
      }

      // Escape - cancel detection if running, else blur input or discard changes
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isLoading) {
          cancelDetection();
          showToast(t('review.status.detectionCancelled'), 'info', 1500);
          return;
        }
        if (isInput) {
          e.target.blur();
        } else {
          discardChanges();
        }
        return;
      }
    };

    document.addEventListener('keydown', handleKeyboard);
    return () => document.removeEventListener('keydown', handleKeyboard);
  }, [currentFaceIndex, detectedFaces, navigateToFace, confirmFace, ignoreFace, discardChanges, skipImage, addManualFace, acceptAllSuggestions, undoLastAction, isLoading, cancelDetection, showToast, requestDeleteCurrentFile, emit]);

  useModuleEvent('image-loaded', useCallback(({ imagePath, skipAutoDetect }) => {
    if (skipAutoDetect) {
      debug('ReviewModule', 'Skipping auto-detect for already-processed file:', imagePath);
      setCurrentImagePath(imagePath);
      setDetectedFaces([]);
      setDetectionOk(false);
      setStatus(t('review.status.alreadyProcessed'));
      return;
    }
    if (imagePath === currentImagePath && detectedFaces.length > 0) {
      debug('ReviewModule', 'Ignoring duplicate image-loaded for same file with faces');
      return;
    }
    detectFaces(imagePath);
  }, [detectFaces, currentImagePath, detectedFaces.length]));

  /**
   * Listen for clear-image events (when file is removed from queue)
   */
  useModuleEvent('clear-image', useCallback(() => {
    debug('ReviewModule', 'Clearing review state');
    setCurrentImagePath(null);
    setDetectedFaces([]);
    setDetectionOk(false);
    setCurrentFaceIndex(-1);
    setStatus(t('review.status.waitingForImage'));
  }, []));

  /**
   * Listen for save/discard commands
   */
  useModuleEvent('save-all-changes', saveAllChanges);
  useModuleEvent('discard-changes', discardChanges);
  // File menu → "Flytta till papperskorgen" / "Ångra radering". Gated by
  // visibility so the menu items act on the reviewed file only when the review
  // surface is up (they no-op during culling, which has its own delete).
  useModuleEvent('delete-current-file', useCallback(() => {
    if (node && !node.isVisible()) return;
    requestDeleteCurrentFile();
  }, [node, requestDeleteCurrentFile]));
  useModuleEvent('undo-delete-file', useCallback(() => {
    if (node && !node.isVisible()) return;
    emit('file-queue:undo-trash');
  }, [node, emit]));
  useModuleEvent('queue-status', setQueueStatus);
  // Pull the current queue status on mount so the overview bar isn't blank
  // when the Review panel is opened after navigation has already happened.
  useEffect(() => {
    emit('request-queue-status');
  }, [emit]);
  useModuleEvent('undo-face-action', useCallback(() => {
    const undone = undoLastAction();
    if (undone) {
      const msg = undone.type === 'confirm'
        ? t('review.toasts.undo', { label: undone.face.person_name || t('review.toasts.undoConfirmFallback') })
        : t('review.toasts.undoIgnore');
      showToast(msg, 'info', 1500);
    }
  }, [undoLastAction, showToast]));

  /**
   * WebSocket events
   */
  useWebSocket('face-detected', useCallback((data) => {
    debug('ReviewModule', 'Face detected event:', data);
  }, []));

  return (
    <div ref={moduleRef} className="module-container review-module" tabIndex={-1}>
      <div className="module-header review-header">
        <div className="review-status">{status}</div>
      </div>

      <div ref={gridRef} className="module-body face-grid">
        {isLoading ? (
          <div className="loading">{t('review.status.detecting')}</div>
        ) : detectedFaces.length === 0 ? (
          detectionOk ? (
            // A detection actually completed and found no faces. The file can
            // still be named manually (e.g. a photo of an object), so surface
            // the action as a button instead of hiding it behind the 'm'
            // shortcut. Works the same in fix mode, which re-detects into this
            // branch. Gated on detectionOk so a detection *error* (which also
            // leaves faces empty) doesn't show a misleading actionable prompt.
            <div className="no-faces-detected">
              <p className="no-faces-title">{t('review.noFacesDetected')}</p>
              <p className="no-faces-hint">{t('review.noFacesHint')}</p>
              <button
                type="button"
                className="btn-secondary add-manual-name-btn"
                onClick={addManualFace}
              >
                {t('review.addManualName')}
              </button>
            </div>
          ) : (
            // No successful detection yet: before any image, or after an error
            // (the status line shows the real error). No actionable button.
            <div className="loading">
              {currentImagePath ? t('review.noFacesDetected') : t('review.status.waitingForImage')}
            </div>
          )
        ) : (
          detectedFaces.map((face, index) => (
            <FaceCard
              key={face.face_id || index}
              face={face}
              index={index}
              isActive={index === currentFaceIndex}
              imagePath={currentImagePath}
              people={people}
              cardRef={(el) => { cardRefs.current[index] = el; }}
              inputRef={(el) => { inputRefs.current[index] = el; }}
              onSelect={() => {
                setCurrentFaceIndex(index);
                emit('active-face-changed', { index });
              }}
              onConfirm={(name) => confirmFace(index, name)}
              onIgnore={() => ignoreFace(index)}
              onUnconfirm={() => unconfirmFace(index)}
              maxAlternatives={preferences.get('reviewModule.maxAlternatives', 5)}
              onSelectAlternative={(name) => {
                if (name === 'ign') {
                  ignoreFace(index);
                } else {
                  confirmFace(index, name);
                }
              }}
              clearInputTrigger={index === currentFaceIndex ? clearInputTrigger : 0}
            />
          ))
        )}
      </div>

      {queueStatus && queueStatus.total > 0 && (() => {
        const { total, done, preprocessed = 0 } = queueStatus;
        const remaining = Math.max(0, total - done - preprocessed);
        const pct = (n) => (n / total) * 100;
        return (
          <div className="module-footer review-footer">
            <div
              className="review-queue-bar"
              title={`${done} granskade · ${preprocessed} redo · ${remaining} kvar`}
            >
              {done > 0 && (
                <div className="seg seg-done" style={{ width: `${pct(done)}%` }} />
              )}
              {preprocessed > 0 && (
                <div className="seg seg-cached" style={{ width: `${pct(preprocessed)}%` }} />
              )}
              {/* "remaining" is the bar track itself (var(--bg-elevated)) showing through */}
            </div>
          </div>
        );
      })()}

      {confirmDialog && (
        <ConfirmDialog
          type={confirmDialog.type}
          topMatch={confirmDialog.topMatch}
          chosenName={confirmDialog.chosenName}
          onConfirm={confirmDialog.onConfirm}
          onCancel={confirmDialog.onCancel}
        />
      )}
    </div>
  );
}

function ConfirmDialog({ type, topMatch, chosenName, onConfirm, onCancel }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onConfirm, onCancel]);

  const isNameMismatch = type === 'name-mismatch';

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{isNameMismatch ? t('review.dialog.confirmNameChange') : t('review.dialog.confirmIgnore')}</h3>
        <div className="match-info">
          {t('review.dialog.bestMatch')} <strong>{topMatch.name}</strong> ({topMatch.confidence}%)
        </div>
        <p>
          {isNameMismatch
            ? t('review.dialog.nameMismatch', { name: chosenName })
            : t('review.dialog.ignoreConfirm')}
        </p>
        <div className="confirm-buttons">
          <button className="btn-cancel" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn-confirm" onClick={onConfirm}>
            {t('common.confirm')}
          </button>
        </div>
        <div className="confirm-hint">
          <kbd>Enter</kbd> {t('review.dialog.hintConfirms')} · <kbd>Esc</kbd> {t('review.dialog.hintCancels')}
        </div>
      </div>
    </div>
  );
}

/**
 * FaceCard Component
 */
function FaceCard({ face, index, isActive, imagePath, people, cardRef, inputRef, onSelect, onConfirm, onIgnore, onUnconfirm, maxAlternatives, onSelectAlternative, clearInputTrigger }) {
  const isProbableIgnoreCase = face.match_case === 'ign' || face.match_case === 'uncertain_ign';
  const initialValue = isProbableIgnoreCase ? '' : (face.person_name || '');
  const [inputValue, setInputValue] = useState(initialValue);
  const [typedValue, setTypedValue] = useState(initialValue);

  // Use cached thumbnail
  const { url: thumbnailUrl, loading: thumbnailLoading, error: thumbnailError } = useThumbnail(
    imagePath,
    face.bounding_box
  );
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const localInputRef = useRef(null);
  const { api } = useBackend();

  const setInputRef = useCallback((el) => {
    localInputRef.current = el;
    if (inputRef) {
      if (typeof inputRef === 'function') inputRef(el);
      else inputRef.current = el;
    }
  }, [inputRef]);

  React.useEffect(() => {
    const newValue = isProbableIgnoreCase ? '' : (face.person_name || '');
    setInputValue(newValue);
    setTypedValue(newValue);
  }, [face.face_id, face.match_case, isProbableIgnoreCase, face.person_name]);

  React.useEffect(() => {
    if (clearInputTrigger > 0) {
      setInputValue('');
      setTypedValue('');
    }
  }, [clearInputTrigger]);

  const filteredPeople = React.useMemo(() => {
    if (!typedValue?.trim()) return [];
    const typed = typedValue.toLowerCase();
    const startsWithMatch = people.filter(p => p.toLowerCase().startsWith(typed));
    const containsMatch = people.filter(p =>
      !p.toLowerCase().startsWith(typed) && p.toLowerCase().includes(typed)
    );
    return [...startsWithMatch, ...containsMatch].slice(0, 8);
  }, [typedValue, people]);

  const dropdownStyle = useDropdownPosition(
    showSuggestions && filteredPeople.length > 0,
    localInputRef.current,
    { maxHeight: 200, gap: 4 }
  );

  // Determine if this is a probable-ignore case
  const isProbableIgnore = face.match_case === 'ign' || face.match_case === 'uncertain_ign';

  const cardClass = [
    'face-card',
    face.is_confirmed && !face.is_rejected ? 'confirmed' : '',
    face.is_rejected ? 'rejected' : '',
    face.is_manual ? 'manual' : '',
    isProbableIgnore && !face.is_confirmed ? 'probable-ignore' : '',
    isActive ? 'active' : ''
  ].filter(Boolean).join(' ');

  const handleDoubleClick = (e) => {
    if (face.is_confirmed && onUnconfirm) {
      e.stopPropagation();
      onUnconfirm();
    }
  };

  return (
    <div ref={cardRef} className={cardClass} onClick={onSelect} onDoubleClick={handleDoubleClick}>
      <div className="face-number">{index + 1}</div>

      <div className="face-thumbnail">
        {thumbnailLoading ? (
          <div className="thumbnail-loading" />
        ) : thumbnailUrl && !thumbnailError ? (
          <img
            src={thumbnailUrl}
            alt={face.person_name || t('review.unknown')}
          />
        ) : (
          <Icon name="user" size={32} />
        )}
      </div>

      <div className="face-info">
        {/* Match case indicator */}
        {face.is_manual && (
          <div className="match-case manual">Manuellt tillagd</div>
        )}
        {face.match_case === 'ign' && !face.is_confirmed && (
          <div className="match-case probable-ignore">Trolig ignorering</div>
        )}
        {face.match_case === 'uncertain_ign' && !face.is_confirmed && (
          <div className="match-case uncertain">
            ign ({face.ignore_confidence}%) / {face.person_name || face.match_alternatives?.[0]?.name || 'Okänd'}
          </div>
        )}
        {face.match_case === 'uncertain_name' && !face.is_confirmed && (
          <div className="match-case uncertain">
            {face.person_name || face.match_alternatives?.[0]?.name || 'Okänd'} / ign ({face.ignore_confidence}%)
          </div>
        )}
        {face.disambiguated && !face.is_confirmed && (
          <div
            className="match-case twin-disambig"
            title={`Lika ansikten ${face.disambiguated.between.join(' / ')} — valt via k-NN-röstning över bekräftade foton`}
          >
            Tvilling-särskiljning → {face.disambiguated.chosen}
          </div>
        )}
      </div>

      {/* Match alternatives - only shown on active unconfirmed face */}
      {isActive && !face.is_confirmed && face.match_alternatives?.length > 0 && (
        <div className="face-alternatives">
          {face.match_alternatives.slice(0, maxAlternatives || 5).map((alt, idx) => (
            <div
              key={idx}
              className={`alt-chip ${idx === 0 ? 'recommended' : ''} ${alt.is_ignored ? 'ignored' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectAlternative?.(alt.name);
              }}
            >
              <span className="kbd">{idx + 1}</span>
              <span className="alt-name">{alt.name}</span>
              <span className="alt-conf">{alt.confidence}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="face-actions">
        {!face.is_confirmed ? (
          <div className="autocomplete-wrapper">
            <input
              ref={setInputRef}
              type="text"
              className={people.includes(inputValue) ? 'name-match' : ''}
              placeholder={t('review.placeholder')}
              value={inputValue}
              onChange={(e) => {
                const val = e.target.value;
                setInputValue(val);
                setTypedValue(val);
                setSelectedSuggestion(-1);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowSuggestions(false);
                  setInputValue(typedValue);
                  setSelectedSuggestion(-1);
                  e.target.blur();
                  e.stopPropagation();
                  return;
                }
                // Arrow Down / Tab - select next suggestion (wraps)
                if ((e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) &&
                    showSuggestions && filteredPeople.length > 0) {
                  e.preventDefault();
                  const newIdx = selectedSuggestion >= filteredPeople.length - 1
                    ? 0
                    : selectedSuggestion + 1;
                  setSelectedSuggestion(newIdx);
                  setInputValue(filteredPeople[newIdx]);
                  return;
                }
                // Arrow Up / Shift+Tab - select previous suggestion (wraps)
                if ((e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) &&
                    showSuggestions && filteredPeople.length > 0) {
                  e.preventDefault();
                  const newIdx = selectedSuggestion <= 0
                    ? filteredPeople.length - 1
                    : selectedSuggestion - 1;
                  setSelectedSuggestion(newIdx);
                  setInputValue(filteredPeople[newIdx]);
                  return;
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
            {showSuggestions && filteredPeople.length > 0 && createPortal(
              <div className="autocomplete-dropdown" style={dropdownStyle}>
                {filteredPeople.map((name, idx) => (
                  <div
                    key={name}
                    className={`autocomplete-item ${idx === selectedSuggestion ? 'selected' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setInputValue(name);
                      setTypedValue(name);
                      setShowSuggestions(false);
                    }}
                  >
                    {name}
                  </div>
                ))}
              </div>,
              document.body
            )}
          </div>
        ) : (
          <div
            className={`status-text ${face.is_rejected ? 'rejected' : 'confirmed'}`}
            title={t('review.undoTitle')}
          >
            {face.is_rejected ? (
              <><Icon name="block" size={12} /> {t('review.ignoredBadge')}</>
            ) : (
              <><Icon name="check" size={12} /> {face.person_name}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReviewModule;
