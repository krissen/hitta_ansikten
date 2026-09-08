/**
 * reviewActions - Pure face-list state transitions for the review flow.
 *
 * Extracted from ReviewModule so the confirm/ignore/unconfirm/undo/accept-all
 * sequencing over the detected-faces array can be unit tested without React.
 * Each function takes the current state and returns the next state (plus any
 * derived pending-change entries); no I/O, no side effects. Orchestration —
 * setState wiring, event emits, dialogs, API calls, auto-save timing — stays
 * in ReviewModule.
 */

export const HIGH_CONFIDENCE_THRESHOLD = 75;

/**
 * The single source of truth for "what does the app suggest for this face".
 * Both the box label (display) and every accept path (action) derive the
 * suggestion from here, so display and action can never diverge — including
 * for older cached responses where `person_name` may disagree with the
 * top alternative.
 *
 * Confirmed faces are the user's decision, not a suggestion: callers that
 * care show `person_name` for `is_confirmed` faces and only fall back to
 * this resolver for unconfirmed ones.
 *
 * @param {Object} face
 * @returns {{name: string, confidence: number, isIgnore: boolean}|null}
 *   null when there is no top alternative to suggest.
 */
export function resolveSuggestion(face) {
  const top = face?.match_alternatives?.[0];
  if (!top) return null;
  return {
    name: top.name,
    confidence: top.confidence,
    isIgnore: !!top.is_ignored || top.name === 'ign',
  };
}

/**
 * Return the suggested match if it is high-confidence and not an ignore
 * suggestion, else null. Thin wrapper over {@link resolveSuggestion} that
 * applies the ConfirmDialog gating threshold.
 * @param {Object} face
 * @param {number} [threshold=HIGH_CONFIDENCE_THRESHOLD]
 * @returns {{name: string, confidence: number}|null}
 */
export function getTopMatch(face, threshold = HIGH_CONFIDENCE_THRESHOLD) {
  const suggestion = resolveSuggestion(face);
  if (!suggestion || suggestion.isIgnore) return null;
  if (suggestion.confidence >= threshold) {
    return { name: suggestion.name, confidence: suggestion.confidence };
  }
  return null;
}

/**
 * True if reviewing (confirming/ignoring) the face at `index` would leave
 * every face confirmed or rejected — i.e. the auto-save will take over and
 * navigation should be skipped.
 * @param {Object[]} faces
 * @param {number} index - Face being acted on.
 * @returns {boolean}
 */
export function willAllBeDone(faces, index) {
  return faces.every((f, i) => i === index || f.is_confirmed || f.is_rejected);
}

/**
 * Compute the next active face index for navigation, skipping confirmed
 * faces and an optional explicit index (handles stale closure on advance).
 * Wraps around; gives up after one full lap.
 * @param {Object[]} faces
 * @param {number} prev - Current index.
 * @param {number} direction - +1 or -1.
 * @param {number|null} [skipIndex=null]
 * @returns {number} New index.
 */
export function nextFaceIndex(faces, prev, direction, skipIndex = null) {
  let newIndex = prev + direction;

  if (newIndex >= faces.length) newIndex = 0;
  if (newIndex < 0) newIndex = faces.length - 1;

  // Skip confirmed faces AND explicitly skipped index (handles stale closure)
  let attempts = 0;
  while (
    (faces[newIndex]?.is_confirmed || newIndex === skipIndex) &&
    attempts < faces.length
  ) {
    newIndex += direction;
    if (newIndex >= faces.length) newIndex = 0;
    if (newIndex < 0) newIndex = faces.length - 1;
    attempts++;
  }

  return newIndex;
}

/**
 * Confirm the face at `index` with `personName`.
 * @param {Object[]} faces
 * @param {number} index
 * @param {string} personName
 * @param {string} imagePath
 * @returns {{faces: Object[], confirmation: Object, undoEntry: Object}|null}
 *   null if the face is missing or already confirmed (no-op).
 */
export function confirmFaceState(faces, index, personName, imagePath) {
  const face = faces[index];
  if (!face || face.is_confirmed) return null;

  const undoEntry = { type: 'confirm', index, face: { ...face } };

  const updatedFaces = [...faces];
  updatedFaces[index] = {
    ...updatedFaces[index],
    is_confirmed: true,
    person_name: personName.trim(),
  };

  const suggestedName = face.person_name || null;
  const confirmation = {
    face_id: face.face_id,
    person_name: personName.trim(),
    image_path: imagePath,
    suggested_name: suggestedName !== personName.trim() ? suggestedName : null,
  };

  return { faces: updatedFaces, confirmation, undoEntry };
}

/**
 * Ignore (reject) the face at `index`.
 * @param {Object[]} faces
 * @param {number} index
 * @param {string} imagePath
 * @returns {{faces: Object[], ignore: Object, undoEntry: Object}|null}
 *   null if the face is missing or already confirmed (no-op).
 */
export function ignoreFaceState(faces, index, imagePath) {
  const face = faces[index];
  if (!face || face.is_confirmed) return null;

  const undoEntry = { type: 'ignore', index, face: { ...face } };

  const updatedFaces = [...faces];
  updatedFaces[index] = {
    ...updatedFaces[index],
    is_confirmed: true,
    is_rejected: true,
    person_name: '(ignored)',
  };

  const ignore = { face_id: face.face_id, image_path: imagePath };

  return { faces: updatedFaces, ignore, undoEntry };
}

/**
 * Revert the face at `index` to unconfirmed for re-review.
 * @param {Object[]} faces
 * @param {number} index
 * @returns {{faces: Object[], faceId: string}|null} null if not confirmed.
 */
export function unconfirmFaceState(faces, index) {
  const face = faces[index];
  if (!face || !face.is_confirmed) return null;

  const updatedFaces = [...faces];
  const originalFace = updatedFaces[index];
  updatedFaces[index] = {
    ...originalFace,
    is_confirmed: false,
    is_rejected: false,
    person_name: originalFace._original_person_name || null,
  };

  return { faces: updatedFaces, faceId: face.face_id };
}

/**
 * Restore the face captured in an undo entry.
 * @param {Object[]} faces
 * @param {{type: string, index: number, face: Object}} action
 * @returns {Object[]} New faces array with the snapshot restored.
 */
export function undoFaceState(faces, action) {
  const { index, face } = action;
  const updatedFaces = [...faces];
  updatedFaces[index] = { ...face };
  return updatedFaces;
}

/**
 * Confirm/ignore every unconfirmed face using its top match alternative.
 * Faces without alternatives are skipped (left unconfirmed).
 * @param {Object[]} faces
 * @param {string} imagePath
 * @returns {{faces: Object[], confirmations: Object[], ignores: Object[],
 *   accepted: number, ignored: number, skipped: number}}
 */
export function acceptAllState(faces, imagePath) {
  let accepted = 0;
  let ignored = 0;
  let skipped = 0;
  const confirmations = [];
  const ignores = [];

  const updatedFaces = faces.map((face) => {
    if (face.is_confirmed) return face;

    const suggestion = resolveSuggestion(face);
    if (!suggestion) {
      skipped++;
      return face;
    }

    if (suggestion.isIgnore) {
      ignored++;
      if (face.face_id) {
        ignores.push({ face_id: face.face_id, image_path: imagePath });
      }
      return {
        ...face,
        is_confirmed: true,
        is_rejected: true,
        person_name: '(ignored)',
      };
    }

    const trimmedName = suggestion.name?.trim() || suggestion.name;
    accepted++;

    if (face.face_id) {
      const suggestedName = face.person_name || null;
      confirmations.push({
        face_id: face.face_id,
        person_name: trimmedName,
        image_path: imagePath,
        suggested_name:
          suggestedName &&
          suggestedName.toLowerCase() !== trimmedName.toLowerCase()
            ? suggestedName
            : null,
      });
    }

    return {
      ...face,
      is_confirmed: true,
      is_rejected: false,
      person_name: trimmedName,
    };
  });

  return {
    faces: updatedFaces,
    confirmations,
    ignores,
    accepted,
    ignored,
    skipped,
  };
}

/**
 * Insert or update a pending confirmation (keyed by face_id).
 * @param {Object[]} prev - Current pendingConfirmations.
 * @param {Object} confirmation
 * @returns {Object[]}
 */
export function upsertConfirmation(prev, confirmation) {
  const existing = prev.findIndex((p) => p.face_id === confirmation.face_id);
  if (existing >= 0) {
    const updated = [...prev];
    updated[existing] = {
      ...updated[existing],
      person_name: confirmation.person_name,
    };
    return updated;
  }
  return [...prev, confirmation];
}

/**
 * Append a pending ignore unless one already exists for the face.
 * @param {Object[]} prev - Current pendingIgnores.
 * @param {Object} ignoreEntry
 * @returns {Object[]}
 */
export function appendIgnore(prev, ignoreEntry) {
  if (prev.some((p) => p.face_id === ignoreEntry.face_id)) return prev;
  return [...prev, ignoreEntry];
}

/**
 * Merge a batch of confirmations into the pending list (accept-all path).
 * Unlike upsertConfirmation, an existing entry also gets its suggested_name
 * replaced — accept-all recomputes it against the accepted alternative.
 * @param {Object[]} prev - Current pendingConfirmations.
 * @param {Object[]} confirmations
 * @returns {Object[]}
 */
export function mergeConfirmations(prev, confirmations) {
  if (confirmations.length === 0) return prev;
  const next = [...prev];
  confirmations.forEach((confirmation) => {
    const existingIndex = next.findIndex(
      (item) => item.face_id === confirmation.face_id,
    );
    if (existingIndex >= 0) {
      next[existingIndex] = {
        ...next[existingIndex],
        person_name: confirmation.person_name,
        suggested_name: confirmation.suggested_name,
      };
    } else {
      next.push(confirmation);
    }
  });
  return next;
}

/**
 * Merge a batch of ignores into the pending list, skipping duplicates.
 * @param {Object[]} prev - Current pendingIgnores.
 * @param {Object[]} ignores
 * @returns {Object[]}
 */
export function mergeIgnores(prev, ignores) {
  if (ignores.length === 0) return prev;
  const next = [...prev];
  ignores.forEach((ignoreEntry) => {
    if (!next.some((item) => item.face_id === ignoreEntry.face_id)) {
      next.push(ignoreEntry);
    }
  });
  return next;
}

/**
 * Build the reviewedFaces array used by rename/mark-review-complete.
 * @param {Object[]} faces
 * @returns {Object[]}
 */
export function buildReviewedFaces(faces) {
  return faces.map((face, index) => ({
    faceIndex: index,
    faceId: face.face_id,
    encodingHash: face.encoding_hash, // Permanent identifier for undo/rename operations
    personName:
      face.is_confirmed && !face.is_rejected ? face.person_name : null,
    isIgnored: face.is_rejected || false,
  }));
}
