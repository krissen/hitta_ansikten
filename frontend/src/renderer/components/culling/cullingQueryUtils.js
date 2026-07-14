/**
 * Pure query/path helpers extracted from CullingModule.
 *
 * These are side-effect-free and independently unit-tested
 * (see tests/cullingQueryUtils.test.js). Kept out of the component shell so
 * the culling query/scope logic can be reasoned about and tested in isolation.
 */

import { RAW_EXTS } from '../../shared/fileExts.js';

// The live stats panel counts every player in the folder, so it uses the scan
// scope only — not the player/name_glob filter that narrows the file list.
// `countSettings` (the shared { baseline, minImages } store) is folded in when
// provided so the stats panel's baseline choice and min_images match the Räkna
// spelare page; omitted (e.g. when the result feeds setScanScope, which must stay
// pure scan-scope) it leaves those out and the backend defaults apply. Exclusions
// still come from the count endpoint's config so coaches/audience/below-threshold
// names land in `excluded`, not in the live count.
export function statsScopeFromQuery(q, countSettings) {
  if (!q) return null;
  const scope = {
    roots: q.roots,
    globs: q.globs,
    extension_preset: q.extension_preset,
    recursive: q.recursive,
    date_from: q.date_from,
    date_to: q.date_to,
  };
  if (countSettings) {
    scope.baseline = countSettings.baseline;
    scope.min_images = countSettings.minImages;
  }
  return scope;
}

export function isRaw(p) {
  const i = p.lastIndexOf('.');
  return i !== -1 && RAW_EXTS.includes(p.slice(i).toLowerCase());
}

export function globBaseDir(pattern) {
  const idx = pattern.search(/[*?[]/);
  const literal = idx === -1 ? pattern : pattern.slice(0, idx);
  const slash = literal.lastIndexOf('/');
  return slash === -1 ? '' : literal.slice(0, slash);
}

// Separator-agnostic basename so paths with Windows backslashes resolve too
// (the backend returns native str(Path) values). Without this, the inline-rename
// no-op guard never matches on Windows and an unchanged rename would advance.
export function basename(p) {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
