/**
 * Logger Utility
 *
 * Logs to both DevTools console and optionally to file via IPC.
 * File logging is controlled by preferences: debug.enabled && debug.logToFile
 */

import { preferences } from '../workspace/preferences.js';

class Logger {
  constructor() {
    this.prefix = '[Renderer]';
    this.ipcAvailable = typeof window !== 'undefined' && window.bildvisareAPI;
  }

  /**
   * Check if file logging is enabled
   */
  isFileLoggingEnabled() {
    const debugEnabled = preferences.get('debug.enabled');
    const logToFile = preferences.get('debug.logToFile');
    return debugEnabled && logToFile;
  }

  /**
   * Format log message with timestamp
   */
  formatMessage(level, tag, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    return `${timestamp} [${tag}] ${message}`;
  }

  /**
   * Send log to main process for file writing
   */
  sendToFile(level, formattedMessage) {
    if (this.ipcAvailable && this.isFileLoggingEnabled()) {
      try {
        window.bildvisareAPI.send('renderer-log', { level, message: formattedMessage });
      } catch (err) {
        // Silently fail - don't cause infinite loop
      }
    }
  }

  /**
   * Log with tag
   */
  log(tag, ...args) {
    const formatted = this.formatMessage('info', tag, ...args);
    console.log(`[${tag}]`, ...args);
    this.sendToFile('info', formatted);
  }

  /**
   * Warning with tag
   */
  warn(tag, ...args) {
    const formatted = this.formatMessage('warn', tag, ...args);
    console.warn(`[${tag}]`, ...args);
    this.sendToFile('warn', formatted);
  }

  /**
   * Error with tag
   */
  error(tag, ...args) {
    const formatted = this.formatMessage('error', tag, ...args);
    console.error(`[${tag}]`, ...args);
    this.sendToFile('error', formatted);
  }

  /**
   * Debug (only logs if debug.enabled is true)
   */
  debug(tag, ...args) {
    if (!preferences.get('debug.enabled')) return;

    const formatted = this.formatMessage('debug', tag, ...args);
    console.log(`[${tag}]`, ...args);
    this.sendToFile('debug', formatted);
  }
}

// Singleton instance
export const logger = new Logger();

// Convenience functions for common tags
export const workspaceLog = (...args) => logger.log('Workspace', ...args);
export const workspaceWarn = (...args) => logger.warn('Workspace', ...args);
export const workspaceError = (...args) => logger.error('Workspace', ...args);
export const workspaceDebug = (...args) => logger.debug('Workspace', ...args);

export const layoutLog = (...args) => logger.log('LayoutManager', ...args);
export const layoutWarn = (...args) => logger.warn('LayoutManager', ...args);
export const layoutError = (...args) => logger.error('LayoutManager', ...args);
export const layoutDebug = (...args) => logger.debug('LayoutManager', ...args);
