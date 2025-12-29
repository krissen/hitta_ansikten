/**
 * Hooks index - Export all custom React hooks
 */

export { useCanvas, useCanvasDimensions, useAnimationFrame } from './useCanvas.js';
export { useKeyboardShortcuts, useKeyHold } from './useKeyboardShortcuts.js';
export { useWebSocket, useWebSocketEvents, useWebSocketConnection } from './useWebSocket.js';
export { useAutoRefresh, usePolledData } from './useAutoRefresh.js';
export {
  useModuleAPI,
  useModuleEvent,
  useEmitEvent,
  useModuleEvents,
  useBackendHttp,
  useIPC
} from './useModuleEvent.js';
