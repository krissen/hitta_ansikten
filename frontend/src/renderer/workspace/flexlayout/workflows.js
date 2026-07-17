/**
 * Declarative workspace specs for the pipeline steps.
 *
 * Each step maps to an ORDERED list of panes ({ moduleId, weight }) describing
 * the workspace the step should morph the live model into (workspaceMorph.js's
 * applyWorkspace consumes these). The panes render left-to-right as sibling
 * tabsets; weights are relative within the row (FlexLayout normalizes them).
 *
 * The specs are consistent with the role catalog's step metadata: every step's
 * PRIMARY module (the one the catalog tags with that `step`) appears in the
 * spec. The step sequence itself is derived from workflowSteps.js so the
 * Cmd+1..5 accelerators, the WorkflowBar and these specs stay in one order.
 *
 *   import   → import (solo)
 *   rename   → rename-nef (solo)
 *   review   → file-queue 15 | review-module 15 | image-viewer 70
 *   count    → player-count (solo)
 *   culling  → culling (solo)
 */

import { WORKFLOW_STEPS } from './workflowSteps.js';
import { getModuleStep } from './moduleRegistry.js';

/**
 * Step id → ordered pane list. A solo step is a single pane at full weight.
 * @type {Record<string, { moduleId: string, weight: number }[]>}
 */
export const WORKSPACE_SPECS = {
  import: [{ moduleId: 'import', weight: 100 }],
  rename: [{ moduleId: 'rename-nef', weight: 100 }],
  review: [
    { moduleId: 'file-queue', weight: 15 },
    { moduleId: 'review-module', weight: 15 },
    { moduleId: 'image-viewer', weight: 70 },
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
 * @returns {{ moduleId: string, weight: number }[] | null}
 */
export function getWorkspaceSpec(stepId) {
  return WORKSPACE_SPECS[stepId] || null;
}

/**
 * The primary (largest-weight) module of a spec — the pane that becomes the
 * active tabset after a morph (the main working area). Ties resolve to the last
 * pane. Returns null for an empty/absent spec.
 * @param {{ moduleId: string, weight: number }[]} spec
 * @returns {string | null}
 */
export function primaryModuleOf(spec) {
  if (!Array.isArray(spec) || spec.length === 0) return null;
  return spec.reduce((best, pane) => (pane.weight >= best.weight ? pane : best)).moduleId;
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
    const hasStepModule = spec.some((pane) => getModuleStep(pane.moduleId) === step);
    if (!hasStepModule) {
      console.warn(`[workflows] spec for step "${step}" omits its own step module`);
    }
  }
}
