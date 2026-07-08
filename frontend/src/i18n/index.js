/**
 * Lightweight i18n for the Ansikten app.
 *
 * Single display language (Swedish) held in a keyed catalog, so user-facing
 * strings live in one place instead of scattered inline. CommonJS so the
 * Electron main process (menu.js) and the bundled renderer share one catalog.
 *
 * Not a full i18n framework (YAGNI — the app is Swedish-only). The keyed shape
 * leaves the door open to adding locales later without touching call sites.
 *
 * Usage:
 *   const { t } = require('./i18n');    // main process (relative to menu.js: ../i18n)
 *   import { t } from '../../../i18n/index.js';    // renderer (esbuild resolves CJS)
 *   t('modules.review-module')                     // → "Granska ansikten"
 *   t('common.selectedCount', { count: 2 })        // interpolation + plural → "2 valda"
 */

const sv = require('./sv/index.js');

const catalogs = { sv };
let locale = 'sv';

function resolve(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function interpolate(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (_, name) =>
    vars[name] != null ? String(vars[name]) : `{${name}}`
  );
}

/**
 * Translate a dotted key from the active catalog.
 *
 * - Interpolates `{name}` placeholders from `vars`.
 * - Simple plural: if the entry is a `{ one, other }` object, selects by
 *   `vars.count` (1 → one, otherwise other).
 * - Missing key returns the key itself, so gaps surface as visible text rather
 *   than blanks.
 *
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 * @returns {string}
 */
function t(key, vars = {}) {
  let entry = resolve(catalogs[locale], key);
  if (entry == null) return key;
  if (typeof entry === 'object') {
    if ('one' in entry || 'other' in entry) {
      // Pick by count, but fall back to whichever plural form exists so a
      // half-defined entry can't render as the literal "undefined".
      const picked = vars.count === 1 ? entry.one : entry.other;
      entry = picked != null ? picked : entry.other != null ? entry.other : entry.one;
    } else {
      // A namespace object, not a leaf string — treat as a missing key.
      return key;
    }
    if (entry == null) return key;
  }
  return interpolate(entry, vars);
}

function setLocale(next) {
  if (catalogs[next]) locale = next;
}

function getLocale() {
  return locale;
}

module.exports = { t, setLocale, getLocale };
