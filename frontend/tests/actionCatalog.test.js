import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
import { ROUTER_INTENT_TYPES } from '../src/renderer/workspace/flexlayout/workspaceCommands.js';
import { t } from '../src/i18n/index.js';

/**
 * Read every .js/.jsx source file under a directory tree. Skips `dist/` — the
 * built bundle is a stale copy of the sources and would answer "does anything
 * emit this?" with yesterday's code.
 */
function readSources(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(entry.name)) out.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return out;
}

/** moduleAPI events some module subscribes to. */
function collectSubscribedEvents() {
  const events = new Set();
  for (const src of readSources(path.resolve(__dirname, '../src/renderer'))) {
    for (const m of src.matchAll(/useModuleEvent\(\s*'([^']+)'/g)) events.add(m[1]);
    for (const m of src.matchAll(/moduleAPI\.on\(\s*'([^']+)'/g)) events.add(m[1]);
  }
  return events;
}

/**
 * Events something in the app actually sends today — a renderer `emit(...)` or a
 * menu command, which reaches modules through menuCommands' broadcast fallback.
 */
function collectEmittedEvents() {
  const events = new Set();
  for (const src of readSources(path.resolve(__dirname, '../src/renderer'))) {
    for (const m of src.matchAll(/\bemit\(\s*'([^']+)'/g)) events.add(m[1]);
  }
  // A menu item sends either a literal or a checked-state ternary of two
  // literals, so take every string literal in the call's arguments.
  const menu = fs.readFileSync(path.resolve(__dirname, '../src/main/menu.js'), 'utf8');
  for (const call of menu.matchAll(/sendMenuCommand\(([^)]*)\)/g)) {
    for (const lit of call[1].matchAll(/'([^']+)'/g)) events.add(lit[1]);
  }
  return events;
}

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

  it('emits only live events — subscribed by a module and sent by the app', () => {
    // Two halves, both needed. Subscribed: the emit reaches somebody. Sent: the
    // event is on a path the app still uses, which is what separates the live
    // `boxes-show`/`boxes-hide` pair from the legacy `toggle-boxes-on-off` that
    // is still listened for but that nothing emits any more.
    const subscribed = [...collectSubscribedEvents()];
    const emitted = [...collectEmittedEvents()];
    const events = ACTIONS.filter((a) => a.route?.via === 'emit').flatMap((a) =>
      [a.route.event, a.route.eventDown].filter(Boolean).map((e) => [a.id, e])
    );
    for (const [id, event] of events) {
      expect(subscribed, `${id} → ${event} (no subscriber)`).toContain(event);
      expect(emitted, `${id} → ${event} (nothing emits it)`).toContain(event);
    }
  });

  it('dispatches only intent types the router handles', () => {
    for (const action of ACTIONS) {
      if (action.route?.via !== 'dispatch') continue;
      expect(ROUTER_INTENT_TYPES, action.id).toContain(action.route.intent.type);
    }
  });

  it('marks an incomplete intent as a template with `fills`', () => {
    // A template intent must say which fields the caller supplies, so "field
    // deliberately left out" is distinguishable from "field forgotten".
    for (const action of ACTIONS) {
      if (action.route?.via !== 'dispatch' || !action.route.fills) continue;
      expect(Array.isArray(action.route.fills), action.id).toBe(true);
      expect(action.route.fills.length, action.id).toBeGreaterThan(0);
      for (const field of action.route.fills) {
        expect(action.route.intent, `${action.id} pre-fills ${field}`).not.toHaveProperty(field);
      }
    }
    // open-workflow-step needs a moduleId that the range value resolves.
    expect(getAction('layout.switchStep').route.fills).toEqual(['moduleId']);
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
