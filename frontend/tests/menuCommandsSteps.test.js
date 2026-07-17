import { describe, it, expect, vi } from 'vitest';

// menuCommands imports workflowSteps → moduleRegistry (module components) and the
// theme manager (localStorage at import). Mock the theme manager.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import { buildMenuCommandTable, createMenuCommandHandler } from '../src/renderer/workspace/flexlayout/menuCommands.js';

function makeCtx() {
  return {
    loadLayout: vi.fn(),
    resetLayout: vi.fn(),
    enterStep: vi.fn(),
    openWorkflowStep: vi.fn(),
    addTabset: vi.fn(),
    removeEmptyTabset: vi.fn(),
    moveToNewTabset: vi.fn(),
    openModule: vi.fn(),
    moduleAPI: { emit: vi.fn() },
  };
}

describe('menuCommands — pipeline step accelerators', () => {
  it('maps Cmd+1..5 step commands to openWorkflowStep with the step module', () => {
    const ctx = makeCtx();
    const table = buildMenuCommandTable(ctx);

    const cases = {
      'workflow-step-import': 'import',
      'workflow-step-rename': 'rename-nef',
      'workflow-step-review': 'review-module',
      'workflow-step-count': 'player-count',
      'workflow-step-culling': 'culling',
    };
    for (const [command, moduleId] of Object.entries(cases)) {
      expect(table[command], `handler for ${command}`).toBeTypeOf('function');
      table[command]();
      expect(ctx.openWorkflowStep).toHaveBeenCalledWith(moduleId);
    }
  });

  it('routes reset-layout to the dirty-guarded resetLayout, not a bare loadLayout', async () => {
    const ctx = makeCtx();
    const handler = createMenuCommandHandler(ctx);
    await handler('reset-layout');
    expect(ctx.resetLayout).toHaveBeenCalledTimes(1);
    expect(ctx.loadLayout).not.toHaveBeenCalled();
  });

  it('still forwards secondary layout templates to loadLayout (no accelerator)', async () => {
    const ctx = makeCtx();
    const handler = createMenuCommandHandler(ctx);
    await handler('layout-template-comparison');
    await handler('layout-template-stats');
    expect(ctx.loadLayout).toHaveBeenCalledWith('comparison');
    expect(ctx.loadLayout).toHaveBeenCalledWith('database');
  });

  it('broadcasts an unknown command to modules (default case)', async () => {
    const ctx = makeCtx();
    const handler = createMenuCommandHandler(ctx);
    await handler('some-view-command');
    expect(ctx.moduleAPI.emit).toHaveBeenCalledWith('some-view-command', {});
  });
});
