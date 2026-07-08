// raw-match.js
// Pure helpers for matching a viewed image (JPEG) to its original RAW/NEF.
//
// The developed JPEG and its source NEF live in different directory trees and do
// NOT share a full filename — only the leading timestamp token is common. The
// filename scheme is `YYMMDD_HHMMSS[-N][_names].<ext>` (see CLAUDE.md gotcha), so
// the reliable join key is the leading `\d{6}_\d{6}(-\d+)?` token.
//
// Kept dependency-free and side-effect-free so it is unit-testable; the recursive
// filesystem walk lives in index.js.

// Leading `YYMMDD_HHMMSS` with an optional `-N` burst counter.
const TOKEN_RE = /^(\d{6}_\d{6}(?:-\d+)?)/;

const DEFAULT_RAW_EXTS = ['.nef'];

/**
 * Extract the leading timestamp token from a basename.
 * @param {string} basename e.g. "260626_194742_ArvidJ.jpg"
 * @returns {string|null} e.g. "260626_194742", or null if no token present
 */
function deriveRawToken(basename) {
  if (typeof basename !== 'string') return null;
  const m = basename.match(TOKEN_RE);
  return m ? m[1] : null;
}

/**
 * True when a candidate filename is a RAW file whose leading token matches
 * `token` exactly. Exact (not prefix) equality so a JPEG without a `-N` counter
 * (`260627_173803`) does not match a burst NEF (`260627_173803-1.NEF`).
 * @param {string} basename candidate filename
 * @param {string} token target token from the JPEG (see deriveRawToken)
 * @param {string[]} [rawExts] allowed RAW extensions, lowercase with dot
 * @returns {boolean}
 */
function basenameMatchesToken(basename, token, rawExts = DEFAULT_RAW_EXTS) {
  if (!token || typeof basename !== 'string') return false;
  const lower = basename.toLowerCase();
  const hasRawExt = rawExts.some((ext) => lower.endsWith(ext.toLowerCase()));
  if (!hasRawExt) return false;
  return deriveRawToken(basename) === token;
}

module.exports = { deriveRawToken, basenameMatchesToken, DEFAULT_RAW_EXTS };
