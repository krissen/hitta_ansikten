import { describe, it, expect, vi, beforeEach } from 'vitest';

// The router imports scanScope (signalExternalLoad) and debug (localStorage at
// import). Mock scanScope so we can assert the count hand-off signals it; debug
// tolerates the jsdom-less env.
vi.mock('../src/renderer/shared/scanScope.js', () => ({
  signalExternalLoad: vi.fn(),
}));

import { createWorkspaceRouter, HANDOFFS } from '../src/renderer/workspace/flexlayout/workspaceCommands.js';
import { signalExternalLoad } from '../src/renderer/shared/scanScope.js';

function makeHandlers() {
  return {
    enterStep: vi.fn(),
    openModule: vi.fn(),
    openWorkflowStep: vi.fn(),
    loadLayout: vi.fn(),
    resetLayout: vi.fn(),
    moduleAPI: {
      // Resolve immediately so hand-offs finish within the test tick.
      waitForListeners: vi.fn().mockResolvedValue(true),
      emit: vi.fn(),
    },
  };
}

function readyRouter(handlers, options) {
  const router = createWorkspaceRouter(options);
  router.setHandlers(handlers);
  router.markReady();
  return router;
}

beforeEach(() => {
  signalExternalLoad.mockClear();
});

describe('workspaceCommands — direct intents', () => {
  it('routes each non-hand-off intent to its handler', () => {
    const h = makeHandlers();
    const router = readyRouter(h);

    router.dispatch({ type: 'enter-step', step: 'culling' });
    expect(h.enterStep).toHaveBeenCalledWith('culling');

    router.dispatch({ type: 'open-module', moduleId: 'trash', options: { forceNew: true } });
    expect(h.openModule).toHaveBeenCalledWith('trash', { forceNew: true });

    router.dispatch({ type: 'open-workflow-step', moduleId: 'player-count' });
    expect(h.openWorkflowStep).toHaveBeenCalledWith('player-count');

    router.dispatch({ type: 'load-layout', name: 'database' });
    expect(h.loadLayout).toHaveBeenCalledWith('database');

    router.dispatch({ type: 'reset-layout' });
    expect(h.resetLayout).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed / unknown intents without throwing', () => {
    const h = makeHandlers();
    const router = readyRouter(h);
    expect(() => router.dispatch(null)).not.toThrow();
    expect(() => router.dispatch({})).not.toThrow();
    expect(() => router.dispatch({ type: 'no-such-intent' })).not.toThrow();
    expect(h.enterStep).not.toHaveBeenCalled();
  });
});

describe('workspaceCommands — hand-offs (morph + waitForListeners + emit)', () => {
  it('each hand-off enters its step, waits for its event, then emits the payload', async () => {
    for (const [type, desc] of Object.entries(HANDOFFS)) {
      const h = makeHandlers();
      const router = readyRouter(h, { waitTimeout: 1234 });
      const payload = { marker: type };
      await router.dispatch({ type, payload });

      expect(h.enterStep).toHaveBeenCalledWith(desc.step);
      expect(h.moduleAPI.waitForListeners).toHaveBeenCalledWith(desc.event, 1234);
      expect(h.moduleAPI.emit).toHaveBeenCalledWith(desc.event, payload);
    }
  });

  it('emits an empty object when a hand-off carries no payload', async () => {
    const h = makeHandlers();
    const router = readyRouter(h);
    await router.dispatch({ type: 'open-culling' });
    expect(h.moduleAPI.emit).toHaveBeenCalledWith('culling-load', {});
  });

  it('open-count signals an external load before the morph (skips a stale scanScope count)', async () => {
    const h = makeHandlers();
    const router = readyRouter(h);
    await router.dispatch({ type: 'open-count', payload: { roots: ['/x'] } });
    expect(signalExternalLoad).toHaveBeenCalledTimes(1);
    expect(h.moduleAPI.emit).toHaveBeenCalledWith('count-load', { roots: ['/x'] });
  });

  it('non-count hand-offs do NOT signal an external load', async () => {
    const h = makeHandlers();
    const router = readyRouter(h);
    await router.dispatch({ type: 'open-culling', payload: { roots: ['/x'] } });
    expect(signalExternalLoad).not.toHaveBeenCalled();
  });
});

describe('workspaceCommands — intent buffer', () => {
  it('buffers intents dispatched before ready and flushes them in order on markReady', () => {
    const h = makeHandlers();
    const router = createWorkspaceRouter();
    router.setHandlers(h);

    // Not ready yet: these must queue, not run.
    router.dispatch({ type: 'enter-step', step: 'import' });
    router.dispatch({ type: 'open-module', moduleId: 'trash' });
    expect(router.pending()).toBe(2);
    expect(h.enterStep).not.toHaveBeenCalled();
    expect(h.openModule).not.toHaveBeenCalled();

    router.markReady();

    expect(h.enterStep).toHaveBeenCalledWith('import');
    expect(h.openModule).toHaveBeenCalledWith('trash', undefined);
    // Order preserved: enterStep before openModule.
    expect(h.enterStep.mock.invocationCallOrder[0])
      .toBeLessThan(h.openModule.mock.invocationCallOrder[0]);
    expect(router.pending()).toBe(0);
  });

  it('buffers even when handlers are set but not yet ready', () => {
    const h = makeHandlers();
    const router = createWorkspaceRouter();
    router.setHandlers(h);
    expect(router.isReady()).toBe(false);
    router.dispatch({ type: 'reset-layout' });
    expect(h.resetLayout).not.toHaveBeenCalled();
    router.markReady();
    expect(h.resetLayout).toHaveBeenCalledTimes(1);
  });

  it('runs intents immediately once ready (no buffering)', () => {
    const h = makeHandlers();
    const router = readyRouter(h);
    router.dispatch({ type: 'reset-layout' });
    expect(h.resetLayout).toHaveBeenCalledTimes(1);
    expect(router.pending()).toBe(0);
  });
});
