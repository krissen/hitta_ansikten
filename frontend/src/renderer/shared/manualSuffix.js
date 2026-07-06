/**
 * Client-side normalizer for the free-text filename suffix.
 *
 * Mirrors the backend `normalize_suffix` (api/services/manual_suffix_service.py)
 * so the live preview matches the name the backend will actually produce:
 *   - trim surrounding whitespace
 *   - collapse runs of whitespace into a single underscore
 *   - fold diacritics (å/ä -> a, ö -> o, à -> a, ...) via NFKD + strip marks
 *   - replace path separators (/ \ \0) with underscore
 *   - collapse repeated underscores, trim leading/trailing underscores
 *
 * Returns '' for empty / whitespace-only / path-only input.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSuffix(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';
  // Whitespace runs -> single underscore
  s = s.replace(/\s+/g, '_');
  // Fold diacritics: decompose then drop combining marks
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  // Path-safety: replace separators / backslash / null with underscore
  s = s.replace(/[/\\\0]/g, '_');
  // Collapse repeated underscores and trim edges
  s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return s;
}
