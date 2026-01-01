/**
 * Main Process - Modular Workspace Mode
 *
 * Entry point for the modular workspace architecture.
 * Uses FlexLayout for layout management.
 */

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { BackendService } = require('./backend-service');
const { createApplicationMenu } = require('./menu');

let mainWindow = null;
let backendService = null;
let initialFilePath = null;
let initialQueueFiles = [];
let isQuitting = false;

// Parse command line arguments
function parseCommandLineArgs(argv) {
  const result = {
    files: [],
    queuePosition: null,  // null = open directly, 'start' or 'end' = add to queue
    startQueue: false
  };

  let i = 0;
  // Skip electron path and app path
  while (i < argv.length && (argv[i].includes('electron') || argv[i].includes('Electron') || argv[i] === '.')) {
    i++;
  }

  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--queue' || arg === '-q') {
      result.queuePosition = 'end';
    } else if (arg === '--queue-start' || arg === '-qs') {
      result.queuePosition = 'start';
    } else if (arg === '--start' || arg === '-s') {
      result.startQueue = true;
    } else if (!arg.startsWith('-')) {
      // It's a file path or glob
      result.files.push(arg);
    }
  }

  return result;
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
            if (fs.statSync(fullPath).isFile()) {
              files.push(fullPath);
            }
          }
        }
      } catch (err) {
        console.error(`[Main] Failed to expand glob "${pattern}":`, err.message);
      }
    } else {
      // Direct path
      const resolved = path.resolve(expandedPattern);
      if (fs.existsSync(resolved)) {
        files.push(resolved);
      }
    }
  }
  return files.sort();
}

// Send files to renderer's file queue
function sendFilesToQueue(files, position, startQueue) {
  if (!mainWindow || files.length === 0) return;

  console.log(`[Main] Sending ${files.length} files to queue (position: ${position}, start: ${startQueue})`);
  mainWindow.webContents.send('queue-files', { files, position, startQueue });
}

/**
 * Create the main workspace window
 */
function createWorkspaceWindow() {
  console.log('[Main] Creating workspace window...');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/preload.js'),
      partition: 'persist:bildvisare' // Persist localStorage between sessions
    },
    title: 'Bildvisare Workspace'
  });

  // Set application menu
  const menu = createApplicationMenu(mainWindow);
  Menu.setApplicationMenu(menu);

  // Load workspace HTML
  const workspaceHtml = path.join(__dirname, '../renderer', 'workspace-flex.html');
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
  console.log('[Main] Another instance is running, sending args and quitting...');
  app.quit();
  process.exit(0);
}

// Handle second instance launching (receives args from new instance)
app.on('second-instance', async (event, argv, workingDirectory) => {
  console.log('[Main] Second instance launched with argv:', JSON.stringify(argv));
  console.log('[Main] Working directory:', workingDirectory);

  // Filter out the working directory from argv if it's included
  const filteredArgv = argv.filter(arg => arg !== workingDirectory);
  console.log('[Main] Filtered argv:', JSON.stringify(filteredArgv));

  const args = parseCommandLineArgs(filteredArgv);
  console.log('[Main] Parsed args:', JSON.stringify(args));

  if (args.files.length > 0) {
    const files = await expandFilePaths(args.files);
    console.log('[Main] Expanded files:', JSON.stringify(files));
    if (args.queuePosition) {
      sendFilesToQueue(files, args.queuePosition, args.startQueue);
    } else if (files.length === 1) {
      // Single file without queue flag - open directly
      mainWindow?.webContents.send('menu-command', 'load-image');
      // TODO: Actually load the file
    }
  }

  // Focus main window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// App lifecycle - only runs if we got the lock
app.whenReady().then(async () => {
  console.log('[Main] App ready, starting backend...');

  // Start backend service
  try {
    backendService = new BackendService();
    await backendService.start();
    console.log(`[Main] Backend ready at ${backendService.getUrl()}`);
  } catch (err) {
    console.error('[Main] Failed to start backend:', err);
    // TODO: Show error dialog to user
  }

  // Create workspace window
  createWorkspaceWindow();

  // Handle initial files from command line
  if (initialArgs.files.length > 0) {
    const files = await expandFilePaths(initialArgs.files);
    if (files.length > 0) {
      if (initialArgs.queuePosition) {
        // Add to queue - wait for renderer to be ready
        mainWindow.webContents.once('did-finish-load', () => {
          setTimeout(() => {
            sendFilesToQueue(files, initialArgs.queuePosition, initialArgs.startQueue);
          }, 1000); // Give FileQueueModule time to mount
        });
      } else if (files.length === 1) {
        // Single file without queue flag - set as initial file
        initialFilePath = files[0];
      }
    }
  }

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
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'nef', 'cr2', 'arw'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// Multi-file dialog for File Queue (supports files and folders)
ipcMain.handle('open-multi-file-dialog', async () => {
  const fs = require('fs');
  const pathModule = require('path');

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [
      { name: 'RAW Images', extensions: ['nef', 'NEF', 'cr2', 'CR2', 'arw', 'ARW'] },
      { name: 'All Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'nef', 'cr2', 'arw'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }

  // Expand directories to their image files
  const supportedExtensions = ['.nef', '.cr2', '.arw', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff'];
  const expandedPaths = [];

  for (const selectedPath of result.filePaths) {
    try {
      const stat = fs.statSync(selectedPath);
      if (stat.isDirectory()) {
        // Read directory and filter for supported images
        const entries = fs.readdirSync(selectedPath);
        for (const entry of entries) {
          const ext = pathModule.extname(entry).toLowerCase();
          if (supportedExtensions.includes(ext)) {
            expandedPaths.push(pathModule.join(selectedPath, entry));
          }
        }
      } else {
        // Regular file
        expandedPaths.push(selectedPath);
      }
    } catch (err) {
      console.error('Error processing path:', selectedPath, err);
      // Still include the path, let the queue handle errors
      expandedPaths.push(selectedPath);
    }
  }

  // Sort files (natural sort for filenames with numbers)
  expandedPaths.sort((a, b) => {
    const nameA = pathModule.basename(a);
    const nameB = pathModule.basename(b);
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });

  return expandedPaths;
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
        files.push(file);
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

    const files = fs.readdirSync(dir)
      .filter(f => regex.test(f))
      .map(f => path.join(dir, f))
      .filter(f => fs.statSync(f).isFile())
      .sort();

    return files;
  } catch (err) {
    console.error('[Main] Failed to expand glob:', err);
    return [];
  }
});

// Folder dialog for File Queue
ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (result.canceled) {
    return null;
  }

  // Find all supported image files in the folder
  const folderPath = result.filePaths[0];
  const supportedExtensions = ['.nef', '.cr2', '.arw', '.jpg', '.jpeg', '.png', '.tiff'];

  const files = [];
  try {
    const entries = fs.readdirSync(folderPath);
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (supportedExtensions.includes(ext)) {
        files.push(path.join(folderPath, entry));
      }
    }
    // Sort by filename
    files.sort();
  } catch (err) {
    console.error('[Main] Failed to read folder:', err);
    return null;
  }

  return files;
});

// NOTE: NEF conversion is now handled by the backend preprocessing API
// See /api/preprocessing/nef endpoint

// Renderer log file handling
let rendererLogStream = null;

function getRendererLogPath() {
  // Use ~/Library/Logs/Bildvisare on macOS, %APPDATA%/Bildvisare/logs on Windows
  const logDir = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Logs', 'Bildvisare')
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

console.log('[Main] Workspace mode initialized');
