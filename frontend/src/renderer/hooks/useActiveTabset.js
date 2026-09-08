/**
 * useActiveTabset - "Should this module own the keyboard right now?"
 *
 * A module that installs a document-level keydown listener must not fire when a
 * DIFFERENT panel is the one the user is driving. Gating on `node.isVisible()`
 * alone is not enough: in a split layout two panels are both visible, so a
 * single keypress can reach BOTH (the double-trash bug — Review and Culling
 * both binding Cmd+Backspace on visibility-gated listeners). The active tabset
 * is the discriminator: FlexLayout tracks exactly one active tabset at a time.
 *
 * Companions
 * ----------
 * A strict "my tabset is active" gate would break the normal review flow: the
 * user clicks the image (making ImageViewer's tabset active) and then presses a
 * confirm/nav key expecting Review — whose tab is now merely visible, not
 * active — to handle it. So the predicate also passes when the active tabset
 * hosts a declared *companion* module (a keyboard-less surface that belongs to
 * the same flow, e.g. `image-viewer` / `original-view` for the review flow).
 * Companions must have no global key listener of their own, so widening the
 * gate to them can't reintroduce cross-talk.
 *
 * Staying current
 * ---------------
 * The predicate reads the live model on every call (like CullingModule's
 * capture-phase gate does) rather than caching a boolean. This is deliberate:
 * the consuming keydown listener is attached once and would capture a stale
 * boolean, whereas a function that reads `model.getActiveTabset()` at event
 * time is always current — FlexLayout has already updated the model by the time
 * the next key is pressed, so no model change listener is needed for a gate.
 */

import { useCallback } from 'react';

/** Id of the tabset FlexLayout currently treats as active (or null). */
export function activeTabsetId(node) {
  return node?.getModel?.()?.getActiveTabset?.()?.getId?.() ?? null;
}

/** Id of the tabset hosting this module's tab (or null). */
export function ownTabsetId(node) {
  return node?.getParent?.()?.getId?.() ?? null;
}

/** Component id of the selected tab in the active tabset (or null). */
export function activeTabsetComponent(node) {
  const active = node?.getModel?.()?.getActiveTabset?.();
  return active?.getSelectedNode?.()?.getComponent?.() ?? null;
}

/**
 * Pure predicate: may the module owning `node` handle keyboard input now?
 *
 * @param {Object|null} node - The module's FlexLayout node. `null` (standalone
 *   render / test harness) is treated as active.
 * @param {Object} [options]
 * @param {string[]} [options.companions] - Component ids whose active tabset
 *   should also keep this module's keyboard live.
 * @returns {boolean}
 */
export function isTabsetActive(node, { companions = [] } = {}) {
  // Standalone / test harness: no node → always active.
  if (!node) return true;
  // A hidden tab never owns the keyboard, regardless of the active tabset.
  if (node.isVisible?.() === false) return false;
  const activeId = activeTabsetId(node);
  const mineId = ownTabsetId(node);
  // Model not resolvable (e.g. a bare `{ isVisible }` stub): fall back to the
  // visibility check already passed above.
  if (!activeId || !mineId) return true;
  if (activeId === mineId) return true;
  // My tabset isn't active, but a companion module hosts the active tabset
  // (e.g. the user clicked the image and then pressed a key).
  if (companions.length) {
    const comp = activeTabsetComponent(node);
    if (comp && companions.includes(comp)) return true;
  }
  return false;
}

/**
 * Hook wrapper: returns a stable `isActive()` predicate that reads the live
 * model each call. Pass it straight to a keydown gate (e.g. useReviewKeyboard's
 * `isActive` option).
 *
 * @param {Object|null} node - The module's FlexLayout node.
 * @param {Object} [options]
 * @param {string[]} [options.companions]
 * @returns {() => boolean}
 */
export function useActiveTabset(node, options = {}) {
  const companions = options.companions || [];
  const companionsKey = companions.join(',');
  return useCallback(
    () => isTabsetActive(node, { companions }),
    // companionsKey stands in for the companions array identity.
    [node, companionsKey]
  );
}

export default useActiveTabset;
