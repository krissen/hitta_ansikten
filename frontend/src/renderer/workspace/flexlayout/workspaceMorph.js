/**
 * Workspace morphing engine.
 *
 * `applyWorkspace(model, spec, { keepDirty })` reshapes the LIVE FlexLayout model
 * into a step's declarative pane spec (workflows.js) using only FlexLayout
 * Actions — no Model.fromJson replace. Because Actions.moveNode retains a tab's
 * node id, React keeps the same component instance across the move, so a module
 * that is already mounted KEEPS ITS STATE when a step switch repositions it
 * (verified empirically in tests/moveNodeStatePreservation.test.jsx).
 *
 * This is what makes step switching non-destructive: a mid-processing File Queue
 * or a Review panel with unsaved edits survives the switch instead of being torn
 * down and rebuilt (the old loadLayout/openModuleSolo replaced the whole model).
 *
 * The function is a PURE function over the model (no React), so it is unit-
 * testable headlessly.
 *
 * Spec shape: each pane becomes one COLUMN (tabset). A single-module pane is a
 * one-tab column; a GROUP pane ({ tabs, active }) is a column with several
 * stacked tabs, the `active` one on top and the rest hidden behind it. The morph
 * builds exactly one row of columns — it does not do 2D (row/column) nesting.
 *
 * Diff semantics against the live model:
 *   - target modules PRESENT   → moved into position (state preserved).
 *   - target modules ABSENT    → added as fresh tabs.
 *   - non-target tabs          → deleted, EXCEPT keepMounted modules (file-queue)
 *                                and dirty modules (from `keepDirty`), which are
 *                                PARKED in the collapsed bottom "background"
 *                                border (still mounted, out of the way).
 *   - weights                  → each pane's tabset set to the spec proportion.
 *   - active tabset            → the primary (largest-weight) pane, so keyboard
 *                                ownership is deterministic after the morph.
 *   - keepMounted hidden tabs  → pinned enableRenderOnDemand:false so a module
 *                                sitting BEHIND another tab in a group (the File
 *                                Queue behind the Image Viewer) stays mounted.
 */

import { Actions, DockLocation } from 'flexlayout-react';
import {
  primaryModuleOf,
  specModuleIds,
  paneModuleIds,
  paneActiveModule,
  isGroupPane,
} from './workflows.js';
import { isKeepMountedModule, MODULE_TITLES } from './moduleRegistry.js';

/** Display title for a module tab, falling back to its id. */
function tabName(moduleId) {
  return MODULE_TITLES[moduleId] || moduleId;
}

/** All tab nodes in the model (includes tabs parked in borders). */
function allTabNodes(model) {
  const tabs = [];
  model.visitNodes((n) => {
    if (n.getType() === 'tab') tabs.push(n);
  });
  return tabs;
}

/** Real (non-border) tabsets in visual (left→right) order. */
function orderedTabsets(model) {
  const tabsets = [];
  model.visitNodes((n) => {
    if (n.getType() === 'tabset') tabsets.push(n);
  });
  return tabsets;
}

/** Whether a node currently lives inside a border (i.e. is parked). */
function isInBorder(node) {
  const parent = node.getParent?.();
  return !!parent && parent.getType?.() === 'border';
}

/** The bottom border's node id, or null when the model has no bottom border. */
export function bottomBorderId(model) {
  let id = null;
  model.visitNodes((n) => {
    if (n.getType?.() !== 'border') return;
    const loc = n.getLocation?.();
    const name = loc?.getName?.();
    if (name === 'bottom' || (!name && id === null)) id = n.getId();
  });
  return id;
}

/** First tab node for a module, or null. */
function findTab(model, moduleId) {
  let node = null;
  model.visitNodes((n) => {
    if (!node && n.getType() === 'tab' && n.getComponent?.() === moduleId) node = n;
  });
  return node;
}

/** Whether any tab (parked or not) hosts the module. */
function hasTab(model, moduleId) {
  return !!findTab(model, moduleId);
}

/**
 * The largest real (non-border) tabset by weight, area fallback. Mirrors
 * tabsetUtils' main-area heuristic but kept local so this engine stays a small
 * pure module. Returns null when there is no real tabset.
 */
function baseTabset(model) {
  let best = null;
  let bestWeight = -1;
  let bestArea = -1;
  model.visitNodes((n) => {
    if (n.getType() !== 'tabset') return;
    const weight = n.getWeight?.() ?? 0;
    const rect = n.getRect?.();
    const area = rect ? rect.width * rect.height : 0;
    if (area > bestArea || (area === bestArea && weight > bestWeight)) {
      bestArea = area;
      bestWeight = weight;
      best = n;
    }
  });
  return best;
}

/** The tabset id of a target module that sits in a real tabset, preferring order. */
function anchorTabsetId(model, targetIds) {
  for (const mid of targetIds) {
    const tab = findTab(model, mid);
    if (tab && !isInBorder(tab)) return tab.getParent().getId();
  }
  return null;
}

/**
 * Park a tab in the bottom border: move it there, keep it mounted regardless of
 * selection (enableRenderOnDemand:false), and label it as backgrounded.
 */
function parkTab(model, tab, borderId, backgroundName) {
  const id = tab.getId();
  if (!isInBorder(tab)) {
    model.doAction(Actions.moveNode(id, borderId, DockLocation.CENTER, -1, false));
  }
  // Label the parked tab "<background>: <module>" so several parked modules stay
  // distinguishable (e.g. "Bakgrund: Filkö", "Bakgrund: Granska ansikten").
  const label = backgroundName
    ? `${backgroundName}: ${tabName(tab.getComponent())}`
    : tabName(tab.getComponent());
  model.doAction(Actions.updateNodeAttributes(id, {
    enableRenderOnDemand: false,
    name: label,
  }));
}

/**
 * Pin keepMounted modules to enableRenderOnDemand:false so they stay mounted even
 * when hidden behind another tab in a group (the File Queue behind the Image
 * Viewer). Idempotent — safe to reassert on the fast path.
 */
function pinKeepMounted(model, targetIds) {
  for (const mid of targetIds) {
    if (!isKeepMountedModule(mid)) continue;
    const tab = findTab(model, mid);
    if (tab) {
      model.doAction(Actions.updateNodeAttributes(tab.getId(), { enableRenderOnDemand: false }));
    }
  }
}

/**
 * Whether the model's real (non-border) tabsets already match the spec exactly:
 * one tabset per pane, in order, each holding the pane's modules in tab order.
 * Lets a repeated apply (e.g. File Queue re-entering the review step on every
 * file load) skip all node churn.
 */
function alreadyMatches(model, spec) {
  const tabsets = orderedTabsets(model);
  if (tabsets.length !== spec.length) return false;
  for (let i = 0; i < spec.length; i++) {
    const ids = paneModuleIds(spec[i]);
    const tabs = tabsets[i].getChildren().filter((c) => c.getType?.() === 'tab');
    if (tabs.length !== ids.length) return false;
    for (let j = 0; j < ids.length; j++) {
      if (tabs[j].getComponent?.() !== ids[j]) return false;
    }
  }
  return true;
}

/**
 * Set weights on each pane's tabset and elect an active tabset.
 *
 * Active-tabset rule: if the currently active tabset is ALREADY one of the
 * spec's panes, leave it — this preserves the user's keyboard focus across an
 * idempotent re-entry (the File Queue calls enterStep('review') on every file
 * load, and forcing focus to the Image Viewer each time would break Review's
 * keyboard). Only when the previously active tabset is gone / not part of this
 * step (e.g. arriving from another step) elect the primary (largest-weight) pane.
 */
function applyWeightsAndActive(model, spec) {
  const paneTabsetIds = new Set();
  for (const pane of spec) {
    const anchor = paneModuleIds(pane)[0];
    const tab = anchor ? findTab(model, anchor) : null;
    if (tab && !isInBorder(tab)) {
      const tabsetId = tab.getParent().getId();
      paneTabsetIds.add(tabsetId);
      model.doAction(Actions.updateNodeAttributes(tabsetId, { weight: pane.weight }));
    }
  }

  const activeId = model.getActiveTabset()?.getId();
  if (activeId && paneTabsetIds.has(activeId)) return; // keep the user's focus

  const primary = primaryModuleOf(spec);
  const primaryTab = primary ? findTab(model, primary) : null;
  if (primaryTab && !isInBorder(primaryTab)) {
    model.doAction(Actions.setActiveTabset(primaryTab.getParent().getId()));
  }
}

/**
 * Select each group pane's active module as its tabset's visible tab. Called only
 * on a fresh build (not the idempotent fast path), so it does not fight a user
 * who has switched to the hidden companion tab (e.g. opened the File Queue).
 */
function selectGroupActiveTabs(model, spec) {
  for (const pane of spec) {
    if (!isGroupPane(pane)) continue;
    const active = paneActiveModule(pane);
    const tab = active ? findTab(model, active) : null;
    if (tab && !isInBorder(tab)) {
      model.doAction(Actions.selectTab(tab.getId()));
    }
  }
}

/**
 * Morph the live model into the given pane spec. See file header for semantics.
 *
 * @param {import('flexlayout-react').Model} model
 * @param {import('./workflows.js').Pane[]} spec
 * @param {{ keepDirty?: Set<string>, backgroundName?: string }} [options]
 *   keepDirty      module ids whose live (unsaved) state must be preserved —
 *                  parked rather than deleted, same as keepMounted modules.
 *   backgroundName label applied to parked tabs (Swedish, from i18n).
 */
export function applyWorkspace(model, spec, options = {}) {
  if (!model || !Array.isArray(spec) || spec.length === 0) return;
  const { keepDirty = new Set(), backgroundName } = options;

  const targetIds = specModuleIds(spec);
  const targetSet = new Set(targetIds);
  const borderId = bottomBorderId(model);

  // Fast path: already in the target shape → only reassert weights + active and
  // the keepMounted pins, no node churn (keeps repeated re-entry from the File
  // Queue cheap and non-focus-stealing).
  if (alreadyMatches(model, spec)) {
    applyWeightsAndActive(model, spec);
    pinKeepMounted(model, targetIds);
    return;
  }

  // 1. Add any missing target modules FIRST, while the current tabsets still
  //    exist to host them — deleting non-target tabs (step 2) could otherwise
  //    remove the last tabset and leave addNode with no target.
  const addBase = baseTabset(model);
  for (const mid of targetIds) {
    if (!hasTab(model, mid) && addBase) {
      model.doAction(Actions.addNode(
        { type: 'tab', name: mid, component: mid, config: { moduleId: mid } },
        addBase.getId(),
        DockLocation.CENTER,
        -1,
        false,
      ));
    }
  }

  // 2. Non-target tabs: park keepMounted / dirty modules in the background
  //    border (state preserved); delete the rest. Clean parked leftovers of a
  //    module that is no longer kept get deleted too.
  for (const tab of allTabNodes(model)) {
    const mid = tab.getComponent();
    if (targetSet.has(mid)) continue;
    const keep = isKeepMountedModule(mid) || keepDirty.has(mid);
    if (keep && borderId) {
      parkTab(model, tab, borderId, backgroundName);
    } else {
      model.doAction(Actions.deleteTab(tab.getId()));
    }
  }

  // 3. Collapse all target modules into one real anchor tabset (un-parks any
  //    target that was sitting in the border, restoring its title).
  const anchorId = anchorTabsetId(model, targetIds);
  if (!anchorId) return; // defensive: no real tabset to build into
  for (const mid of targetIds) {
    const tab = findTab(model, mid);
    if (!tab) continue;
    if (tab.getParent().getId() !== anchorId) {
      model.doAction(Actions.moveNode(tab.getId(), anchorId, DockLocation.CENTER, -1, false));
    }
    // Restore a real title in case this tab was parked/backgrounded before.
    model.doAction(Actions.updateNodeAttributes(tab.getId(), { name: tabName(mid) }));
  }

  // 4. Split the stacked modules out into ordered columns, left → right. Pane 0
  //    stays in the anchor tabset; each later pane pulls its FIRST module out to
  //    a new column on the right, then its remaining group members join that same
  //    column as stacked tabs. Since every non-pane-0 module is pulled out, the
  //    anchor ends up holding exactly pane 0's module(s).
  let prevTabsetId = anchorId;
  for (let i = 1; i < spec.length; i++) {
    const ids = paneModuleIds(spec[i]);
    if (ids.length === 0) continue;
    const firstTab = findTab(model, ids[0]);
    if (!firstTab) continue;
    model.doAction(Actions.moveNode(firstTab.getId(), prevTabsetId, DockLocation.RIGHT, -1, false));
    const moved = findTab(model, ids[0]);
    const colId = moved ? moved.getParent().getId() : prevTabsetId;
    for (let j = 1; j < ids.length; j++) {
      const t = findTab(model, ids[j]);
      if (t && t.getParent().getId() !== colId) {
        model.doAction(Actions.moveNode(t.getId(), colId, DockLocation.CENTER, -1, false));
      }
    }
    prevTabsetId = colId;
  }

  // 5. Keep hidden companion modules (File Queue) mounted, then reveal each
  //    group's active tab, then set weights + the active tabset.
  pinKeepMounted(model, targetIds);
  selectGroupActiveTabs(model, spec);
  applyWeightsAndActive(model, spec);
}
