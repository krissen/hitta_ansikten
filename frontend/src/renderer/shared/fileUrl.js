// fileUrl.js
// Build file:// URLs for rendering local images in <img>/<canvas>.

/**
 * Convert an absolute filesystem path to a file:// URL, encoding characters that
 * would otherwise break the URL (spaces, #, ?, []). Windows paths (C:/...) get
 * the extra leading slash (file:///C:/...). Already-file:// input is passed through.
 * @param {string} p
 * @returns {string}
 */
export function toFileUrl(p) {
  if (p.startsWith('file://')) return p;
  const normalized = p.replace(/\\/g, '/');
  const isWin = /^[a-zA-Z]:\//.test(normalized);
  const encoded = encodeURI(normalized)
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
    .replace(/\[/g, '%5B')
    .replace(/\]/g, '%5D');
  return isWin ? 'file:///' + encoded : 'file://' + encoded;
}

/**
 * A file:// URL with a cache-busting `?v=` fingerprint (e.g. mtime+size).
 * Chromium keys its cache on the full URL, so a changed fingerprint forces the
 * <img> to re-read the file from disk instead of serving a stale or partially
 * decoded cached copy. With no fingerprint, returns the plain file:// URL.
 * @param {string} p absolute path
 * @param {string|number} [fingerprint]
 * @returns {string}
 */
export function bustedFileUrl(p, fingerprint) {
  const base = toFileUrl(p);
  if (fingerprint === undefined || fingerprint === null || fingerprint === '') return base;
  return base + (base.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(fingerprint);
}
