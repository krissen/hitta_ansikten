// Pure helpers for the player-name part of a culling filename.
//
// Filename shape (mirrors the backend — rakna_spelare.parse_filename and
// rename_service's nameSeparator): a prefix `YYMMDD_HHMMSS` with an optional
// `-N` collision suffix, then `_` begins the description, then the player names
// joined by `,_` (so a comma only appears when there is more than one name).
//
// This module only ever REMOVES names from an existing filename — it never
// adds or reconstructs them. It splits the original description on `,_`, drops
// the toggled-off pieces (matched on their cleaned form, sans any `-N`), and
// rejoins on `,_`. Because it reuses the original verbatim name pieces, the
// only "format" decisions are the prefix boundary and the comma — and the comma
// falls out of join(): >1 name keeps commas, 1 name has none, 0 names leaves a
// bare timestamp.

const NAME_SEP = ',_';
// Prefix = YYMMDD_HHMMSS, optional -N collision suffix (and a short legacy alpha
// tag the backend tolerates), up to the `_` that starts the description.
const PREFIX_RE = /^(\d{6}_\d{6}(?:-\d+)?[a-zA-Z]{0,3})_(.*)$/;

function splitExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}

/** A name piece's display form: the trailing `-N` disambiguation is dropped. */
export function cleanName(part) {
  return part.replace(/-\d+$/, '');
}

/**
 * Removable names in a filename: the cleaned, de-duplicated player names, in
 * filename order. Returns [] when the name isn't the expected shape or has no
 * description part (so callers can simply hide the toggle UI).
 */
export function namesInBasename(basename) {
  const [stem] = splitExt(basename);
  const m = stem.match(PREFIX_RE);
  if (!m) return [];
  const out = [];
  for (const part of m[2].split(NAME_SEP)) {
    const c = cleanName(part);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * New basename with the cleaned names in `removeSet` (a Set of cleaned names)
 * removed. Returns null when the filename isn't the expected shape, so the
 * caller offers no rename rather than risk corrupting it. When every name is
 * removed the result is the bare `prefix.ext`.
 */
export function removeNamesFromBasename(basename, removeSet) {
  const [stem, ext] = splitExt(basename);
  const m = stem.match(PREFIX_RE);
  if (!m) return null;
  const kept = m[2].split(NAME_SEP).filter((p) => !removeSet.has(cleanName(p)));
  return kept.length ? `${m[1]}_${kept.join(NAME_SEP)}${ext}` : `${m[1]}${ext}`;
}
