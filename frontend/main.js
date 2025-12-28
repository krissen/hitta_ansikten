// main.js
//
// Dual-Mode Bootstrap: Workspace vs Legacy
// Set BILDVISARE_WORKSPACE=1 to use new modular workspace
// Set BILDVISARE_WORKSPACE=0 (or unset) to use legacy single-window mode

const USE_WORKSPACE = process.env.BILDVISARE_WORKSPACE === '1';

if (USE_WORKSPACE) {
  // Load new modular workspace
  console.log('[Bootstrap] Loading modular workspace...');
  require('./src/main/index.js');
} else {
  // LEGACY MODE: Continue with current implementation below
  console.log('[Bootstrap] Loading legacy mode...');

// Logging configuration - logger and dlog defined after requires below
const LOG_LEVEL = process.env.BILDVISARE_LOG_LEVEL || "debug"; // Always debug in packaged app
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Configuration constants
const STATUS_FILE_POLL_INTERVAL_MS = 1500; // Poll status file every 1.5s
const STATUS_FILE_INITIAL_DELAY_MS = 2000; // Initial delay before polling

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, exec } = require("child_process");
const { convertNEFtoJPG, ensureJPGAndLaunchSlave } = require("./lib/conversion");

// File logging for packaged app
const isPackaged = !process.execPath.includes("node_modules/electron") && !process.execPath.includes("/dev/bildvisare");
const logFilePath = path.join(os.homedir(), "Library", "Logs", "Bildvisare.log");
let logStream = null;

// Always try to create log file - fallback to console if it fails
try {
  const logDir = path.dirname(logFilePath);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });
  const startMsg = `\n\n=== Bildvisare started at ${new Date().toISOString()} (packaged: ${isPackaged}, execPath: ${process.execPath}) ===\n`;
  logStream.write(startMsg);
  if (!isPackaged) console.log(startMsg.trim()); // Also log to console in dev
} catch (e) {
  console.error("Failed to create log file:", e);
  logStream = null; // Ensure we fall back to console
}

function logToFile(level, ...args) {
  const timestamp = new Date().toISOString();
  const message = `${timestamp} [bildvisare:${level}] ${args.join(" ")}\n`;
  if (logStream) {
    logStream.write(message);
  } else {
    console.log(`[bildvisare:${level}]`, ...args);
  }
}

/**
 * Simple logging utility with log levels.
 * Set BILDVISARE_LOG_LEVEL env var to control verbosity.
 * Packaged app logs to ~/Library/Logs/Bildvisare.log
 */
const logger = {
  debug: (...args) => {
    if (LOG_LEVELS[LOG_LEVEL] <= LOG_LEVELS.debug) {
      logToFile("debug", ...args);
    }
  },
  info: (...args) => {
    if (LOG_LEVELS[LOG_LEVEL] <= LOG_LEVELS.info) {
      logToFile("info", ...args);
    }
  },
  warn: (...args) => {
    if (LOG_LEVELS[LOG_LEVEL] <= LOG_LEVELS.warn) {
      logToFile("warn", ...args);
    }
  },
  error: (...args) => {
    if (LOG_LEVELS[LOG_LEVEL] <= LOG_LEVELS.error) {
      logToFile("error", ...args);
    }
  },
};

// Backwards compatibility
const DEBUG = LOG_LEVEL === "debug";
function dlog(...args) {
  logger.debug(...args);
}

const statusFilePath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "bildvisare",
  "status.json",
);

const originalStatusPath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "bildvisare",
  "original_status.json",
);

/**
 * Validates that a file path is safe to access.
 * Only allows image files under user's home directory or /tmp.
 *
 * @param {string} filePath - The file path to validate
 * @returns {boolean} True if path is valid and safe, false otherwise
 */
function isValidImagePath(filePath) {
  if (!filePath || typeof filePath !== "string") return false;

  try {
    const resolved = path.resolve(filePath);
    const home = os.homedir();
    const systemTmp = os.tmpdir(); // System temp directory

    // Only allow paths under user's home directory or system temp directory
    const isUnderHome = resolved.startsWith(home);
    // macOS: /var is symlink to /private/var, so check both
    const isUnderTmp = resolved.startsWith("/tmp") ||
                       resolved.startsWith("/private/tmp") ||
                       resolved.startsWith("/var/folders") ||
                       resolved.startsWith("/private/var/folders") ||
                       resolved.startsWith(systemTmp);

    if (!isUnderHome && !isUnderTmp) {
      dlog("SECURITY: Rejected path outside allowed directories:", resolved);
      dlog("  Home:", home);
      dlog("  SystemTmp:", systemTmp);
      return false;
    }

    // Check file extension - only allow image formats
    const ext = path.extname(resolved).toLowerCase();
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".nef", ".cr2", ".arw"];
    if (!allowedExtensions.includes(ext)) {
      dlog("SECURITY: Rejected invalid file extension:", ext);
      return false;
    }

    return true;
  } catch (e) {
    dlog("SECURITY: Path validation error:", e);
    return false;
  }
}

// NOTE: convertNEFtoJPG and ensureJPGAndLaunchSlave moved to lib/conversion.js

// For slave/secondary instance: passed with --slave or env variable
const IS_SLAVE =
  process.argv.includes("--slave") || !!process.env.BILDVISARE_SLAVE;

dlog("DEBUG: process.argv =", process.argv);
dlog("DEBUG: IS_SLAVE =", IS_SLAVE);

// BUG FIX: Read image path from environment variable for slave (Electron v36 compatibility)
// Passing file paths as argv causes ERR_UNKNOWN_FILE_EXTENSION in Electron v36
// Master: Read from argv[2]
// Slave:  Read from BILDVISARE_IMAGE_PATH env var
let bildFil = IS_SLAVE ? process.env.BILDVISARE_IMAGE_PATH : process.argv[2];
bildFil = bildFil || null;

// SECURITY: Validate initial bildFil path
if (bildFil && !isValidImagePath(bildFil)) {
  dlog("SECURITY: Invalid initial bildFil path, ignoring:", bildFil);
  bildFil = null;
}
dlog("DEBUG: bildFil =", bildFil);

let appStartedAt = new Date().toLocaleString("sv-SE");
let appIsRunning = true;
let currentFileInfo = null;
let mainWindow = null;
let slaveWindow = null;
let hasOpenedWindow = false;
let pendingOpenFile = null;
let isAppReady = false;
let lastSlaveImagePath = null; // To avoid restarting the same slave multiple times
let slaveProc = null; // Handle secondary instance process
let originalNefPath = null; // Track original NEF path when showing JPG preview
// Track spawned slaves: Map of imagePath -> timestamp
const spawnedSlaves = new Map();

dlog("App starting. CLI arguments:", process.argv, "IS_SLAVE:", IS_SLAVE);

/**
 * Writes application status to JSON file.
 * Includes app running state, start time, and current file info.
 *
 * @param {Object} data - Additional data to merge into status
 */
function writeStatus(data = {}) {
  try {
    const dir = path.dirname(statusFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      statusFilePath,
      JSON.stringify(
        {
          app_status: appIsRunning ? "running" : "exited",
          app_started: appStartedAt,
          ...currentFileInfo,
          ...data,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    // Don't crash app if status file can't be written
    logger.warn("Failed to write status file:", err.message);
  }
}

app.on("open-file", (event, filePath) => {
  dlog("open-file-event:", filePath);
  event.preventDefault();

  // SECURITY: Validate file path from open-file event
  if (!isValidImagePath(filePath)) {
    dlog("SECURITY: Invalid file path from open-file event:", filePath);
    return;
  }

  bildFil = filePath;
  updateFileStatus(bildFil);

  if (!isAppReady) {
    dlog("open-file: app not ready, queueing for later");
    pendingOpenFile = filePath;
    return;
  }

  if (!hasOpenedWindow) {
    dlog("open-file: Creating new window");
    createMasterWindow();
  } else if (mainWindow) {
    dlog("open-file: Reloading window with image:", bildFil);
    mainWindow.loadFile("index.html", {
      query: { bild: encodeURIComponent(path.resolve(bildFil)), slave: "0" },
    });
  }
});
writeStatus();

app.on("will-quit", () => {
  appIsRunning = false;
  dlog("App closing (will-quit)");
  writeStatus();
});

function updateFileStatus(filePath) {
  dlog("updateFileStatus:", filePath);
  currentFileInfo = {
    file_opened: new Date().toLocaleString("sv-SE"),
    file_path: path.resolve(filePath),
    file_updated: new Date().toLocaleString("sv-SE"),
  };
  writeStatus();
}

function updateFileViewed() {
  if (!currentFileInfo) return;
  dlog("updateFileViewed");
  currentFileInfo.file_updated = new Date().toLocaleString("sv-SE");
  writeStatus();
}

// ----- IPC from renderer
ipcMain.on("bild-visad", () => {
  dlog("IPC: bild-visad from renderer");
  updateFileViewed();
});

// Synchronize views between master and slave
ipcMain.on("sync-view", (event, data) => {
  // Forward to other window
  if (event.sender === mainWindow?.webContents && slaveWindow) {
    slaveWindow.webContents.send("apply-view", data);
  } else if (event.sender === slaveWindow?.webContents && mainWindow) {
    mainWindow.webContents.send("apply-view", data);
  }
});

// SECURITY: Safe file stat checking for renderer (no direct fs access)
ipcMain.handle("check-file-changed", async (event, filePath) => {
  // Validate file path first
  if (!isValidImagePath(filePath)) {
    dlog("SECURITY: Rejected file stat request for invalid path:", filePath);
    return { error: "Invalid file path", mtimeMs: 0 };
  }

  try {
    const stats = await fs.promises.stat(filePath);
    return { mtimeMs: stats.mtimeMs };
  } catch (err) {
    return { error: err.message, mtimeMs: 0 };
  }
});

// PERFORMANCE: File watching instead of polling
// Map of file paths to {watcher, senders: Set<WebContents>}
const fileWatchers = new Map();

ipcMain.on("watch-file", (event, filePath) => {
  // Validate file path
  if (!isValidImagePath(filePath)) {
    dlog("SECURITY: Rejected file watch request for invalid path:", filePath);
    return;
  }

  if (!fs.existsSync(filePath)) {
    dlog("WARNING: Cannot watch non-existent file:", filePath);
    return;
  }

  const sender = event.sender;

  // If already watching this file, just add this sender
  if (fileWatchers.has(filePath)) {
    const entry = fileWatchers.get(filePath);
    entry.senders.add(sender);
    dlog("Added sender to existing watcher for:", filePath);
    return;
  }

  // Create new watcher
  try {
    const watcher = fs.watch(filePath, (eventType) => {
      if (eventType === "change") {
        dlog("File changed, notifying watchers:", filePath);
        const entry = fileWatchers.get(filePath);
        if (entry) {
          // Notify all windows watching this file
          entry.senders.forEach((s) => {
            if (!s.isDestroyed()) {
              s.send("file-changed", filePath);
            }
          });
        }
      }
    });

    fileWatchers.set(filePath, {
      watcher,
      senders: new Set([sender]),
    });

    dlog("Started watching file:", filePath);

    // Clean up when sender (window) is destroyed
    sender.on("destroyed", () => {
      unwatchFileForSender(filePath, sender);
    });
  } catch (err) {
    dlog("ERROR: Failed to watch file:", filePath, err.message);
  }
});

ipcMain.on("unwatch-file", (event, filePath) => {
  unwatchFileForSender(filePath, event.sender);
});

function unwatchFileForSender(filePath, sender) {
  const entry = fileWatchers.get(filePath);
  if (!entry) return;

  entry.senders.delete(sender);

  // If no more senders, close the watcher
  if (entry.senders.size === 0) {
    entry.watcher.close();
    fileWatchers.delete(filePath);
    dlog("Stopped watching file (no more watchers):", filePath);
  }
}

// ------ Slave instance handling and original_status.json monitoring ------

function readSlaveStatusFile() {
  if (!fs.existsSync(originalStatusPath)) return null;
  try {
    const stat = fs.statSync(originalStatusPath);
    const content = fs.readFileSync(originalStatusPath, "utf8");
    const json = JSON.parse(content);
    return {
      ...json,
      fileMTime: stat.mtimeMs,
    };
  } catch (e) {
    dlog("Error reading slave status file:", e);
    return null;
  }
}

/**
 * Launches a secondary (slave) viewer window for an image.
 * Checks if viewer is already running to avoid duplicates.
 *
 * @param {string} imagePath - Path to image file to open in slave viewer
 */
function launchSlaveViewer(imagePath) {
  dlog("Attempting to start slave viewer for", imagePath);
  if (!imagePath || !fs.existsSync(imagePath)) {
    dlog("File does not exist:", imagePath);
    return;
  }

  // Check if we recently spawned a slave for this image (within last 5 seconds)
  const now = Date.now();
  const SLAVE_SPAWN_COOLDOWN_MS = 5000; // 5 seconds

  if (spawnedSlaves.has(imagePath)) {
    const spawnTime = spawnedSlaves.get(imagePath);
    const elapsed = now - spawnTime;
    if (elapsed < SLAVE_SPAWN_COOLDOWN_MS) {
      dlog("Slave viewer for this image was recently spawned:", imagePath,
           `(${elapsed}ms ago, cooldown: ${SLAVE_SPAWN_COOLDOWN_MS}ms)`);
      return;
    }
    // Cooldown expired, remove old entry
    spawnedSlaves.delete(imagePath);
  }

  // Record spawn time
  spawnedSlaves.set(imagePath, now);
  lastSlaveImagePath = imagePath;

  // Clean up old entries (older than cooldown period)
  for (const [path, time] of spawnedSlaves.entries()) {
    if (now - time > SLAVE_SPAWN_COOLDOWN_MS) {
      spawnedSlaves.delete(path);
    }
  }

  // Start via open -a Bildvisare "image"
  dlog("Running: open -a Bildvisare", imagePath);
  // We pass --slave to distinguish
  const appBundlePath = path
    .dirname(process.execPath)
    .includes(".app/Contents/MacOS")
    ? path.resolve(process.execPath)
    : "/Applications/Bildvisare.app/Contents/MacOS/Bildvisare";

  // ERROR HANDLING: Spawn slave viewer with error handling
  // BUG FIX: Pass image path via env var to avoid Electron v36 module loading error
  logger.debug("Spawning slave with:", { appBundlePath, imagePath });

  // BUG FIX: In development mode, we need to pass the app directory
  const args = appBundlePath.includes("node_modules/electron")
    ? [".", "--slave"]  // Development: Pass app directory first
    : ["--slave"];      // Production: Bundled app doesn't need directory

  const slaveProcess = spawn(appBundlePath, args, {
    detached: true,
    stdio: process.env.BILDVISARE_LOG_LEVEL === "debug" ? "inherit" : "ignore",
    env: {
      ...process.env,
      BILDVISARE_SLAVE: "1",
      BILDVISARE_IMAGE_PATH: imagePath,  // Pass via env instead of argv
      BILDVISARE_LOG_LEVEL: process.env.BILDVISARE_LOG_LEVEL || "info"
    },
  });

  slaveProcess.on("error", (err) => {
    dlog("ERROR: Failed to spawn slave viewer:", err.message);
  });

  slaveProcess.unref();
}

// Monitor status file for changes, auto-start slave if requested
let mainStartedAt = Date.now();
function watchSlaveStatusFile() {
  let lastKnownMtime = 0;
  let lastKnownExported = null;
  function check() {
    const status = readSlaveStatusFile();
    if (!status) return setTimeout(check, STATUS_FILE_POLL_INTERVAL_MS);

    // NEW: check that status file is NEWER than main instance
    if (
      status.fileMTime > mainStartedAt &&
      (status.fileMTime !== lastKnownMtime ||
        status.exported_jpg !== lastKnownExported)
    ) {
      lastKnownMtime = status.fileMTime;
      lastKnownExported = status.exported_jpg;

      // IGNORE internal bildvisare conversions (_preview.jpg and _converted.jpg)
      // These are handled by the app itself, not the status file poller
      const filename = path.basename(status.exported_jpg || "");
      if (filename.endsWith("_preview.jpg") || filename.endsWith("_converted.jpg")) {
        dlog("Ignoring internal conversion file:", status.exported_jpg);
      } else {
        dlog("Detected new/changed slave status file:", status.exported_jpg);
        if (status.exported_jpg && fs.existsSync(status.exported_jpg)) {
          launchSlaveViewer(status.exported_jpg);
        }
      }
    }
    setTimeout(check, STATUS_FILE_POLL_INTERVAL_MS);
  }
  setTimeout(check, STATUS_FILE_INITIAL_DELAY_MS);
}

// Key commands: O = open slave/secondary, ESC = close slave and own window
function addSlaveKeybinds(win, isSlave) {
  win.webContents.on("before-input-event", (event, input) => {
    // O = open slave original (with NEF->JPG conversion if needed)
    if (input.type === "keyDown" && input.key.toLowerCase() === "o") {
      logger.info("'O' key pressed");

      // Try reading status file first (hitta_ansikten workflow)
      const status = readSlaveStatusFile();

      // Check if we have a valid status file with NEF
      if (status && status.source_nef && fs.existsSync(status.source_nef)) {
        logger.info("Using NEF from status file:", status.source_nef);
        ensureJPGAndLaunchSlave(status, mainWindow, launchSlaveViewer, logger);
        return;
      }

      // Fallback: Use current file if it's a NEF (direct NEF opening workflow)
      const nefFile = originalNefPath || bildFil;

      // Only allow 'O' when viewing a NEF file (or preview of NEF)
      if (!nefFile || !nefFile.toLowerCase().endsWith('.nef')) {
        logger.info("'O' key: Only works with NEF files");
        if (win) {
          win.webContents.send("show-wait-overlay",
            "Press 'O' only works with NEF files.<br>Currently viewing: " +
            (bildFil ? path.basename(bildFil) : "no file"));
        }
        // Auto-hide after 2 seconds
        setTimeout(() => {
          if (win) win.webContents.send("hide-wait-overlay");
        }, 2000);
        return;
      }

      // Convert NEF and launch slave directly
      logger.info("Using current NEF file:", nefFile);
      const nefBase = path.basename(nefFile, path.extname(nefFile));
      const jpgPath = `/tmp/${nefBase}_converted.jpg`;

      const directStatus = {
        source_nef: nefFile,
        exported_jpg: jpgPath,
        exported: false
      };

      ensureJPGAndLaunchSlave(directStatus, mainWindow, launchSlaveViewer, logger);
    }

    // ESC = close slave instances and close current window (both main and slave)
    if (input.type === "keyDown" && input.key === "Escape") {
      dlog("Keybind ESC: attempting to close slave instances via pkill");
      spawn("pkill", ["-f", "--", "Bildvisare.*--slave"], {
        detached: true,
        stdio: "ignore",
      });
      win.close(); // Also close current window (main or slave)
    }
    // q = closes window (already exists)
    if (input.type === "keyDown" && input.key.toLowerCase() === "q") {
      win.close();
    }
  });
}

// ----- Windows -----
function createMasterWindow() {
  dlog("createMasterWindow:", bildFil ? bildFil : "(no image)");
  if (mainWindow) {
    try {
      mainWindow.destroy();
    } catch {}
    mainWindow = null;
  }
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    alwaysOnTop: false,
    webPreferences: {
      // SECURITY FIX: Enable proper isolation
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    title: "Bildvisare",
  });
  mainWindow.setMenu(null);

  hasOpenedWindow = true;
  const resolvedBildFil = bildFil ? path.resolve(bildFil) : null;
  if (resolvedBildFil) {
    updateFileStatus(resolvedBildFil);

    // AUTO-CONVERT: If opening a NEF file, convert to JPG first
    if (resolvedBildFil.toLowerCase().endsWith('.nef')) {
      logger.info("Auto-converting NEF to JPG for display:", resolvedBildFil);
      originalNefPath = resolvedBildFil; // Remember original NEF for 'O' key
      const nefBase = path.basename(resolvedBildFil, path.extname(resolvedBildFil));
      const jpgPath = `/tmp/${nefBase}_preview.jpg`;

      // Load index.html first, then show overlay and start conversion
      mainWindow.loadFile("index.html", {
        query: { bild: "", slave: "0" },
      });

      // Wait for page to load, then show overlay and start conversion
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send("show-wait-overlay", "Converting NEF to JPG for preview...");

        // Start conversion after overlay is shown
        convertNEFtoJPG(resolvedBildFil, jpgPath, (err, outJpg) => {
          if (err || !outJpg) {
            logger.error("Failed to convert NEF:", err);
            mainWindow.webContents.send("show-wait-overlay",
              "Failed to convert NEF file.<br>Try opening the JPG version instead.");
            setTimeout(() => {
              mainWindow.webContents.send("hide-wait-overlay");
            }, 3000);
            return;
          }

          // Success - reload with JPG (page reload will clear overlay)
          logger.info("NEF converted, loading JPG:", outJpg);
          bildFil = outJpg; // Update bildFil to the preview JPG
          mainWindow.loadFile("index.html", {
            query: { bild: encodeURIComponent(outJpg), slave: "0" },
          });
        }, logger);
      });

      // Register keybinds for NEF preview window
      addSlaveKeybinds(mainWindow, false);
      return;
    }

    dlog("Window loading with image:", resolvedBildFil);
    mainWindow.loadFile("index.html", {
      query: { bild: encodeURIComponent(resolvedBildFil), slave: "0" },
    });
  } else {
    dlog("Window loading without image:");
    mainWindow.loadFile("index.html", { query: { bild: "", slave: "0" } });
  }
  addSlaveKeybinds(mainWindow, false);
}

function createSlaveWindow(slaveBildPath) {
  dlog("createSlaveWindow:", slaveBildPath ? slaveBildPath : "(no image)");
  if (slaveWindow) {
    try {
      slaveWindow.destroy();
    } catch {}
    slaveWindow = null;
  }
  slaveWindow = new BrowserWindow({
    width: 800,
    height: 600,
    alwaysOnTop: false,
    webPreferences: {
      // SECURITY FIX: Enable proper isolation
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    title: "Bildvisare (original)",
  });
  slaveWindow.setMenu(null);

  const resolvedBildFil = slaveBildPath ? path.resolve(slaveBildPath) : null;
  if (resolvedBildFil) {
    dlog("Slave window loading with image:", resolvedBildFil);
    slaveWindow.loadFile("index.html", {
      query: { bild: encodeURIComponent(resolvedBildFil), slave: "1" },
    });
  } else {
    dlog("Slave window loading without image:");
    slaveWindow.loadFile("index.html", { query: { bild: "", slave: "1" } });
  }
  addSlaveKeybinds(slaveWindow, true);

  slaveWindow.on("closed", () => {
    slaveWindow = null;
  });
}

// Adapt so slave window is created directly if IS_SLAVE
function createWindow() {
  if (IS_SLAVE) {
    createSlaveWindow(bildFil);
  } else {
    createMasterWindow();
  }
}

app.whenReady().then(() => {
  isAppReady = true;
  dlog("app.whenReady triggered, IS_SLAVE:", IS_SLAVE);
  if (!IS_SLAVE) {
    // Only main instance monitors status file for slave viewing
    watchSlaveStatusFile();
  }
  if (pendingOpenFile) {
    bildFil = pendingOpenFile;
    dlog("Running createWindow() with pendingOpenFile:", bildFil);
    createWindow();
    pendingOpenFile = null;
  } else {
    createWindow();
  }
});
}
