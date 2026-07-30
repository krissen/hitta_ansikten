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
  ACTION_ROUTE_BUSES,
  KNOWN_DEAD_MENU_COMMANDS,
  actionsForSection,
  getAction,
  menuCommandsOf,
} from '../src/renderer/workspace/actions/actionCatalog.js';
import { MODULE_CATALOG } from '../src/renderer/workspace/flexlayout/moduleRegistry.js';
import { ROUTER_INTENT_TYPES } from '../src/renderer/workspace/flexlayout/workspaceCommands.js';
import { buildMenuCommandTable } from '../src/renderer/workspace/flexlayout/menuCommands.js';
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

/** Every `menu-command` string src/main/menu.js can send. */
function collectSentMenuCommands() {
  const menu = fs.readFileSync(path.resolve(__dirname, '../src/main/menu.js'), 'utf8');
  const commands = new Set();
  // A menu item sends either a literal or a checked-state ternary of two
  // literals, so take every string literal in the call's arguments.
  for (const call of menu.matchAll(/sendMenuCommand\(([^)]*)\)/g)) {
    for (const lit of call[1].matchAll(/'([^']+)'/g)) commands.add(lit[1]);
  }
  return commands;
}

/**
 * Commands the renderer handles: a key in the menu-command dispatch table, or —
 * via that table's broadcast fallback — an event some module subscribes to. The
 * table is built for real rather than grepped, so a handler added as a computed
 * key (the generated `workflow-step-*` entries) counts like any other.
 */
function collectHandledMenuCommands() {
  const noop = () => {};
  const ctx = {
    dispatch: noop,
    addTabset: noop,
    removeEmptyTabset: noop,
    moveToNewTabset: noop,
    moduleAPI: { emit: noop, on: noop, waitForListeners: noop },
    showWelcome: noop,
    toggleShortcutsHelp: noop,
  };
  return new Set([...Object.keys(buildMenuCommandTable(ctx)), ...collectSubscribedEvents()]);
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

  it('routes only via the three existing buses', () => {
    for (const action of ACTIONS) {
      if (action.route === null) continue;
      expect(ACTION_ROUTE_BUSES, action.id).toContain(action.route.via);
      if (action.route.via === 'emit') {
        expect(typeof action.route.event, action.id).toBe('string');
        // A directional pair is only meaningful for a signed (delta) action.
        if (action.route.eventDown) expect(action.kind).toBe('delta');
      } else if (action.route.via === 'menu') {
        const commands = [action.route.command].flat();
        expect(commands.length, action.id).toBeGreaterThan(0);
        for (const command of commands) expect(typeof command, action.id).toBe('string');
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

  it('declares every menu command the app menu can send', () => {
    // The catalog now claims to cover the menu bus too. A menu item added without
    // a catalog entry is the drift this catches — the same failure the keyboard
    // half already fails on.
    const declared = new Set(ACTIONS.flatMap(menuCommandsOf));
    for (const command of collectSentMenuCommands()) {
      expect(declared, `menu.js sends '${command}', no action declares it`).toContain(command);
    }
  });

  it('names a menu command something in the renderer handles', () => {
    // The menu's counterpart to the emit/dispatch target checks: a command with
    // neither a dispatch-table entry nor a subscriber falls through the broadcast
    // fallback and silently does nothing. This is what makes a dead menu item
    // fail the suite instead of the user.
    const handled = collectHandledMenuCommands();
    const dead = new Set(KNOWN_DEAD_MENU_COMMANDS);
    for (const action of ACTIONS) {
      for (const command of menuCommandsOf(action)) {
        if (dead.has(command)) continue;
        expect(handled, `${action.id} → '${command}' (nothing handles it)`).toContain(command);
      }
    }
  });

  it('keeps the dead-command list honest in both directions', () => {
    // A listed command must still be dead (otherwise the exception outlived the
    // defect) and must still be a command the menu sends (otherwise it is stale).
    const handled = collectHandledMenuCommands();
    const sent = collectSentMenuCommands();
    for (const command of KNOWN_DEAD_MENU_COMMANDS) {
      expect(handled, `'${command}' is handled now — drop it from the list`).not.toContain(command);
      expect(sent, `'${command}' is no longer a menu command — drop it`).toContain(command);
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

  it('gives every action at least one binding', () => {
    // A key or a menu command. Menu-only actions with no accelerator (Papperskorg,
    // the theme entries) have an empty `keys` and are still bound; an action with
    // neither is one nothing can trigger.
    for (const action of ACTIONS) {
      expect(Array.isArray(action.keys), action.id).toBe(true);
      const bindings = action.keys.length + menuCommandsOf(action).length;
      expect(bindings, `${action.id} has no key and no menu command`).toBeGreaterThan(0);
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
      'general.reloadDatabase',
      'general.preferences',
      'general.saveAll',
      'general.discardChanges',
      'general.showWelcome',
      'general.themeLight',
      'general.themeDark',
      'general.themeSystem',
      'general.hardReload',
    ]);
  });

  it('finds an action by id, and nothing for an unknown one', () => {
    expect(getAction('review.confirm')?.owner).toBe('review-module');
    expect(getAction('nope.nope')).toBeUndefined();
  });
});
