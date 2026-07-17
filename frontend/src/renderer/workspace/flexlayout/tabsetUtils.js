/**
 * Pure FlexLayout tabset helpers (no React, so they are unit-testable in
 * isolation).
 */

import { Actions, DockLocation } from 'flexlayout-react';

/**
 * Collect every tabset in the model with its geometry, for placement decisions.
 *
 * @param {import('flexlayout-react').Model} model
 * @returns {Array<{ node: object, weight: number, rect: object|null, area: number }>}
 */
function collectTabsets(model) {
  const tabsets = [];
  model.visitNodes((node) => {
    if (node.getType() !== 'tabset') return;
    const rect = node.getRect?.() || null;
    const area = rect ? rect.width * rect.height : 0;
    tabsets.push({ node, weight: node.getWeight?.() ?? 0, rect, area });
  });
  return tabsets;
}

/**
 * The main working area: the LARGEST tabset by rendered area, falling back to
 * the highest WEIGHT before the first measure pass (when every rect is still 0).
 *
 * Race guard: immediately after a layout loads, the render/measure pass may not
 * have run yet and every tabset rect is 0. An area-only pick would then land on
 * the first-visited tabset (the narrow 15% side column). The weight fallback
 * keeps the main area as the target in that window.
 *
 * @param {import('flexlayout-react').Model} model
 * @returns {object | null} the tabset node, or null if there are none.
 */
function largestTabset(model) {
  let bestArea = 0;
  let bestWeight = -1;
  let byArea = null;
  let byWeight = null;
  for (const ts of collectTabsets(model)) {
    if (ts.area > bestArea) { bestArea = ts.area; byArea = ts.node; }
    if (ts.weight > bestWeight) { bestWeight = ts.weight; byWeight = ts.node; }
  }
  return byArea || byWeight;
}

/**
 * Choose which tabset a newly-opened module should dock into.
 *
 * Prefers the active tabset (where the user is working). When there is none —
 * e.g. right after a layout loads from the landing page, before the user has
 * clicked any tab — it falls back to the LARGEST tabset by rendered area so the
 * module lands in the main working area, not a narrow side column.
 *
 * This is the ACTIVE-tabset choice used for keyboard ownership and legacy
 * openers. Deterministic placement-on-open lives in resolvePlacementTabset.
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
  return largestTabset(model);
}

/**
 * The narrow side column to reuse for a 'side' module, or null if none exists.
 *
 * A side column is any tabset strictly narrower than the main area. When
 * geometry is measured, the LEFT-most narrow tabset wins (side columns live to
 * the left of main); before the first measure pass — every rect 0 — the pick
 * falls back to the narrowest by weight.
 *
 * @param {import('flexlayout-react').Model} model
 * @param {object} main the main-area tabset node to compare against.
 * @returns {object | null}
 */
function narrowSideTabset(model, main) {
  const mainWeight = main.getWeight?.() ?? 0;
  const mainRect = main.getRect?.() || null;
  const narrow = collectTabsets(model)
    .filter((ts) => ts.node !== main && ts.weight < mainWeight);
  if (!narrow.length) return null;

  if (mainRect) {
    const left = narrow.filter((ts) => ts.rect && ts.rect.x < mainRect.x);
    if (left.length) {
      left.sort((a, b) => a.rect.x - b.rect.x);
      return left[0].node;
    }
  }
  narrow.sort((a, b) => a.weight - b.weight);
  return narrow[0].node;
}

/**
 * The bottom bar to reuse for a 'bottom' module, or null if none exists.
 *
 * A bottom bar is a tabset (other than main) that sits in the lower half of the
 * main area. Only detectable once geometry is MEASURED: FlexLayout's getRect()
 * returns a zero-sized Rect (not null) before the first render/measure pass, so
 * an unmeasured main would give threshold 0 and wrongly match every other
 * unmeasured tabset at y === 0 (e.g. the left Review column) — stacking Log
 * Viewer into the side panel instead of splitting a bottom bar. Require non-zero
 * dimensions on both the main area and the candidate; until they're measured
 * this returns null and the caller creates a fresh BOTTOM split.
 *
 * @param {import('flexlayout-react').Model} model
 * @param {object} main the main-area tabset node to compare against.
 * @returns {object | null}
 */
function isMeasured(rect) {
  return !!rect && rect.width > 0 && rect.height > 0;
}

function bottomBarTabset(model, main) {
  const mainRect = main.getRect?.() || null;
  if (!isMeasured(mainRect)) return null;
  const threshold = mainRect.y + mainRect.height * 0.5;
  const below = collectTabsets(model)
    .filter((ts) => ts.node !== main && isMeasured(ts.rect) && ts.rect.y >= threshold);
  if (!below.length) return null;
  below.sort((a, b) => b.rect.y - a.rect.y);
  return below[0].node;
}

/**
 * Deterministic placement for a newly-opened module, driven by its ROLE rather
 * than by wherever the user last clicked. This is the fix for the "same command,
 * different result" problem: a 'main' module always lands in the main working
 * area even when a narrow side column happens to be the active tabset.
 *
 * Return contract (a placement descriptor, no side effects):
 *   { tabsetId }               dock as a CENTER tab into an existing tabset.
 *   { split, refTabsetId }     create a new tabset by splitting `refTabsetId`;
 *                              `split` is 'left' or 'bottom'.
 *   null                       no tabset exists to place against.
 *
 * Roles:
 *   'main'   → the largest tabset (area, weight fallback).
 *   'side'   → an existing narrow left column if one exists, else a LEFT split
 *              off the main area.
 *   'bottom' → an existing bottom bar if one exists, else a BOTTOM split off the
 *              main area.
 *
 * @param {import('flexlayout-react').Model} model
 * @param {'main' | 'side' | 'bottom'} role
 * @returns {{ tabsetId: string } | { split: 'left' | 'bottom', refTabsetId: string } | null}
 */
export function resolvePlacementTabset(model, role) {
  const main = largestTabset(model);
  if (!main) return null;

  if (role === 'side') {
    const side = narrowSideTabset(model, main);
    return side ? { tabsetId: side.getId() } : { split: 'left', refTabsetId: main.getId() };
  }

  if (role === 'bottom') {
    const bottom = bottomBarTabset(model, main);
    return bottom ? { tabsetId: bottom.getId() } : { split: 'bottom', refTabsetId: main.getId() };
  }

  // 'main' (and any unknown role): the main working area.
  return { tabsetId: main.getId() };
}

/**
 * Add a tab into the model at a resolved placement, sizing a fresh split to the
 * module's declared role weight. Returns the added TabNode (or whatever
 * doAction returns).
 *
 * Placement forms (from resolvePlacementTabset):
 *   { tabsetId }            → add as a CENTER tab into that tabset (no resize).
 *   { split, refTabsetId }  → split `refTabsetId` LEFT/BOTTOM into a new tabset.
 *
 * Split sizing: FlexLayout 0.8.17 gives a fresh split its default weight, which
 * HALVES the target — so a 15%-catalog side pane would open at 50% and could end
 * up with a weight >= the main area, which then breaks role resolution (main is
 * picked by weight). When `paneWeight` is given for a split, pin the new tabset
 * to it and give the rest (100 - paneWeight) to the reference tabset, keeping the
 * new side/bottom pane strictly narrower/shorter than main. Weights are relative
 * within their row/column, so the pair renders at paneWeight : (100 - paneWeight).
 *
 * @param {import('flexlayout-react').Model} model
 * @param {object} tabJson the tab node JSON to add.
 * @param {{ tabsetId: string } | { split: 'left' | 'bottom', refTabsetId: string }} placement
 * @param {number | null} [paneWeight] declared role weight for split sizing.
 * @returns {object}
 */
export function applyPlacement(model, tabJson, placement, paneWeight = null) {
  if (placement.tabsetId) {
    // select=true so the new tab is shown (not added behind the current one).
    return model.doAction(Actions.addNode(tabJson, placement.tabsetId, DockLocation.CENTER, -1, true));
  }

  const location = placement.split === 'bottom' ? DockLocation.BOTTOM : DockLocation.LEFT;
  const added = model.doAction(Actions.addNode(tabJson, placement.refTabsetId, location, -1, true));

  const newTabsetId = added?.getParent?.()?.getId?.();
  if (newTabsetId && paneWeight != null) {
    model.doAction(Actions.updateNodeAttributes(newTabsetId, { weight: paneWeight }));
    model.doAction(Actions.updateNodeAttributes(placement.refTabsetId, { weight: 100 - paneWeight }));
  }
  return added;
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
