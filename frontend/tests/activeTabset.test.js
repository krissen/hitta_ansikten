import { describe, it, expect } from 'vitest';
import { isTabsetActive } from '../src/renderer/hooks/useActiveTabset.js';

// Unit fence for the active-tabset keyboard gate (I1).
//
// isTabsetActive is the single predicate behind every module keyboard gate that
// must not fire from a visible-but-inactive panel. The most important property
// it guarantees is MUTUAL EXCLUSIVITY between two visible modules sharing one
// FlexLayout model: for any active tabset, at most one of {Review, Culling}
// answers "yes, handle this key". That is the double-trash fix — Review and
// Culling both bind Cmd+Backspace, and one keypress must reach exactly one.
//
// Mounting both real modules in a single FlexLayout model is far heavier than
// the behaviour under test; per the plan we pin the predicates against a fake
// model instead, which is the actual seam the runtime handlers gate on.

/**
 * Build a fake FlexLayout node for a module.
 * @param {Object} p
 * @param {string} p.mine - id of the tabset hosting this module.
 * @param {string} p.activeId - id of the currently active tabset (model-wide).
 * @param {string} p.activeComponent - component id selected in the active tabset.
 * @param {boolean} [p.visible=true]
 */
function makeNode({ mine, activeId, activeComponent, visible = true }) {
  const activeTabset = {
    getId: () => activeId,
    getSelectedNode: () => ({ getComponent: () => activeComponent }),
  };
  return {
    isVisible: () => visible,
    getModel: () => ({ getActiveTabset: () => activeTabset }),
    getParent: () => ({ getId: () => mine }),
  };
}

// The review flow keeps its keyboard live while the image surfaces are active.
const REVIEW_COMPANIONS = { companions: ['image-viewer', 'original-view'] };
// Culling is self-contained — no companion surfaces.
const CULLING_COMPANIONS = { companions: [] };

describe('isTabsetActive — base cases', () => {
  it('treats a null node (standalone / test harness) as active', () => {
    expect(isTabsetActive(null)).toBe(true);
  });

  it('is false for a hidden tab regardless of the active tabset', () => {
    const node = makeNode({
      mine: 'TSR',
      activeId: 'TSR',
      activeComponent: 'review-module',
      visible: false,
    });
    expect(isTabsetActive(node, REVIEW_COMPANIONS)).toBe(false);
  });

  it('falls back to visibility when the model is not resolvable (bare stub)', () => {
    expect(isTabsetActive({ isVisible: () => true })).toBe(true);
    expect(isTabsetActive({ isVisible: () => false })).toBe(false);
  });

  it('is true when the module owns the active tabset', () => {
    const node = makeNode({
      mine: 'TSR',
      activeId: 'TSR',
      activeComponent: 'review-module',
    });
    expect(isTabsetActive(node, REVIEW_COMPANIONS)).toBe(true);
  });

  it('is false when a foreign, non-companion tabset is active', () => {
    const node = makeNode({
      mine: 'TSR',
      activeId: 'TSC',
      activeComponent: 'culling',
    });
    expect(isTabsetActive(node, REVIEW_COMPANIONS)).toBe(false);
  });

  it('fails OPEN when NO tabset is active (fail-open by design)', () => {
    // FlexLayout's getActiveTabset() returns undefined until something sets it
    // (a first tab click). The pure predicate deliberately treats "no active
    // tabset" as active so a never-clicked single panel keeps its shortcuts;
    // fail-closed would kill keyboard nav in the common case.
    //
    // The residual hazard — two visible modules BOTH failing open at once — is
    // closed one level up: FlexLayoutWorkspace.ensureActiveTabset() elects a
    // deterministic active tabset immediately after every Model.fromJson, so a
    // loaded model never actually reaches the module gates with a null active.
    const node = makeNode({
      mine: 'TSR',
      activeId: null,
      activeComponent: null,
    });
    expect(isTabsetActive(node, REVIEW_COMPANIONS)).toBe(true);
  });
});

describe('isTabsetActive — companions', () => {
  it('keeps Review live when a companion image surface hosts the active tabset', () => {
    const onImage = makeNode({
      mine: 'TSR',
      activeId: 'TSI',
      activeComponent: 'image-viewer',
    });
    const onOriginal = makeNode({
      mine: 'TSR',
      activeId: 'TSO',
      activeComponent: 'original-view',
    });
    expect(isTabsetActive(onImage, REVIEW_COMPANIONS)).toBe(true);
    expect(isTabsetActive(onOriginal, REVIEW_COMPANIONS)).toBe(true);
  });

  it('does NOT widen to a companion for a module that declares none (Culling)', () => {
    const node = makeNode({
      mine: 'TSC',
      activeId: 'TSI',
      activeComponent: 'image-viewer',
    });
    expect(isTabsetActive(node, CULLING_COMPANIONS)).toBe(false);
  });
});

describe('single-trash — Review vs Culling mutual exclusivity (double-trash fix)', () => {
  // Both modules visible in different tabsets of one model. For each possible
  // active tabset, EXACTLY ONE module's gate is open.
  function gates(activeId, activeComponent) {
    const review = makeNode({ mine: 'TSR', activeId, activeComponent });
    const culling = makeNode({ mine: 'TSC', activeId, activeComponent });
    return {
      review: isTabsetActive(review, REVIEW_COMPANIONS),
      culling: isTabsetActive(culling, CULLING_COMPANIONS),
    };
  }

  it('Review active → only Review handles Cmd+Backspace', () => {
    const g = gates('TSR', 'review-module');
    expect(g).toEqual({ review: true, culling: false });
  });

  it('Culling active → only Culling handles Cmd+Backspace', () => {
    const g = gates('TSC', 'culling');
    expect(g).toEqual({ review: false, culling: true });
  });

  it('ImageViewer active → only Review (its companion) handles the key', () => {
    const g = gates('TSI', 'image-viewer');
    expect(g).toEqual({ review: true, culling: false });
  });

  it('every case yields at most one open gate (no double-trash)', () => {
    const cases = [
      gates('TSR', 'review-module'),
      gates('TSC', 'culling'),
      gates('TSI', 'image-viewer'),
      gates('TSO', 'original-view'),
    ];
    for (const g of cases) {
      expect(Number(g.review) + Number(g.culling)).toBeLessThanOrEqual(1);
    }
  });
});
