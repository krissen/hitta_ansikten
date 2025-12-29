/**
 * Application Menu
 *
 * Defines the main application menu with all available commands and keyboard shortcuts.
 */

const { Menu, shell } = require('electron');

/**
 * Create application menu
 * @param {BrowserWindow} mainWindow - Main window instance
 * @returns {Menu} Electron menu
 */
function createApplicationMenu(mainWindow) {
  const isMac = process.platform === 'darwin';

  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: 'Bildvisare',
      submenu: [
        {
          label: 'About Bildvisare',
          role: 'about'
        },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow.webContents.send('menu-command', 'open-preferences');
          }
        },
        { type: 'separator' },
        {
          label: 'Hide Bildvisare',
          role: 'hide'
        },
        {
          label: 'Hide Others',
          role: 'hideOthers'
        },
        {
          label: 'Show All',
          role: 'unhide'
        },
        { type: 'separator' },
        {
          label: 'Quit Bildvisare',
          role: 'quit'
        }
      ]
    }] : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Image...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow.webContents.send('menu-command', 'open-file');
          }
        },
        { type: 'separator' },
        {
          label: 'Reload Database',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow.webContents.send('menu-command', 'reload-database');
          }
        },
        { type: 'separator' },
        {
          label: 'Save All Changes',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow.webContents.send('menu-command', 'save-all-changes');
          }
        },
        {
          label: 'Discard Changes',
          accelerator: 'Escape',
          click: () => {
            mainWindow.webContents.send('menu-command', 'discard-changes');
          }
        },
        { type: 'separator' },
        ...(!isMac ? [
          {
            label: 'Quit',
            accelerator: 'CmdOrCtrl+Q',
            role: 'quit'
          }
        ] : [])
      ]
    },

    // View menu
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Single/All Boxes',
          accelerator: 'b',
          click: () => {
            mainWindow.webContents.send('menu-command', 'toggle-single-all-boxes');
          }
        },
        {
          label: 'Toggle Boxes On/Off',
          accelerator: 'Shift+B',
          click: () => {
            mainWindow.webContents.send('menu-command', 'toggle-boxes-on-off');
          }
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            mainWindow.webContents.send('menu-command', 'zoom-in');
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            mainWindow.webContents.send('menu-command', 'zoom-out');
          }
        },
        {
          label: 'Reset Zoom (1:1)',
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            mainWindow.webContents.send('menu-command', 'reset-zoom');
          }
        },
        {
          label: 'Auto-Fit',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            mainWindow.webContents.send('menu-command', 'auto-fit');
          }
        },
        { type: 'separator' },
        {
          label: 'Enable Auto-Center on Face',
          accelerator: 'c',
          click: () => {
            mainWindow.webContents.send('menu-command', 'auto-center-enable');
          }
        },
        {
          label: 'Disable Auto-Center on Face',
          accelerator: 'Shift+C',
          click: () => {
            mainWindow.webContents.send('menu-command', 'auto-center-disable');
          }
        },
        { type: 'separator' },
        {
          label: 'Open Original View',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            mainWindow.webContents.send('menu-command', 'open-original-view');
          }
        },
        {
          label: 'Open Log Viewer',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            mainWindow.webContents.send('menu-command', 'open-log-viewer');
          }
        },
        {
          label: 'Open Review Module',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            mainWindow.webContents.send('menu-command', 'open-review-module');
          }
        },
        { type: 'separator' },
        {
          label: 'Statistics Dashboard',
          click: () => {
            mainWindow.webContents.send('menu-command', 'open-statistics-dashboard');
          }
        },
        {
          label: 'Database Management',
          click: () => {
            mainWindow.webContents.send('menu-command', 'open-database-management');
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            mainWindow.webContents.reload();
          }
        }
      ]
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        {
          label: 'Reset Layout',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            mainWindow.webContents.send('menu-command', 'reset-layout');
          }
        },
        {
          label: 'Export Layout...',
          click: () => {
            mainWindow.webContents.send('menu-command', 'export-layout');
          }
        },
        {
          label: 'Import Layout...',
          click: () => {
            mainWindow.webContents.send('menu-command', 'import-layout');
          }
        },
        { type: 'separator' },
        {
          label: 'Minimize',
          role: 'minimize'
        },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          role: 'close'
        },
        ...(isMac ? [
          { type: 'separator' },
          {
            label: 'Bring All to Front',
            role: 'front'
          }
        ] : [])
      ]
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: async () => {
            await shell.openExternal('https://github.com/krissen/hitta_ansikten');
          }
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/krissen/hitta_ansikten/issues');
          }
        },
        { type: 'separator' },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            mainWindow.webContents.send('menu-command', 'show-keyboard-shortcuts');
          }
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { createApplicationMenu };
