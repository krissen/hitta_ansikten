/**
 * Application Menu
 *
 * Defines the main application menu with all available commands and keyboard shortcuts.
 * Toggle menu items use checkboxes to show current state.
 */

const { Menu, shell, ipcMain, app, dialog } = require('electron');
const { t } = require('../i18n');
const path = require('path');
const fs = require('fs');

function getVersionInfo() {
  try {
    const versionPath = path.join(__dirname, '..', 'version.json');
    if (fs.existsSync(versionPath)) {
      return JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    }
  } catch (e) {}
  return { version: 'dev', isTag: false };
}

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

  const versionInfo = getVersionInfo();
  const versionString = versionInfo.isTag ? versionInfo.version : `commit ${versionInfo.version}`;

  const template = [
    ...(isMac ? [{
      label: 'Ansikten',
      submenu: [
        {
          label: t('menu.app.about'),
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: t('menu.app.about'),
              message: 'Ansikten',
              detail: t('menu.app.aboutDetail', { version: versionString }),
              buttons: ['OK']
            });
          }
        },
        { type: 'separator' },
        {
          label: t('menu.app.preferences'),
          click: () => {
            sendMenuCommand('open-preferences');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.app.hide'),
          role: 'hide'
        },
        {
          label: t('menu.app.hideOthers'),
          role: 'hideOthers'
        },
        {
          label: t('menu.app.showAll'),
          role: 'unhide'
        },
        { type: 'separator' },
        {
          label: t('menu.app.quit'),
          role: 'quit'
        }
      ]
    }] : []),

    {
      label: t('menu.edit.title'),
      submenu: [
        { role: 'undo', label: t('menu.edit.undo') },
        { role: 'redo', label: t('menu.edit.redo') },
        { type: 'separator' },
        {
          label: t('menu.edit.undoFaceAction'),
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => {
            sendMenuCommand('undo-face-action');
          }
        },
        {
          label: t('menu.edit.undoDelete'),
          accelerator: 'CmdOrCtrl+Shift+Backspace',
          click: () => {
            sendMenuCommand('undo-delete-file');
          }
        },
        { type: 'separator' },
        { role: 'cut', label: t('menu.edit.cut') },
        { role: 'copy', label: t('menu.edit.copy') },
        { role: 'paste', label: t('menu.edit.paste') },
        { role: 'delete', label: t('menu.edit.delete') },
        { type: 'separator' },
        { role: 'selectAll', label: t('menu.edit.selectAll') }
      ]
    },

    // File menu
    {
      label: t('menu.file.title'),
      submenu: [
        {
          label: t('menu.file.openImage'),
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            sendMenuCommand( 'open-file');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.file.reloadDatabase'),
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            sendMenuCommand( 'reload-database');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.file.saveAll'),
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            sendMenuCommand( 'save-all-changes');
          }
        },
        {
          label: t('menu.file.discard'),
          accelerator: 'Escape',
          click: () => {
            sendMenuCommand( 'discard-changes');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.file.openInLightroom'),
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            sendMenuCommand('open-raw-in-lightroom');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.file.deleteToTrash'),
          accelerator: 'CmdOrCtrl+Backspace',
          click: () => {
            sendMenuCommand('delete-current-file');
          }
        },
        { type: 'separator' },
        ...(!isMac ? [
          {
            label: t('menu.file.quit'),
            accelerator: 'CmdOrCtrl+Q',
            role: 'quit'
          }
        ] : [])
      ]
    },

    // View menu
    {
      label: t('menu.view.title'),
      submenu: [
        {
          label: t('modules.image-viewer'),
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            sendMenuCommand('open-image-viewer');
          }
        },
        { type: 'separator' },
        {
          id: 'boxes-visible',
          label: t('menu.view.showBoxes'),
          accelerator: 'Shift+B',
          type: 'checkbox',
          checked: true, // Default: visible
          click: (menuItem) => {
            sendMenuCommand(menuItem.checked ? 'boxes-show' : 'boxes-hide');
          }
        },
        {
          id: 'boxes-all-faces',
          label: t('menu.view.showAllFaces'),
          accelerator: 'b',
          type: 'checkbox',
          checked: true, // Default: all faces (unchecked = single face)
          click: (menuItem) => {
            sendMenuCommand(menuItem.checked ? 'boxes-all' : 'boxes-single');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.view.zoomIn'),
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            sendMenuCommand( 'zoom-in');
          }
        },
        {
          label: t('menu.view.zoomOut'),
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            sendMenuCommand( 'zoom-out');
          }
        },
        {
          label: t('menu.view.resetZoom'),
          accelerator: 'CmdOrCtrl+=',
          click: () => {
            sendMenuCommand( 'reset-zoom');
          }
        },
        {
          label: t('menu.view.autoFit'),
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            sendMenuCommand( 'auto-fit');
          }
        },
        { type: 'separator' },
        {
          id: 'auto-center',
          label: t('menu.view.autoCenter'),
          accelerator: 'c',
          type: 'checkbox',
          checked: true,
          click: (menuItem) => {
            sendMenuCommand(menuItem.checked ? 'auto-center-enable' : 'auto-center-disable');
          }
        },
        {
          id: 'show-file-info',
          label: t('menu.view.reviewProgress'),
          accelerator: 'Shift+I',
          type: 'checkbox',
          checked: true,
          click: (menuItem) => {
            sendMenuCommand(menuItem.checked ? 'file-info-show' : 'file-info-hide');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.view.openOriginalView'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            sendMenuCommand( 'open-original-view');
          }
        },
        {
          label: t('menu.view.openLogViewer'),
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            sendMenuCommand( 'open-log-viewer');
          }
        },
        {
          label: t('menu.view.openReviewModule'),
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            sendMenuCommand( 'open-review-module');
          }
        },
        { type: 'separator' },
        {
          label: t('modules.statistics-dashboard'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            sendMenuCommand( 'open-statistics-dashboard');
          }
        },
        {
          label: t('modules.import'),
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            sendMenuCommand('open-import');
          }
        },
        {
          label: t('modules.rename-nef'),
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => {
            sendMenuCommand('open-rename-nef');
          }
        },
        {
          label: t('modules.player-count'),
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => {
            sendMenuCommand('open-player-count');
          }
        },
        {
          label: t('modules.culling'),
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => {
            sendMenuCommand('open-culling');
          }
        },
        {
          label: t('modules.database-management'),
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => {
            sendMenuCommand( 'open-database-management');
          }
        },
        {
          label: t('modules.refine-faces'),
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => {
            sendMenuCommand('open-refine-faces');
          }
        },
        {
          label: t('modules.file-queue'),
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => {
            sendMenuCommand('open-file-queue');
          }
        },
        {
          label: t('modules.preferences'),
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            sendMenuCommand('open-preferences');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.theme.title'),
          submenu: [
            {
              label: t('menu.theme.editor'),
              accelerator: 'CmdOrCtrl+Shift+T',
              click: () => {
                sendMenuCommand('open-theme-editor');
              }
            },
            { type: 'separator' },
            {
              label: t('menu.theme.light'),
              click: () => {
                sendMenuCommand('theme-light');
              }
            },
            {
              label: t('menu.theme.dark'),
              click: () => {
                sendMenuCommand('theme-dark');
              }
            },
            {
              label: t('menu.theme.followSystem'),
              click: () => {
                sendMenuCommand('theme-system');
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: t('menu.view.toggleDevTools'),
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        },
        {
          label: t('menu.view.reload'),
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            mainWindow.webContents.reload();
          }
        }
      ]
    },

    // Window menu
    {
      label: t('menu.window.title'),
      submenu: [
        {
          label: t('menu.window.layoutTemplates'),
          submenu: [
            {
              label: t('menu.window.reviewMode'),
              accelerator: 'CmdOrCtrl+1',
              click: () => {
                sendMenuCommand( 'layout-template-review');
              }
            },
            {
              label: t('menu.window.comparisonMode'),
              accelerator: 'CmdOrCtrl+2',
              click: () => {
                sendMenuCommand( 'layout-template-comparison');
              }
            },
            {
              label: t('menu.window.fullImage'),
              accelerator: 'CmdOrCtrl+3',
              click: () => {
                sendMenuCommand( 'layout-template-full-image');
              }
            },
            {
              label: t('menu.window.statsMode'),
              accelerator: 'CmdOrCtrl+4',
              click: () => {
                sendMenuCommand( 'layout-template-stats');
              }
            },
            {
              label: t('menu.window.queueReviewMode'),
              accelerator: 'CmdOrCtrl+5',
              click: () => {
                sendMenuCommand('layout-queue-review');
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: t('menu.window.gridPresets'),
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
          label: t('menu.window.layout'),
          submenu: [
            {
              label: t('menu.window.addColumn'),
              accelerator: 'CmdOrCtrl+Shift+]',
              click: () => {
                sendMenuCommand('layout-add-column');
              }
            },
            {
              label: t('menu.window.removeColumn'),
              accelerator: 'CmdOrCtrl+Shift+[',
              click: () => {
                sendMenuCommand('layout-remove-column');
              }
            },
            { type: 'separator' },
            {
              label: t('menu.window.addRow'),
              accelerator: 'CmdOrCtrl+Shift+}',
              click: () => {
                sendMenuCommand('layout-add-row');
              }
            },
            {
              label: t('menu.window.removeRow'),
              accelerator: 'CmdOrCtrl+Shift+{',
              click: () => {
                sendMenuCommand('layout-remove-row');
              }
            },
            { type: 'separator' },
            {
              label: t('menu.window.moveLeft'),
              accelerator: 'CmdOrCtrl+Alt+Left',
              click: () => {
                sendMenuCommand('layout-move-new-left');
              }
            },
            {
              label: t('menu.window.moveRight'),
              accelerator: 'CmdOrCtrl+Alt+Right',
              click: () => {
                sendMenuCommand('layout-move-new-right');
              }
            },
            {
              label: t('menu.window.moveAbove'),
              accelerator: 'CmdOrCtrl+Alt+Up',
              click: () => {
                sendMenuCommand('layout-move-new-above');
              }
            },
            {
              label: t('menu.window.moveBelow'),
              accelerator: 'CmdOrCtrl+Alt+Down',
              click: () => {
                sendMenuCommand('layout-move-new-below');
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: t('menu.window.resetLayout'),
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            sendMenuCommand( 'reset-layout');
          }
        },
        {
          label: t('menu.window.exportLayout'),
          click: () => {
            sendMenuCommand( 'export-layout');
          }
        },
        {
          label: t('menu.window.importLayout'),
          click: () => {
            sendMenuCommand( 'import-layout');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.window.minimize'),
          role: 'minimize'
        },
        {
          label: t('menu.window.close'),
          accelerator: 'CmdOrCtrl+W',
          role: 'close'
        },
        ...(isMac ? [
          { type: 'separator' },
          {
            label: t('menu.window.bringAllToFront'),
            role: 'front'
          }
        ] : [])
      ]
    },

    // Help menu
    {
      label: t('menu.help.title'),
      submenu: [
        {
          label: t('menu.help.keyboardShortcuts'),
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            sendMenuCommand('show-keyboard-shortcuts');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.help.documentation'),
          click: async () => {
            await shell.openExternal('https://github.com/krissen/ansikten#readme');
          }
        },
        {
          label: t('menu.help.userGuide'),
          click: async () => {
            await shell.openExternal('https://github.com/krissen/ansikten/blob/main/docs/user/getting-started.md');
          }
        },
        {
          label: t('menu.help.reportIssue'),
          click: async () => {
            await shell.openExternal('https://github.com/krissen/ansikten/issues/new');
          }
        },
        { type: 'separator' },
        {
          label: t('menu.help.githubRepo'),
          click: async () => {
            await shell.openExternal('https://github.com/krissen/ansikten');
          }
        },
        ...(!isMac ? [
          { type: 'separator' },
          {
            label: t('menu.app.about'),
            click: () => {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: t('menu.app.about'),
                message: 'Ansikten',
                detail: t('menu.app.aboutDetail', { version: versionString }),
                buttons: ['OK']
              });
            }
          }
        ] : [])
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
