/**
 * Main Process - Modular Workspace Mode
 *
 * Entry point for the new modular workspace architecture.
 * This file is loaded when BILDVISARE_WORKSPACE=1
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { BackendService } = require('./backend-service');

let mainWindow = null;
let backendService = null;

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
      preload: path.join(__dirname, '../preload/preload.js')
    },
    title: 'Bildvisare Workspace'
  });

  // Remove menu bar
  mainWindow.setMenu(null);

  // Load workspace HTML
  const workspaceHtml = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(workspaceHtml);

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  console.log('[Main] Workspace window created');
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (backendService) {
    console.log('[Main] Shutting down backend...');
    event.preventDefault(); // Prevent quit until backend stops

    await backendService.stop();
    backendService = null;

    // Now quit for real
    app.quit();
  }
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

console.log('[Main] Workspace mode initialized');
