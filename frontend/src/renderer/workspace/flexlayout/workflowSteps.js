/**
 * Workflow-step derivation — the pipeline (Import → Rename → Review → Count →
 * Culling) as a single ordered list, plus the "continue where you left off"
 * mapping. Shared by the StartupLanding page and the persistent WorkflowBar so
 * both render the same steps, in the same order, with the same continuation
 * logic (DRY — the landing used to own private copies of all of this).
 *
 * The module<->step mapping lives in the module catalog (`moduleRegistry.js`,
 * each pipeline entry carries a `step`); this file only declares the ORDER
 * (catalog order is placement-oriented, not pipeline-oriented) plus the per-step
 * icon and the Import card gate, then derives the module id from the catalog.
 */

import { MODULE_CATALOG } from './moduleRegistry.js';

// Canonical pipeline order, by step id. The catalog knows which module owns each
// step but not their sequence, so the sequence is declared here.
const STEP_ORDER = ['import', 'rename', 'review', 'count', 'culling'];

// Per-step presentation/behavior not carried by the catalog.
const STEP_ICONS = {
  import: 'folder-plus',
  rename: 'file',
  review: 'user',
  count: 'layers',
  culling: 'check-circle',
};

// Steps gated on an external precondition. Import needs a mounted camera card.
const STEP_REQUIRES_CARD = new Set(['import']);

// Reverse lookup: step id → module id, from the catalog's `step` metadata.
function moduleForStep(stepId) {
  for (const [id, entry] of Object.entries(MODULE_CATALOG)) {
    if (entry.step === stepId) return id;
  }
  return null;
}

/**
 * Ordered pipeline steps, derived from the catalog.
 * @type {{ step: string, moduleId: string, icon: string, requiresCard: boolean }[]}
 */
export const WORKFLOW_STEPS = STEP_ORDER.map((step) => {
  const moduleId = moduleForStep(step);
  if (!moduleId) return null;
  return { step, moduleId, icon: STEP_ICONS[step], requiresCard: STEP_REQUIRES_CARD.has(step) };
}).filter(Boolean);

// The remaining (non-pipeline) views/tools, in the order the landing/bar list
// them. Kept here so the landing page and the WorkflowBar's "Verktyg" menu stay
// in sync from one source.
export const WORKFLOW_TOOLS = [
  { moduleId: 'database-management', icon: 'sort' },
  { moduleId: 'refine-faces', icon: 'bolt' },
  { moduleId: 'file-queue', icon: 'folder' },
  { moduleId: 'statistics-dashboard', icon: 'layers' },
  { moduleId: 'log-viewer', icon: 'file' },
  { moduleId: 'preferences', icon: 'settings' },
  { moduleId: 'theme-editor', icon: 'circle' },
];

// Which pipeline step the working-folder anchor should continue INTO, keyed by
// the step that last set it. Each maps to an in-app hand-off event the workspace
// handles by morphing into the next step and passing the anchor's roots. The
// full chain: import → rename → review → count → culling. Every target listens
// on the moduleAPI bus (WorkflowBar emits there), and adoption downstream stays
// opt-in — the anchor only pre-fills.
export const CONTINUE_BY_STEP = {
  import: { event: 'open-rename-nef', labelKey: 'startupLanding.continueRename' },
  rename: { event: 'open-review-queue', labelKey: 'startupLanding.continueReview' },
  review: { event: 'open-count', labelKey: 'startupLanding.continueCount' },
  count: { event: 'open-culling', labelKey: 'startupLanding.continueCull' },
};

/** Last path segment of a folder, for the "current folder" label. */
export function basename(p) {
  // Normalize Windows separators first — the folder picker / backend can hand
  // back paths like C:\events\cupen; without this the whole path would show in
  // the chip. The app ships on Windows, so both separators must be handled.
  const parts = String(p).replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

/**
 * Resolve the continuation for a working-folder anchor, or null when there is
 * none (no anchor, no roots, or the anchor's step has no known next step).
 * @param {{ roots?: string[], step?: string } | null} anchor
 * @returns {{ roots: string[], name: string, event: string, labelKey: string } | null}
 */
export function getContinuation(anchor) {
  const roots = anchor?.roots;
  if (!Array.isArray(roots) || roots.length === 0) return null;
  const target = CONTINUE_BY_STEP[anchor.step];
  if (!target) return null;
  return { roots, name: basename(roots[0]), ...target };
}
