// Shared session-only player reclassification (the right-click moves in
// Räkna spelare and the culling stats column). Holds four name lists — one per
// bucket a name can be pinned to for the session: spelare (force-include,
// bypasses exclusions AND min_images), tranare, publik, grupp. A name lives in
// at most one list. The lists are sent as per-request pins to /players/count
// (`spelare` / `session_*` fields) and are never persisted to config.
//
// Backed by sessionStorage (like scanScope.js/workingFolder.js): survives a
// renderer reload (Cmd+R), clears when the app quits — "session" literally.
// Both consumers subscribe, so a move made in one module updates the other.

import { t } from '../../i18n/index.js';

const STORAGE_KEY = 'ansikten.playerSession';

export const SESSION_BUCKETS = ['spelare', 'tranare', 'publik', 'grupp'];

const EMPTY = { spelare: [], tranare: [], publik: [], grupp: [] };

let current = { ...EMPTY };
let hydrated = false;
const subscribers = new Set();

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      current = Object.fromEntries(
        SESSION_BUCKETS.map((k) => [k, Array.isArray(parsed[k]) ? parsed[k] : []])
      );
    }
  } catch {
    /* ignore — unreadable/parse error just means no restored session moves */
  }
}

/** Current session moves: { spelare, tranare, publik, grupp } (name arrays). */
export function getPlayerSession() {
  hydrate();
  return current;
}

/** True when no session move is active. */
export function playerSessionIsEmpty(session = getPlayerSession()) {
  return SESSION_BUCKETS.every((k) => session[k].length === 0);
}

/**
 * Pin `name` to `bucket` ('spelare' | 'tranare' | 'publik' | 'grupp') for the
 * session, removing it from every other bucket. Notifies subscribers.
 */
export function movePlayerSession(name, bucket) {
  const clean = (name || '').trim();
  if (!clean || !SESSION_BUCKETS.includes(bucket)) return;
  hydrate();
  current = Object.fromEntries(
    SESSION_BUCKETS.map((k) => {
      const rest = current[k].filter((n) => n !== clean);
      return [k, k === bucket ? [...rest, clean] : rest];
    })
  );
  persist();
  notify();
}

/** Remove `name` from every session bucket (undo its session move). */
export function removePlayerSession(name) {
  hydrate();
  current = Object.fromEntries(
    SESSION_BUCKETS.map((k) => [k, current[k].filter((n) => n !== name)])
  );
  persist();
  notify();
}

/** Clear all session moves. Notifies subscribers. */
export function clearPlayerSession() {
  hydrated = true;
  current = { ...EMPTY };
  persist();
  notify();
}

/**
 * Subscribe to session-move changes. Returns an unsubscribe function.
 * The callback receives the current session object.
 */
export function subscribePlayerSession(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/**
 * The /players/count request fields for the current session moves
 * (null fields when a list is empty, matching the API's "no pin" default).
 */
export function playerSessionParams(session = getPlayerSession()) {
  return {
    spelare: session.spelare.length ? session.spelare : null,
    session_tranare: session.tranare.length ? session.tranare : null,
    session_publik: session.publik.length ? session.publik : null,
    session_grupp: session.grupp.length ? session.grupp : null,
  };
}

/**
 * Context-menu action keys for a name in result bucket `bucket`
 * ('players' | 'below_threshold' | 'tranare' | 'publik' | 'grupp').
 * 'sep' marks a separator; consumers map keys to labels and handlers
 * (i18n: playerCount.contextMenu.<key>). Pure — unit-tested.
 */
export function contextMenuItemsFor(bucket) {
  switch (bucket) {
    case 'players':
      return ['toPublikSession', 'toTranareSession', 'toGruppSession', 'sep', 'publikPermanent'];
    case 'below_threshold':
      // Already a player by classification, but under min_images — the pin
      // ("gör till spelare") is what lifts it past the threshold.
      return ['toPlayerSession', 'toPublikSession', 'toTranareSession', 'toGruppSession', 'sep', 'publikPermanent'];
    case 'publik':
      return ['toPlayerSession', 'toTranareSession', 'toGruppSession', 'sep', 'publikPermanent'];
    case 'tranare':
      return ['toPlayerSession', 'toPublikSession', 'toGruppSession'];
    case 'grupp':
      return ['toPlayerSession', 'toPublikSession', 'toTranareSession'];
    default:
      return [];
  }
}

/** The session bucket a context-menu action key pins to. */
export const ACTION_TO_BUCKET = {
  toPlayerSession: 'spelare',
  toPublikSession: 'publik',
  toTranareSession: 'tranare',
  toGruppSession: 'grupp',
};

/**
 * Items for the shared <ContextMenu> for a name in `bucket`. Session moves go
 * through the store (movePlayerSession); the permanent action is delegated to
 * `onPermanent(name)` since it needs the API client + module error surface.
 * The menu payload `m` is `{ name, bucket, x, y }` from useContextMenu.
 */
export function buildPlayerMenuItems(bucket, onPermanent) {
  return contextMenuItemsFor(bucket).map((key, i) =>
    key === 'sep'
      ? { key: `sep-${i}`, separator: true }
      : {
          key,
          label: t(`playerCount.contextMenu.${key}`),
          onClick: (m) =>
            key === 'publikPermanent'
              ? onPermanent(m.name)
              : movePlayerSession(m.name, ACTION_TO_BUCKET[key]),
        }
  );
}

/**
 * Persist ONLY "name is publik" to the config (unlike the count module's
 * "Spara som standard", which persists every unsaved editor change). Built on
 * the RAW config lists from the GET (`config` field) — not the resolved view —
 * so active RAKNA_* env values are never echoed into the file. Also pins the
 * name to publik for the session so every open view reflects the change
 * immediately. Throws on HTTP failure (caller surfaces the error).
 */
export async function persistPublikPermanent(api, name) {
  const clean = (name || '').trim();
  if (!clean) return;
  const cfg = await api.get('/api/v1/players/exclusions');
  const raw = cfg.config || { tranare: [], publik: [] };
  if (!(raw.publik || []).includes(clean)) {
    // The backend strips always-markers/dupes from the posted list.
    await api.post('/api/v1/players/exclusions', {
      tranare: raw.tranare || [],
      publik: [...(raw.publik || []), clean],
    });
  }
  movePlayerSession(clean, 'publik');
}

function persist() {
  try {
    if (playerSessionIsEmpty(current)) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* ignore — storage unavailable/full just falls back to in-memory only */
  }
}

function notify() {
  for (const cb of subscribers) {
    try {
      cb(current);
    } catch {
      /* a broken subscriber must not stop the others */
    }
  }
}
