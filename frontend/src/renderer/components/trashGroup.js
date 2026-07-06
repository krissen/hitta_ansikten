/**
 * trashGroup - classify a trashed file by type for the trash-view filter.
 *
 * Self-contained (no CullingModule import) so both CullingModule and the
 * standalone TrashPanel can share one classifier. Groups a basename into
 * 'jpg' (jpg/jpeg) vs 'nef' (raw: nef/cr2/…) vs 'other' (png/tiff/…),
 * mirroring the backend EXTENSION_PRESETS groups.
 */

// RAW extensions that go through the NEF->JPG preview pipeline
// (matches file_resolver EXTENSION_PRESETS.raw).
const RAW_EXTS = ['.nef', '.cr2', '.cr3', '.arw', '.dng', '.raw', '.raf', '.orf', '.rw2'];

const JPG_EXTS = ['.jpg', '.jpeg'];

// Extract a file extension (incl. the leading dot). A leading dot (dotfile) is
// treated as part of the name, not an extension, so `.hidden` has no extension.
function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
}

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
