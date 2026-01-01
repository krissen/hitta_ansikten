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
import { useWebSocket } from '../hooks/useWebSocket.js';
import { debug, debugWarn, debugError } from '../shared/debug.js';
import './ReviewModule.css';

/**
 * ReviewModule Component
 */
export function ReviewModule() {
  const { api } = useBackend();
  const emit = useEmitEvent();

  // State
  const [currentImagePath, setCurrentImagePath] = useState(null);
  const [currentFileHash, setCurrentFileHash] = useState(null);  // For mark-review-complete optimization
  const [detectedFaces, setDetectedFaces] = useState([]);
  const [people, setPeople] = useState([]);
  const [currentFaceIndex, setCurrentFaceIndex] = useState(0);
  const [pendingConfirmations, setPendingConfirmations] = useState([]);
  const [pendingIgnores, setPendingIgnores] = useState([]);
  const [status, setStatus] = useState('Waiting for image...');
  const [isLoading, setIsLoading] = useState(false);

  // Refs
  const moduleRef = useRef(null);
  const gridRef = useRef(null);
  const inputRefs = useRef({});
  const cardRefs = useRef({});

  // Shortcut overlay state
  const [showShortcuts, setShowShortcuts] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const IDLE_TIMEOUT = 10000; // 10 seconds

  /**
   * Track user activity to control shortcut overlay visibility
   */
  const trackActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowShortcuts(false);
  }, []);

  /**
   * Timer to show shortcuts after inactivity
   */
  useEffect(() => {
    const interval = setInterval(() => {
      const idleTime = Date.now() - lastActivityRef.current;
      if (idleTime > IDLE_TIMEOUT && !showShortcuts && detectedFaces.length > 0) {
        setShowShortcuts(true);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [showShortcuts, detectedFaces.length]);

  /**
   * Load people names for autocomplete
   */
  const loadPeopleNames = useCallback(async () => {
    try {
      const response = await api.get('/api/database/people/names');
      setPeople(response || []);
    } catch (err) {
      debugError('ReviewModule', 'Failed to load people names:', err);
    }
  }, [api]);

  // Load people names on mount
  useEffect(() => {
    loadPeopleNames();
  }, [loadPeopleNames]);

  /**
   * Detect faces in image
   */
  const detectFaces = useCallback(async (imagePath) => {
    setCurrentImagePath(imagePath);
    setCurrentFileHash(null);  // Clear previous hash
    setIsLoading(true);
    setStatus('Detecting faces...');
    setDetectedFaces([]);
    setCurrentFaceIndex(0);
    setPendingConfirmations([]);
    setPendingIgnores([]);

    try {
      const result = await api.post('/api/detect-faces', { image_path: imagePath, force: false });

      const faces = result.faces || [];
      setDetectedFaces(faces);
      setCurrentFileHash(result.file_hash || null);  // Store hash for mark-review-complete
      setStatus(`Found ${faces.length} faces (${result.processing_time_ms?.toFixed(0) || 0}ms)`);

      // Emit faces to Image Viewer for bounding box overlay
      emit('faces-detected', { faces });

      // Auto-focus first face's input after render (enables keyboard shortcuts)
      if (faces.length > 0) {
        setTimeout(() => {
          const firstInput = inputRefs.current[0];
          if (firstInput) {
            firstInput.focus();
          }
        }, 100);
      }
    } catch (err) {
      debugError('ReviewModule', 'Face detection failed:', err);
      setStatus('Detection failed');
    } finally {
      setIsLoading(false);
    }
  }, [api, emit]);

  /**
   * Navigate to face
   */
  const navigateToFace = useCallback((direction) => {
    if (detectedFaces.length === 0) return;
    trackActivity();

    setCurrentFaceIndex(prev => {
      let newIndex = prev + direction;

      // Wrap around
      if (newIndex >= detectedFaces.length) newIndex = 0;
      if (newIndex < 0) newIndex = detectedFaces.length - 1;

      // Skip confirmed faces
      let attempts = 0;
      while (detectedFaces[newIndex]?.is_confirmed && attempts < detectedFaces.length) {
        newIndex += direction;
        if (newIndex >= detectedFaces.length) newIndex = 0;
        if (newIndex < 0) newIndex = detectedFaces.length - 1;
        attempts++;
      }

      // Notify Image Viewer
      emit('active-face-changed', { index: newIndex });
      return newIndex;
    });
  }, [detectedFaces, emit, trackActivity]);

  /**
   * Jump to specific face
   */
  const jumpToFace = useCallback((faceNum) => {
    if (faceNum <= detectedFaces.length && faceNum >= 1) {
      trackActivity();
      const newIndex = faceNum - 1;
      setCurrentFaceIndex(newIndex);
      emit('active-face-changed', { index: newIndex });
    }
  }, [detectedFaces.length, emit, trackActivity]);

  /**
   * Confirm face
   */
  const confirmFace = useCallback((index, personName) => {
    if (!personName?.trim()) return;

    const face = detectedFaces[index];
    if (!face || face.is_confirmed) return;
    trackActivity();

    setDetectedFaces(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], is_confirmed: true, person_name: personName.trim() };
      return updated;
    });

    setPendingConfirmations(prev => {
      const existing = prev.findIndex(p => p.face_id === face.face_id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], person_name: personName.trim() };
        return updated;
      }
      return [...prev, { face_id: face.face_id, person_name: personName.trim(), image_path: currentImagePath }];
    });

    // Move to next face
    navigateToFace(1);
  }, [detectedFaces, currentImagePath, navigateToFace, trackActivity]);

  /**
   * Ignore face
   */
  const ignoreFace = useCallback((index) => {
    const face = detectedFaces[index];
    if (!face || face.is_confirmed) return;
    trackActivity();

    setDetectedFaces(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], is_confirmed: true, is_rejected: true, person_name: '(ignored)' };
      return updated;
    });

    setPendingIgnores(prev => {
      if (prev.some(p => p.face_id === face.face_id)) return prev;
      return [...prev, { face_id: face.face_id, image_path: currentImagePath }];
    });

    // Move to next face
    navigateToFace(1);
  }, [detectedFaces, currentImagePath, navigateToFace, trackActivity]);

  /**
   * Build reviewedFaces array for rename functionality
   */
  const buildReviewedFaces = useCallback(() => {
    return detectedFaces.map((face, index) => ({
      faceIndex: index,
      faceId: face.face_id,
      personName: face.is_confirmed && !face.is_rejected ? face.person_name : null,
      isIgnored: face.is_rejected || false
    }));
  }, [detectedFaces]);

  /**
   * Mark review as complete (logs to attempt_stats.jsonl for rename)
   */
  const markReviewComplete = useCallback(async (imagePath, reviewedFaces, fileHash = null) => {
    try {
      await api.post('/api/mark-review-complete', {
        image_path: imagePath,
        reviewed_faces: reviewedFaces.map(f => ({
          face_index: f.faceIndex,
          face_id: f.faceId,
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
    setStatus(`Saving ${totalChanges} changes...`);

    try {
      // Save confirmations
      for (const confirmation of pendingConfirmations) {
        await api.post('/api/confirm-identity', confirmation);
      }

      // Save ignores
      for (const ignore of pendingIgnores) {
        await api.post('/api/ignore-face', ignore);
      }

      setPendingConfirmations([]);
      setPendingIgnores([]);
      await loadPeopleNames();
      setStatus(`Saved ${totalChanges} changes!`);
      return true;
    } catch (err) {
      debugError('ReviewModule', 'Failed to save:', err);
      setStatus('Error saving changes - review NOT marked complete');
      return false;
    }
  }, [pendingConfirmations, pendingIgnores, api, loadPeopleNames]);

  /**
   * Discard all changes
   */
  const discardChanges = useCallback(() => {
    if (pendingConfirmations.length === 0 && pendingIgnores.length === 0) return;

    if (!confirm(`Discard ${pendingConfirmations.length + pendingIgnores.length} unsaved changes?`)) return;

    // Reset face states
    setDetectedFaces(prev => prev.map(face => {
      if (face.is_rejected || face.is_confirmed) {
        return { ...face, is_confirmed: false, is_rejected: false, person_name: null };
      }
      return face;
    }));

    setPendingConfirmations([]);
    setPendingIgnores([]);
    setStatus('Changes discarded');
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

    setStatus('Image skipped');
  }, [currentImagePath, pendingConfirmations.length, pendingIgnores.length, saveAllChanges, buildReviewedFaces, markReviewComplete, emit, detectedFaces, currentFileHash]);

  /**
   * Add manual face - for when a person exists but wasn't detected
   */
  const addManualFace = useCallback(() => {
    if (!currentImagePath) return;

    debug('ReviewModule', 'Adding manual face');

    // Create a virtual face with no bounding box
    const manualFaceId = `manual_${Date.now()}`;
    const manualFace = {
      face_id: manualFaceId,
      bounding_box: null,  // No bounding box
      confidence: null,    // No confidence
      person_name: '',
      is_manual: true,     // Mark as manually added
      is_confirmed: false
    };

    setDetectedFaces(prev => [...prev, manualFace]);

    // Focus the new face's input after render
    const newIndex = detectedFaces.length;
    setCurrentFaceIndex(newIndex);

    setTimeout(() => {
      const input = inputRefs.current[newIndex];
      if (input) {
        input.focus();
      }
    }, 100);

    setStatus('Manual face added - enter name');
  }, [currentImagePath, detectedFaces.length]);

  /**
   * Auto-save when all faces reviewed
   */
  useEffect(() => {
    const allDone = detectedFaces.length > 0 && detectedFaces.every(f => f.is_confirmed || f.is_rejected);
    const hasChanges = pendingConfirmations.length > 0 || pendingIgnores.length > 0;

    if (allDone && hasChanges) {
      const timeout = setTimeout(async () => {
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
   * Update status when pending changes
   */
  useEffect(() => {
    if (detectedFaces.length === 0) return;

    const reviewedCount = detectedFaces.filter(f => f.is_confirmed).length;
    const pendingCount = pendingConfirmations.length + pendingIgnores.length;

    if (pendingCount > 0) {
      setStatus(`${reviewedCount}/${detectedFaces.length} reviewed | ${pendingCount} pending`);
    }
  }, [detectedFaces, pendingConfirmations.length, pendingIgnores.length]);

  /**
   * Auto-scroll and focus active face when navigating
   */
  useEffect(() => {
    const cardEl = cardRefs.current[currentFaceIndex];
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Focus the input for the new active face (if not confirmed)
    const face = detectedFaces[currentFaceIndex];
    if (face && !face.is_confirmed) {
      const input = inputRefs.current[currentFaceIndex];
      if (input) {
        // Small delay to ensure DOM is updated after state change
        requestAnimationFrame(() => {
          input.focus();
        });
      }
    }
  }, [currentFaceIndex, detectedFaces]);

  /**
   * Keyboard handler
   * Review shortcuts work when focus is in ReviewModule OR ImageViewer
   * This allows seamless workflow: view image, confirm/ignore faces
   * Shortcuts are blocked in other modules (LogViewer, etc.) to prevent accidents
   */
  useEffect(() => {
    const handleKeyboard = (e) => {
      // Check if focus is in ReviewModule or ImageViewer
      const activeEl = document.activeElement;
      const inReviewModule = moduleRef.current?.contains(activeEl);
      const inImageViewer = activeEl?.closest('.image-viewer') !== null;

      // Only handle shortcuts when in ReviewModule or ImageViewer
      if (!inReviewModule && !inImageViewer) {
        return;
      }

      // Skip if in input (for letter keys only, not navigation)
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

      // Navigation
      if (e.key === 'Tab') {
        e.preventDefault();
        navigateToFace(e.shiftKey ? -1 : 1);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateToFace(1);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateToFace(-1);
        return;
      }

      // Number keys
      if (e.key >= '1' && e.key <= '9' && !isInput) {
        e.preventDefault();
        jumpToFace(parseInt(e.key));
        return;
      }

      // Enter to confirm (works both in input and outside)
      if (e.key === 'Enter') {
        e.preventDefault();
        // If we're in an input, use that input's value directly
        // Otherwise use the current face's input ref
        const inputValue = isInput
          ? e.target.value?.trim()
          : inputRefs.current[currentFaceIndex]?.value?.trim();
        if (inputValue) {
          confirmFace(currentFaceIndex, inputValue);
        }
        return;
      }

      // A to confirm
      if ((e.key === 'a' || e.key === 'A') && !isInput) {
        e.preventDefault();
        const input = inputRefs.current[currentFaceIndex];
        if (input?.value?.trim()) {
          confirmFace(currentFaceIndex, input.value);
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
          input.focus();
          input.value = '';
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

      // ? to toggle shortcut overlay
      if (e.key === '?' && !isInput) {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
        return;
      }

      // Escape
      if (e.key === 'Escape') {
        e.preventDefault();
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
  }, [currentFaceIndex, detectedFaces, navigateToFace, jumpToFace, confirmFace, ignoreFace, discardChanges, skipImage, addManualFace]);

  /**
   * Listen for image-loaded events
   */
  useModuleEvent('image-loaded', useCallback(({ imagePath }) => {
    detectFaces(imagePath);
  }, [detectFaces]));

  /**
   * Listen for clear-image events (when file is removed from queue)
   */
  useModuleEvent('clear-image', useCallback(() => {
    debug('ReviewModule', 'Clearing review state');
    setCurrentImagePath(null);
    setDetectedFaces([]);
    setCurrentFaceIndex(-1);
    setStatus('Waiting for image...');
  }, []));

  /**
   * Listen for save/discard commands
   */
  useModuleEvent('save-all-changes', saveAllChanges);
  useModuleEvent('discard-changes', discardChanges);

  /**
   * WebSocket events
   */
  useWebSocket('face-detected', useCallback((data) => {
    debug('ReviewModule', 'Face detected event:', data);
  }, []));

  return (
    <div ref={moduleRef} className="review-module" tabIndex={-1}>
      <div className="review-header">
        <div className="review-status">{status}</div>
      </div>

      <div ref={gridRef} className="face-grid">
        {isLoading ? (
          <div className="loading">Detecting faces...</div>
        ) : detectedFaces.length === 0 ? (
          <div className="loading">No faces detected</div>
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
                trackActivity();
              }}
              onConfirm={(name) => confirmFace(index, name)}
              onIgnore={() => ignoreFace(index)}
              onInputActivity={trackActivity}
            />
          ))
        )}
      </div>

      {/* Keyboard shortcut overlay - shows after inactivity */}
      {detectedFaces.length > 0 && (
        <ShortcutOverlay visible={showShortcuts} />
      )}
    </div>
  );
}

/**
 * FaceCard Component
 */
function FaceCard({ face, index, isActive, imagePath, people, cardRef, inputRef, onSelect, onConfirm, onIgnore, onInputActivity }) {
  const [inputValue, setInputValue] = useState(face.person_name || '');
  const { api } = useBackend();

  // Build thumbnail URL (only for faces with bounding boxes)
  const bbox = face.bounding_box;
  const thumbnailUrl = (imagePath && bbox) ? (
    `http://127.0.0.1:5001/api/face-thumbnail?` +
    `image_path=${encodeURIComponent(imagePath)}` +
    `&x=${bbox.x || 0}&y=${bbox.y || 0}&width=${bbox.width || 100}&height=${bbox.height || 100}&size=150`
  ) : null;

  const cardClass = [
    'face-card',
    face.is_confirmed && !face.is_rejected ? 'confirmed' : '',
    face.is_rejected ? 'rejected' : '',
    face.is_manual ? 'manual' : '',
    isActive ? 'active' : ''
  ].filter(Boolean).join(' ');

  return (
    <div ref={cardRef} className={cardClass} onClick={onSelect}>
      <div className="face-number">{index + 1}</div>

      <div className="face-thumbnail">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={face.person_name || 'Unknown'}
            onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.textContent = '👤'; }}
          />
        ) : (
          '👤'
        )}
      </div>

      <div className="face-info">
        {face.is_manual ? (
          <div className="face-confidence manual">Manual entry</div>
        ) : (
          <div className="face-confidence">
            Confidence: {((face.confidence || 0) * 100).toFixed(1)}%
          </div>
        )}
        {face.person_name && !face.is_rejected && (
          <div>Person: {face.person_name}</div>
        )}
      </div>

      <div className="face-actions">
        {!face.is_confirmed ? (
          <input
            ref={inputRef}
            type="text"
            placeholder="Person name..."
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              onInputActivity?.();
            }}
            onKeyDown={(e) => {
              // Let document handler manage Enter for consistency
              // Just stop propagation for other keys we don't want bubbling
              if (e.key === 'Escape') {
                e.target.blur();
                e.stopPropagation();
              }
            }}
            list="people-names-datalist"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className={`status-text ${face.is_rejected ? 'rejected' : 'confirmed'}`}>
            {face.is_rejected ? '⊘ Ignored' : `✓ ${face.person_name}`}
          </div>
        )}
      </div>

      {/* Datalist for autocomplete */}
      <datalist id="people-names-datalist">
        {people.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}

/**
 * ShortcutOverlay - Shows keyboard shortcuts with inactivity-based visibility
 */
function ShortcutOverlay({ visible }) {
  // Check if an input is currently focused
  const [isInputFocused, setIsInputFocused] = useState(false);

  useEffect(() => {
    const checkFocus = () => {
      const active = document.activeElement;
      setIsInputFocused(active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA');
    };

    // Check on focus changes
    document.addEventListener('focusin', checkFocus);
    document.addEventListener('focusout', checkFocus);
    return () => {
      document.removeEventListener('focusin', checkFocus);
      document.removeEventListener('focusout', checkFocus);
    };
  }, []);

  // Show different shortcuts based on context
  const shortcuts = isInputFocused
    ? 'Enter=Confirm  Esc=Cancel'
    : 'A=Accept  I=Ignore  X=Skip  M=Manual';

  return (
    <div className={`shortcut-overlay ${visible ? 'visible' : ''}`}>
      <div className="shortcut-text">{shortcuts}</div>
      <div className="shortcut-hint">?=Toggle help</div>
    </div>
  );
}

export default ReviewModule;
