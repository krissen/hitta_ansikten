import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { DockLocation, Actions } from 'flexlayout-react';
import {
  getDockLocation,
  getTabsetPosition,
  findTabsetInDirection,
  applyModuleBasedRatios,
  groupAsTab,
} from '../src/renderer/workspace/flexlayout/layoutGeometry.js';

// Unit tests for the layout-geometry helpers extracted from FlexLayoutWorkspace.
// #146's characterization suite fenced the workspace but flagged the geometry
// helpers as an untested gap (they were closures over model/layoutRef). Now
// that they're plain functions taking (model, layoutRef), fake models + fake
// tabset rects make them directly testable.

// Build a fake .flexlayout__tabset DOM element for `id` with a known rect. A
// child tab-button carries data-layout-path containing the id, which is how
// getTabsetPosition matches an element to a tabset.
function makeTabsetEl(id, rect) {
  const el = document.createElement('div');
  el.className = 'flexlayout__tabset';
  const btn = document.createElement('div');
  btn.className = 'flexlayout__tab_button';
  btn.setAttribute('data-layout-path', `/${id}/tb0`);
  el.appendChild(btn);
  el.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  });
  document.body.appendChild(el);
  return el;
}

// A minimal model exposing visitNodes over a set of tabset nodes.
function makeModel(tabsetNodes) {
  return {
    visitNodes(cb) {
      tabsetNodes.forEach((n) => cb(n));
    },
  };
}

function tabsetNode(id) {
  return { getType: () => 'tabset', getId: () => id };
}

const layoutRef = { current: {} };

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('getDockLocation', () => {
  it('maps direction strings to FlexLayout DockLocations', () => {
    expect(getDockLocation('left')).toBe(DockLocation.LEFT);
    expect(getDockLocation('right')).toBe(DockLocation.RIGHT);
    expect(getDockLocation('up')).toBe(DockLocation.TOP);
    expect(getDockLocation('above')).toBe(DockLocation.TOP);
    expect(getDockLocation('down')).toBe(DockLocation.BOTTOM);
    expect(getDockLocation('below')).toBe(DockLocation.BOTTOM);
  });

  it('defaults to RIGHT for an unknown direction', () => {
    expect(getDockLocation('sideways')).toBe(DockLocation.RIGHT);
  });
});

describe('getTabsetPosition', () => {
  it('returns the center point (and rect) of the matching tabset element', () => {
    makeTabsetEl('ts-a', { left: 0, top: 0, width: 200, height: 100 });
    const model = makeModel([tabsetNode('ts-a')]);

    const pos = getTabsetPosition(model, layoutRef, tabsetNode('ts-a'));
    expect(pos.x).toBe(100); // 0 + 200/2
    expect(pos.y).toBe(50); //  0 + 100/2
    expect(pos.rect).toBeTruthy();
  });

  it('returns {x:0,y:0} when the layout ref is not mounted', () => {
    const model = makeModel([tabsetNode('ts-a')]);
    const pos = getTabsetPosition(model, { current: null }, tabsetNode('ts-a'));
    expect(pos).toEqual({ x: 0, y: 0 });
  });
});

describe('findTabsetInDirection', () => {
  beforeEach(() => {
    // Two tabsets side by side: A on the left, B on the right.
    makeTabsetEl('ts-a', { left: 0, top: 0, width: 200, height: 100 });
    makeTabsetEl('ts-b', { left: 400, top: 0, width: 200, height: 100 });
  });

  it('finds the tabset to the right of the source', () => {
    const a = tabsetNode('ts-a');
    const b = tabsetNode('ts-b');
    const model = makeModel([a, b]);
    const found = findTabsetInDirection(model, layoutRef, a, 'right');
    expect(found.getId()).toBe('ts-b');
  });

  it('finds nothing to the left of the leftmost tabset', () => {
    const a = tabsetNode('ts-a');
    const b = tabsetNode('ts-b');
    const model = makeModel([a, b]);
    expect(findTabsetInDirection(model, layoutRef, a, 'left')).toBeNull();
  });

  it('returns null when there is only one tabset', () => {
    document.body.innerHTML = '';
    makeTabsetEl('ts-a', { left: 0, top: 0, width: 200, height: 100 });
    const a = tabsetNode('ts-a');
    const model = makeModel([a]);
    expect(findTabsetInDirection(model, layoutRef, a, 'right')).toBeNull();
  });
});

describe('applyModuleBasedRatios', () => {
  // Root child helper: a tabset whose selected tab hosts `component`.
  function rootTabset(id, component) {
    return {
      getType: () => 'tabset',
      getId: () => id,
      getSelectedNode: () => ({ getComponent: () => component }),
    };
  }

  it('sets normalized width weights from each module ratio (horizontal layout)', () => {
    const spy = vi.spyOn(Actions, 'updateNodeAttributes');
    const root = {
      getChildren: () => [
        rootTabset('a', 'review-module'), // widthRatio 0.15
        rootTabset('b', 'image-viewer'), //  widthRatio 0.85
      ],
    };
    const model = { getRoot: () => root, doAction: vi.fn() };

    applyModuleBasedRatios(model);

    // Ratios sum to 1.0 -> weights 15 and 85.
    expect(spy).toHaveBeenCalledWith('a', { weight: 15 });
    expect(spy).toHaveBeenCalledWith('b', { weight: 85 });
    expect(model.doAction).toHaveBeenCalledTimes(2);
  });

  it('does nothing when a single tabset shares no row', () => {
    const spy = vi.spyOn(Actions, 'updateNodeAttributes');
    const root = { getChildren: () => [rootTabset('a', 'review-module')] };
    const model = { getRoot: () => root, doAction: vi.fn() };

    applyModuleBasedRatios(model);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('groupAsTab', () => {
  beforeEach(() => {
    makeTabsetEl('ts-a', { left: 0, top: 0, width: 200, height: 100 });
    makeTabsetEl('ts-b', { left: 400, top: 0, width: 200, height: 100 });
  });

  it('moves the active tab into the target tabset (CENTER dock)', () => {
    const moveSpy = vi.spyOn(Actions, 'moveNode');
    const activeTab = { getId: () => 'tab-1' };
    const activeTabset = {
      getType: () => 'tabset',
      getId: () => 'ts-a',
      getSelectedNode: () => activeTab,
    };
    const targetTabset = tabsetNode('ts-b');
    const model = {
      getActiveTabset: () => activeTabset,
      visitNodes(cb) {
        cb(activeTabset);
        cb(targetTabset);
      },
      doAction: vi.fn(),
    };

    groupAsTab(model, layoutRef, 'right');

    expect(moveSpy).toHaveBeenCalledWith('tab-1', 'ts-b', DockLocation.CENTER, -1, true);
    expect(model.doAction).toHaveBeenCalledTimes(1);
  });
});
