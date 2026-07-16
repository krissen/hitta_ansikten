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
// The scanning dimensions that define WHICH files a count scans. Single source of
// truth shared by statsScopeFromQuery (which builds the scope from these fields)
// and scanScopeKey (which keys the live-stats blank-on-scope-change guard). Adding
// a new scanning dimension here updates both, so the panel can't silently stop
// blanking on a new field. Deliberately excludes baseline/min_images (counting
// options, appended separately) and player (a file-list filter, not a scan field).
export const SCAN_SCOPE_FIELDS = ['roots', 'globs', 'extension_preset', 'recursive', 'date_from', 'date_to'];

export function statsScopeFromQuery(q, countSettings) {
  if (!q) return null;
  const scope = {};
  for (const f of SCAN_SCOPE_FIELDS) scope[f] = q[f];
  if (countSettings) {
    scope.baseline = countSettings.baseline;
    scope.min_images = countSettings.minImages;
  }
  return scope;
}

// Stable key over ONLY the scan fields of a scope, for detecting a scan-scope
// change (the live stats panel blanks when it changes). Fields are read in the
// fixed SCAN_SCOPE_FIELDS order so the key is order-stable; a missing field
// normalizes to null so absent vs. explicit-null don't key differently. Arrays
// (roots/globs) compare by value via JSON.stringify.
export function scanScopeKey(scope) {
  if (!scope) return null;
  const norm = {};
  for (const f of SCAN_SCOPE_FIELDS) norm[f] = scope[f] ?? null;
  return JSON.stringify(norm);
}

export function isRaw(p) {
  const i = p.lastIndexOf('.');
  return i !== -1 && RAW_EXTS.includes(p.slice(i).toLowerCase());
}

// Culling's file-type control only knows jpg/nef/raw; Räkna spelare also offers
// images/all. Map a preset culling can't represent (or a missing one) to jpg, so
// the dropdown isn't desynced and the list never includes types culling can't
// expose. Shared by the scan-scope adopt-on-mount and the Räkna→Gallra hand-off
// (cull-player) so the two agree on which presets survive the transition.
export function cullingPresetFrom(preset) {
  return ['jpg', 'nef', 'raw'].includes(preset) ? preset : 'jpg';
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
