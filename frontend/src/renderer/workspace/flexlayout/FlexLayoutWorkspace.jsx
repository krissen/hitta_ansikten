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
import { reviewLayout, getLayoutByName, ensureBottomBorder } from './layouts.js';
import { resolvePlacementTabset, applyPlacement, ensureActiveTabset } from './tabsetUtils.js';
import { applyWorkspace } from './workspaceMorph.js';
import { getWorkspaceSpec } from './workflows.js';
import {
  snapshotStepSpec,
  saveStepSpec,
  clearStepSpec,
  clearAllStepSpecs,
  resolveStepSpec,
  migrateLegacyLayout,
} from './stepLayoutMemory.js';
import { t } from '../../../i18n/index.js';
import { preferences } from '../preferences.js';
import { useModuleAPI } from '../../context/ModuleAPIContext.jsx';
import { useConfirm } from '../../context/ConfirmContext.jsx';
import { debug, debugWarn, debugError } from '../../shared/debug.js';
import { MODULE_COMPONENTS, MODULE_TITLES, getModuleRole, getModuleWeight, getModuleStep, isSingletonModule } from './moduleRegistry.js';
import { useUIPreferences } from './uiPreferences.js';
import { ShortcutsHelpOverlay } from './ShortcutsHelp.jsx';
import {
  applyModuleBasedRatios as geomApplyModuleBasedRatios,
  swapActivePanel as geomSwapActivePanel,
  moveToNewTabset as geomMoveToNewTabset,
  groupAsTab as geomGroupAsTab,
} from './layoutGeometry.js';
import { createMenuCommandHandler } from './menuCommands.js';
import { createWorkspaceRouter } from './workspaceCommands.js';
import { StartupLanding } from '../../components/StartupLanding.jsx';
import { WorkflowBar } from '../../components/WorkflowBar.jsx';
import { hasBeenWelcomed, markWelcomed } from '../welcomeFlag.js';

// Re-exported for the characterization tests (tests/flexLayoutWorkspace.test.jsx),
// which import these from this module. The definitions now live in their own
// files; re-exporting keeps the test import paths stable.
export { SHORTCUT_SECTIONS } from './shortcutSections.js';
export { applyUIPreferences } from './uiPreferences.js';

/**
 * FlexLayoutWorkspace Component
 */
export function FlexLayoutWorkspace() {
  const layoutRef = useRef(null);
  const [model, setModel] = useState(null);
  const [ready, setReady] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  // Startup landing page: the first-run welcome card, dismissed once a module is
  // opened or an image is loaded. Shown only on the FIRST normal session — once
  // dismissed, a persistent flag (welcomeFlag.js) suppresses it on every later
  // launch, which drop straight into the workspace with the WorkflowBar. Also
  // suppressed when the main process will dispatch a launch command (CLI start),
  // so the card never flashes before the target step opens. The renderer no
  // longer guesses launch from raw argument counts — the main process resolves it
  // AFTER path expansion (`willLaunch`), so a path that expands to nothing
  // (`ansikten culling /typo`) still gets an explicit launch command (open the
  // step empty) and suppresses the landing accordingly.
  const willLaunch = !!window.ansiktenAPI?.launchIntent?.willLaunch;
  const [showLanding, setShowLanding] = useState(() => !willLaunch && !hasBeenWelcomed());
  // Dismiss the welcome card AND remember it was seen, so it is first-run-only.
  // Every dismissal path (open a step, load an image, close via the menu) routes
  // through here so the flag is set once and consistently.
  const dismissLanding = useCallback(() => {
    setShowLanding(false);
    markWelcomed();
  }, []);
  // The single command router. Created once so dispatch is available (and can
  // buffer) before the model exists; handlers are wired once the model is ready.
  const routerRef = useRef(null);
  if (!routerRef.current) routerRef.current = createWorkspaceRouter();
  const router = routerRef.current;
  const dispatch = useCallback((intent) => router.dispatch(intent), [router]);
  // Persistent workflow bar: the active pipeline step it highlights, and whether
  // it is shown at all (preference, default on). The bar state re-reads on
  // 'preferences-changed' so toggling the pref applies without a reload.
  const [activeStep, setActiveStep] = useState(null);
  // Mirror of activeStep read synchronously by handleModelChange (which fires
  // inside doAction, before a state update would land) so a user tweak is
  // persisted to the RIGHT step's memory. Updated in lockstep with setActiveStep
  // via applyActiveStep.
  const activeStepRef = useRef(null);
  const applyActiveStep = useCallback((step) => {
    activeStepRef.current = step;
    setActiveStep(step);
  }, []);
  // Suppress per-step persistence during a programmatic morph: applyWorkspace
  // fires handleModelChange for every intermediate doAction, and those transient
  // shapes must not overwrite a step's remembered layout. Only settled,
  // user-driven changes are persisted. onModelChange fires synchronously inside
  // doAction, so a plain boolean flag is race-free.
  const suppressPersistRef = useRef(false);
  const [showWorkflowBar, setShowWorkflowBar] = useState(
    () => preferences.get('workspace.showWorkflowBar') !== false
  );
  useEffect(() => {
    const onPrefChange = () =>
      setShowWorkflowBar(preferences.get('workspace.showWorkflowBar') !== false);
    window.addEventListener('preferences-changed', onPrefChange);
    return () => window.removeEventListener('preferences-changed', onPrefChange);
  }, []);
  const moduleAPI = useModuleAPI();
  const confirm = useConfirm();
  // Image paths whose Review has unsaved confirmations/ignores (mirrors the
  // 'review-dirty' signal the file queue uses). Consulted before auto-closing
  // the Review panel so culling can't silently drop partially reviewed faces.
  const reviewDirtyRef = useRef(new Set());

  // Initialize model
  useEffect(() => {
    // One-time migration of the pre-per-step single layout key into the review
    // step's memory (then it is removed). Safe no-op once migrated.
    migrateLegacyLayout();

    // Mount always builds the NEUTRAL default preset — never a remembered
    // layout. Per-step memory (stepLayoutMemory.js) is restored when the user
    // enters a step (enterStep → resolveStepSpec), not on bare startup: the
    // mount surface stays a predictable default and the pipeline's remembered
    // shapes surface only when the user actually engages a step.
    const defaultLayout = preferences.get('workspace.defaultLayout') || 'review';
    debug('FlexLayout', 'Using default layout:', defaultLayout);
    let layoutConfig = getLayoutByName(defaultLayout);

    // Guarantee a bottom border so the morphing engine can park keepMounted /
    // dirty modules there (borders only exist if declared at fromJson time).
    layoutConfig = ensureBottomBorder(layoutConfig);

    // Ensure critical global settings are always applied.
    const criticalSettings = {
      tabEnableRenderOnDemand: true,   // Unmount hidden tabs to save CPU
      splitterSize: 4,                  // Consistent splitter appearance
      tabSetMinWidth: 100,              // Prevent panels from becoming too small
      tabSetMinHeight: 100,
      tabEnableRename: false,           // Tabs are fixed module labels derived
                                        // from i18n; a manual rename wouldn't
                                        // survive a morph anyway.
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
      const fallbackModel = Model.fromJson(ensureBottomBorder(reviewLayout));
      ensureActiveTabset(fallbackModel);
      setModel(fallbackModel);
      setReady(true);
    }
  }, []);

  // Apply UI preferences when ready (and re-apply when preferences change)
  useUIPreferences(ready);

  // Persist the active step's layout on every settled user change. Programmatic
  // morphs suppress this (suppressPersistRef); changes made while no step is
  // active (activeStepRef null — non-pipeline templates, initial default) are
  // not remembered, keeping memory scoped to the pipeline steps.
  const handleModelChange = useCallback((newModel) => {
    if (!suppressPersistRef.current) {
      const step = activeStepRef.current;
      if (step) {
        const spec = snapshotStepSpec(newModel);
        if (spec.length > 0) saveStepSpec(step, spec);
      }
    }
    // When the last module is closed and the workspace is empty, bring the
    // welcome card back so there's always somewhere to go — UNCONDITIONALLY,
    // independent of the first-run flag. The card fills the area under the
    // always-visible WorkflowBar. The flag governs only whether the card shows
    // at START over the non-empty default layout (first-run only); this
    // empty-workspace fallback is separate and always on.
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

    // Opening any module dismisses the welcome card (and marks it seen).
    dismissLanding();

    // The bar highlights workflow context: opening/focusing a module that IS a
    // pipeline step (culling→culling, player-count→count, review-module→review,
    // …) marks it active. This is the single root — it covers the View menu, the
    // Verktyg menu and every window.workspace caller that routes through
    // openModule, so those paths need no setActiveStep of their own. Modules with
    // no step (Inställningar, Statistik, Loggar, …) leave activeStep untouched.
    const step = getModuleStep(moduleId);
    const markActiveStep = () => { if (step != null) applyActiveStep(step); };

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
        markActiveStep();
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

    markActiveStep();
    debug('FlexLayout', `Opened new module: ${moduleId}${isSingleton ? ' (singleton)' : ''}`);
  }, [model, applyActiveStep, dismissLanding]);

  // Close a panel by ID
  const closePanel = useCallback((panelId) => {
    if (!model) return;

    const node = model.getNodeById(panelId);
    if (node) {
      model.doAction(Actions.deleteTab(panelId));
      debug('FlexLayout', `Closed panel: ${panelId}`);
    }
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

  // Load a preset layout by full Model replace. This is the ONE destructive path
  // left — it discards live module state — so it is reserved for "Reset layout"
  // (resetLayout guards it behind a dirty-state confirm). Step switching uses the
  // non-destructive morphing engine (enterStep) instead.
  const loadLayout = useCallback((layoutName) => {
    debug('FlexLayout', `Loading layout: ${layoutName}`);
    const layoutConfig = ensureBottomBorder(getLayoutByName(layoutName));
    try {
      const newModel = Model.fromJson(layoutConfig);
      ensureActiveTabset(newModel);
      setModel(newModel);
    } catch (err) {
      debugError('FlexLayout', 'Failed to load layout:', err);
    }
  }, []);

  // The set of modules whose unsaved (dirty) state must survive a morph. Review
  // is the only module tracking dirty edits (reviewDirtyRef mirrors its
  // 'review-dirty' signal); when any file is dirty, review-module is parked
  // rather than closed during a step switch.
  const dirtyModuleSet = useCallback(
    () => (reviewDirtyRef.current.size > 0 ? new Set(['review-module']) : new Set()),
    [],
  );

  // Enter a pipeline step by MORPHING the live model into the step's pane spec —
  // the non-destructive replacement for the old loadLayout / openModuleSolo
  // rebuilds. Modules already mounted keep their state (moveNode retains node
  // ids); keepMounted (File Queue) and dirty (Review) modules are parked in the
  // background border, so nothing live is lost. This is the ONLY structural
  // layout-change path, so it is where activeStep is kept in sync.
  //
  // The target shape is the step's REMEMBERED layout (resolveStepSpec — the
  // user's saved tweaks merged with the factory so essential modules can't go
  // missing) unless `useMemory` is false, in which case the bare factory spec is
  // used (Reset layout). The morph is wrapped in the persist suppressor so its
  // intermediate shapes never overwrite the step's memory.
  const enterStep = useCallback((stepId, { useMemory = true } = {}) => {
    if (!model) return;
    const spec = useMemory ? resolveStepSpec(stepId) : getWorkspaceSpec(stepId);
    if (!spec) {
      debugWarn('FlexLayout', `No workspace spec for step: ${stepId}`);
      return;
    }
    dismissLanding();
    suppressPersistRef.current = true;
    try {
      applyWorkspace(model, spec, {
        keepDirty: dirtyModuleSet(),
        backgroundName: t('workspace.backgroundTab'),
      });
    } finally {
      suppressPersistRef.current = false;
    }
    applyActiveStep(stepId);
  }, [model, dirtyModuleSet, applyActiveStep, dismissLanding]);

  // Open a pipeline step from the WorkflowBar, landing or a Cmd+1..5 accelerator.
  //
  // Fast path (PINNED from PR 2, unchanged): when the clicked step's module is
  // already mounted AND (it is the active step OR Review has unsaved edits), just
  // focus it — never rebuild, never prompt. (N5: a mounted step must never show a
  // discard prompt; covers "click the step I'm on" even when activeStep is stale.)
  //
  // Otherwise MORPH via enterStep. Morphing is non-destructive — a dirty Review
  // and a mid-processing File Queue are parked (preserved), not closed — so a step
  // switch can no longer discard unsaved edits, and the old discard prompt is gone
  // (see docs/dev/ux-principles.md). Reset layout is the only path that still
  // confirms, because it alone rebuilds the model destructively.
  const openWorkflowStep = useCallback((moduleId) => {
    const step = getModuleStep(moduleId);
    const reviewDirty = reviewDirtyRef.current.size > 0;
    if (step != null && hasModuleTab(moduleId) && (step === activeStep || reviewDirty)) {
      // openModule syncs the bar highlight to this step (covers the dirty clause
      // where step !== activeStep).
      openModule(moduleId);
      return;
    }
    if (step != null) {
      enterStep(step);
    } else {
      // A non-pipeline module routed here (defensive): open it as a plain tab.
      openModule(moduleId);
    }
  }, [activeStep, enterStep, openModule, hasModuleTab]);

  // Confirm before a reset that would discard unsaved Review edits. Returns true
  // when the reset may proceed (nothing dirty, or the user confirmed). Reset
  // still confirms because — unlike a step morph — it forgets remembered tweaks
  // and (for a non-step surface) rebuilds the model destructively.
  const confirmDirtyReset = useCallback(async () => {
    if (reviewDirtyRef.current.size > 0) {
      const ok = await confirm({
        message: t('workflowBar.unsavedStepChange'),
        confirmLabel: t('workflowBar.switchAnyway'),
      });
      if (!ok) return false;
      reviewDirtyRef.current.clear();
    }
    return true;
  }, [confirm]);

  // Rebuild the current surface from the factory: morph the active step to its
  // bare factory spec (memory already cleared by the caller), or — with no
  // active step (a non-pipeline template) — destructively reload the default
  // preset.
  const rebuildCurrentToFactory = useCallback(() => {
    const step = activeStepRef.current;
    if (step && getWorkspaceSpec(step)) {
      enterStep(step, { useMemory: false });
    } else {
      loadLayout('review');
      applyActiveStep('review');
    }
  }, [enterStep, loadLayout, applyActiveStep]);

  // "Reset layout" (Cmd+Shift+L): forget the CURRENT step's remembered tweaks
  // and rebuild it to factory. Other steps' memories are untouched.
  const resetLayout = useCallback(async () => {
    if (!(await confirmDirtyReset())) return;
    const step = activeStepRef.current;
    if (step) clearStepSpec(step);
    rebuildCurrentToFactory();
  }, [confirmDirtyReset, rebuildCurrentToFactory]);

  // "Reset all layouts": forget every step's remembered tweaks, then rebuild the
  // current surface to factory.
  const resetAllLayouts = useCallback(async () => {
    if (!(await confirmDirtyReset())) return;
    clearAllStepSpecs();
    rebuildCurrentToFactory();
  }, [confirmDirtyReset, rebuildCurrentToFactory]);

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

  // Wire the router's handlers whenever the underlying operations change. The
  // router is created before the model exists (so early dispatches buffer); this
  // keeps its handlers pointing at the current closures (openWorkflowStep reads
  // activeStep, etc.). Runs before the ready effect below so handlers are in
  // place when markReady() flushes the buffer.
  useEffect(() => {
    router.setHandlers({
      enterStep,
      openModule,
      openWorkflowStep,
      loadLayout,
      resetLayout,
      resetAllLayouts,
      moduleAPI,
    });
  }, [router, enterStep, openModule, openWorkflowStep, loadLayout, resetLayout, resetAllLayouts, moduleAPI]);

  // Setup IPC listeners + in-app hand-off adapters, then complete the
  // workspace-ready handshake. Every mechanism here is now a thin adapter that
  // builds a typed intent and calls dispatch — the router owns the routing and
  // the cold-mount waitForListeners guards (workspaceCommands.js).
  const readySignalledRef = useRef(false);
  useEffect(() => {
    if (!ready || !window.ansiktenAPI) return;

    // Request initial file path (if app was launched with a single file arg /
    // Finder "Open With"). This pull-based handshake is unchanged — the file is
    // loaded into whatever layout is up, no morph.
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

    // Listen for menu commands — the dispatch table (navigation commands adapt to
    // router intents; geometry/theme/open-file stay direct) and unknown-command
    // fallback (broadcast to modules via moduleAPI.emit) live in menuCommands.js.
    const handleMenuCommand = createMenuCommandHandler({
      dispatch,
      addTabset,
      removeEmptyTabset,
      moveToNewTabset,
      moduleAPI,
      // Help ▸ "Visa välkomstguiden" re-shows the first-run card on demand.
      showWelcome: () => setShowLanding(true),
    });
    const offMenuCommand = window.ansiktenAPI.on('menu-command', handleMenuCommand);

    // Main-process launch commands: one unified `workspace-command` IPC carrying
    // a typed intent (open-culling / queue-files / open-import / enter-step /
    // load-image), sent only after this handshake so the router's listeners are
    // guaranteed live. dispatch buffers anything that still races ahead.
    const offWorkspaceCommand = window.ansiktenAPI.on('workspace-command', (intent) => {
      debug('FlexLayout', 'workspace-command', intent?.type);
      dispatch(intent);
    });

    // In-app hand-offs (WorkflowBar "Fortsätt →", chip "Använd i…", Import →
    // Rename → Review chain): each moduleAPI event becomes the matching intent.
    // The event name IS the intent type — the router's HANDOFFS table maps it to
    // the morph + waitForListeners + emit flow (culling/count/import/rename/
    // review-queue). This is the same behavior the per-handler code had, now in
    // one place. The morph parks a dirty Review (keepDirty) and keepMounted File
    // Queue rather than discarding them, and signalExternalLoad for count is
    // preserved (HANDOFFS.signalExternal).
    const offOpenCulling = moduleAPI.on('open-culling', (payload) =>
      dispatch({ type: 'open-culling', payload }));
    const offOpenCount = moduleAPI.on('open-count', (payload) =>
      dispatch({ type: 'open-count', payload }));
    const offOpenRenameNef = moduleAPI.on('open-rename-nef', (payload) =>
      dispatch({ type: 'open-rename-nef', payload }));
    const offOpenReviewQueue = moduleAPI.on('open-review-queue', (payload) =>
      dispatch({ type: 'open-review-queue', payload }));

    // Track which files have unsaved Review changes so a step morph parks Review
    // (keepDirty) instead of discarding its edits.
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
    const unsubscribeImageLoaded = moduleAPI.on('image-loaded', () => dismissLanding());

    // Listeners are registered and the router's handlers are wired — flush any
    // buffered intents and tell the main process the workspace is ready. The
    // main process holds its launch command until this signal, replacing the old
    // did-finish-load + 1000ms setTimeout timing lottery with a deterministic
    // handshake. Guarded so a re-run of this effect never re-signals.
    router.markReady();
    if (!readySignalledRef.current) {
      readySignalledRef.current = true;
      window.ansiktenAPI.send('workspace-ready');
    }

    return () => {
      unsubscribeImageLoaded();
      offMenuCommand?.();
      offWorkspaceCommand?.();
      offOpenCulling?.();
      offOpenCount?.();
      offOpenRenameNef?.();
      offOpenReviewQueue?.();
      offReviewDirty?.();
    };
  }, [ready, dispatch, router, addTabset, removeEmptyTabset, moduleAPI, moveToNewTabset, dismissLanding]);

  // Expose workspace API globally for debugging
  useEffect(() => {
    if (!model) return;

    window.workspace = {
      model,
      layoutRef,
      // Navigation surface routed through the single command router (same outer
      // API, so existing callers/debug usage are unchanged).
      dispatch,
      openModule: (moduleId, options) => dispatch({ type: 'open-module', moduleId, options }),
      openWorkflowStep: (moduleId) => dispatch({ type: 'open-workflow-step', moduleId }),
      enterStep: (step) => dispatch({ type: 'enter-step', step }),
      loadLayout: (name) => dispatch({ type: 'load-layout', name }),
      activeStep,
      // Layout geometry / panel ops stay direct — they are not "open" mechanisms.
      closePanel,
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
  }, [model, dispatch, activeStep, closePanel, addTabset, removeEmptyTabset, swapActivePanel, moveToNewTabset, groupAsTab, applyModuleBasedRatios, moduleAPI]);

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
    <div className="workspace-shell">
      {showWorkflowBar && (
        <WorkflowBar
          activeStep={activeStep}
          onOpenStep={openWorkflowStep}
          onOpenTool={openModule}
        />
      )}
      <div className="workspace-layout-host">
        <Layout
          ref={layoutRef}
          model={model}
          factory={factory}
          onModelChange={handleModelChange}
          onAction={handleAction}
        />
        {/* The welcome card fills the layout host (the area BELOW the persistent
            WorkflowBar), not the whole viewport — so the bar stays visible and
            interactive while the card is up. Modals (ShortcutsHelp, confirm)
            still paint above it, being higher-z siblings of the shell. */}
        {showLanding && <StartupLanding />}
      </div>
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
    </div>
  );
}

export default FlexLayoutWorkspace;
