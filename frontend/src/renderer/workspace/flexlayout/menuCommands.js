/**
 * Menu-command dispatch table for the FlexLayout workspace.
 *
 * Replaces the former ~40-case switch inside FlexLayoutWorkspace with a
 * { commandId: (ctx) => ... } table. The workspace builds the table with a
 * minimal ctx (the layout helpers + moduleAPI the cases actually use) and
 * subscribes createMenuCommandHandler(ctx) to the 'menu-command' IPC event.
 *
 * Any command not in the table falls through to moduleAPI.emit(command, {}) —
 * the same broadcast the switch's default case performed.
 */

import { themeManager } from '../../theme-manager.js';
import { debug } from '../../shared/debug.js';
import { WORKFLOW_STEPS } from './workflowSteps.js';

/**
 * Build the command -> handler table from a workspace context.
 * @param {object} ctx - { loadLayout, resetLayout, enterStep, openWorkflowStep,
 *   addTabset, removeEmptyTabset, moveToNewTabset, openModule, moduleAPI }
 */
export function buildMenuCommandTable(ctx) {
  const {
    loadLayout,
    resetLayout,
    openWorkflowStep,
    addTabset,
    removeEmptyTabset,
    moveToNewTabset,
    openModule,
    moduleAPI,
  } = ctx;

  // Pipeline-step accelerators (Cmd+1..5) route through openWorkflowStep — the
  // same non-destructive morph + dirty/mounted fast-path that WorkflowBar clicks
  // use — so keyboard and mouse navigation behave identically. Keyed by step id
  // (`workflow-step-<id>`) from the shared catalog so order/naming never drift.
  const stepCommands = {};
  for (const { step, moduleId } of WORKFLOW_STEPS) {
    stepCommands[`workflow-step-${step}`] = () => openWorkflowStep(moduleId);
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

    // Layout template commands (secondary, non-pipeline layouts moved to the
    // Window ▸ Layout templates submenu, no accelerators). These still replace
    // the layout via loadLayout — they are not pipeline steps.
    'layout-template-review': () => loadLayout('review'),
    'layout-review': () => loadLayout('review'),
    'layout-template-comparison': () => loadLayout('comparison'),
    'layout-comparison': () => loadLayout('comparison'),
    'layout-template-full-image': () => loadLayout('review'),
    'layout-template-stats': () => loadLayout('database'),
    'layout-database': () => loadLayout('database'),
    'layout-review-with-logs': () => loadLayout('review-with-logs'),
    'layout-full-review': () => loadLayout('full-review'),
    'layout-queue-review': () => loadLayout('queue-review'),

    // "Reset layout" (Cmd+Shift+L): the one destructive rebuild, dirty-guarded.
    'reset-layout': () => resetLayout(),

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

    // Open module commands
    'open-image-viewer': () => openModule('image-viewer'),
    'open-original-view': () => openModule('original-view'),
    'open-log-viewer': () => openModule('log-viewer'),
    'open-review-module': () => openModule('review-module'),
    'open-statistics-dashboard': () => openModule('statistics-dashboard'),
    'open-player-count': () => openModule('player-count'),
    'open-culling': () => openModule('culling'),
    'open-trash': () => openModule('trash'),
    'open-import': () => openModule('import'),
    'open-rename-nef': () => openModule('rename-nef'),
    'open-database-management': () => openModule('database-management'),
    'open-refine-faces': () => openModule('refine-faces'),
    'open-file-queue': () => openModule('file-queue'),
    'open-theme-editor': () => openModule('theme-editor'),

    'open-preferences': () => openModule('preferences'),

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
