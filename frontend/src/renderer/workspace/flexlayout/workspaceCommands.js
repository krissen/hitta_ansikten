/**
 * workspaceCommands — the single command router for the FlexLayout workspace.
 *
 * Three "open"/navigation mechanisms used to reach the workspace independently:
 *   1. window.workspace.openModule / enterStep globals,
 *   2. moduleAPI events (open-culling, open-count, open-rename-nef, …) with
 *      per-handler waitForListeners race-guards,
 *   3. menu IPC → menuCommands dispatch table,
 * plus the CLI launch bridge (queue-files / open-culling / open-import IPC from
 * the main process).
 *
 * This router is now the ONE path. Every mechanism above is a thin adapter that
 * builds a typed intent and calls dispatch(intent); the router owns the routing.
 *
 * Intent buffer (the deterministic replacement for the cold-start timing hacks):
 * intents dispatched before the workspace signals ready — before the model is
 * built and the router's handlers are wired — are queued and flushed, in order,
 * when markReady() runs. This is what lets the main process stop guessing when
 * the renderer is up (the old 1000ms did-finish-load setTimeout): it sends launch
 * intents after the renderer's workspace-ready handshake, and any that still
 * arrive early are buffered rather than lost.
 *
 * The buffer covers the "router not initialized yet" race. It does NOT cover the
 * "target module not mounted yet" race — a step morph mounts the destination
 * module lazily and its React effect subscribes a tick later. That second race
 * is still guarded per hand-off by waitForListeners (see runHandoff), exactly as
 * the individual handlers did before. Those guards are preserved verbatim, only
 * relocated here.
 *
 * @typedef {object} WorkspaceIntent
 * @property {string} type
 */

import { signalExternalLoad } from '../../shared/scanScope.js';
import { debug, debugWarn } from '../../shared/debug.js';

/**
 * Hand-off descriptors: intent type → { step, event, signalExternal? }.
 *
 * Each describes a "morph into a step, then hand the payload to the module once
 * it has subscribed" flow. They share one implementation (runHandoff) so the
 * cold-start guard (waitForListeners) is written once and behaves identically for
 * every hand-off. The payload the intent carries is emitted verbatim on `event`.
 *
 *   queue-files / open-review-queue → review  (File Queue expands folders/files)
 *   open-culling                    → culling
 *   open-count                      → count   (signalExternal: skip a stale scanScope count)
 *   open-import                     → import
 *   open-rename-nef                 → rename
 *   load-image                      → review  (ensure an Image Viewer, then load)
 */
export const HANDOFFS = {
  'queue-files':       { step: 'review',  event: 'file-queue-load' },
  'open-review-queue': { step: 'review',  event: 'file-queue-load' },
  'open-culling':      { step: 'culling', event: 'culling-load' },
  'open-count':        { step: 'count',   event: 'count-load', signalExternal: true },
  'open-import':       { step: 'import',  event: 'import-load' },
  'open-rename-nef':   { step: 'rename',  event: 'rename-nef-load' },
  'load-image':        { step: 'review',  event: 'load-image' },
};

/**
 * Run one hand-off: (optionally signal an external load, so a downstream
 * adopt-on-mount skips a redundant scanScope-driven count), morph into the
 * step, wait for the target module to subscribe, then emit the payload.
 *
 * waitForListeners is the cold-mount guard: enterStep morphs the model but the
 * destination module's listener is registered a tick later, so the emit could
 * otherwise reach nobody. This is the same guarantee the per-handler guards gave
 * before consolidation.
 */
async function runHandoff(desc, payload, h, waitTimeout) {
  if (desc.signalExternal) signalExternalLoad();
  h.enterStep(desc.step);
  await h.moduleAPI.waitForListeners(desc.event, waitTimeout);
  h.moduleAPI.emit(desc.event, payload || {});
}

/**
 * Create a workspace command router.
 *
 * The router is created once (before the model exists) so dispatch is available
 * immediately and can buffer. The primitive operations it drives (enterStep,
 * openModule, …) are injected later via setHandlers, because they close over the
 * live model/React state; dispatch reads the current handlers at run time.
 *
 * @param {object} [options]
 * @param {number} [options.waitTimeout=2000] - per-hand-off waitForListeners budget.
 * @returns {{
 *   dispatch: (intent: WorkspaceIntent) => any,
 *   setHandlers: (handlers: object) => void,
 *   markReady: () => void,
 *   isReady: () => boolean,
 *   pending: () => number,
 * }}
 */
export function createWorkspaceRouter(options = {}) {
  const waitTimeout = options.waitTimeout ?? 2000;
  let ready = false;
  let handlers = null;
  const buffer = [];

  function run(intent) {
    const h = handlers;
    if (!h) {
      debugWarn('WorkspaceRouter', 'No handlers wired; dropping intent:', intent?.type);
      return undefined;
    }
    if (!intent || typeof intent.type !== 'string') {
      debugWarn('WorkspaceRouter', 'Ignoring malformed intent:', intent);
      return undefined;
    }
    debug('WorkspaceRouter', 'run', intent.type);
    switch (intent.type) {
      case 'enter-step':
        return h.enterStep(intent.step);
      case 'open-module':
        return h.openModule(intent.moduleId, intent.options);
      case 'open-workflow-step':
        return h.openWorkflowStep(intent.moduleId);
      case 'reset-layout':
        return h.resetLayout();
      case 'load-layout':
        return h.loadLayout(intent.name);
      default: {
        const desc = HANDOFFS[intent.type];
        if (desc) return runHandoff(desc, intent.payload, h, waitTimeout);
        debugWarn('WorkspaceRouter', 'Unknown intent type:', intent.type);
        return undefined;
      }
    }
  }

  return {
    dispatch(intent) {
      if (!ready || !handlers) {
        debug('WorkspaceRouter', 'buffering (not ready)', intent?.type);
        buffer.push(intent);
        return undefined;
      }
      return run(intent);
    },
    setHandlers(h) {
      handlers = h;
    },
    markReady() {
      ready = true;
      // Flush in dispatch order. Splice one at a time so a re-entrant dispatch
      // during flush (a handler that dispatches again) is appended, not skipped.
      while (buffer.length > 0) {
        run(buffer.shift());
      }
    },
    isReady() {
      return ready;
    },
    pending() {
      return buffer.length;
    },
  };
}
