/**
 * Main Process - Modular Workspace Mode
 *
 * Entry point for the new modular workspace architecture.
 * This file is loaded when BILDVISARE_WORKSPACE=1
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
let isQuitting = false;

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
  const workspaceHtml = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(workspaceHtml);

  // Send initial file path to renderer when ready
  if (initialFilePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[Main] Sending initial file path to renderer:', initialFilePath);
      mainWindow.webContents.send('load-initial-file', initialFilePath);
    });
  }

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

// Get initial file path from command line arguments
// process.argv[0] is electron, process.argv[1] is the app, process.argv[2] is the file
if (process.argv.length > 2) {
  const argPath = process.argv[2];
  // Check if it's a file path (not a flag)
  if (!argPath.startsWith('-') && fs.existsSync(argPath)) {
    initialFilePath = path.resolve(argPath);
    console.log('[Main] Initial file path from args:', initialFilePath);
  }
}

// App lifecycle
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

// NEF to JPG conversion
ipcMain.handle('convert-nef', async (event, nefPath) => {
  console.log('[Main] Converting NEF to JPG:', nefPath);

  // Use /tmp directly (not os.tmpdir()) to avoid macOS symlink issues
  const tmpDir = '/tmp';
  const nefFilename = path.basename(nefPath, '.NEF');
  const jpgPath = path.join(tmpDir, `${nefFilename}_converted.jpg`);

  // Check if already converted and cached
  if (fs.existsSync(jpgPath)) {
    const nefStat = fs.statSync(nefPath);
    const jpgStat = fs.statSync(jpgPath);

    // If JPG is newer than NEF, use cached version
    if (jpgStat.mtime > nefStat.mtime) {
      console.log('[Main] Using cached NEF conversion:', jpgPath);
      return jpgPath;
    }
  }

  // Convert NEF to JPG using Python script
  const scriptPath = path.join(__dirname, '../../scripts/nef2jpg.py');
  const pythonPath = '/Users/krisniem/.local/share/miniforge3/envs/hitta_ansikten/bin/python3';

  return new Promise((resolve, reject) => {
    const process = spawn(pythonPath, [scriptPath, nefPath, jpgPath]);

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        console.log('[Main] NEF conversion successful:', jpgPath);
        resolve(jpgPath);
      } else {
        console.error('[Main] NEF conversion failed:', stderr);
        reject(new Error(`NEF conversion failed: ${stderr}`));
      }
    });

    process.on('error', (err) => {
      console.error('[Main] Failed to spawn NEF conversion process:', err);
      reject(err);
    });
  });
});

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
