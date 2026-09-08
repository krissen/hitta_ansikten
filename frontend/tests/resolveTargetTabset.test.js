import { describe, it, expect } from 'vitest';
import { Model, Actions } from 'flexlayout-react';

import {
  resolveTargetTabset,
  ensureActiveTabset,
} from '../src/renderer/workspace/flexlayout/tabsetUtils.js';

// Two-tabset layout mirroring the default review layout: a narrow 15% Review
// column first, then the wide 85% Image Viewer. On a freshly-loaded model the
// render/measure pass hasn't run, so every tabset rect is still 0 — the
// regression was that the module then docked into the first (narrow) tabset,
// making menu-driven view switches appear to do nothing.
function freshReviewModel() {
  return Model.fromJson({
    global: { tabSetMinWidth: 100, tabSetMinHeight: 100, splitterSize: 4 },
    layout: {
      type: 'row',
      weight: 100,
      children: [
        {
          type: 'tabset',
          weight: 15,
          children: [
            { type: 'tab', name: 'Review', component: 'review-module' },
          ],
        },
        {
          type: 'tabset',
          weight: 85,
          children: [
            { type: 'tab', name: 'Image Viewer', component: 'image-viewer' },
          ],
        },
      ],
    },
  });
}

describe('resolveTargetTabset', () => {
  it('picks the highest-weight tabset when no rects are measured yet (race guard)', () => {
    const model = freshReviewModel();
    // No active tabset and all rects 0 on a fresh model.
    expect(model.getActiveTabset()).toBeUndefined();

    const target = resolveTargetTabset(model);
    expect(target).toBeTruthy();
    // The main (85%) area, not the narrow 15% Review column.
    expect(target.getWeight()).toBe(85);
  });

  it('prefers the active tabset when one is set', () => {
    const model = freshReviewModel();
    let narrow = null;
    model.visitNodes((n) => {
      if (n.getType() === 'tabset' && n.getWeight() === 15) narrow = n;
    });
    expect(narrow).toBeTruthy(); // guard: fail clearly if the layout shape changes
    // Make the narrow tabset active; resolveTargetTabset must honor it.
    model.doAction(Actions.setActiveTabset(narrow.getId()));
    expect(resolveTargetTabset(model).getId()).toBe(narrow.getId());
  });
});

describe('ensureActiveTabset', () => {
  it('sets an active tabset on a fresh model that has none', () => {
    const model = freshReviewModel();
    expect(model.getActiveTabset()).toBeUndefined();

    const applied = ensureActiveTabset(model);
    expect(applied).toBe(true);
    // Elects the main working area (85%), same target resolveTargetTabset picks.
    expect(model.getActiveTabset()).toBeTruthy();
    expect(model.getActiveTabset().getWeight()).toBe(85);
  });

  it('is a no-op when a tabset is already active', () => {
    const model = freshReviewModel();
    let narrow = null;
    model.visitNodes((n) => {
      if (n.getType() === 'tabset' && n.getWeight() === 15) narrow = n;
    });
    model.doAction(Actions.setActiveTabset(narrow.getId()));

    const applied = ensureActiveTabset(model);
    expect(applied).toBe(false);
    // The pre-existing active tabset is left untouched.
    expect(model.getActiveTabset().getId()).toBe(narrow.getId());
  });

  it('prefers a maximized tabset over the largest area when one is restored', () => {
    // Fake model with no active tabset but a maximized one — the restored
    // maximized tabset is where the user was working, so it wins.
    const maximized = { getId: () => 'MAX' };
    let setId = null;
    const model = {
      getActiveTabset: () => undefined,
      getMaximizedTabset: () => maximized,
      doAction: (action) => {
        setId = action.data?.tabsetNode ?? action.data?.node;
      },
    };
    const applied = ensureActiveTabset(model);
    expect(applied).toBe(true);
    expect(setId).toBe('MAX');
  });

  it('returns false for a falsy model', () => {
    expect(ensureActiveTabset(null)).toBe(false);
  });
});
