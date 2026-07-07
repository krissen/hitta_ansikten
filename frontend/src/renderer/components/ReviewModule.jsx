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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useModuleEvent, useEmitEvent } from '../hooks/useModuleEvent.js';
import { useBackend } from '../context/BackendContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { debug, debugWarn, debugError } from '../shared/debug.js';
import { NetworkError } from '../shared/api-client.js';
import { preferences } from '../workspace/preferences.js';
import { normalizeSuffix } from '../shared/manualSuffix.js';
import { Icon } from './Icon.jsx';
import { t } from '../../i18n/index.js';
import { SuffixDialog } from './review/SuffixDialog.jsx';
import { ConfirmDialog } from './review/ConfirmDialog.jsx';
import { FaceCard } from './review/FaceCard.jsx';
import {
  getTopMatch as getTopMatchPure,
  willAllBeDone,
  nextFaceIndex,
  confirmFaceState,
  ignoreFaceState,
  unconfirmFaceState,
  undoFaceState,
  acceptAllState,
  upsertConfirmation,
  appendIgnore,
  mergeConfirmations,
  mergeIgnores,
  buildReviewedFaces as buildReviewedFacesPure,
} from './review/reviewActions.js';
import './ReviewModule.css';

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
  const [suffixDialog, setSuffixDialog] = useState(null);
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
      const newIndex = nextFaceIndex(detectedFaces, prev, direction, skipIndex);

      // Only emit if we found an unconfirmed face (avoid centering on old face when all done)
      const targetFace = detectedFaces[newIndex];
      if (targetFace && !targetFace.is_confirmed) {
        emit('active-face-changed', { index: newIndex });
      }
      return newIndex;
    });
  }, [detectedFaces, emit]);

  const getTopMatch = useCallback((face) => getTopMatchPure(face), []);

  const doConfirmFace = useCallback((index, personName) => {
    const result = confirmFaceState(detectedFaces, index, personName, currentImagePath);
    if (!result) return;

    setUndoStack(prev => [...prev, result.undoEntry]);
    setDetectedFaces(result.faces);

    emit('faces-detected', { faces: result.faces, imagePath: currentImagePath });

    setPendingConfirmations(prev => upsertConfirmation(prev, result.confirmation));

    // Skip navigation if all faces will be done - auto-save will handle transition
    if (!willAllBeDone(detectedFaces, index)) {
      navigateToFace(1, index);
    }
  }, [detectedFaces, currentImagePath, navigateToFace, emit]);

  const doIgnoreFace = useCallback((index) => {
    const result = ignoreFaceState(detectedFaces, index, currentImagePath);
    if (!result) return;

    setUndoStack(prev => [...prev, result.undoEntry]);
    setDetectedFaces(result.faces);

    emit('faces-detected', { faces: result.faces, imagePath: currentImagePath });

    setPendingIgnores(prev => appendIgnore(prev, result.ignore));

    // Skip navigation if all faces will be done - auto-save will handle transition
    if (!willAllBeDone(detectedFaces, index)) {
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

    const updatedFaces = undoFaceState(detectedFaces, lastAction);
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
    const result = unconfirmFaceState(detectedFaces, index);
    if (!result) return;

    debug('ReviewModule', 'Unconfirming face at index:', index);

    setDetectedFaces(result.faces);

    // Emit updated faces to sync ImageViewer
    emit('faces-detected', { faces: result.faces, imagePath: currentImagePath });

    setPendingConfirmations(prev => prev.filter(p => p.face_id !== result.faceId));
    setPendingIgnores(prev => prev.filter(p => p.face_id !== result.faceId));

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
    const { faces: updatedFaces, confirmations, ignores, accepted, ignored, skipped } =
      acceptAllState(detectedFaces, currentImagePath);

    if (confirmations.length > 0 || ignores.length > 0) {
      setDetectedFaces(updatedFaces);
      emit('faces-detected', { faces: updatedFaces, imagePath: currentImagePath });

      setPendingConfirmations((prev) => mergeConfirmations(prev, confirmations));
      setPendingIgnores((prev) => mergeIgnores(prev, ignores));
    }

    setStatus(
      t('review.status.accepted', { accepted, ignored }) +
      (skipped > 0 ? t('review.status.acceptedSkippedSuffix', { skipped }) : '')
    );
  }, [detectedFaces, currentImagePath, emit]);

  /**
   * Build reviewedFaces array for rename functionality
   */
  const buildReviewedFaces = useCallback(
    () => buildReviewedFacesPure(detectedFaces),
    [detectedFaces]
  );

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
   * Open the manual filename-suffix dialog for the current image (Alt+Enter).
   * The suffix is free text, NOT a person name — it only affects the filename.
   * Prefill from the backend store so re-editing shows the existing value.
   */
  const openSuffixDialog = useCallback(async () => {
    if (!currentImagePath) return;
    let prefill = '';
    try {
      const res = await api.get('/api/v1/files/manual-suffix', { image_path: currentImagePath });
      prefill = res?.raw || '';
    } catch (err) {
      debugWarn('ReviewModule', 'Could not load manual suffix:', err?.message || err);
    }
    setSuffixDialog({ imagePath: currentImagePath, prefill });
  }, [currentImagePath, api]);

  /**
   * Persist (or clear) the manual filename suffix for a given image.
   */
  const saveSuffix = useCallback(async (imagePath, rawSuffix) => {
    try {
      await api.post('/api/v1/files/manual-suffix', { image_path: imagePath, suffix: rawSuffix });
      const cleared = !normalizeSuffix(rawSuffix);
      showToast(t(cleared ? 'review.manualSuffix.cleared' : 'review.manualSuffix.saved'), 'success', 1500);
    } catch (err) {
      debugError('ReviewModule', 'Failed to save manual suffix:', err);
      showToast(t('review.manualSuffix.saveError'), 'error');
    }
    setSuffixDialog(null);
  }, [api, showToast]);

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

      // Alt+Enter - open the manual filename-suffix dialog. Handled before the
      // plain-Enter branch and works even with focus in a name input, since
      // Alt+Enter is not a normal text-entry gesture.
      if (e.key === 'Enter' && e.altKey) {
        e.preventDefault();
        openSuffixDialog();
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
  }, [currentFaceIndex, detectedFaces, navigateToFace, confirmFace, ignoreFace, discardChanges, skipImage, addManualFace, acceptAllSuggestions, undoLastAction, isLoading, cancelDetection, showToast, requestDeleteCurrentFile, openSuffixDialog, emit]);

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

      {suffixDialog && (
        <SuffixDialog
          initialValue={suffixDialog.prefill}
          originalName={suffixDialog.imagePath ? suffixDialog.imagePath.split('/').pop() : ''}
          onSave={(value) => saveSuffix(suffixDialog.imagePath, value)}
          onCancel={() => setSuffixDialog(null)}
        />
      )}
    </div>
  );
}

export default ReviewModule;
