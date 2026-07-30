/**
 * Menu-command dispatch table for the FlexLayout workspace.
 *
 * Replaces the former ~40-case switch inside FlexLayoutWorkspace with a
 * { commandId: (ctx) => ... } table. The workspace builds the table with a
 * minimal ctx (the layout helpers + moduleAPI the cases actually use) and
 * subscribes createMenuCommandHandler(ctx) to the 'menu-command' IPC event.
 *
 * Navigation commands (open a module, enter a step, load/reset a layout) are
 * adapters: they build a typed intent and hand it to ctx.dispatch — the single
 * workspace command router (workspaceCommands.js). Layout-geometry, theme and
 * open-file commands stay direct ctx calls; they are not part of the "open"
 * mechanisms the router consolidates.
 *
 * Any command not in the table falls through to moduleAPI.emit(command, {}) —
 * the same broadcast the switch's default case performed (view commands).
 */

import { themeManager } from '../../theme-manager.js';
import { debug } from '../../shared/debug.js';
import { WORKFLOW_STEPS } from './workflowSteps.js';

/**
 * Build the command -> handler table from a workspace context.
 * @param {object} ctx - { dispatch, addTabset, removeEmptyTabset,
 *   moveToNewTabset, moduleAPI, showWelcome, toggleShortcutsHelp }
 */
export function buildMenuCommandTable(ctx) {
  const {
    dispatch,
    addTabset,
    removeEmptyTabset,
    moveToNewTabset,
    moduleAPI,
    showWelcome,
    toggleShortcutsHelp,
  } = ctx;

  // Pipeline-step accelerators (Cmd+1..5) route through the open-workflow-step
  // intent — the same non-destructive morph + dirty/mounted fast-path that
  // WorkflowBar clicks use — so keyboard and mouse navigation behave
  // identically. Keyed by step id (`workflow-step-<id>`) from the shared catalog
  // so order/naming never drift.
  const stepCommands = {};
  for (const { step, moduleId } of WORKFLOW_STEPS) {
    stepCommands[`workflow-step-${step}`] = () =>
      dispatch({ type: 'open-workflow-step', moduleId });
  }

  return {
    ...stepCommands,

    // File commands
    'open-file': async () => {
      // Use multi-file dialog (same as Cmd+O and + button)
      const filePaths = await window.ansiktenAPI?.invoke('open-multi-file-dialog');
      if (filePaths && filePaths.length > 0) {
        if (window.fileQueue?.add) {
          window.fileQueue.add(filePaths);
          setTimeout(() => window.fileQueue.start?.(), 100);
        } else {
          moduleAPI.emit('load-image', { imagePath: filePaths[0] });
        }
      }
    },

    // Layout template commands (secondary, non-pipeline layouts in the
    // Window ▸ Layout templates submenu, no accelerators). These replace the
    // layout via the load-layout intent — they are not pipeline steps.
    //
    // Only the two the menu actually sends live here. Six sibling aliases
    // (`layout-review`, `layout-comparison`, `layout-database`,
    // `layout-template-review`, `layout-review-with-logs`, `layout-queue-review`)
    // were removed: they lost their menu items when the Window menu was rewritten
    // around the pipeline steps, and the menu is this table's only caller, so an
    // alias without a menu item is unreachable by construction. The layouts
    // themselves are untouched — `load-layout` still accepts every name in
    // layouts.js, so a programmatic dispatch reaches them.
    'layout-template-comparison': () => dispatch({ type: 'load-layout', name: 'comparison' }),
    'layout-template-stats': () => dispatch({ type: 'load-layout', name: 'database' }),

    // "Reset layout" (Cmd+Shift+L): forget the current step's remembered tweaks
    // and rebuild it to factory. "Reset all layouts": forget every step's memory.
    'reset-layout': () => dispatch({ type: 'reset-layout' }),
    'reset-all-layouts': () => dispatch({ type: 'reset-all-layouts' }),

    // Layout manipulation commands
    'layout-add-column': () => addTabset('column'),
    'layout-remove-column': () => removeEmptyTabset(),
    'layout-add-row': () => addTabset('row'),
    'layout-remove-row': () => removeEmptyTabset(),

    // Move to new column/row commands (Cmd+Alt+Arrow via menu)
    'layout-move-new-left': () => moveToNewTabset('left'),
    'layout-move-new-right': () => moveToNewTabset('right'),
    'layout-move-new-above': () => moveToNewTabset('above'),
    'layout-move-new-below': () => moveToNewTabset('below'),

    // Open module commands — each an adapter to the open-module intent.
    'open-image-viewer': () => dispatch({ type: 'open-module', moduleId: 'image-viewer' }),
    'open-original-view': () => dispatch({ type: 'open-module', moduleId: 'original-view' }),
    'open-log-viewer': () => dispatch({ type: 'open-module', moduleId: 'log-viewer' }),
    'open-review-module': () => dispatch({ type: 'open-module', moduleId: 'review-module' }),
    'open-statistics-dashboard': () => dispatch({ type: 'open-module', moduleId: 'statistics-dashboard' }),
    'open-player-count': () => dispatch({ type: 'open-module', moduleId: 'player-count' }),
    'open-culling': () => dispatch({ type: 'open-module', moduleId: 'culling' }),
    'open-trash': () => dispatch({ type: 'open-module', moduleId: 'trash' }),
    'open-import': () => dispatch({ type: 'open-module', moduleId: 'import' }),
    'open-rename-nef': () => dispatch({ type: 'open-module', moduleId: 'rename-nef' }),
    'open-database-management': () => dispatch({ type: 'open-module', moduleId: 'database-management' }),
    'open-refine-faces': () => dispatch({ type: 'open-module', moduleId: 'refine-faces' }),
    'open-file-queue': () => dispatch({ type: 'open-module', moduleId: 'file-queue' }),
    'open-theme-editor': () => dispatch({ type: 'open-module', moduleId: 'theme-editor' }),

    'open-preferences': () => dispatch({ type: 'open-module', moduleId: 'preferences' }),

    // Help ▸ toggle the keyboard-shortcuts overlay (same as the `?` key).
    'show-keyboard-shortcuts': () => toggleShortcutsHelp?.(),

    // Help ▸ show the first-run welcome card again on demand.
    'show-welcome': () => showWelcome?.(),

    // Theme commands
    'theme-light': () => themeManager.setPreference('light'),
    'theme-dark': () => themeManager.setPreference('dark'),
    'theme-system': () => themeManager.setPreference('system')
  };
}

/**
 * Create the async 'menu-command' handler for a workspace context. Looks the
 * command up in the dispatch table; unknown commands broadcast to modules via
 * moduleAPI.emit (the former switch default case).
 * @param {object} ctx - see buildMenuCommandTable
 */
export function createMenuCommandHandler(ctx) {
  const table = buildMenuCommandTable(ctx);

  return async (command) => {
    debug('FlexLayout', 'Menu command:', command);
    const handler = table[command];
    if (handler) {
      await handler();
    } else {
      // View commands - broadcast to modules
      ctx.moduleAPI.emit(command, {});
    }
  };
}
