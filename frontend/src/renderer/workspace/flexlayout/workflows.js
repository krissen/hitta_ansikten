/**
 * Declarative workspace specs for the pipeline steps.
 *
 * Each step maps to an ORDERED list of PANES describing the workspace the step
 * should morph the live model into (workspaceMorph.js's applyWorkspace consumes
 * these). The panes render left-to-right as sibling tabsets; weights are relative
 * within the row (FlexLayout normalizes them).
 *
 * A pane is one of two shapes:
 *   - a SINGLE module:  { moduleId: string, weight: number }
 *   - a TAB GROUP:      { tabs: string[], active?: string, weight: number }
 *     — several modules stacked as tabs in ONE tabset (column). `active` is the
 *     module shown on top; the others stay behind it (mounted when keepMounted).
 *
 * The specs are consistent with the role catalog's step metadata: every step's
 * PRIMARY module (the one the catalog tags with that `step`) appears in the
 * spec. The step sequence itself is derived from workflowSteps.js so the
 * Cmd+1..5 accelerators, the WorkflowBar and these specs stay in one order.
 *
 *   import   → import (solo)
 *   rename   → rename-nef (solo)
 *   review   → review-module 15 | [image-viewer (active), file-queue] 85
 *   count    → player-count (solo)
 *   culling  → culling (solo)
 *
 * The review step deliberately puts the File Queue BEHIND the Image Viewer as a
 * companion tab rather than a permanent column: the queue drives review (auto-
 * advance, load-image, trash/undo) from the background and is one keystroke away
 * (Cmd+Shift+U), but does not consume screen space by default. It stays mounted
 * while hidden (keepMounted → enableRenderOnDemand:false) so its state and n/p
 * navigation survive.
 */

import { WORKFLOW_STEPS } from './workflowSteps.js';
import { getModuleStep } from './moduleRegistry.js';

/**
 * A single-module pane, or a grouped-tab pane.
 * @typedef {{ moduleId: string, weight: number }} SinglePane
 * @typedef {{ tabs: string[], active?: string, weight: number }} GroupPane
 * @typedef {SinglePane | GroupPane} Pane
 */

/**
 * Step id → ordered pane list. A solo step is a single pane at full weight.
 * @type {Record<string, Pane[]>}
 */
export const WORKSPACE_SPECS = {
  import: [{ moduleId: 'import', weight: 100 }],
  rename: [{ moduleId: 'rename-nef', weight: 100 }],
  review: [
    { moduleId: 'review-module', weight: 15 },
    {
      tabs: ['image-viewer', 'file-queue'],
      active: 'image-viewer',
      weight: 85,
    },
  ],
  count: [{ moduleId: 'player-count', weight: 100 }],
  culling: [{ moduleId: 'culling', weight: 100 }],
};

// Canonical pipeline step order, derived from the shared catalog so the
// Cmd+1..5 mapping and the bar never drift from workflowSteps.js.
export const WORKFLOW_STEP_SEQUENCE = WORKFLOW_STEPS.map((s) => s.step);

/**
 * The pane spec for a step, or null when the step id is unknown.
 * @param {string} stepId
 * @returns {Pane[] | null}
 */
export function getWorkspaceSpec(stepId) {
  return WORKSPACE_SPECS[stepId] || null;
}

/** Whether a pane is a grouped-tab pane (several modules in one tabset). */
export function isGroupPane(pane) {
  return !!pane && Array.isArray(pane.tabs);
}

/**
 * The module ids a pane contributes, in tab order. A single pane yields one id;
 * a group yields its tabs. This is the ONE place pane shape is decoded, so every
 * consumer (morph, memory, guards) stays agnostic to single-vs-group.
 * @param {Pane} pane
 * @returns {string[]}
 */
export function paneModuleIds(pane) {
  if (isGroupPane(pane)) return pane.tabs.slice();
  return pane && pane.moduleId ? [pane.moduleId] : [];
}

/**
 * The module that becomes the visible/active tab of a pane — a single pane's
 * module, or a group's `active` (falling back to its first tab).
 * @param {Pane} pane
 * @returns {string | null}
 */
export function paneActiveModule(pane) {
  if (isGroupPane(pane)) {
    if (pane.active && pane.tabs.includes(pane.active)) return pane.active;
    return pane.tabs[0] ?? null;
  }
  return pane && pane.moduleId ? pane.moduleId : null;
}

/**
 * Every module id in a spec, flattened across panes/groups in visual order.
 * @param {Pane[]} spec
 * @returns {string[]}
 */
export function specModuleIds(spec) {
  return Array.isArray(spec) ? spec.flatMap(paneModuleIds) : [];
}

/**
 * The primary module of a spec — the active module of the largest-weight pane.
 * This is the module whose tabset becomes active after a morph (the main working
 * area). Ties resolve to the last pane. Returns null for an empty/absent spec.
 * @param {Pane[]} spec
 * @returns {string | null}
 */
export function primaryModuleOf(spec) {
  if (!Array.isArray(spec) || spec.length === 0) return null;
  const primary = spec.reduce((best, pane) =>
    pane.weight >= best.weight ? pane : best,
  );
  return paneActiveModule(primary);
}

// Consistency guard (dev only): every step in the sequence must have a spec, and
// each spec must include its step's primary catalog module. Surfaces a drift
// between the catalog's step metadata and these specs at import time.
if (process.env.NODE_ENV !== 'production') {
  for (const step of WORKFLOW_STEP_SEQUENCE) {
    const spec = WORKSPACE_SPECS[step];
    if (!spec) {
      console.warn(`[workflows] no workspace spec for step "${step}"`);
      continue;
    }
    const hasStepModule = specModuleIds(spec).some(
      (id) => getModuleStep(id) === step,
    );
    if (!hasStepModule) {
      console.warn(
        `[workflows] spec for step "${step}" omits its own step module`,
      );
    }
  }
}
