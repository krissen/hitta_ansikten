/**
 * FlexLayoutWorkspace - Main workspace component using FlexLayout
 *
 * Pure React implementation - all modules are React components.
 *
 * This is the layout host/shell. The pieces it used to inline now live in
 * focused modules alongside it:
 *   - moduleRegistry.js  — MODULE_COMPONENTS + MODULE_TITLES
 *   - shortcutSections.js / ShortcutsHelp.jsx — shortcuts overlay
 *   - uiPreferences.js   — applyUIPreferences + useUIPreferences
 *   - layoutGeometry.js  — tabset geometry / panel move-swap-group helpers
 *   - menuCommands.js    — the menu-command dispatch table
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Layout, Model, Actions, DockLocation } from 'flexlayout-react';
import { reviewLayout, getLayoutByName, singleModuleLayout } from './layouts.js';
import { resolvePlacementTabset, applyPlacement, ensureActiveTabset } from './tabsetUtils.js';
import { retranslateTabNames } from './tabNames.js';
import { t } from '../../../i18n/index.js';
import { preferences } from '../preferences.js';
import { useModuleAPI } from '../../context/ModuleAPIContext.jsx';
import { debug, debugWarn, debugError } from '../../shared/debug.js';
import { MODULE_COMPONENTS, MODULE_TITLES, getModuleRole, getModuleWeight, isSingletonModule } from './moduleRegistry.js';
import { useUIPreferences } from './uiPreferences.js';
import { ShortcutsHelpOverlay } from './ShortcutsHelp.jsx';
import {
  applyModuleBasedRatios as geomApplyModuleBasedRatios,
  swapActivePanel as geomSwapActivePanel,
  moveToNewTabset as geomMoveToNewTabset,
  groupAsTab as geomGroupAsTab,
} from './layoutGeometry.js';
import { createMenuCommandHandler } from './menuCommands.js';
import { StartupLanding } from '../../components/StartupLanding.jsx';

// Re-exported for the characterization tests (tests/flexLayoutWorkspace.test.jsx),
// which import these from this module. The definitions now live in their own
// files; re-exporting keeps the test import paths stable.
export { SHORTCUT_SECTIONS } from './shortcutSections.js';
export { applyUIPreferences } from './uiPreferences.js';

// Storage key for layout persistence
const STORAGE_KEY = 'ansikten-flexlayout';

/**
 * FlexLayoutWorkspace Component
 */
export function FlexLayoutWorkspace() {
  const layoutRef = useRef(null);
  const [model, setModel] = useState(null);
  const [ready, setReady] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  // Startup landing page: shown on an empty workspace, dismissed once a module
  // is opened or an image is loaded. Skipped only when the launch will actually
  // dispatch a handoff (file args or --clear) — the main process opens the
  // target then, so the landing would only flash. A bare verb (`ansikten
  // culling` with no paths and no --clear) sends no handoff, so the landing must
  // stay, or the user is stranded with no way to pick a workflow. The `import`
  // verb is the exception: it always opens the import module (its source card is
  // autodetected, so it needs no path arg), so a bare `ansikten import` still
  // dispatches a handoff and the landing is suppressed.
  const launchIntent = window.ansiktenAPI?.launchIntent;
  const hasLaunchIntent = !!launchIntent &&
    (launchIntent.hasFiles || launchIntent.clear || launchIntent.verb === 'import');
  const [showLanding, setShowLanding] = useState(!hasLaunchIntent);
  const moduleAPI = useModuleAPI();
  // Image paths whose Review has unsaved confirmations/ignores (mirrors the
  // 'review-dirty' signal the file queue uses). Consulted before auto-closing
  // the Review panel so culling can't silently drop partially reviewed faces.
  const reviewDirtyRef = useRef(new Set());

  // Initialize model
  useEffect(() => {
    // Try to load saved layout
    let layoutConfig;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        debug('FlexLayout', 'Loading saved layout');
        // Persisted layouts freeze each tab's name; re-apply current
        // translations so old layouts don't show stale (e.g. English) labels.
        layoutConfig = retranslateTabNames(JSON.parse(saved), MODULE_TITLES);
      }
    } catch (err) {
      debugWarn('FlexLayout', 'Failed to load saved layout:', err);
    }

    // Fall back to default layout
    if (!layoutConfig) {
      const defaultLayout = preferences.get('workspace.defaultLayout') || 'review';
      debug('FlexLayout', 'Using default layout:', defaultLayout);
      layoutConfig = getLayoutByName(defaultLayout);
    }

    // Ensure critical global settings are always applied
    // (saved layouts may not have newer settings)
    const criticalSettings = {
      tabEnableRenderOnDemand: true,   // Unmount hidden tabs to save CPU
      splitterSize: 4,                  // Consistent splitter appearance
      tabSetMinWidth: 100,              // Prevent panels from becoming too small
      tabSetMinHeight: 100,
      tabEnableRename: false,           // Tabs are fixed module labels — their
                                        // names are re-derived from i18n on
                                        // restore (retranslateTabNames), so a
                                        // manual rename couldn't survive anyway.
    };
    layoutConfig.global = { ...layoutConfig.global, ...criticalSettings };

    // Create model from config
    try {
      const newModel = Model.fromJson(layoutConfig);
      // Guarantee an active tabset so keyboard gates elect exactly one owner
      // from the first keypress (double-trash guard — see ensureActiveTabset).
      ensureActiveTabset(newModel);
      setModel(newModel);
      setReady(true);
      debug('FlexLayout', 'Model created');
    } catch (err) {
      debugError('FlexLayout', 'Failed to create model:', err);
      // Fall back to default
      const fallbackModel = Model.fromJson(reviewLayout);
      ensureActiveTabset(fallbackModel);
      setModel(fallbackModel);
      setReady(true);
    }
  }, []);

  // Apply UI preferences when ready (and re-apply when preferences change)
  useUIPreferences(ready);

  // Save layout on model change
  const handleModelChange = useCallback((newModel) => {
    try {
      const json = newModel.toJson();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
    } catch (err) {
      debugWarn('FlexLayout', 'Failed to save layout:', err);
    }
    // When the last module is closed and the workspace is empty, bring the
    // startup landing back so there's always somewhere to go.
    let tabCount = 0;
    newModel.visitNodes((node) => {
      if (node.getType() === 'tab') tabCount += 1;
    });
    if (tabCount === 0) setShowLanding(true);
  }, []);

  // Focus tab content when tab is selected (via tab header click)
  // This ensures keyboard shortcuts work immediately after switching tabs
  const handleAction = useCallback((action) => {
    if (action.type === Actions.SELECT_TAB && model) {
      const tabNodeId = action.data?.tabNode;

      // Use setTimeout to run after DOM update
      setTimeout(() => {
        // Get the component name from the model
        const tabNode = model.getNodeById(tabNodeId);
        if (!tabNode) return;

        const componentName = tabNode.getComponent?.();
        if (!componentName) return;

        // Find the module container by its class name
        const moduleClass = componentName; // e.g., 'image-viewer', 'review-module'
        const moduleElement = document.querySelector(`.${moduleClass}`);

        if (moduleElement) {
          // Focus the module container if it has tabindex, otherwise find a focusable child
          if (moduleElement.hasAttribute('tabindex')) {
            moduleElement.focus();
            debug('FlexLayout', 'Focused module:', componentName);
          } else {
            const focusable = moduleElement.querySelector(
              '[tabindex], canvas, input:not([disabled]), button:not([disabled])'
            );
            if (focusable) {
              focusable.focus();
              debug('FlexLayout', 'Focused element in module:', componentName);
            }
          }
        }
      }, 50);
    }
    return action; // Allow action to proceed
  }, [model]);

  // Open a module tab
  // - Singleton modules: reuses existing if found (unless forceNew is true)
  // - Non-singleton modules: always creates new instance
  //
  // Placement is deterministic by the module's ROLE (main/side/bottom) from the
  // registry, not by the active tabset — so the same command always lands the
  // module in the same kind of area. `options.placement` is an escape hatch: a
  // placement descriptor ({ tabsetId } or { split, refTabsetId }) that overrides
  // the role-based resolution.
  const openModule = useCallback((moduleId, options = {}) => {
    if (!model || !layoutRef.current) return;

    const ModuleComponent = MODULE_COMPONENTS[moduleId];
    if (!ModuleComponent) {
      debugError('FlexLayout', `Module not found: ${moduleId}`);
      return;
    }

    // Opening any module dismisses the startup landing page.
    setShowLanding(false);

    // Check if module is a singleton and already exists
    const isSingleton = isSingletonModule(moduleId);
    if (isSingleton && !options.forceNew) {
      let existingTab = null;
      model.visitNodes(node => {
        if (node.getComponent?.() === moduleId && node.getType() === 'tab') {
          existingTab = node;
        }
      });

      if (existingTab) {
        // Select the existing tab instead of creating a new one
        model.doAction(Actions.selectTab(existingTab.getId()));
        debug('FlexLayout', `Focused existing singleton module: ${moduleId}`);
        return;
      }
    }

    const tabJson = {
      type: 'tab',
      name: MODULE_TITLES[moduleId] || moduleId,
      component: moduleId,
      config: { moduleId }
    };

    // Resolve where to dock: role-based placement unless a caller forces one.
    const placement = options.placement || resolvePlacementTabset(model, getModuleRole(moduleId), getModuleRole);
    if (!placement) {
      debugWarn('FlexLayout', `No tabset to host module: ${moduleId}`);
      return;
    }

    // Add the tab at the resolved placement; a fresh split is sized to the
    // module's declared role weight so a side/bottom pane opens narrow and never
    // ends up weighing >= main (which would confuse later role resolution).
    const added = applyPlacement(model, tabJson, placement, getModuleWeight(moduleId));

    // Make the host tabset active so the switch is visible and later opens dock
    // here too (matches the pre-placement behavior).
    const hostTabsetId = added?.getParent?.()?.getId?.()
      || placement.tabsetId
      || placement.refTabsetId;
    if (hostTabsetId) model.doAction(Actions.setActiveTabset(hostTabsetId));

    debug('FlexLayout', `Opened new module: ${moduleId}${isSingleton ? ' (singleton)' : ''}`);
  }, [model]);

  // Close a panel by ID
  const closePanel = useCallback((panelId) => {
    if (!model) return;

    const node = model.getNodeById(panelId);
    if (node) {
      model.doAction(Actions.deleteTab(panelId));
      debug('FlexLayout', `Closed panel: ${panelId}`);
    }
  }, [model]);

  // Close any open tab(s) of a module by its component id, leaving the rest of
  // the workspace untouched (unlike loadLayout/openModuleSolo, which replace the
  // whole layout). Returns true if anything was closed.
  const closeModule = useCallback((moduleId) => {
    if (!model) return false;
    const ids = [];
    model.visitNodes((node) => {
      if (node.getType() === 'tab' && node.getComponent?.() === moduleId) {
        ids.push(node.getId());
      }
    });
    ids.forEach((id) => model.doAction(Actions.deleteTab(id)));
    if (ids.length) debug('FlexLayout', `Closed module: ${moduleId} (${ids.length})`);
    return ids.length > 0;
  }, [model]);

  // The tab node for the given module, or null if it isn't in the layout.
  const findModuleTab = useCallback((moduleId) => {
    if (!model) return null;
    let node = null;
    model.visitNodes((n) => {
      if (n.getType() === 'tab' && n.getComponent?.() === moduleId) node = n;
    });
    return node;
  }, [model]);

  // True if a tab for the given module is currently present in the layout.
  const hasModuleTab = useCallback((moduleId) => !!findModuleTab(moduleId), [findModuleTab]);

  // Factory function for FlexLayout
  const factory = useCallback((node) => {
    const component = node.getComponent();
    const ModuleComponent = MODULE_COMPONENTS[component];

    if (!ModuleComponent) {
      return (
        <div className="workspace-placeholder-text" style={{ padding: 20 }}>
          {t('workspace.unknownModule', { component })}
        </div>
      );
    }

    return <ModuleComponent node={node} />;
  }, []);

  // Apply module-based ratios to all tabsets (width + height weights)
  const applyModuleBasedRatios = useCallback(() => {
    geomApplyModuleBasedRatios(model);
  }, [model]);

  // Add a new tabset (column or row)
  const addTabset = useCallback((direction) => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) {
      debug('FlexLayout', 'No active tabset for adding', direction);
      return;
    }

    // FlexLayout's addNode with RIGHT or BOTTOM location creates new tabset
    const location = direction === 'column' ? DockLocation.RIGHT : DockLocation.BOTTOM;

    // Create a placeholder tab in the new tabset
    const placeholderTab = {
      type: 'tab',
      name: t('modules.image-viewer'),
      component: 'image-viewer',
      config: { moduleId: 'image-viewer' }
    };

    model.doAction(Actions.addNode(placeholderTab, activeTabset.getId(), location, -1));
    debug('FlexLayout', `Added new ${direction}`);
  }, [model]);

  // Remove empty tabset
  const removeEmptyTabset = useCallback(() => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) return false;

    const children = activeTabset.getChildren();
    if (children.length === 0) {
      debug('FlexLayout', 'Cannot remove empty tabset directly');
      return false;
    }

    if (children.length === 1) {
      // Remove the single tab, which may remove the tabset
      const tabId = children[0].getId();
      model.doAction(Actions.deleteTab(tabId));
      debug('FlexLayout', 'Removed last tab from tabset');
      return true;
    }

    debug('FlexLayout', `Tabset has ${children.length} tabs, not removing`);
    return false;
  }, [model]);

  // Load a preset layout
  const loadLayout = useCallback((layoutName) => {
    debug('FlexLayout', `Loading layout: ${layoutName}`);
    const layoutConfig = getLayoutByName(layoutName);
    try {
      const newModel = Model.fromJson(layoutConfig);
      ensureActiveTabset(newModel);
      setModel(newModel);
    } catch (err) {
      debugError('FlexLayout', 'Failed to load layout:', err);
    }
  }, []);

  // Add a module in a NEW tabset docked at `location` relative to `refTabsetId`
  // (DockLocation.RIGHT/BOTTOM split off a fresh tabset), rather than as another
  // tab inside an existing tabset. Used to place Review/Viewer beside the queue
  // without stacking them on top of it.
  const openModuleInNewTabset = useCallback((moduleId, refTabsetId, location) => {
    if (!model) return;
    model.doAction(Actions.addNode(
      { type: 'tab', name: MODULE_TITLES[moduleId] || moduleId, component: moduleId, config: { moduleId } },
      refTabsetId,
      location,
      -1,
    ));
  }, [model]);

  // Ensure a review surface (Review + Image Viewer) is mounted before the queue
  // hands off an image (called by FileQueue.loadFile). Four cases — none may
  // replace the layout while a queue exists, and none may stack a new panel into
  // an existing tabset (that hides/unmounts the panel already there under
  // render-on-demand):
  //
  //  1. BOTH present → deliberate layout: just focus the existing tabs.
  //  2. Only Review present → dock Image Viewer in its OWN tabset to the RIGHT of
  //     Review (order stays …|review|viewer).
  //  3. Only Viewer present → dock Review in its OWN tabset to the LEFT of the
  //     Viewer (order stays queue|review|viewer).
  //  4. NEITHER present → if the queue is ALSO absent it's a blank start, so a
  //     fresh queue-review layout is safe (nothing live to lose); if the queue
  //     EXISTS, replacing the model would unmount that FileQueue mid-loadFile and
  //     drop its currentFileRef/currentIndex (round-3 finding), so dock Review +
  //     Image Viewer in their own tabsets beside the queue instead.
  const ensureReviewSurface = useCallback(() => {
    const reviewTab = findModuleTab('review-module');
    const viewerTab = findModuleTab('image-viewer');

    if (reviewTab && viewerTab) {
      openModule('review-module');
      openModule('image-viewer');
      return;
    }
    if (reviewTab && !viewerTab) {
      openModuleInNewTabset('image-viewer', reviewTab.getParent().getId(), DockLocation.RIGHT);
      return;
    }
    if (viewerTab && !reviewTab) {
      openModuleInNewTabset('review-module', viewerTab.getParent().getId(), DockLocation.LEFT);
      return;
    }
    // Neither present.
    const queueTab = findModuleTab('file-queue');
    if (!queueTab) {
      loadLayout('queue-review');
      return;
    }
    const queueTabsetId = queueTab.getParent().getId();
    openModuleInNewTabset('review-module', queueTabsetId, DockLocation.RIGHT);
    const newReviewTab = findModuleTab('review-module');
    const reviewTabsetId = newReviewTab ? newReviewTab.getParent().getId() : queueTabsetId;
    openModuleInNewTabset('image-viewer', reviewTabsetId, DockLocation.RIGHT);
  }, [findModuleTab, loadLayout, openModule, openModuleInNewTabset]);

  // Replace the workspace with a single self-contained module filling it. Used
  // by the landing page for workflow steps (culling, player-count, import,
  // rename-nef) so they don't dock beside the empty Review panel.
  const openModuleSolo = useCallback((moduleId) => {
    setShowLanding(false);
    try {
      const newModel = Model.fromJson(singleModuleLayout(moduleId, MODULE_TITLES[moduleId]));
      // A solo layout has a single tabset, but set it active too so the module's
      // keyboard is live immediately without a click (and for consistency).
      ensureActiveTabset(newModel);
      setModel(newModel);
    } catch (err) {
      debugError('FlexLayout', 'Failed to open module solo:', err);
    }
  }, []);

  const openLandingStep = useCallback((moduleId) => {
    setShowLanding(false);
    // Review needs its multi-pane pipeline layout (File Queue + Review + Image
    // Viewer). Without the queue panel the review view is a dead end — nothing
    // feeds it — so land on 'queue-review', not the queue-less 'review'. Every
    // other landing target is a self-contained view opened solo (fills the
    // workspace) so a direct pick lands you on that view, not beside an empty panel.
    if (moduleId === 'review-module') {
      loadLayout('queue-review');
    } else {
      openModuleSolo(moduleId);
    }
  }, [loadLayout, openModuleSolo]);

  // Swap active panel with panel in specified direction (Cmd+Arrow)
  const swapActivePanel = useCallback((direction) => {
    geomSwapActivePanel(model, layoutRef, direction);
  }, [model]);

  // Move active panel to new tabset in direction (Cmd+Alt+Arrow)
  const moveToNewTabset = useCallback((direction) => {
    geomMoveToNewTabset(model, direction);
  }, [model]);

  // Group active panel as tab with panel in direction (Cmd+Shift+Arrow)
  const groupAsTab = useCallback((direction) => {
    geomGroupAsTab(model, layoutRef, direction);
  }, [model]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!model || !ready) return;

    const handleKeyDown = (event) => {
      // Check if should ignore (input focused, etc.)
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }

      // ? - Show keyboard shortcuts help
      if (event.key === '?') {
        event.preventDefault();
        setShowShortcutsHelp(prev => !prev);
        return;
      }

      const isMod = event.metaKey || event.ctrlKey;

      // Cmd+Shift+R / Ctrl+Shift+R - Hard reload
      if (isMod && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        window.location.reload(true);
        return;
      }

      // Cmd+R / Ctrl+R - Reload
      if (isMod && event.key.toLowerCase() === 'r' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        window.location.reload();
        return;
      }

      // === Arrow key combinations ===
      const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (isMod && arrowKeys.includes(event.key)) {
        const dirMap = {
          'ArrowLeft': 'left',
          'ArrowRight': 'right',
          'ArrowUp': 'above',
          'ArrowDown': 'below'
        };
        const direction = dirMap[event.key];

        // Cmd+Shift+Arrow: Group as tab with panel in direction
        if (event.shiftKey && !event.altKey) {
          event.preventDefault();
          groupAsTab(direction);
          return;
        }

        // Cmd+Alt+Arrow: Move panel to new column/row
        if (event.altKey && !event.shiftKey) {
          event.preventDefault();
          moveToNewTabset(direction);
          return;
        }

        // Cmd+Arrow (no modifiers): Swap/move panel positions
        if (!event.shiftKey && !event.altKey) {
          event.preventDefault();
          swapActivePanel(direction);
          return;
        }
      }

      // === Bracket key combinations ===
      if (isMod && event.shiftKey) {
        // Cmd+Shift+] - Add column to the right
        if (event.key === ']') {
          event.preventDefault();
          addTabset('column');
          return;
        }
        // Cmd+Shift+[ - Remove active tabset (if possible)
        if (event.key === '[') {
          event.preventDefault();
          removeEmptyTabset();
          return;
        }
        // Cmd+Shift+} - Add row below
        if (event.key === '}') {
          event.preventDefault();
          addTabset('row');
          return;
        }
        // Cmd+Shift+{ - Remove active tabset (if possible)
        if (event.key === '{') {
          event.preventDefault();
          removeEmptyTabset();
          return;
        }
      }

      // Cmd+Alt+1-5: Set column count (future enhancement)
      // FlexLayout doesn't have direct column count control like Dockview
      // Would need to restructure the entire layout

      // Cmd+O: Open file
      if (isMod && event.key === 'o' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        openFileDialog();
        return;
      }
    };

    const openFileDialog = async () => {
      try {
        // Use multi-file dialog (same as + button in FileQueue)
        const filePaths = await window.ansiktenAPI?.invoke('open-multi-file-dialog');
        if (!filePaths || filePaths.length === 0) return;

        debug('FlexLayout', `Opening ${filePaths.length} file(s)`);
        // Add to queue - FileQueue will handle loading the first file
        if (window.fileQueue?.add) {
          window.fileQueue.add(filePaths);
          // Start queue if it wasn't running
          setTimeout(() => window.fileQueue.start?.(), 100);
        } else {
          // Fallback: emit for single file
          moduleAPI.emit('load-image', { imagePath: filePaths[0] });
        }
      } catch (err) {
        debugError('FlexLayout', 'Failed to open file:', err);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [model, ready, swapActivePanel, moveToNewTabset, groupAsTab, addTabset, removeEmptyTabset, moduleAPI]);

  // Setup IPC listeners
  useEffect(() => {
    if (!ready || !window.ansiktenAPI) return;

    // Request initial file path (if app was launched with a file argument)
    const loadInitialFile = async () => {
      try {
        const filePath = await window.ansiktenAPI.invoke('get-initial-file');
        if (filePath) {
          debug('FlexLayout', 'Loading initial file:', filePath);
          moduleAPI.emit('load-image', { imagePath: filePath });
        }
      } catch (err) {
        debugError('FlexLayout', 'Failed to get initial file:', err);
      }
    };
    loadInitialFile();

    // Listen for menu commands — the dispatch table and unknown-command
    // fallback (broadcast to modules via moduleAPI.emit) live in menuCommands.js.
    const handleMenuCommand = createMenuCommandHandler({
      loadLayout,
      addTabset,
      removeEmptyTabset,
      moveToNewTabset,
      openModule,
      moduleAPI,
    });

    const offMenuCommand = window.ansiktenAPI.on('menu-command', handleMenuCommand);

    // CLI culling target (`ansikten culling DIR`): close the face-review panel
    // (culling is a different workflow — Review shouldn't sit in the layout
    // while culling) and open/focus the culling module as a tab, leaving every
    // OTHER open tab untouched. Then hand it the folder scope once it has
    // subscribed. Using waitForListeners avoids a lost-event race on a cold
    // start where the module hasn't mounted yet — same guard the
    // FileQueue→ImageViewer handshake uses for 'load-image'.
    const handleOpenCulling = async ({ roots, clear, recursive }) => {
      // Open culling FIRST, before closing Review, so there is always a host
      // tabset to place it into. If Review were the workspace's only panel,
      // closing it first would empty the layout and leave placement with no
      // tabset (resolvePlacementTabset → null), silently dropping the culling
      // tab — so the order matters.
      openModule('culling');
      // Then close Review — but not while it has unsaved confirmations/ignores,
      // which live in ReviewModule state and would be silently dropped. In that
      // case leave the panel open; the user can save and re-issue the command.
      if (reviewDirtyRef.current.size === 0) {
        closeModule('review-module');
      }
      await moduleAPI.waitForListeners('culling-load', 2000);
      moduleAPI.emit('culling-load', { roots, clear, recursive });
    };
    const offOpenCulling = window.ansiktenAPI.on('open-culling', handleOpenCulling);

    // CLI `ansikten import [DEST]`: open the import module and hand it the
    // optional destination. Unlike culling this doesn't touch the Review panel —
    // import is its own workflow and shares no layout with Review. waitForListeners
    // guards the cold-start race where the module hasn't mounted yet.
    const handleOpenImport = async ({ destination }) => {
      openModule('import');
      await moduleAPI.waitForListeners('import-load', 2000);
      moduleAPI.emit('import-load', { destination });
    };
    const offOpenImport = window.ansiktenAPI.on('open-import', handleOpenImport);

    // In-app hand-off from Import → Rename-NEF ("Döp om filer…"). Unlike the
    // CLI hand-offs above this is a renderer moduleAPI event (no IPC): open/focus
    // the rename-nef module, then pass it the just-imported folder once it has
    // subscribed. waitForListeners guards the cold-start race on first open.
    const handleOpenRenameNef = async ({ roots }) => {
      openModule('rename-nef');
      await moduleAPI.waitForListeners('rename-nef-load', 2000);
      moduleAPI.emit('rename-nef-load', { roots });
    };
    const offOpenRenameNef = moduleAPI.on('open-rename-nef', handleOpenRenameNef);

    // Bring the File Queue up so it can receive a 'file-queue-load' emit, WITHOUT
    // racing a layout swap. Only load the fresh pipeline layout when the queue is
    // ABSENT and Review has no unsaved edits; otherwise just focus the existing
    // queue. Reloading while a File Queue tab already exists is the bug: the old
    // queue's 'file-queue-load' listener stays registered until React commits the
    // unmount, so waitForListeners can resolve against that dying listener and the
    // emit is lost with it. Only loadLayout when there is no queue listener to
    // race against; when the queue is present its live listener gets the emit.
    const ensureQueueMounted = () => {
      // Dismiss the startup landing explicitly. Normally a loaded image does this
      // (via 'image-loaded'), but a `queue-files` payload without startQueue just
      // fills the queue — no image loads — so nothing else would hide the landing
      // and the populated queue would sit behind the startup screen.
      setShowLanding(false);
      if (!hasModuleTab('file-queue') && reviewDirtyRef.current.size === 0) {
        loadLayout('queue-review');
      } else {
        openModule('file-queue');
      }
    };

    // In-app hand-off from Rename-NEF → Review ("Granska ansikten…"): bring up
    // the pipeline layout (File Queue + Review + Image Viewer) and hand the
    // just-renamed folder(s) to the queue, which expands them to files.
    const handleOpenReviewQueue = async ({ roots }) => {
      ensureQueueMounted();
      await moduleAPI.waitForListeners('file-queue-load', 2000);
      moduleAPI.emit('file-queue-load', { roots });
    };
    const offOpenReviewQueue = moduleAPI.on('open-review-queue', handleOpenReviewQueue);

    // CLI `ansikten -q FILES` (and the `queue-files` IPC generally): the queue
    // may not be mounted yet — a saved layout without a File Queue panel, or a
    // cold start where the landing page was suppressed by the launch intent but
    // no receiver existed → a blank workspace. Ensure the queue is present (load
    // 'queue-review' only when it is missing) then re-emit the payload as the
    // renderer-side 'file-queue-load' once the queue has subscribed. This is the
    // single mount-aware entry point that the old direct FileQueue IPC listener
    // couldn't provide.
    const handleQueueFilesIpc = async (payload) => {
      ensureQueueMounted();
      await moduleAPI.waitForListeners('file-queue-load', 2000);
      moduleAPI.emit('file-queue-load', payload || {});
    };
    const offQueueFiles = window.ansiktenAPI.on('queue-files', handleQueueFilesIpc);

    // Track which files have unsaved Review changes so the culling hand-off
    // above won't close Review and discard them.
    const offReviewDirty = moduleAPI.on('review-dirty', ({ imagePath, dirty }) => {
      if (!imagePath) return;
      if (dirty) reviewDirtyRef.current.add(imagePath);
      else reviewDirtyRef.current.delete(imagePath);
    });

    // A loaded image dismisses the landing. Listen on the past-tense
    // 'image-loaded' (emitted by ImageViewer after a load), NOT the imperative
    // 'load-image' command: FileQueue uses hasListeners('load-image') to detect
    // when ImageViewer has mounted, and a permanent listener here would defeat
    // that guard and reintroduce a lost-event race on first queue load.
    const unsubscribeImageLoaded = moduleAPI.on('image-loaded', () => setShowLanding(false));

    return () => {
      unsubscribeImageLoaded();
      offMenuCommand?.();
      offOpenCulling?.();
      offOpenImport?.();
      offOpenRenameNef?.();
      offOpenReviewQueue?.();
      offQueueFiles?.();
      offReviewDirty?.();
    };
  }, [ready, loadLayout, addTabset, removeEmptyTabset, openModule, closeModule, hasModuleTab, moduleAPI, moveToNewTabset]);

  // Expose workspace API globally for debugging
  useEffect(() => {
    if (!model) return;

    window.workspace = {
      model,
      layoutRef,
      openModule,
      ensureReviewSurface,
      closePanel,
      loadLayout,
      addColumn: () => addTabset('column'),
      addRow: () => addTabset('row'),
      removeTabset: removeEmptyTabset,
      swapPanel: swapActivePanel,
      moveToNew: moveToNewTabset,
      groupAsTab: groupAsTab,
      applyModuleRatios: applyModuleBasedRatios,
      moduleAPI,
      preferences
    };

    return () => {
      delete window.workspace;
    };
  }, [model, openModule, ensureReviewSurface, closePanel, loadLayout, addTabset, removeEmptyTabset, swapActivePanel, moveToNewTabset, groupAsTab, applyModuleBasedRatios, moduleAPI]);

  // NOTE: Auto-load from queue is handled by FileQueueModule, not here

  if (!model) {
    return (
      <div className="workspace-placeholder-text" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%'
      }}>
        {t('workspace.loading')}
      </div>
    );
  }

  return (
    <>
      <Layout
        ref={layoutRef}
        model={model}
        factory={factory}
        onModelChange={handleModelChange}
        onAction={handleAction}
      />
      {showLanding && <StartupLanding onOpenModule={openLandingStep} />}
      {showShortcutsHelp && (
        <ShortcutsHelpOverlay
          onClose={() => setShowShortcutsHelp(false)}
          activeModule={(() => {
            const activeTabset = model.getActiveTabset();
            if (!activeTabset) return null;
            const activeTab = activeTabset.getSelectedNode();
            return activeTab?.getComponent() || null;
          })()}
        />
      )}
    </>
  );
}

export default FlexLayoutWorkspace;
