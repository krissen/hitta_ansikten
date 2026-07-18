import { describe, it, expect, vi } from 'vitest';

// menuCommands imports workflowSteps → moduleRegistry (module components) and the
// theme manager (localStorage at import). Mock the theme manager.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import { buildMenuCommandTable, createMenuCommandHandler } from '../src/renderer/workspace/flexlayout/menuCommands.js';

function makeCtx() {
  return {
    dispatch: vi.fn(),
    addTabset: vi.fn(),
    removeEmptyTabset: vi.fn(),
    moveToNewTabset: vi.fn(),
    moduleAPI: { emit: vi.fn() },
  };
}

describe('menuCommands — pipeline step accelerators', () => {
  it('maps Cmd+1..5 step commands to an open-workflow-step intent with the step module', () => {
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
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'open-workflow-step', moduleId });
    }
  });

  it('routes reset-layout to a reset-layout intent (not a bare load-layout)', async () => {
    const ctx = makeCtx();
    const handler = createMenuCommandHandler(ctx);
    await handler('reset-layout');
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'reset-layout' });
    expect(ctx.dispatch).not.toHaveBeenCalledWith({ type: 'load-layout', name: 'review' });
  });

  it('forwards secondary layout templates to a load-layout intent (no accelerator)', async () => {
    const ctx = makeCtx();
    const handler = createMenuCommandHandler(ctx);
    await handler('layout-template-comparison');
    await handler('layout-template-stats');
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'load-layout', name: 'comparison' });
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'load-layout', name: 'database' });
  });

  it('maps open-<module> commands to an open-module intent', async () => {
    const ctx = makeCtx();
    const handler = createMenuCommandHandler(ctx);
    await handler('open-culling');
    await handler('open-player-count');
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'open-module', moduleId: 'culling' });
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'open-module', moduleId: 'player-count' });
  });

  it('broadcasts an unknown command to modules (default case)', async () => {
    const ctx = makeCtx();
    const handler = createMenuCommandHandler(ctx);
    await handler('some-view-command');
    expect(ctx.moduleAPI.emit).toHaveBeenCalledWith('some-view-command', {});
  });
});
