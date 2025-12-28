// preload.js
// Secure bridge between main and renderer processes

const { contextBridge, ipcRenderer } = require("electron");

// Expose safe, limited APIs to renderer
contextBridge.exposeInMainWorld("bildvisareAPI", {
  // IPC communication - only specific channels allowed
  send: (channel, data) => {
    const allowedChannels = ["bild-visad", "sync-view"];
    if (allowedChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  on: (channel, callback) => {
    const allowedChannels = ["show-wait-overlay", "hide-wait-overlay", "apply-view"];
    if (allowedChannels.includes(channel)) {
      // Strip event object for security
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
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
});
