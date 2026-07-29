import { describe, it, expect, vi } from 'vitest';

// The catalog itself is pure data, but the module-id check reads the module
// registry, which imports every module component; ThemeEditor pulls in the theme
// manager (localStorage at import). Mock it, same as moduleCatalog.test.js.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import {
  ACTIONS,
  SECTIONS,
  ACTION_KINDS,
  ACTION_SCOPES,
  actionsForSection,
  getAction,
} from '../src/renderer/workspace/actions/actionCatalog.js';
import { MODULE_CATALOG } from '../src/renderer/workspace/flexlayout/moduleRegistry.js';
import { t } from '../src/i18n/index.js';

describe('action catalog integrity', () => {
  it('has unique action ids', () => {
    const ids = ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves every titleKey in the i18n catalog', () => {
    // t() returns the key itself on a miss, so key === value means a gap.
    for (const action of ACTIONS) {
      expect(t(action.titleKey), `${action.id} → ${action.titleKey}`).not.toBe(action.titleKey);
    }
  });

  it('names a real module id as owner (or none)', () => {
    for (const action of ACTIONS) {
      if (action.owner === null) continue;
      expect(MODULE_CATALOG[action.owner], `${action.id} owner ${action.owner}`).toBeDefined();
    }
  });

  it('declares kind and scope within the allowed sets', () => {
    for (const action of ACTIONS) {
      expect(ACTION_KINDS, action.id).toContain(action.kind);
      expect(ACTION_SCOPES, action.id).toContain(action.scope);
    }
  });

  it('routes only via the two existing buses', () => {
    for (const action of ACTIONS) {
      if (action.route === null) continue;
      expect(['emit', 'dispatch'], action.id).toContain(action.route.via);
      if (action.route.via === 'emit') {
        expect(typeof action.route.event, action.id).toBe('string');
        // A directional pair is only meaningful for a signed (delta) action.
        if (action.route.eventDown) expect(action.kind).toBe('delta');
      } else {
        expect(typeof action.route.intent?.type, action.id).toBe('string');
      }
    }
  });

  it('gives every action a section that exists', () => {
    const sectionIds = new Set(SECTIONS.map((s) => s.id));
    for (const action of ACTIONS) {
      expect(sectionIds, action.id).toContain(action.section);
    }
  });

  it('lists at least one key per action', () => {
    for (const action of ACTIONS) {
      expect(Array.isArray(action.keys), action.id).toBe(true);
      expect(action.keys.length, action.id).toBeGreaterThan(0);
    }
  });

  it('scopes destructive actions to the ones that delete files', () => {
    const destructive = ACTIONS.filter((a) => a.scope === 'destructive').map((a) => a.id);
    expect(destructive).toEqual(['review.deleteToTrash', 'culling.cull']);
  });

  it('gives module-scoped actions an owning module', () => {
    for (const action of ACTIONS) {
      if (action.scope === 'module' || action.scope === 'destructive') {
        expect(action.owner, action.id).not.toBeNull();
      }
    }
  });

  it('resolves every section title', () => {
    for (const section of SECTIONS) {
      expect(t(section.titleKey)).not.toBe(section.titleKey);
      for (const moduleId of section.modules) {
        expect(MODULE_CATALOG[moduleId], `${section.id} → ${moduleId}`).toBeDefined();
      }
    }
  });
});

describe('catalog lookups', () => {
  it('returns a section\'s actions in catalog order', () => {
    const ids = actionsForSection('general').map((a) => a.id);
    expect(ids).toEqual([
      'general.showHelp',
      'general.reload',
      'general.preferences',
      'general.hardReload',
    ]);
  });

  it('finds an action by id, and nothing for an unknown one', () => {
    expect(getAction('review.confirm')?.owner).toBe('review-module');
    expect(getAction('nope.nope')).toBeUndefined();
  });
});
