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
 * columns, so a snapshot captures module set + order + weights but NOT 2D
 * (row/column nesting) or grouped-tab structure. That matches what the morph can
 * produce anyway; richer manual arrangements collapse to a single row on
 * re-entry. This is the accepted limit of per-step memory.
 */

import { Model } from 'flexlayout-react';
import { ensureBottomBorder } from './layouts.js';
import { getWorkspaceSpec } from './workflows.js';
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

/** A pane spec is a non-empty array of `{ moduleId: string, weight: finite }`. */
function isValidSpec(spec) {
  return (
    Array.isArray(spec) &&
    spec.length > 0 &&
    spec.every(
      (p) =>
        p &&
        typeof p.moduleId === 'string' &&
        p.moduleId.length > 0 &&
        typeof p.weight === 'number' &&
        Number.isFinite(p.weight),
    )
  );
}

/**
 * Snapshot a live model's real (non-border) tabsets into an ordered pane spec.
 * Border-parked tabs are skipped (their parent is a border, not a tabset), and a
 * module that somehow appears twice is de-duplicated (first wins) so the spec is
 * a clean one-pane-per-module target for the morph engine.
 *
 * @param {import('flexlayout-react').Model} model
 * @returns {{ moduleId: string, weight: number }[]}
 */
export function snapshotStepSpec(model) {
  if (!model) return [];
  const seen = new Set();
  const spec = [];
  model.visitNodes((n) => {
    if (n.getType() !== 'tab') return;
    const parent = n.getParent?.();
    if (!parent || parent.getType?.() !== 'tabset') return; // parked/border → skip
    const moduleId = n.getComponent?.();
    if (!moduleId || seen.has(moduleId)) return;
    seen.add(moduleId);
    spec.push({ moduleId, weight: parent.getWeight?.() ?? 100 });
  });
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
  const present = new Set(saved.map((p) => p.moduleId));
  const merged = saved.slice();
  for (const pane of factory) {
    if (!present.has(pane.moduleId)) merged.push({ ...pane });
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
