/**
 * nameAutocomplete - Pure ranking for the review name-input autocomplete.
 *
 * Extracted verbatim from FaceCard's inline filter so the ranking can be unit
 * tested directly (the DOM characterization tests only reach it indirectly).
 */

const DEFAULT_LIMIT = 8;

/**
 * Rank candidate names for a typed query.
 *
 * Prefix matches (case-insensitive `startsWith`) come first, then substring
 * matches (`includes` but not a prefix). Names matching neither are excluded.
 * An empty/whitespace query yields no suggestions. The result is capped at
 * `limit` entries.
 *
 * @param {string} query - The typed value.
 * @param {string[]} names - Candidate person names.
 * @param {number} [limit=8] - Maximum number of suggestions to return.
 * @returns {string[]} Ranked, capped suggestion list.
 */
export function rank(query, names, limit = DEFAULT_LIMIT) {
  if (!query?.trim()) return [];
  const typed = query.toLowerCase();
  const startsWithMatch = names.filter(p => p.toLowerCase().startsWith(typed));
  const containsMatch = names.filter(p =>
    !p.toLowerCase().startsWith(typed) && p.toLowerCase().includes(typed)
  );
  return [...startsWithMatch, ...containsMatch].slice(0, limit);
}

export default rank;
