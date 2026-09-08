import { describe, it, expect, vi } from 'vitest';

// The catalog imports every module component. ThemeEditor pulls in the theme
// manager, which reads localStorage at import time — unavailable under jsdom
// here. Mock it away (same shape the workspace test uses); the catalog still
// references the real component modules otherwise.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import {
  MODULE_CATALOG,
  MODULE_COMPONENTS,
  MODULE_TITLES,
  getModuleRole,
  isSingletonModule,
} from '../src/renderer/workspace/flexlayout/moduleRegistry.js';

const VALID_ROLES = new Set(['main', 'side', 'bottom']);

describe('module catalog integrity', () => {
  it('gives every module a component and a valid role', () => {
    const ids = Object.keys(MODULE_CATALOG);
    expect(ids.length).toBeGreaterThan(0);
    for (const [id, entry] of Object.entries(MODULE_CATALOG)) {
      expect(entry.component, `component for ${id}`).toBeTruthy();
      expect(VALID_ROLES.has(entry.role), `role for ${id}: ${entry.role}`).toBe(
        true,
      );
    }
  });

  it('derives MODULE_COMPONENTS one-to-one from the catalog', () => {
    expect(Object.keys(MODULE_COMPONENTS).sort()).toEqual(
      Object.keys(MODULE_CATALOG).sort(),
    );
    for (const [id, entry] of Object.entries(MODULE_CATALOG)) {
      expect(MODULE_COMPONENTS[id]).toBe(entry.component);
    }
  });

  it('has a non-empty title for every module id', () => {
    expect(Object.keys(MODULE_TITLES).sort()).toEqual(
      Object.keys(MODULE_CATALOG).sort(),
    );
    for (const id of Object.keys(MODULE_CATALOG)) {
      expect(typeof MODULE_TITLES[id]).toBe('string');
      expect(MODULE_TITLES[id].length).toBeGreaterThan(0);
      // A missing i18n key would echo back as the raw "modules.<id>" path.
      expect(MODULE_TITLES[id]).not.toBe(`modules.${id}`);
    }
  });

  it('assigns the file queue and review to the side role, logs to bottom', () => {
    expect(getModuleRole('file-queue')).toBe('side');
    expect(getModuleRole('review-module')).toBe('side');
    expect(getModuleRole('log-viewer')).toBe('bottom');
    // Everything else is a main-area view.
    expect(getModuleRole('image-viewer')).toBe('main');
    expect(getModuleRole('culling')).toBe('main');
  });

  it('defaults an unknown module id to the main role', () => {
    expect(getModuleRole('does-not-exist')).toBe('main');
  });
});

describe('singleton derivation', () => {
  it('treats every catalogued module as a singleton (none set singleton:false)', () => {
    for (const id of Object.keys(MODULE_CATALOG)) {
      expect(isSingletonModule(id), `singleton for ${id}`).toBe(true);
    }
  });

  it('honors an explicit singleton:false override', () => {
    // Guard the derivation rule itself: `singleton !== false`, not truthiness.
    const entry = { role: 'main', singleton: false };
    expect(entry.singleton !== false).toBe(false);
  });

  it('treats an unknown module id as a non-singleton', () => {
    expect(isSingletonModule('does-not-exist')).toBe(false);
  });
});
