import { describe, it, expect, vi } from 'vitest';

// workflowSteps derives from the module catalog, which imports every module
// component; ThemeEditor pulls in the theme manager (localStorage at import).
// Mock it, same as moduleCatalog.test.js.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import {
  WORKFLOW_STEPS,
  WORKFLOW_TOOLS,
  CONTINUE_BY_STEP,
  getContinuation,
  basename,
} from '../src/renderer/workspace/flexlayout/workflowSteps.js';
import { getModuleStep } from '../src/renderer/workspace/flexlayout/moduleRegistry.js';

describe('WORKFLOW_STEPS derivation', () => {
  it('lists the five pipeline steps in canonical order', () => {
    expect(WORKFLOW_STEPS.map((s) => s.step)).toEqual([
      'import',
      'rename',
      'review',
      'count',
      'culling',
    ]);
  });

  it('maps each step to its module via the catalog step metadata', () => {
    expect(WORKFLOW_STEPS.map((s) => s.moduleId)).toEqual([
      'import',
      'rename-nef',
      'review-module',
      'player-count',
      'culling',
    ]);
    // The derivation is the catalog's own step<->module mapping, both ways.
    for (const step of WORKFLOW_STEPS) {
      expect(getModuleStep(step.moduleId)).toBe(step.step);
    }
  });

  it('gates only Import on a camera card', () => {
    const requiring = WORKFLOW_STEPS.filter((s) => s.requiresCard).map(
      (s) => s.step,
    );
    expect(requiring).toEqual(['import']);
  });

  it('gives every step an icon', () => {
    for (const step of WORKFLOW_STEPS) {
      expect(typeof step.icon).toBe('string');
      expect(step.icon.length).toBeGreaterThan(0);
    }
  });

  it('keeps the tools list disjoint from the pipeline steps', () => {
    const stepModules = new Set(WORKFLOW_STEPS.map((s) => s.moduleId));
    for (const tool of WORKFLOW_TOOLS) {
      expect(stepModules.has(tool.moduleId)).toBe(false);
    }
  });
});

describe('getContinuation', () => {
  it('returns null for no anchor / no roots', () => {
    expect(getContinuation(null)).toBeNull();
    expect(getContinuation({})).toBeNull();
    expect(getContinuation({ roots: [], step: 'import' })).toBeNull();
  });

  it('returns null for a step with no known next step', () => {
    // culling is the terminal step — nothing continues past it.
    expect(
      getContinuation({ roots: ['/e/cupen'], step: 'culling' }),
    ).toBeNull();
    // an unknown step id also has no continuation.
    expect(getContinuation({ roots: ['/e/cupen'], step: 'nope' })).toBeNull();
  });

  it('continues review → count and count → culling', () => {
    expect(getContinuation({ roots: ['/e/cupen'], step: 'review' }).event).toBe(
      'open-count',
    );
    expect(getContinuation({ roots: ['/e/cupen'], step: 'count' }).event).toBe(
      'open-culling',
    );
  });

  it('after import, continues into rename with the roots and folder name', () => {
    const cont = getContinuation({ roots: ['/events/cupen'], step: 'import' });
    expect(cont).toEqual({
      roots: ['/events/cupen'],
      name: 'cupen',
      event: CONTINUE_BY_STEP.import.event,
      labelKey: CONTINUE_BY_STEP.import.labelKey,
    });
  });

  it('after rename, continues into review', () => {
    const cont = getContinuation({ roots: ['/events/cupen'], step: 'rename' });
    expect(cont.event).toBe('open-review-queue');
  });
});

describe('basename', () => {
  it('returns the last path segment, ignoring trailing slashes', () => {
    expect(basename('/a/b/cupen')).toBe('cupen');
    expect(basename('/a/b/cupen/')).toBe('cupen');
    expect(basename('cupen')).toBe('cupen');
  });

  it('handles Windows backslash paths', () => {
    expect(basename('C:\\events\\cupen')).toBe('cupen');
    expect(basename('C:\\events\\cupen\\')).toBe('cupen');
    expect(basename('D:\\cupen')).toBe('cupen');
  });
});
