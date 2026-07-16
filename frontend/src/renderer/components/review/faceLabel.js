/**
 * faceLabel - Pure builder for the ImageViewer face-box label text.
 *
 * Extracted from ImageViewer.drawFaceBoxes so the match_case formatting can be
 * unit tested and, crucially, so the name shown in the label comes from the
 * same {@link resolveSuggestion} resolver the accept paths use. That closes the
 * gap where the box label could show `person_name` while the accept keys
 * applied `match_alternatives[0]` (e.g. on older cached responses).
 */

import { resolveSuggestion } from './reviewActions.js';

/**
 * Build the label drawn over a face box.
 *
 * Confirmed faces show the user's decision (`person_name`); unconfirmed faces
 * are formatted per `match_case`, with the suggested name always taken from
 * {@link resolveSuggestion} so display can never diverge from what an accept
 * would apply.
 *
 * @param {Object} face - Detected face (bounding_box, match_case, alternatives…).
 * @param {number} faceNumber - 1-based label prefix.
 * @param {(key: string) => string} t - i18n lookup (for the "unknown" fallback).
 * @returns {string} Label text, e.g. `3. Anna? (82%)`.
 */
export function buildFaceLabel(face, faceNumber, t) {
  const matchCase = face.match_case;
  const suggestion = resolveSuggestion(face);

  // Name for the match-heuristic branches, always via the shared resolver.
  const suggestionName = () => {
    if (!suggestion) return t('imageViewer.unknown');
    return suggestion.isIgnore ? 'ign' : suggestion.name;
  };

  // Confirmed faces reflect the user's decision — evaluated before the
  // match_case branches so a corrected name on an uncertain_* face overrides
  // the (now stale) top alternative instead of being shadowed by it.
  if (face.is_confirmed) {
    if (face.is_rejected) {
      return `${faceNumber}. ign (${face.ignore_confidence || 0}%)`;
    }
    return `${faceNumber}. ${face.person_name} (${((face.confidence || 0) * 100).toFixed(0)}%)`;
  }

  if (matchCase === 'ign') {
    return `${faceNumber}. ign (${face.ignore_confidence || 0}%)`;
  } else if (matchCase === 'uncertain_ign') {
    return `${faceNumber}. ign (${face.ignore_confidence || 0}%) / ${suggestionName()}`;
  } else if (matchCase === 'uncertain_name') {
    return `${faceNumber}. ${suggestionName()} / ign (${face.ignore_confidence || 0}%)`;
  } else if (suggestion) {
    return suggestion.isIgnore
      ? `${faceNumber}. ign? (${suggestion.confidence}%)`
      : `${faceNumber}. ${suggestion.name}? (${suggestion.confidence}%)`;
  }
  return `${faceNumber}. ${t('imageViewer.unknown')}`;
}
