// preload.js
// Secure bridge between main and renderer processes

const { contextBridge, ipcRenderer } = require("electron");

// Expose safe, limited APIs to renderer
contextBridge.exposeInMainWorld("ansiktenAPI", {
  // Launch intent parsed from the command line, resolved synchronously at
  // preload time so the renderer can decide whether to show the startup
  // landing page before its first paint (avoids a landing flash on
  // `ansikten culling ...` / `ansikten <files>`).
  launchIntent: ipcRenderer.sendSync("get-launch-intent-sync"),

  // IPC communication - only specific channels allowed
  send: (channel, data) => {
    const allowedChannels = ["bild-visad", "sync-view", "renderer-log", "update-menu-state"];
    if (allowedChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  on: (channel, callback) => {
    const allowedChannels = ["show-wait-overlay", "hide-wait-overlay", "apply-view", "load-initial-file", "menu-command", "devtools-state-changed", "queue-files", "open-culling", "open-import"];
    if (!allowedChannels.includes(channel)) return undefined;
    // Strip event object for security. Return a disposer so callers can clean
    // up in effect teardown and avoid stacking duplicate listeners on re-runs.
    const handler = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // Invoke IPC handlers (request-response pattern)
  invoke: (channel, ...args) => {
    const allowedChannels = [
      "open-file-dialog",
      "open-multi-file-dialog",
      "open-folder-dialog",
      "open-folder-paths",
      "expand-glob",
      "check-file-changed",
      "get-initial-file",
      "open-raw-in-lightroom",
      "stat-file-stable"
    ];
    if (allowedChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    throw new Error(`IPC channel '${channel}' not allowed`);
  },

  // Safe file stat checking via IPC (no direct fs access)
  checkFileChanged: (filePath) => {
    return ipcRenderer.invoke("check-file-changed", filePath);
  },

  // PERFORMANCE: File watching via IPC instead of polling
  watchFile: (filePath) => {
    ipcRenderer.send("watch-file", filePath);
  },

  unwatchFile: (filePath) => {
    ipcRenderer.send("unwatch-file", filePath);
  },

  onFileChanged: (callback) => {
    ipcRenderer.on("file-changed", (event, filePath) => callback(filePath));
  },

  onFileDeleted: (callback) => {
    const handler = (event, filePath) => callback(filePath);
    ipcRenderer.on("file-deleted", handler);
    return () => {
      ipcRenderer.removeListener("file-deleted", handler);
    };
  },

  onWatcherError: (callback) => {
    const handler = (event, { dir, files }) => callback(dir, files);
    ipcRenderer.on("watcher-error", handler);
    return () => {
      ipcRenderer.removeListener("watcher-error", handler);
    };
  },

  unwatchAllFiles: () => {
    ipcRenderer.send("unwatch-all-files");
  },

  // Folder-level watching for live auto-refresh (whole directory, debounced).
  watchFolder: (dir, recursive = true) => {
    ipcRenderer.send("watch-folder", { dir, recursive });
  },

  unwatchFolder: (dir) => {
    ipcRenderer.send("unwatch-folder", dir);
  },

  onFolderChanged: (callback) => {
    const handler = (event, dir) => callback(dir);
    ipcRenderer.on("folder-changed", handler);
    return () => {
      ipcRenderer.removeListener("folder-changed", handler);
    };
  },
});
