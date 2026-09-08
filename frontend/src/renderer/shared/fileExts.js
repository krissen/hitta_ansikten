/**
 * Shared file-extension constants and helpers.
 *
 * RAW_EXTS / JPG_EXTS classify a basename into the same groups the backend
 * uses for the NEF->JPG preview pipeline. The canonical source of truth is
 * `backend/core/files.py` (RAW_EXTENSIONS); keep this array aligned with it.
 */

// RAW extensions that go through the NEF->JPG preview pipeline
// (matches core/files.py RAW_EXTENSIONS).
export const RAW_EXTS = [
  '.nef',
  '.cr2',
  '.cr3',
  '.arw',
  '.dng',
  '.raw',
  '.raf',
  '.orf',
  '.rw2',
];

export const JPG_EXTS = ['.jpg', '.jpeg'];

// Extract a file extension (incl. the leading dot). A leading dot (dotfile) is
// treated as part of the name, not an extension, so `.hidden` has no extension.
export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
}
