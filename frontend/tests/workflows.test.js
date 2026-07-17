import { describe, it, expect, vi } from 'vitest';

// workflows imports workflowSteps → moduleRegistry, which imports every module
// component; ThemeEditor pulls in the theme manager (localStorage at import).
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import {
  WORKSPACE_SPECS,
  WORKFLOW_STEP_SEQUENCE,
  getWorkspaceSpec,
  primaryModuleOf,
} from '../src/renderer/workspace/flexlayout/workflows.js';
import { getModuleStep } from '../src/renderer/workspace/flexlayout/moduleRegistry.js';

describe('WORKFLOW_STEP_SEQUENCE', () => {
  it('is the canonical pipeline order', () => {
    expect(WORKFLOW_STEP_SEQUENCE).toEqual(['import', 'rename', 'review', 'count', 'culling']);
  });

  it('has a spec for every step, and each spec includes its own step module', () => {
    for (const step of WORKFLOW_STEP_SEQUENCE) {
      const spec = getWorkspaceSpec(step);
      expect(spec, `spec for ${step}`).toBeTruthy();
      expect(spec.some((pane) => getModuleStep(pane.moduleId) === step)).toBe(true);
    }
  });
});

describe('WORKSPACE_SPECS', () => {
  it('models the four solo steps as a single full-weight pane', () => {
    for (const step of ['import', 'rename', 'count', 'culling']) {
      const spec = getWorkspaceSpec(step);
      expect(spec).toHaveLength(1);
      expect(spec[0].weight).toBe(100);
    }
  });

  it('models review as file-queue | review-module | image-viewer at 15|15|70', () => {
    expect(WORKSPACE_SPECS.review).toEqual([
      { moduleId: 'file-queue', weight: 15 },
      { moduleId: 'review-module', weight: 15 },
      { moduleId: 'image-viewer', weight: 70 },
    ]);
  });
});

describe('getWorkspaceSpec', () => {
  it('returns null for an unknown step', () => {
    expect(getWorkspaceSpec('nope')).toBeNull();
  });
});

describe('primaryModuleOf', () => {
  it('picks the largest-weight pane (image-viewer for the review trio)', () => {
    expect(primaryModuleOf(WORKSPACE_SPECS.review)).toBe('image-viewer');
  });

  it('returns the sole module for a solo spec', () => {
    expect(primaryModuleOf(WORKSPACE_SPECS.culling)).toBe('culling');
  });

  it('returns null for an empty/absent spec', () => {
    expect(primaryModuleOf([])).toBeNull();
    expect(primaryModuleOf(null)).toBeNull();
  });
});
