/**
 * Main Process - Modular Workspace Mode
 *
 * Entry point for the modular workspace architecture.
 * Uses FlexLayout for layout management.
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  session,
} = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const { BackendService } = require('./backend-service');
const { createApplicationMenu } = require('./menu');
const { t } = require('../i18n');
const { parseCliArgs } = require('./cli-args');
const { resolveLaunchCommand } = require('./launch-command');
const { createLaunchQueue } = require('./launch-queue');
const { deriveRawToken } = require('./raw-match');
const { createRawIndexCache } = require('./raw-index');
const {
  WORKSPACE_PERMISSIONS,
  applyPermissionPolicy,
  installSessionPermissionDefaults,
} = require('./permissions');

// Lazily-built, TTL-cached filename index of the RAW root. Reused across the
// keystroke bursts that drive open-raw-in-lightroom so the recursive scan runs
// at most once per TTL window instead of once per keystroke.
const rawIndexCache = createRawIndexCache();

function getVersionInfo() {
  try {
    const versionPath = path.join(__dirname, '..', 'version.json');
    if (fs.existsSync(versionPath)) {
      return JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    }
  } catch (e) {
    console.error('[Main] Failed to read version.json:', e.message);
  }
  return { version: 'dev', isTag: false };
}

const versionInfo = getVersionInfo();

let mainWindow = null;
let splashWindow = null;
let backendService = null;
let initialFilePath = null;
let isQuitting = false;

/**
 * Create splash window for startup
 */
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 350,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const splashPath = path.join(__dirname, '../renderer/splash.html');
  splashWindow.loadFile(splashPath);

  splashWindow.webContents.on('did-finish-load', () => {
    splashWindow.webContents.send('version-info', versionInfo);
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });

  return splashWindow;
}

/**
 * Send status update to splash window
 */
function updateSplashStatus(message, progress = null) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-status', { message, progress });
  }
}

// Command-line parsing lives in cli-args.js (pure + unit-tested). Aliased here
// to keep the existing call sites readable.
const parseCommandLineArgs = parseCliArgs;

// Supported image extensions — filter out sidecars (xmp) and other non-image files
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.nef',
  '.cr2',
  '.arw',
  '.jpg',
  '.jpeg',
  '.png',
  '.tiff',
]);

function isSupportedImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
}

// Expand a list of directories to the supported image files they directly
// contain (non-recursive), naturally sorted by filename. `~` is expanded like
// the expand-glob handler. Shared by the open-folder-dialog handler and the
// expand-folders IPC (folder hand-off from the pipeline / working-folder anchor).
function expandDirsToImageFiles(dirs) {
  const fs = require('fs');
  const pathModule = require('path');
  const os = require('os');
  const expandedPaths = [];

  for (const dir of dirs || []) {
    let selectedPath = dir;
    if (typeof selectedPath === 'string' && selectedPath.startsWith('~')) {
      selectedPath = pathModule.join(os.homedir(), selectedPath.slice(1));
    }
    try {
      const entries = fs.readdirSync(selectedPath);
      for (const entry of entries) {
        if (isSupportedImageFile(entry)) {
          expandedPaths.push(pathModule.join(selectedPath, entry));
        }
      }
    } catch (err) {
      console.error('Error reading folder:', selectedPath, err);
    }
  }

  // Sort files (natural sort for filenames with numbers)
  expandedPaths.sort((a, b) => {
    const nameA = pathModule.basename(a);
    const nameB = pathModule.basename(b);
    return nameA.localeCompare(nameB, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

  return expandedPaths;
}

// Expand globs and resolve paths
async function expandFilePaths(patterns) {
  const files = [];
  for (const pattern of patterns) {
    // Expand ~ to home directory
    let expandedPattern = pattern;
    if (pattern.startsWith('~')) {
      expandedPattern = path.join(os.homedir(), pattern.slice(1));
    }

    if (pattern.includes('*') || pattern.includes('?')) {
      // Glob pattern
      try {
        const dir = path.dirname(expandedPattern);
        const patternBase = path.basename(expandedPattern);
        const regexPattern = patternBase
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`, 'i');

        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          if (regex.test(entry)) {
            const fullPath = path.join(dir, entry);
            if (
              fs.statSync(fullPath).isFile() &&
              isSupportedImageFile(fullPath)
            ) {
              files.push(fullPath);
            }
          }
        }
      } catch (err) {
        console.error(
          `[Main] Failed to expand glob "${pattern}":`,
          err.message,
        );
      }
    } else {
      // Direct path - must be a supported image file (not directory or sidecar)
      const resolved = path.resolve(expandedPattern);
      try {
        const stat = fs.statSync(resolved);
        if (stat.isFile() && isSupportedImageFile(resolved)) {
          files.push(resolved);
        } else if (stat.isFile()) {
          console.log(`[Main] Skipping unsupported file: ${resolved}`);
        } else if (stat.isDirectory()) {
          console.log(`[Main] Skipping directory: ${resolved}`);
        }
      } catch (err) {
        // File doesn't exist, skip silently
      }
    }
  }
  return files.sort();
}

// Resolve path args to directories for the culling target. Unlike the face
// queue (which wants image files), culling scans folders, so we accept
// directories directly and fall back to a file's parent dir for convenience.
function expandFolderPaths(patterns) {
  const dirs = [];
  for (const pattern of patterns) {
    let expanded = pattern;
    if (pattern.startsWith('~')) {
      expanded = path.join(os.homedir(), pattern.slice(1));
    }
    const resolved = path.resolve(expanded);
    try {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        dirs.push(resolved);
      } else if (stat.isFile()) {
        dirs.push(path.dirname(resolved));
      }
    } catch (err) {
      // Path doesn't exist, skip silently
    }
  }
  // De-duplicate while preserving order.
  return [...new Set(dirs)];
}

// Resolve the optional import destination from the CLI path args. Unlike
// expandFolderPaths this does NOT stat/verify existence — an import destination
// may not exist yet (it's created on transfer). Returns the resolved absolute
// path, or undefined when no destination was given (the module falls back to its
// preference default).
function resolveImportDest(patterns) {
  const first = patterns[0];
  if (!first) return undefined;
  let expanded = first;
  if (first.startsWith('~')) {
    expanded = path.join(os.homedir(), first.slice(1));
  }
  return path.resolve(expanded);
}

// Resolve a parsed CLI intent into a single workspace command, doing all path
// expansion up front (launch-command.js is the pure, unit-tested decision; the
// filesystem expanders are injected here). Returns { command, initialFile }.
function resolveLaunch(args) {
  return resolveLaunchCommand(args, {
    expandFolders: expandFolderPaths,
    expandFiles: expandFilePaths,
    resolveImportDest,
  });
}

// Deliver a workspace command to the renderer, but only after the renderer has
// completed the workspace-ready handshake — before that its router listener
// isn't attached and an IPC send would be lost. A FIFO queue holds commands
// until ready (so an initial launch and a second-instance launch that both race
// ahead deliver in order, not clobbering each other) and re-arms across renderer
// reloads (markNotReady on did-start-loading below).
const launchQueue = createLaunchQueue((cmd) => {
  console.log('[Main] Sending workspace-command:', cmd.type);
  mainWindow?.webContents.send('workspace-command', cmd);
});

function sendWorkspaceCommand(intent) {
  launchQueue.enqueue(intent);
}

/**
 * Install deny-by-default permission policies on the app's sessions.
 *
 * Must run after app ready (sessions do not exist before that) and before any
 * window loads content. Two sessions get a deliberate policy:
 *  - persist:ansikten — the workspace window's partition.
 *  - the default session — the splash window sets no partition, so it lands
 *    here; it only shows a static status page and needs no permissions at all,
 *    which makes an empty allowlist the honest setting. It exists before app
 *    ready, so the session-created catch-all never sees it; it is named here.
 *
 * Anything else the app ever creates is covered by the catch-all, which grants
 * nothing until someone deliberately lists it.
 */
function installPermissionPolicies() {
  // Catch-all first: any session created from here on is born closed, even one
  // no code here names. Sessions given a deliberate policy below are skipped.
  installSessionPermissionDefaults(app);

  applyPermissionPolicy(session.fromPartition('persist:ansikten'), {
    label: 'workspace',
    allowed: WORKSPACE_PERMISSIONS,
  });
  applyPermissionPolicy(session.defaultSession, {
    label: 'default',
    allowed: [],
  });
  console.log(
    `[Main] Permission policy installed (workspace allows: ${WORKSPACE_PERMISSIONS.join(', ')})`,
  );
}

/**
 * Create the main workspace window
 */
function createWorkspaceWindow() {
  console.log('[Main] Creating workspace window...');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/preload.js'),
      partition: 'persist:ansikten',
    },
    title: 'Ansikten',
  });

  // Set application menu
  const menu = createApplicationMenu(mainWindow);
  Menu.setApplicationMenu(menu);

  // Load workspace HTML
  const workspaceHtml = path.join(
    __dirname,
    '../renderer',
    'workspace-flex.html',
  );
  console.log('[Main] Loading FlexLayout workspace:', workspaceHtml);
  mainWindow.loadFile(workspaceHtml);

  // Note: Initial file path is now requested by renderer via IPC when ready
  // This avoids race conditions where the event was sent before React mounted

  // Open DevTools in development (disabled - user can open with Cmd+Option+I)
  // if (!app.isPackaged) {
  //   mainWindow.webContents.openDevTools();
  // }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Re-arm the launch-command hold whenever the renderer starts (re)loading
  // (Cmd+R, crash reload, navigation). Until it re-mounts and re-signals
  // workspace-ready, its command router is gone, so a command sent now would
  // hit a router-less page and be dropped; markNotReady queues it instead.
  mainWindow.webContents.on('did-start-loading', () => {
    launchQueue.markNotReady();
  });

  // Track DevTools open/close state for renderer
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.send('devtools-state-changed', true);
  });

  mainWindow.webContents.on('devtools-closed', () => {
    mainWindow.webContents.send('devtools-state-changed', false);
  });

  console.log('[Main] Workspace window created');
}

// Parse initial command line arguments
const initialArgs = parseCommandLineArgs(process.argv);
console.log('[Main] Initial args:', initialArgs);

// Request single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is running - it will receive our args via second-instance event
  console.log(
    '[Main] Another instance is running, sending args and quitting...',
  );
  app.quit();
  process.exit(0);
}

// Handle second instance launching (receives args from new instance)
app.on('second-instance', async (event, argv, workingDirectory) => {
  console.log(
    '[Main] Second instance launched with argv:',
    JSON.stringify(argv),
  );
  console.log('[Main] Working directory:', workingDirectory);

  // Parse arguments (second-instance argv has same structure as process.argv)
  const args = parseCommandLineArgs(argv);
  console.log('[Main] Parsed args:', JSON.stringify(args));

  // Resolve to a single workspace command and enqueue it. The window is normally
  // up and ready, so the queue delivers immediately; if a reload is in flight it
  // holds until the next workspace-ready (in FIFO order behind any earlier
  // launch). A single Finder file (resolveLaunchCommand returns null, sets
  // initialFilePath) is turned into an explicit load-image command here, since
  // the renderer already consumed its one-shot get-initial-file on first mount.
  const { command, initialFile } = await resolveLaunch(args);
  if (command) {
    sendWorkspaceCommand(command);
  } else if (initialFile) {
    sendWorkspaceCommand({
      type: 'load-image',
      payload: { imagePath: initialFile },
    });
  }

  // Focus main window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// App lifecycle - only runs if we got the lock
app.whenReady().then(async () => {
  console.log('[Main] App ready, showing splash...');

  installPermissionPolicies();

  // Show splash immediately
  createSplashWindow();
  updateSplashStatus(t('dialogs.splash.startingBackend'));

  // Start backend service
  try {
    backendService = new BackendService();
    backendService.onStatusUpdate = (message) => {
      updateSplashStatus(message);
    };
    await backendService.start();
    console.log(`[Main] Backend ready at ${backendService.getUrl()}`);
    updateSplashStatus(t('dialogs.splash.loadingInterface'), 90);
  } catch (err) {
    console.error('[Main] Failed to start backend:', err);

    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }

    const isPackaged = app.isPackaged;
    const suggestion = isPackaged
      ? 'Försök installera om appen. Om problemet kvarstår, kontakta support.'
      : t('dialogs.backendStartFailedSuggestion');

    await dialog.showMessageBox({
      type: 'error',
      title: 'Kunde inte starta backend',
      message: 'Backend-servern kunde inte startas',
      detail: `${err.message}\n\n${suggestion}`,
      buttons: ['Avsluta'],
    });

    app.quit();
    return;
  }

  // Resolve the launch command BEFORE creating the window: the renderer reads
  // `willLaunch` synchronously (get-launch-intent-sync) at preload time to decide
  // whether to suppress the startup landing without a flash, so the decision must
  // be made — including path expansion — before that sync read can happen.
  try {
    const resolved = await resolveLaunch(initialArgs);
    // Enqueue now: the queue holds it (renderer not ready yet) and delivers on
    // the workspace-ready handshake.
    if (resolved.command) sendWorkspaceCommand(resolved.command);
    if (resolved.initialFile) initialFilePath = resolved.initialFile;
    console.log(
      '[Main] Launch command:',
      resolved.command ? resolved.command.type : '(none)',
    );
  } catch (err) {
    console.error('[Main] Failed to resolve launch command:', err);
  }

  // Create workspace window
  updateSplashStatus(t('dialogs.splash.ready'), 100);
  createWorkspaceWindow();

  // Close splash when main window is ready
  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    mainWindow.show();
  });

  // The resolved launch command (if any) is delivered once the renderer signals
  // workspace-ready (see the ipcMain.on('workspace-ready') handler) — a
  // deterministic handshake, replacing the old did-finish-load + 1000ms
  // setTimeout that only guessed when the module had mounted.

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWorkspaceWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  console.log('[Main] All windows closed, isQuitting:', isQuitting);

  // If we're in the middle of quitting, actually quit now
  if (isQuitting) {
    console.log('[Main] Quitting after backend stopped');
    // Don't call app.quit() here - we're already quitting
    // Just exit the process directly
    process.exit(0);
    return;
  }

  // On macOS, stop backend but keep app running (unless quitting)
  // On other platforms, quit the app
  if (process.platform === 'darwin') {
    // Stop backend when window closes on macOS
    if (backendService) {
      isQuitting = true;
      try {
        await backendService.stop();
        console.log('[Main] Backend stopped (window closed)');
      } catch (err) {
        console.error('[Main] Error stopping backend:', err);
      }
      backendService = null;
    }
  } else {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  console.log('[Main] before-quit event, isQuitting:', isQuitting);

  if (backendService && !isQuitting) {
    console.log('[Main] Preventing quit to stop backend first...');
    event.preventDefault(); // Prevent quit until backend stops
    isQuitting = true;

    try {
      await backendService.stop();
      console.log('[Main] Backend stopped successfully');
    } catch (err) {
      console.error('[Main] Error stopping backend:', err);
    }

    backendService = null;

    // Now quit for real
    console.log('[Main] Backend stopped, quitting now...');
    app.quit();
  }
});

app.on('will-quit', () => {
  console.log('[Main] will-quit event');
});

// IPC Handlers

ipcMain.handle('get-version-info', () => {
  return versionInfo;
});

// Launch intent read synchronously by the renderer before its first paint so it
// can skip the startup landing page when a launch command will open something.
// `willLaunch` is resolved AFTER path expansion (resolveLaunchCommand ran before
// the window was created), so a path that expands to nothing still reports
// truthfully — the renderer no longer guesses from raw argument counts.
// Synchronous (sendSync) so there is no render where the landing flashes.
ipcMain.on('get-launch-intent-sync', (e) => {
  e.returnValue = {
    willLaunch: launchQueue.pending() > 0 || initialFilePath != null,
  };
});

// Workspace-ready handshake: the renderer signals once its command router and
// listeners are live. Only then is it safe to deliver held launch commands — an
// earlier IPC send would land before the router's listener is attached and be
// lost. Replaces the did-finish-load + 1000ms setTimeout timing lottery. The
// renderer re-signals on every mount, so this also drives redelivery after a
// reload (see markNotReady on did-start-loading).
ipcMain.on('workspace-ready', () => {
  console.log('[Main] Renderer workspace-ready');
  launchQueue.markReady();
});

// Get initial file path (if app was launched with a file argument)
ipcMain.handle('get-initial-file', () => {
  const filePath = initialFilePath;
  console.log('[Main] Renderer requested initial file:', filePath || '(none)');
  // Clear it after first request to avoid reloading on window refresh
  initialFilePath = null;
  return filePath;
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      {
        name: t('dialogs.filters.images'),
        extensions: ['jpg', 'jpeg', 'png', 'tiff', 'nef', 'cr2', 'arw'],
      },
      { name: t('dialogs.filters.allFiles'), extensions: ['*'] },
    ],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// Resolve the original NEF for a developed JPEG (shared only via the leading
// `YYMMDD_HHMMSS[-N]` timestamp token — the files live in different trees and
// don't share a full name) and open it in the configured external editor.
// macOS-only. (Channel name kept for compatibility; renaming it is its own
// refactor across preload allowlist, menu and renderer.)
ipcMain.handle(
  'open-raw-in-lightroom',
  async (event, { imagePath, rawRoot, editor } = {}) => {
    if (process.platform !== 'darwin') {
      return { ok: false, reason: 'unsupported-platform' };
    }
    if (!imagePath) return { ok: false, reason: 'no-image' };

    const token = deriveRawToken(path.basename(imagePath));
    if (!token) return { ok: false, reason: 'no-timestamp' };

    // Expand ~ and resolve the configured RAW root.
    let root = rawRoot || '~/Pictures/nerladdat';
    if (root.startsWith('~')) root = path.join(os.homedir(), root.slice(1));
    root = path.resolve(root);

    let match = null;
    try {
      // Cached lookup: the RAW root is scanned once and reused across keystrokes.
      // The index keys files by their leading token and keeps each token's paths
      // sorted, so this returns the same deterministic "first" match the old
      // per-keystroke scan did; the editor shows it in-folder so burst neighbours
      // remain visible.
      match = await rawIndexCache.lookup(root, token);
    } catch (err) {
      console.error('[Main] open-raw-in-lightroom scan failed:', err.message);
      return { ok: false, reason: 'scan-error', error: err.message };
    }

    if (!match) return { ok: false, reason: 'not-found', token };

    // `open -a` takes either an application name or a path to an .app bundle;
    // expand ~ so a path form works the same way rawRoot does.
    // Named editorApp, not app: `app` is Electron's imported singleton.
    let editorApp = editor || 'Adobe Lightroom Classic';
    if (editorApp.startsWith('~'))
      editorApp = path.join(os.homedir(), editorApp.slice(1));

    return await new Promise((resolve) => {
      execFile('open', ['-a', editorApp, match], (err) => {
        if (err) {
          console.error(
            `[Main] Failed to open in "${editorApp}":`,
            err.message,
          );
          resolve({
            ok: false,
            reason: 'open-failed',
            error: err.message,
            path: match,
            editor: editorApp,
          });
        } else {
          resolve({ ok: true, path: match });
        }
      });
    });
  },
);

// Return a file's identity fingerprint (mtime + size), waiting for the write to
// settle first — but only when the file was modified recently, so navigating to
// old files stays instant. Used by culling to (a) avoid decoding a JPEG that
// Lightroom is still exporting and (b) cache-bust the <img> when it changes.
ipcMain.handle('stat-file-stable', async (event, opts = {}) => {
  const {
    filePath,
    freshWindowMs = 5000, // only wait for files touched within this window
    settleMs = 350, // require size+mtime unchanged this long to call it done
    timeoutMs = 8000, // give up waiting after this and return the latest stat
    pollMs = 120,
  } = opts;
  if (!filePath) return { ok: false, reason: 'no-path' };

  let st;
  try {
    st = await fs.promises.stat(filePath);
  } catch {
    return { ok: false, reason: 'not-found' };
  }
  // Old, already-settled file: return immediately (no navigation latency).
  if (Date.now() - st.mtimeMs > freshWindowMs) {
    return { ok: true, mtimeMs: st.mtimeMs, size: st.size, settled: true };
  }

  // Recently modified: poll until size + mtime hold steady for settleMs.
  const start = Date.now();
  let last = { size: st.size, mtimeMs: st.mtimeMs };
  let stableSince = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, pollMs));
    try {
      st = await fs.promises.stat(filePath);
    } catch {
      return { ok: false, reason: 'not-found' };
    }
    const now = Date.now();
    if (st.size === last.size && st.mtimeMs === last.mtimeMs) {
      if (now - stableSince >= settleMs) {
        return { ok: true, mtimeMs: st.mtimeMs, size: st.size, settled: true };
      }
    } else {
      last = { size: st.size, mtimeMs: st.mtimeMs };
      stableSince = now;
    }
    if (now - start >= timeoutMs) {
      // Still churning after the timeout — hand back the latest stat anyway so
      // the caller can render something rather than hang.
      return { ok: true, mtimeMs: st.mtimeMs, size: st.size, settled: false };
    }
  }
});

// Multi-file dialog for File Queue (files only - normal navigation)
ipcMain.handle('open-multi-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: t('dialogs.filters.rawImages'),
        extensions: ['nef', 'NEF', 'cr2', 'CR2', 'arw', 'ARW'],
      },
      {
        name: t('dialogs.filters.allImages'),
        extensions: ['jpg', 'jpeg', 'png', 'tiff', 'nef', 'cr2', 'arw'],
      },
      { name: t('dialogs.filters.allFiles'), extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths;
});

// Folder dialog - select folders and expand to image files
ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections'],
    message: t('dialogs.selectFolders'),
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }

  return expandDirsToImageFiles(result.filePaths);
});

// Expand a set of already-known folders (no dialog) to their image files.
// Used by the pipeline hand-off (Rename → Review) and the working-folder
// anchor's "load this folder" offer, which pass folder paths directly.
ipcMain.handle('expand-folders', async (event, dirs) => {
  return expandDirsToImageFiles(Array.isArray(dirs) ? dirs : [dirs]);
});

// Expand glob pattern to file paths
ipcMain.handle('expand-glob', async (event, pattern) => {
  const fs = require('fs');
  const path = require('path');

  // Expand ~ to home directory
  let expandedPattern = pattern;
  if (pattern.startsWith('~')) {
    expandedPattern = path.join(require('os').homedir(), pattern.slice(1));
  }

  try {
    // Use Node.js 22+ built-in glob
    const { glob } = require('fs').promises;
    if (glob) {
      const files = [];
      for await (const file of glob(expandedPattern)) {
        if (isSupportedImageFile(file)) {
          files.push(file);
        }
      }
      return files.sort();
    }
  } catch (err) {
    // Fallback: try synchronous glob from fs
  }

  // Fallback for patterns - use simple directory listing with filter
  try {
    const dir = path.dirname(expandedPattern);
    const patternBase = path.basename(expandedPattern);

    // Convert glob pattern to regex
    const regexPattern = patternBase
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`, 'i');

    const files = fs
      .readdirSync(dir)
      .filter((f) => regex.test(f))
      .map((f) => path.join(dir, f))
      .filter((f) => fs.statSync(f).isFile() && isSupportedImageFile(f))
      .sort();

    return files;
  } catch (err) {
    console.error('[Main] Failed to expand glob:', err);
    return [];
  }
});

// NOTE: NEF conversion is now handled by the backend preprocessing API
// See /api/preprocessing/nef endpoint

// Renderer log file handling
let rendererLogStream = null;

function getRendererLogPath() {
  const logDir =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Logs', 'Ansikten')
      : path.join(app.getPath('userData'), 'logs');

  // Ensure directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Use date-based log file
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(logDir, `renderer-${today}.log`);
}

function ensureLogStream() {
  const logPath = getRendererLogPath();

  // Create new stream if none exists or if date changed
  if (!rendererLogStream || rendererLogStream.path !== logPath) {
    if (rendererLogStream) {
      rendererLogStream.end();
    }
    rendererLogStream = fs.createWriteStream(logPath, { flags: 'a' });
    console.log('[Main] Renderer log file:', logPath);
  }

  return rendererLogStream;
}

// IPC handler for renderer logs
ipcMain.on('renderer-log', (event, { level, message }) => {
  try {
    const stream = ensureLogStream();
    stream.write(`[${level.toUpperCase()}] ${message}\n`);
  } catch (err) {
    console.error('[Main] Failed to write renderer log:', err);
  }
});

// Directory-level file watching for scalability (1000+ files)
// Instead of one watcher per file, we watch directories and track which files we care about
const directoryWatchers = new Map(); // dir -> { watcher, files: Set<filePath> }
const fileToDirectory = new Map(); // filePath -> dir

ipcMain.on('watch-file', (event, filePath) => {
  if (fileToDirectory.has(filePath)) return;

  try {
    if (!fs.existsSync(filePath)) {
      mainWindow?.webContents.send('file-deleted', filePath);
      return;
    }

    const dir = path.dirname(filePath);

    if (directoryWatchers.has(dir)) {
      directoryWatchers.get(dir).files.add(filePath);
      fileToDirectory.set(filePath, dir);
      return;
    }

    const files = new Set([filePath]);
    const watcher = fs.watch(dir, (eventType, changedFile) => {
      if (eventType !== 'rename' || !changedFile) return;

      const changedPath = path.join(dir, changedFile);
      const dirEntry = directoryWatchers.get(dir);
      if (!dirEntry?.files.has(changedPath)) return;

      if (!fs.existsSync(changedPath)) {
        console.log('[Main] File deleted:', changedPath);
        mainWindow?.webContents.send('file-deleted', changedPath);
        dirEntry.files.delete(changedPath);
        fileToDirectory.delete(changedPath);
        if (dirEntry.files.size === 0) {
          dirEntry.watcher.close();
          directoryWatchers.delete(dir);
        }
      }
    });

    watcher.on('error', (err) => {
      console.error('[Main] Directory watcher error:', dir, err.message);
      const dirEntry = directoryWatchers.get(dir);
      const affectedFiles = dirEntry ? [...dirEntry.files] : [];
      dirEntry?.watcher?.close();
      for (const f of affectedFiles) fileToDirectory.delete(f);
      directoryWatchers.delete(dir);
      mainWindow?.webContents.send('watcher-error', {
        dir,
        files: affectedFiles,
      });
    });

    directoryWatchers.set(dir, { watcher, files });
    fileToDirectory.set(filePath, dir);
  } catch (err) {
    console.error('[Main] Failed to watch file:', filePath, err.message);
  }
});

ipcMain.on('unwatch-file', (event, filePath) => {
  const dir = fileToDirectory.get(filePath);
  if (!dir) return;

  fileToDirectory.delete(filePath);
  const dirEntry = directoryWatchers.get(dir);
  if (!dirEntry) return;

  dirEntry.files.delete(filePath);
  if (dirEntry.files.size === 0) {
    dirEntry.watcher.close();
    directoryWatchers.delete(dir);
  }
});

ipcMain.on('unwatch-all-files', () => {
  for (const [, { watcher }] of directoryWatchers) {
    watcher.close();
  }
  directoryWatchers.clear();
  fileToDirectory.clear();
});

// Folder selection that returns the chosen directory paths themselves (not the
// expanded image files) - used by modules that let the backend do the globbing.
ipcMain.handle('open-folder-paths', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections'],
    message: 'Välj mapp(ar)',
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths;
});

// Folder-level watching for live auto-refresh. Unlike the file-list watcher
// above, this watches a whole directory (optionally recursively) and emits on
// ANY add/remove/rename/change, debounced to coalesce the bursts fs.watch fires
// on macOS. Keyed by folder path; reference-counted so multiple modules can
// share a watcher.
const folderWatchers = new Map(); // dir -> { watcher, refs, timer }
const FOLDER_DEBOUNCE_MS = 300;

ipcMain.on('watch-folder', (event, { dir, recursive = true } = {}) => {
  if (!dir) return;

  // Expand a leading ~ - glob inputs like ~/Pictures/... arrive un-expanded, and
  // fs.existsSync/fs.watch don't expand it (so the watch would silently no-op).
  if (dir.startsWith('~')) {
    dir = path.join(os.homedir(), dir.slice(1));
  }

  const existing = folderWatchers.get(dir);
  if (existing) {
    existing.refs += 1;
    return;
  }

  try {
    if (!fs.existsSync(dir)) return;

    const entry = { watcher: null, refs: 1, timer: null };
    const onChange = () => {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        mainWindow?.webContents.send('folder-changed', dir);
      }, FOLDER_DEBOUNCE_MS);
    };
    let watcher;
    try {
      watcher = fs.watch(dir, { recursive }, onChange);
    } catch (err) {
      // Recursive watching is unsupported on Linux (ERR_FEATURE_UNAVAILABLE_ON_PLATFORM);
      // fall back to a non-recursive watch so top-level changes still refresh.
      if (recursive) {
        console.warn(
          '[Main] Recursive folder watch unavailable, falling back:',
          err.message,
        );
        watcher = fs.watch(dir, { recursive: false }, onChange);
      } else {
        throw err;
      }
    }

    watcher.on('error', (err) => {
      console.error('[Main] Folder watcher error:', dir, err.message);
      if (entry.timer) clearTimeout(entry.timer);
      try {
        entry.watcher?.close();
      } catch (_) {
        // already closed
      }
      folderWatchers.delete(dir);
    });

    entry.watcher = watcher;
    folderWatchers.set(dir, entry);
  } catch (err) {
    console.error('[Main] Failed to watch folder:', dir, err.message);
  }
});

ipcMain.on('unwatch-folder', (event, dir) => {
  if (!dir) return;
  // Match the ~-expansion done in watch-folder so we find the right watcher.
  if (dir.startsWith('~')) {
    dir = path.join(os.homedir(), dir.slice(1));
  }
  const entry = folderWatchers.get(dir);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  if (entry.timer) clearTimeout(entry.timer);
  try {
    entry.watcher?.close();
  } catch (_) {
    // already closed
  }
  folderWatchers.delete(dir);
});

console.log('[Main] Workspace mode initialized');
