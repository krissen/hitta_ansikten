/**
 * Pure FlexLayout tabset helpers (no React, so they are unit-testable in
 * isolation).
 */

import { Actions } from 'flexlayout-react';

/**
 * Choose which tabset a newly-opened module should dock into.
 *
 * Prefers the active tabset (where the user is working). When there is none —
 * e.g. right after a layout loads from the landing page, before the user has
 * clicked any tab — it falls back to the LARGEST tabset by rendered area so the
 * module lands in the main working area, not a narrow side column.
 *
 * Race guard: immediately after a layout loads, the render/measure pass may not
 * have run yet and every tabset rect is still 0. An area-only pick would then
 * land on the first-visited tabset (the narrow 15% Review column), opening the
 * module in a cramped side panel while the user watches the large Image Viewer —
 * so the switch appears to do nothing. When no area is measured yet, fall back
 * to the highest-WEIGHT tabset (the main area).
 *
 * @param {import('flexlayout-react').Model} model
 * @returns {import('flexlayout-react').TabSetNode | null}
 */
export function resolveTargetTabset(model) {
  const active = model.getActiveTabset();
  if (active) return active;

  // Belt-and-braces: the workspace now calls ensureActiveTabset() right after
  // every Model.fromJson, so a loaded model always has an active tabset and the
  // fallback below is effectively dead in normal use. It's kept deliberately —
  // this stays correct for any caller or code path that reaches a model before
  // the guarantee has run.

  let bestArea = 0;
  let bestWeight = -1;
  let byArea = null;
  let byWeight = null;
  model.visitNodes((node) => {
    if (node.getType() !== 'tabset') return;
    const rect = node.getRect?.();
    const area = rect ? rect.width * rect.height : 0;
    if (area > bestArea) { bestArea = area; byArea = node; }
    const weight = node.getWeight?.() ?? 0;
    if (weight > bestWeight) { bestWeight = weight; byWeight = node; }
  });
  return byArea || byWeight;
}

/**
 * Guarantee that a freshly-loaded model has exactly one active tabset.
 *
 * FlexLayout's `getActiveTabset()` returns undefined until something sets it —
 * typically the user's first tab click. That gap is the double-trash hazard
 * (#159 follow-up): with NO active tabset, every visible module's keyboard gate
 * (isTabsetActive) fails OPEN, so a hand-built split showing both Review and
 * Culling could route one Cmd+Backspace to BOTH. Setting a deterministic active
 * tabset immediately after load collapses that window — the gate then always
 * elects exactly one owner.
 *
 * Rule: no-op when a tabset is already active. Otherwise prefer the maximized
 * tabset (if the layout restored one), else the same target `resolveTargetTabset`
 * would dock into (largest rendered area, or highest weight before the first
 * measure pass) — the main working area.
 *
 * Call once per `Model.fromJson`. Returns whether an active tabset was applied.
 *
 * @param {import('flexlayout-react').Model} model
 * @returns {boolean} true if an active tabset was set, false if already active
 */
export function ensureActiveTabset(model) {
  if (!model) return false;
  if (model.getActiveTabset()) return false;

  const target = model.getMaximizedTabset?.() || resolveTargetTabset(model);
  if (!target) return false;

  model.doAction(Actions.setActiveTabset(target.getId()));
  return true;
}
