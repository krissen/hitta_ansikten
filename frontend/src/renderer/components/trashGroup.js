/**
 * trashGroup - classify a trashed file by type for the trash-view filter.
 *
 * Self-contained (no CullingModule import) so both CullingModule and the
 * standalone TrashPanel can share one classifier. Groups a basename into
 * 'jpg' (jpg/jpeg) vs 'nef' (raw: nef/cr2/…) vs 'other' (png/tiff/…),
 * mirroring the backend EXTENSION_PRESETS groups.
 */

import { RAW_EXTS, JPG_EXTS, extOf } from '../shared/fileExts.js';

/**
 * Classify a filename as 'jpg' | 'nef' | 'other'.
 * @param {string} name basename to classify
 * @returns {'jpg'|'nef'|'other'}
 */
export function trashGroup(name) {
  const ext = extOf(name).toLowerCase();
  if (JPG_EXTS.includes(ext)) return 'jpg';
  if (RAW_EXTS.includes(ext)) return 'nef';
  return 'other';
}
