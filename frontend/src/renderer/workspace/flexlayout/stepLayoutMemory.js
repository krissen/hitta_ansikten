/**
 * Per-step layout memory (Capture One "workspaces" pattern, Nielsen N7).
 *
 * Each pipeline step (import / rename / review / count / culling) remembers the
 * shape the user left it in, so returning to a step restores their tweaks
 * (extra column, changed pane weights) instead of the bare factory layout. This
 * replaces the single `ansikten-flexlayout` key with one key per step
 * (`ansikten-workspace-<step>`).
 *
 * Representation — a PANE SPEC, not a full FlexLayout model. A step's memory is
 * the ordered list of `{ moduleId, weight }` for its real (non-border) tabsets,
 * the same shape `workflows.js` factory specs use. This is deliberate:
 *
 *   - It feeds the NON-DESTRUCTIVE morph (`workspaceMorph.applyWorkspace`) that
 *     step switching already uses, so restoring a remembered layout preserves
 *     live module state and the parked-in-background semantics (PR 3). A full
 *     `Model.fromJson` restore would tear those down.
 *   - Border-parked "Bakgrund" tabs are excluded automatically: a snapshot only
 *     reads real tabsets, so a Review/File-Queue parked while the user was in
 *     another step never leaks into this step's memory (parked tabs belong to
 *     the LIVE model, not to any step's remembered shape).
 *
 * Tradeoff (KISS): the morph engine normalises a spec into one row of weighted
 * columns (a column may hold a GROUP of stacked tabs), so a snapshot captures
 * module set + order + weights + per-column grouping and active tab, but NOT 2D
 * (row/column nesting). That matches what the morph can produce anyway; richer
 * manual arrangements collapse to a single row on re-entry. This is the accepted
 * limit of per-step memory.
 */

import { Model } from 'flexlayout-react';
import { ensureBottomBorder } from './layouts.js';
import { getWorkspaceSpec, isGroupPane, paneModuleIds } from './workflows.js';
import { debugWarn } from '../../shared/debug.js';

const KEY_PREFIX = 'ansikten-workspace-';

/** The pre-per-step single-layout key, migrated once then removed. */
export const LEGACY_LAYOUT_KEY = 'ansikten-flexlayout';

/** The pipeline steps that own a memory key. */
export const MEMORY_STEPS = ['import', 'rename', 'review', 'count', 'culling'];

/** localStorage key for a step's remembered layout. */
export function stepStorageKey(stepId) {
  return `${KEY_PREFIX}${stepId}`;
}

/** A finite numeric weight. */
function isFiniteWeight(w) {
  return typeof w === 'number' && Number.isFinite(w);
}

/** A non-empty module-id string. */
function isModuleId(id) {
  return typeof id === 'string' && id.length > 0;
}

/**
 * A pane is either a single-module pane `{ moduleId, weight }` or a grouped-tab
 * pane `{ tabs: [id, …], active?, weight }`.
 */
function isValidPane(p) {
  if (!p || !isFiniteWeight(p.weight)) return false;
  if (isGroupPane(p)) {
    return (
      p.tabs.length > 0 &&
      p.tabs.every(isModuleId) &&
      (p.active === undefined ||
        (isModuleId(p.active) && p.tabs.includes(p.active)))
    );
  }
  return isModuleId(p.moduleId);
}

/** A pane spec is a non-empty array of valid panes. */
function isValidSpec(spec) {
  return Array.isArray(spec) && spec.length > 0 && spec.every(isValidPane);
}

/**
 * Snapshot a live model's real (non-border) tabsets into an ordered pane spec.
 * Each tabset becomes one pane: a single-tab tabset yields `{ moduleId, weight }`,
 * a multi-tab tabset yields a group `{ tabs, active, weight }` (the selected tab
 * is `active`). Border-parked tabs are skipped (their parent is a border, not a
 * tabset), and a module that somehow appears twice is de-duplicated (first wins)
 * so the spec is a clean target for the morph engine.
 *
 * @param {import('flexlayout-react').Model} model
 * @returns {import('./workflows.js').Pane[]}
 */
export function snapshotStepSpec(model) {
  if (!model) return [];
  const tabsets = [];
  model.visitNodes((n) => {
    if (n.getType?.() === 'tabset') tabsets.push(n);
  });
  const seen = new Set();
  const spec = [];
  for (const tabset of tabsets) {
    const ids = [];
    let activeId = null;
    const selected = tabset.getSelectedNode?.();
    const selectedComponent = selected?.getComponent?.();
    for (const child of tabset.getChildren?.() ?? []) {
      if (child.getType?.() !== 'tab') continue;
      const moduleId = child.getComponent?.();
      if (!moduleId || seen.has(moduleId)) continue;
      seen.add(moduleId);
      ids.push(moduleId);
      if (moduleId === selectedComponent) activeId = moduleId;
    }
    if (ids.length === 0) continue;
    const weight = tabset.getWeight?.() ?? 100;
    if (ids.length === 1) {
      spec.push({ moduleId: ids[0], weight });
    } else {
      spec.push({ tabs: ids, active: activeId ?? ids[0], weight });
    }
  }
  return spec;
}

/**
 * Load a step's remembered spec, or null when absent/corrupt. A corrupt or
 * malformed value falls back to null (→ factory), never throws.
 * @param {string} stepId
 * @returns {{ moduleId: string, weight: number }[] | null}
 */
export function loadStepSpec(stepId) {
  try {
    const raw = localStorage.getItem(stepStorageKey(stepId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidSpec(parsed) ? parsed : null;
  } catch (err) {
    debugWarn('StepMemory', 'Failed to load step layout:', stepId, err);
    return null;
  }
}

/** Persist a step's spec. No-ops on an empty/invalid spec (never wipes to junk). */
export function saveStepSpec(stepId, spec) {
  if (!stepId || !isValidSpec(spec)) return;
  try {
    localStorage.setItem(stepStorageKey(stepId), JSON.stringify(spec));
  } catch (err) {
    debugWarn('StepMemory', 'Failed to save step layout:', stepId, err);
  }
}

/** Forget one step's remembered layout (next entry uses the factory spec). */
export function clearStepSpec(stepId) {
  try {
    localStorage.removeItem(stepStorageKey(stepId));
  } catch (err) {
    debugWarn('StepMemory', 'Failed to clear step layout:', stepId, err);
  }
}

/** Forget every step's remembered layout ("Reset all layouts"). */
export function clearAllStepSpecs() {
  for (const step of MEMORY_STEPS) clearStepSpec(step);
}

/**
 * Merge a remembered spec with the step's factory spec so the step's essential
 * modules are ALWAYS present. The saved spec keeps its order + weights + extra
 * panes; any factory module the saved spec dropped is appended at factory
 * weight. This guarantees a hand-off that targets a specific module (e.g. the
 * review queue needs `file-queue`) can never morph into a step that lacks it,
 * even if the user had closed that pane before the snapshot.
 *
 * @param {{ moduleId: string, weight: number }[]} saved
 * @param {{ moduleId: string, weight: number }[]} factory
 * @returns {{ moduleId: string, weight: number }[]}
 */
export function mergeWithFactory(saved, factory) {
  if (!isValidSpec(saved)) return factory;
  if (!Array.isArray(factory) || factory.length === 0) return saved;
  const present = new Set(saved.flatMap(paneModuleIds));
  const merged = saved.slice();
  // Append each factory module the saved spec dropped, as its own single pane at
  // the factory pane's weight. (A grouped factory module lands as a standalone
  // column — the guarantee is presence, not exact grouping, for this edge case.)
  for (const pane of factory) {
    for (const mid of paneModuleIds(pane)) {
      if (!present.has(mid)) {
        present.add(mid);
        merged.push({ moduleId: mid, weight: pane.weight });
      }
    }
  }
  return merged;
}

/**
 * The spec a step should morph into: its remembered layout (merged with the
 * factory to guarantee essential modules) when one exists, else the factory
 * spec. Returns null for an unknown step id.
 * @param {string} stepId
 * @returns {{ moduleId: string, weight: number }[] | null}
 */
export function resolveStepSpec(stepId) {
  const factory = getWorkspaceSpec(stepId);
  if (!factory) return null;
  const saved = loadStepSpec(stepId);
  return saved ? mergeWithFactory(saved, factory) : factory;
}

/**
 * One-time migration of the legacy single-layout key into the review step's
 * memory. The old key held whatever workspace the user last had; a review-ish
 * layout is by far the most common, so it seeds the review step (the app's
 * default working step). The legacy key is removed afterwards regardless — a
 * corrupt legacy value is simply discarded (→ steps start at factory).
 *
 * Idempotent: it never overwrites an existing review memory, and once the
 * legacy key is gone it is a no-op.
 */
/**
 * One-time reshape of an OLD-shape review memory into the new companion-tab form.
 *
 * Before this PR the review step was three columns (file-queue | review-module |
 * image-viewer). The owner's decision moved the File Queue to a companion tab
 * behind the Image Viewer. Existing installs carry the old three-column memory,
 * which would otherwise override the new factory default forever. This rewrites
 * such a memory ONCE — folding the File Queue into the Image Viewer's column as a
 * hidden tab and summing their weights — so the new default is adopted without
 * discarding the user's review-module tweaks. Idempotent: a memory that already
 * has a group pane (new shape) or lacks the old file-queue/image-viewer columns
 * is left untouched.
 */
export function migrateReviewMemoryShape() {
  const saved = loadStepSpec('review');
  if (!saved) return;
  if (saved.some(isGroupPane)) return; // already new shape
  const queuePane = saved.find((p) => p.moduleId === 'file-queue');
  const viewerPane = saved.find((p) => p.moduleId === 'image-viewer');
  if (!queuePane || !viewerPane) return; // not the old three-column shape
  const groupWeight = (viewerPane.weight ?? 70) + (queuePane.weight ?? 15);
  const rebuilt = [];
  for (const pane of saved) {
    if (pane.moduleId === 'file-queue') continue; // folded into the group
    if (pane.moduleId === 'image-viewer') {
      rebuilt.push({
        tabs: ['image-viewer', 'file-queue'],
        active: 'image-viewer',
        weight: groupWeight,
      });
    } else {
      rebuilt.push({ ...pane });
    }
  }
  saveStepSpec('review', rebuilt);
}

export function migrateLegacyLayout() {
  let raw;
  try {
    raw = localStorage.getItem(LEGACY_LAYOUT_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    // Only seed review when the user has no review memory yet.
    if (!localStorage.getItem(stepStorageKey('review'))) {
      const json = JSON.parse(raw);
      const model = Model.fromJson(ensureBottomBorder(json));
      const spec = snapshotStepSpec(model);
      if (isValidSpec(spec)) saveStepSpec('review', spec);
    }
  } catch (err) {
    debugWarn('StepMemory', 'Legacy layout migration failed:', err);
  } finally {
    try {
      localStorage.removeItem(LEGACY_LAYOUT_KEY);
    } catch {
      /* best effort */
    }
  }
}
