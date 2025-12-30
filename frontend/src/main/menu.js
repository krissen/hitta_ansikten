/**
 * Application Menu
 *
 * Defines the main application menu with all available commands and keyboard shortcuts.
 * Toggle menu items use checkboxes to show current state.
 */

const { Menu, shell, ipcMain } = require('electron');

// Store references to toggle menu items for state updates
const menuItemRefs = {};

/**
 * Update menu item checked state
 * Called from renderer via IPC when state changes
 * @param {string} id - Menu item ID (e.g., 'auto-center', 'boxes-visible')
 * @param {boolean} checked - New checked state
 */
function updateMenuItemState(id, checked) {
  const menuItem = menuItemRefs[id];
  if (menuItem) {
    menuItem.checked = checked;
  }
}

// IPC handler for menu state updates from renderer
ipcMain.on('update-menu-state', (event, { id, checked }) => {
  updateMenuItemState(id, checked);
});

/**
 * Create application menu
 * @param {BrowserWindow} mainWindow - Main window instance
 * @returns {Menu} Electron menu
 */
function createApplicationMenu(mainWindow) {
  const isMac = process.platform === 'darwin';

  // Helper: Check if DevTools has focus before sending menu commands
  // This prevents shortcuts from triggering when typing in DevTools console
  const sendMenuCommand = (command) => {
    if (mainWindow.webContents.isDevToolsFocused()) {
      return; // DevTools focused - let it handle input natively
    }
    mainWindow.webContents.send('menu-command', command);
  };

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
            sendMenuCommand('open-preferences');
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

    // Edit menu - uses roles for native focus-aware clipboard handling
    // Roles automatically route to correct context (main window or DevTools)
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Image...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            sendMenuCommand( 'open-file');
          }
        },
        { type: 'separator' },
        {
          label: 'Reload Database',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            sendMenuCommand( 'reload-database');
          }
        },
        { type: 'separator' },
        {
          label: 'Save All Changes',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            sendMenuCommand( 'save-all-changes');
          }
        },
        {
          label: 'Discard Changes',
          accelerator: 'Escape',
          click: () => {
            sendMenuCommand( 'discard-changes');
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
          id: 'boxes-visible',
          label: 'Show Bounding Boxes',
          accelerator: 'Shift+B',
          type: 'checkbox',
          checked: true, // Default: visible
          click: (menuItem) => {
            sendMenuCommand(menuItem.checked ? 'boxes-show' : 'boxes-hide');
          }
        },
        {
          id: 'boxes-all-faces',
          label: 'Show All Faces',
          accelerator: 'b',
          type: 'checkbox',
          checked: true, // Default: all faces (unchecked = single face)
          click: (menuItem) => {
            sendMenuCommand(menuItem.checked ? 'boxes-all' : 'boxes-single');
          }
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            sendMenuCommand( 'zoom-in');
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            sendMenuCommand( 'zoom-out');
          }
        },
        {
          label: 'Reset Zoom (1:1)',
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            sendMenuCommand( 'reset-zoom');
          }
        },
        {
          label: 'Auto-Fit',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            sendMenuCommand( 'auto-fit');
          }
        },
        { type: 'separator' },
        {
          id: 'auto-center',
          label: 'Auto-Center on Face',
          accelerator: 'c',
          type: 'checkbox',
          checked: true, // Default: enabled
          click: (menuItem) => {
            sendMenuCommand(menuItem.checked ? 'auto-center-enable' : 'auto-center-disable');
          }
        },
        {
          label: 'Disable Auto-Center',
          accelerator: 'Shift+C',
          click: () => {
            // Uncheck the auto-center checkbox
            if (menuItemRefs['auto-center']) {
              menuItemRefs['auto-center'].checked = false;
            }
            sendMenuCommand('auto-center-disable');
          }
        },
        { type: 'separator' },
        {
          label: 'Open Original View',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            sendMenuCommand( 'open-original-view');
          }
        },
        {
          label: 'Open Log Viewer',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            sendMenuCommand( 'open-log-viewer');
          }
        },
        {
          label: 'Open Review Module',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            sendMenuCommand( 'open-review-module');
          }
        },
        { type: 'separator' },
        {
          label: 'Statistics Dashboard',
          click: () => {
            sendMenuCommand( 'open-statistics-dashboard');
          }
        },
        {
          label: 'Database Management',
          click: () => {
            sendMenuCommand( 'open-database-management');
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
          label: 'Layout Templates',
          submenu: [
            {
              label: 'Review Mode',
              accelerator: 'CmdOrCtrl+1',
              click: () => {
                sendMenuCommand( 'layout-template-review');
              }
            },
            {
              label: 'Comparison Mode',
              accelerator: 'CmdOrCtrl+2',
              click: () => {
                sendMenuCommand( 'layout-template-comparison');
              }
            },
            {
              label: 'Full Image',
              accelerator: 'CmdOrCtrl+3',
              click: () => {
                sendMenuCommand( 'layout-template-full-image');
              }
            },
            {
              label: 'Statistics Mode',
              accelerator: 'CmdOrCtrl+4',
              click: () => {
                sendMenuCommand( 'layout-template-stats');
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Grid Presets',
          submenu: [
            {
              label: '50% / 50%',
              accelerator: 'CmdOrCtrl+Shift+1',
              click: () => {
                sendMenuCommand( 'grid-preset-50-50');
              }
            },
            {
              label: '60% / 40%',
              accelerator: 'CmdOrCtrl+Shift+2',
              click: () => {
                sendMenuCommand( 'grid-preset-60-40');
              }
            },
            {
              label: '70% / 30%',
              accelerator: 'CmdOrCtrl+Shift+3',
              click: () => {
                sendMenuCommand( 'grid-preset-70-30');
              }
            },
            {
              label: '30% / 70%',
              accelerator: 'CmdOrCtrl+Shift+4',
              click: () => {
                sendMenuCommand( 'grid-preset-30-70');
              }
            },
            {
              label: '40% / 60%',
              accelerator: 'CmdOrCtrl+Shift+5',
              click: () => {
                sendMenuCommand( 'grid-preset-40-60');
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Layout',
          submenu: [
            {
              label: 'Add Column',
              accelerator: 'CmdOrCtrl+Shift+]',
              click: () => {
                sendMenuCommand('layout-add-column');
              }
            },
            {
              label: 'Remove Column',
              accelerator: 'CmdOrCtrl+Shift+[',
              click: () => {
                sendMenuCommand('layout-remove-column');
              }
            },
            { type: 'separator' },
            {
              label: 'Add Row',
              accelerator: 'CmdOrCtrl+Shift+}',
              click: () => {
                sendMenuCommand('layout-add-row');
              }
            },
            {
              label: 'Remove Row',
              accelerator: 'CmdOrCtrl+Shift+{',
              click: () => {
                sendMenuCommand('layout-remove-row');
              }
            },
            { type: 'separator' },
            {
              label: 'Move Panel to New Column Left',
              accelerator: 'CmdOrCtrl+Alt+Left',
              click: () => {
                sendMenuCommand('layout-move-new-left');
              }
            },
            {
              label: 'Move Panel to New Column Right',
              accelerator: 'CmdOrCtrl+Alt+Right',
              click: () => {
                sendMenuCommand('layout-move-new-right');
              }
            },
            {
              label: 'Move Panel to New Row Above',
              accelerator: 'CmdOrCtrl+Alt+Up',
              click: () => {
                sendMenuCommand('layout-move-new-above');
              }
            },
            {
              label: 'Move Panel to New Row Below',
              accelerator: 'CmdOrCtrl+Alt+Down',
              click: () => {
                sendMenuCommand('layout-move-new-below');
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Reset Layout',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            sendMenuCommand( 'reset-layout');
          }
        },
        {
          label: 'Export Layout...',
          click: () => {
            sendMenuCommand( 'export-layout');
          }
        },
        {
          label: 'Import Layout...',
          click: () => {
            sendMenuCommand( 'import-layout');
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
            sendMenuCommand( 'show-keyboard-shortcuts');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);

  // Store references to checkbox menu items for state synchronization
  // Menu.getMenuItemById requires the menu to be set as application menu first,
  // so we iterate through the template to find items with IDs
  const findMenuItemsWithId = (items) => {
    for (const item of items) {
      if (item.id) {
        // Find the actual MenuItem in the built menu
        const menuItem = menu.getMenuItemById(item.id);
        if (menuItem) {
          menuItemRefs[item.id] = menuItem;
        }
      }
      if (item.submenu && Array.isArray(item.submenu)) {
        findMenuItemsWithId(item.submenu);
      }
    }
  };
  findMenuItemsWithId(template);

  return menu;
}

module.exports = { createApplicationMenu };
