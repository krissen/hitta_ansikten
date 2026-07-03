/**
 * FlexLayoutWorkspace - Main workspace component using FlexLayout
 *
 * Pure React implementation - all modules are React components.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Layout, Model, Actions, DockLocation } from 'flexlayout-react';
import { reviewLayout, getLayoutByName, singleModuleLayout } from './layouts.js';
import { resolveTargetTabset } from './tabsetUtils.js';
import { t } from '../../../i18n/index.js';
import { preferences } from '../preferences.js';
import { themeManager } from '../../theme-manager.js';
import { useModuleAPI } from '../../context/ModuleAPIContext.jsx';
import { debug, debugWarn, debugError } from '../../shared/debug.js';
import './ShortcutsHelp.css';

// Import React components directly
import { ImageViewer } from '../../components/ImageViewer.jsx';
import { OriginalView } from '../../components/OriginalView.jsx';
import { LogViewer } from '../../components/LogViewer.jsx';
import { StatisticsDashboard } from '../../components/StatisticsDashboard.jsx';
import { ReviewModule } from '../../components/ReviewModule.jsx';
import { DatabaseManagement } from '../../components/DatabaseManagement.jsx';
import { FileQueueModule } from '../../components/FileQueueModule.jsx';
import { ThemeEditor } from '../../components/ThemeEditor.jsx';
import { PreferencesModule } from '../../components/PreferencesModule.jsx';
import { RefineFacesModule } from '../../components/RefineFacesModule.jsx';
import { PlayerCountModule } from '../../components/PlayerCountModule.jsx';
import { CullingModule } from '../../components/CullingModule.jsx';
import { ImportModule } from '../../components/ImportModule.jsx';
import { RenameNefModule } from '../../components/RenameNefModule.jsx';
import { StartupLanding } from '../../components/StartupLanding.jsx';


// Storage key for layout persistence
const STORAGE_KEY = 'ansikten-flexlayout';

const SHORTCUT_SECTIONS = [
  {
    id: 'navigation',
    title: t('shortcuts.sections.navigation'),
    modules: [],
    shortcuts: [
      { keys: ['Cmd', '←→↑↓'], desc: t('shortcuts.desc.nav.moveFocus') },
      { keys: ['↑', '↓'], desc: t('shortcuts.desc.nav.prevNextItem'), sep: '/' },
      { keys: ['Tab'], desc: t('shortcuts.desc.nav.completeName') }
    ]
  },
  {
    id: 'layout',
    title: t('shortcuts.sections.layout'),
    modules: [],
    shortcuts: [
      { keys: ['Cmd', '1-4'], desc: t('shortcuts.desc.layout.switchTemplate') },
      { keys: ['Cmd', 'Shift', ']'], desc: t('shortcuts.desc.layout.addColumn') },
      { keys: ['Cmd', 'Shift', '['], desc: t('shortcuts.desc.layout.removeColumn') },
      { keys: ['Cmd', 'Shift', '}'], desc: t('shortcuts.desc.layout.addRow') },
      { keys: ['Cmd', 'Shift', '{'], desc: t('shortcuts.desc.layout.removeRow') }
    ]
  },
  {
    id: 'image-viewer',
    title: t('modules.image-viewer'),
    modules: ['image-viewer', 'original-view'],
    shortcuts: [
      { keys: ['+', '-'], desc: t('shortcuts.desc.viewer.zoom'), sep: ' / ' },
      { keys: ['='], desc: t('shortcuts.desc.viewer.reset') },
      { keys: ['0'], desc: t('shortcuts.desc.viewer.autoFit') },
      { keys: ['B'], desc: t('shortcuts.desc.viewer.toggleBoxes') },
      { keys: ['b'], desc: t('shortcuts.desc.viewer.toggleSingleAll') },
      { keys: ['c', 'C'], desc: t('shortcuts.desc.viewer.autoCenter'), sep: ' / ' }
    ]
  },
  {
    id: 'face-review',
    title: t('modules.review-module'),
    modules: ['review-module'],
    shortcuts: [
      { keys: ['Enter', 'A'], desc: t('shortcuts.desc.review.acceptMatch'), sep: ' / ' },
      { keys: ['I'], desc: t('shortcuts.desc.review.ignoreFace') },
      { keys: ['R'], desc: t('shortcuts.desc.review.rename') },
      { keys: ['1-N'], desc: t('shortcuts.desc.review.selectAlternative') },
      { keys: ['↑', '↓'], desc: t('shortcuts.desc.review.prevNextFace'), sep: ' / ' },
      { keys: ['X'], desc: t('shortcuts.desc.review.skipFile') },
      { keys: ['Shift', 'Cmd', 'A'], desc: t('shortcuts.desc.review.acceptAll') },
      { keys: ['Cmd', 'Z'], desc: t('shortcuts.desc.review.undo') },
      { keys: ['Esc'], desc: t('shortcuts.desc.review.cancel') }
    ]
  },
  {
    id: 'file-queue',
    title: t('modules.file-queue'),
    modules: ['file-queue'],
    shortcuts: [
      { keys: ['Cmd', 'O'], desc: t('shortcuts.desc.queue.openFiles') },
      { keys: ['↑', '↓'], desc: t('shortcuts.desc.queue.navigate'), sep: ' / ' },
      { keys: ['Enter'], desc: t('shortcuts.desc.queue.loadFile') },
      { keys: ['Delete'], desc: t('shortcuts.desc.queue.remove') },
      { keys: ['Cmd', 'A'], desc: t('shortcuts.desc.queue.selectAll') }
    ]
  },
  {
    id: 'culling',
    title: t('modules.culling'),
    modules: ['culling'],
    shortcuts: [
      { keys: ['→', '↓'], desc: t('shortcuts.desc.culling.nextImage'), sep: ' / ' },
      { keys: ['←', '↑'], desc: t('shortcuts.desc.culling.prevImage'), sep: ' / ' },
      { keys: ['Alt', '←→↑↓'], desc: t('shortcuts.desc.culling.page') },
      { keys: ['X', 'Delete', 'Cmd+⌫'], desc: t('shortcuts.desc.culling.cull'), sep: ' / ' },
      { keys: ['Enter'], desc: t('shortcuts.desc.culling.rename') },
      { keys: ['Cmd', 'Enter'], desc: t('shortcuts.desc.culling.applyRemovals') },
      { keys: ['Cmd', 'Z'], desc: t('shortcuts.desc.culling.undo') },
      { keys: ['L'], desc: t('shortcuts.desc.culling.openLightroom') }
    ]
  },
  {
    id: 'general',
    title: t('shortcuts.sections.general'),
    modules: [],
    shortcuts: [
      { keys: ['?'], desc: t('shortcuts.desc.general.showHelp') },
      { keys: ['Cmd', 'R'], desc: t('shortcuts.desc.general.reload') },
      { keys: ['Cmd', ','], desc: t('shortcuts.desc.general.preferences') }
    ]
  }
];

function ShortcutRow({ shortcut }) {
  const { keys, desc, sep = '+' } = shortcut;
  return (
    <div className="shortcut-row">
      {keys.map((key, i) => (
        <span key={key}>
          {i > 0 && <span className="key-sep">{sep}</span>}
          <kbd>{key}</kbd>
        </span>
      ))}
      <span className="shortcut-desc">{desc}</span>
    </div>
  );
}

function ShortcutsHelpOverlay({ onClose, activeModule }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-dialog" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h2>{t('shortcuts.header')}</h2>
          <button type="button" className="shortcuts-close" onClick={onClose}>&times;</button>
        </div>
        <div className="shortcuts-content">
          {SHORTCUT_SECTIONS.map(section => {
            const isActive = section.modules.length > 0 && section.modules.includes(activeModule);
            return (
              <div
                key={section.id}
                className={`shortcuts-section ${isActive ? 'active-module' : ''}`}
              >
                <h3>{section.title}</h3>
                {section.shortcuts.map((shortcut) => (
                  <ShortcutRow key={shortcut.desc} shortcut={shortcut} />
                ))}
              </div>
            );
          })}
        </div>
        <div className="shortcuts-footer">
          {t('shortcuts.footer.before')}<kbd>?</kbd>{t('shortcuts.footer.or')}<kbd>Esc</kbd>{t('shortcuts.footer.after')}
        </div>
      </div>
    </div>
  );
}

// Module component mapping
const MODULE_COMPONENTS = {
  'image-viewer': ImageViewer,
  'original-view': OriginalView,
  'log-viewer': LogViewer,
  'statistics-dashboard': StatisticsDashboard,
  'review-module': ReviewModule,
  'database-management': DatabaseManagement,
  'refine-faces': RefineFacesModule,
  'file-queue': FileQueueModule,
  'theme-editor': ThemeEditor,
  'preferences': PreferencesModule,
  'player-count': PlayerCountModule,
  'culling': CullingModule,
  'import': ImportModule,
  'rename-nef': RenameNefModule
};

// Module titles (Swedish) — derived from the i18n catalog, keyed by module id.
const MODULE_TITLES = Object.fromEntries(
  Object.keys(MODULE_COMPONENTS).map((id) => [id, t(`modules.${id}`)])
);


// Module-specific default layout ratios
// widthRatio: proportion of row width (horizontal split)
// heightRatio: proportion when in a secondary row (vertical split)
// row: default row (1 = primary/top, 2 = secondary/bottom)
const MODULE_LAYOUT = {
  'review-module': {
    widthRatio: 0.15,     // 15% width in its row
    heightRatio: 0.70,    // Primary row gets 70% height
    row: 1
  },
  'image-viewer': {
    widthRatio: 0.85,     // 85% width in its row
    heightRatio: 0.70,    // Primary row gets 70% height
    row: 1
  },
  'original-view': {
    widthRatio: 0.50,     // 50% when sharing row
    heightRatio: 0.70,    // Primary row
    row: 1
  },
  'log-viewer': {
    widthRatio: 0.50,     // 50% when sharing row with stats
    heightRatio: 0.30,    // Secondary row gets 30% height
    row: 2
  },
  'statistics-dashboard': {
    widthRatio: 0.50,     // 50% when sharing row with log
    heightRatio: 0.30,    // Secondary row gets 30% height
    row: 2
  },
  'database-management': {
    widthRatio: 0.50,     // 50% when sharing row
    heightRatio: 0.30,    // Secondary row
    row: 2
  },
  'file-queue': {
    widthRatio: 0.15,     // 15% width in sidebar
    heightRatio: 0.70,    // Primary row
    row: 1
  },
  'theme-editor': {
    widthRatio: 0.50,     // 50% when sharing row
    heightRatio: 0.70,    // Primary row
    row: 1
  },
  'player-count': {
    widthRatio: 0.50,     // 50% when sharing row
    heightRatio: 0.70,    // Primary row
    row: 1
  },
  'culling': {
    widthRatio: 0.70,     // wide - it holds list + image side by side
    heightRatio: 0.70,    // Primary row
    row: 1
  },
  'import': {
    widthRatio: 0.40,     // compact form
    heightRatio: 0.70,    // Primary row
    row: 1
  },
  'rename-nef': {
    widthRatio: 0.50,     // preview table
    heightRatio: 0.70,    // Primary row
    row: 1
  }
};

// Simple width ratios for backward compatibility
const MODULE_RATIOS = Object.fromEntries(
  Object.entries(MODULE_LAYOUT).map(([k, v]) => [k, v.widthRatio])
);

/**
 * Apply UI preferences to FlexLayout CSS variables
 * Maps preferences to FlexLayout's theming system
 * @param {object} overrides - Optional override values (for live preview)
 */
function applyUIPreferences(overrides = null) {
  const layoutEl = document.querySelector('.flexlayout__layout');
  if (!layoutEl) {
    debug('FlexLayout', 'Layout element not found, will retry');
    return false;
  }

  // Helper to get value from overrides or preferences
  const getValue = (path, defaultVal) => {
    if (overrides && overrides.appearance) {
      const key = path.split('.').pop();
      if (overrides.appearance[key] !== undefined) {
        return overrides.appearance[key];
      }
    }
    return preferences.get(path) || defaultVal;
  };

  // Size preferences (colors now come from theme.css)
  const tabsHeight = getValue('appearance.tabsHeight', 28);
  const tabsFontSize = getValue('appearance.tabsFontSize', 13);
  const tabPaddingLeft = getValue('appearance.tabPaddingLeft', 8);
  const tabPaddingRight = getValue('appearance.tabPaddingRight', 6);
  const tabMinGap = getValue('appearance.tabMinGap', 5);

  // Apply font size to FlexLayout CSS variable
  layoutEl.style.setProperty('--font-size', `${tabsFontSize}px`);

  // Apply tab sizing via direct CSS injection (colors come from theme)
  let styleEl = document.getElementById('flexlayout-preferences-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'flexlayout-preferences-style';
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `
    /* Tab sizing preferences (colors from theme.css) */
    .flexlayout__tab_button {
      padding: 4px ${tabPaddingRight}px 4px ${tabPaddingLeft}px !important;
      height: ${tabsHeight}px !important;
      box-sizing: border-box !important;
      font-size: ${tabsFontSize}px !important;
      gap: ${tabMinGap}px !important;
    }
    .flexlayout__tabset_tabbar_outer {
      font-size: ${tabsFontSize}px !important;
      min-height: ${tabsHeight + 4}px !important;
    }
  `;

  debug('FlexLayout', 'Applied UI preferences');
  return true;
}

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
        layoutConfig = JSON.parse(saved);
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
    };
    layoutConfig.global = { ...layoutConfig.global, ...criticalSettings };

    // Create model from config
    try {
      const newModel = Model.fromJson(layoutConfig);
      setModel(newModel);
      setReady(true);
      debug('FlexLayout', 'Model created');
    } catch (err) {
      debugError('FlexLayout', 'Failed to create model:', err);
      // Fall back to default
      setModel(Model.fromJson(reviewLayout));
      setReady(true);
    }
  }, []);

  // Apply UI preferences when ready (and re-apply when preferences change)
  useEffect(() => {
    if (!ready) return;

    // Apply preferences (may need retry if layout element not yet mounted)
    const tryApply = () => {
      if (!applyUIPreferences()) {
        setTimeout(tryApply, 100);
      }
    };
    tryApply();

    // Listen for preference changes (saved) - read from actual preferences
    const handlePrefChange = () => applyUIPreferences();
    window.addEventListener('preferences-changed', handlePrefChange);

    // Listen for live preview - use tempPrefs from event
    const handlePreview = (e) => {
      if (e.detail && e.detail.tempPrefs) {
        applyUIPreferences(e.detail.tempPrefs);
      }
    };
    window.addEventListener('preferences-preview', handlePreview);

    // Listen for cancel - restore from actual saved preferences
    const handleCancel = () => applyUIPreferences();
    window.addEventListener('preferences-cancelled', handleCancel);

    return () => {
      window.removeEventListener('preferences-changed', handlePrefChange);
      window.removeEventListener('preferences-preview', handlePreview);
      window.removeEventListener('preferences-cancelled', handleCancel);
    };
  }, [ready]);

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

  // Modules that are singletons (only one instance allowed, switch to existing)
  // Most modules should be singletons - multiple instances rarely make sense
  const SINGLETON_MODULES = new Set([
    'image-viewer',
    'review-module',
    'file-queue',
    'original-view',
    'preferences',
    'statistics-dashboard',
    'log-viewer',
    'database-management',
    'refine-faces',
    'theme-editor',
    'player-count',
    'culling',
    'import',
    'rename-nef'
  ]);

  // Open a module tab
  // - Singleton modules: reuses existing if found (unless forceNew is true)
  // - Non-singleton modules: always creates new instance
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
    const isSingleton = SINGLETON_MODULES.has(moduleId);
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

    // Resolve where to dock the new tab (active tabset, else main working area).
    const targetTabset = resolveTargetTabset(model);
    if (targetTabset) {
      // select=true so the new tab is shown (not added behind the current one),
      // and make its tabset active so the switch is visible and later opens dock
      // here too.
      model.doAction(Actions.addNode(tabJson, targetTabset.getId(), DockLocation.CENTER, -1, true));
      model.doAction(Actions.setActiveTabset(targetTabset.getId()));
    } else {
      debugWarn('FlexLayout', `No tabset to host module: ${moduleId}`);
    }

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

  // Factory function for FlexLayout
  const factory = useCallback((node) => {
    const component = node.getComponent();
    const ModuleComponent = MODULE_COMPONENTS[component];

    if (!ModuleComponent) {
      return (
        <div style={{ padding: 20, color: '#666' }}>
          {t('workspace.unknownModule', { component })}
        </div>
      );
    }

    return <ModuleComponent node={node} />;
  }, []);

  // Get tabset position in layout (using bounding rect)
  const getTabsetPosition = useCallback((tabset) => {
    if (!layoutRef.current) return { x: 0, y: 0 };

    const tabsetId = tabset.getId();

    // FlexLayout uses class-based selectors, find the tabset container
    // The tabset header contains a unique identifier we can use
    const allTabsets = document.querySelectorAll('.flexlayout__tabset');

    for (const element of allTabsets) {
      // Check if this element corresponds to our tabset by matching tab IDs
      const tabButtons = element.querySelectorAll('.flexlayout__tab_button');
      for (const btn of tabButtons) {
        const btnId = btn.getAttribute('data-layout-path');
        if (btnId && btnId.includes(tabsetId)) {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            rect
          };
        }
      }
    }

    // Fallback: try to find by iterating through layout structure
    const allElements = document.querySelectorAll('.flexlayout__tabset');
    if (allElements.length > 0) {
      // Get tabsets from model and match by index
      const tabsets = [];
      model.visitNodes((node) => {
        if (node.getType() === 'tabset') {
          tabsets.push(node);
        }
      });

      const tabsetIndex = tabsets.findIndex(ts => ts.getId() === tabsetId);
      if (tabsetIndex >= 0 && tabsetIndex < allElements.length) {
        const element = allElements[tabsetIndex];
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          rect
        };
      }
    }

    return { x: 0, y: 0 };
  }, [model]);

  // Find tabset in direction based on position
  const findTabsetInDirection = useCallback((fromTabset, direction) => {
    const tabsets = [];
    model.visitNodes((node) => {
      if (node.getType() === 'tabset') {
        tabsets.push(node);
      }
    });

    if (tabsets.length < 2) return null;

    const fromPos = getTabsetPosition(fromTabset);

    // Filter tabsets in the specified direction
    const candidates = tabsets.filter(ts => {
      if (ts.getId() === fromTabset.getId()) return false;
      const pos = getTabsetPosition(ts);

      switch (direction) {
        case 'left':
          return pos.x < fromPos.x;
        case 'right':
          return pos.x > fromPos.x;
        case 'up':
          return pos.y < fromPos.y;
        case 'down':
          return pos.y > fromPos.y;
        default:
          return false;
      }
    });

    if (candidates.length === 0) return null;

    // Sort by distance and return nearest
    candidates.sort((a, b) => {
      const posA = getTabsetPosition(a);
      const posB = getTabsetPosition(b);
      const distA = Math.sqrt(Math.pow(posA.x - fromPos.x, 2) + Math.pow(posA.y - fromPos.y, 2));
      const distB = Math.sqrt(Math.pow(posB.x - fromPos.x, 2) + Math.pow(posB.y - fromPos.y, 2));
      return distA - distB;
    });

    return candidates[0];
  }, [model, getTabsetPosition]);

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
      setModel(newModel);
    } catch (err) {
      debugError('FlexLayout', 'Failed to load layout:', err);
    }
  }, []);

  // Replace the workspace with a single self-contained module filling it. Used
  // by the landing page for workflow steps (culling, player-count, import,
  // rename-nef) so they don't dock beside the empty Review panel.
  const openModuleSolo = useCallback((moduleId) => {
    setShowLanding(false);
    try {
      setModel(Model.fromJson(singleModuleLayout(moduleId, MODULE_TITLES[moduleId])));
    } catch (err) {
      debugError('FlexLayout', 'Failed to open module solo:', err);
    }
  }, []);

  const openLandingStep = useCallback((moduleId) => {
    setShowLanding(false);
    // Review needs its multi-pane layout (Review + Image Viewer); every other
    // landing target is a self-contained view opened solo (fills the workspace)
    // so a direct pick lands you on that view, not docked beside an empty panel.
    if (moduleId === 'review-module') {
      loadLayout('review');
    } else {
      openModuleSolo(moduleId);
    }
  }, [loadLayout, openModuleSolo]);

  // Helper: Get DockLocation from direction string
  const getDockLocation = useCallback((direction) => {
    switch (direction) {
      case 'left': return DockLocation.LEFT;
      case 'right': return DockLocation.RIGHT;
      case 'above':
      case 'up': return DockLocation.TOP;
      case 'below':
      case 'down': return DockLocation.BOTTOM;
      default: return DockLocation.RIGHT;
    }
  }, []);

  // Apply module-based ratios to all tabsets
  // Handles both width ratios (horizontal) and height ratios (vertical)
  const applyModuleBasedRatios = useCallback(() => {
    const root = model.getRoot();
    if (!root) return;

    // Helper: Get module layout config
    const getModuleLayout = (moduleId) => MODULE_LAYOUT[moduleId] || { widthRatio: 0.5, heightRatio: 0.5, row: 1 };

    // Helper: Apply width ratios to tabsets in a row
    const applyWidthRatios = (children) => {
      const tabsetsWithModules = [];
      children.forEach(child => {
        if (child.getType() === 'tabset') {
          const selectedTab = child.getSelectedNode();
          if (selectedTab) {
            const moduleId = selectedTab.getComponent();
            const layout = getModuleLayout(moduleId);
            tabsetsWithModules.push({ node: child, moduleId, ratio: layout.widthRatio });
          }
        }
      });

      if (tabsetsWithModules.length < 2) return;

      // Normalize ratios
      const totalRatio = tabsetsWithModules.reduce((sum, t) => sum + t.ratio, 0);
      tabsetsWithModules.forEach(t => {
        const weight = Math.round((t.ratio / totalRatio) * 100);
        model.doAction(Actions.updateNodeAttributes(t.node.getId(), { weight }));
        debug('FlexLayout', `Set ${t.moduleId} width weight to ${weight}`);
      });
    };

    // Helper: Apply height ratios to rows
    const applyHeightRatios = (rows) => {
      if (rows.length < 2) return;

      // Determine height ratio for each row based on its modules
      const rowHeights = rows.map(row => {
        // Find modules in this row
        let heightRatio = 0.5; // default
        row.getChildren().forEach(child => {
          if (child.getType() === 'tabset') {
            const selectedTab = child.getSelectedNode();
            if (selectedTab) {
              const moduleId = selectedTab.getComponent();
              const layout = getModuleLayout(moduleId);
              heightRatio = layout.heightRatio;
            }
          }
        });
        return { node: row, heightRatio };
      });

      // Apply height weights
      const totalHeight = rowHeights.reduce((sum, r) => sum + r.heightRatio, 0);
      rowHeights.forEach(r => {
        const weight = Math.round((r.heightRatio / totalHeight) * 100);
        model.doAction(Actions.updateNodeAttributes(r.node.getId(), { weight }));
        debug('FlexLayout', `Set row height weight to ${weight}`);
      });
    };

    // Process root children
    const children = root.getChildren();
    const rows = children.filter(c => c.getType() === 'row');
    const tabsets = children.filter(c => c.getType() === 'tabset');

    if (rows.length > 0) {
      // Vertical layout: multiple rows
      applyHeightRatios(rows);
      // Apply width ratios within each row
      rows.forEach(row => applyWidthRatios(row.getChildren()));
    } else if (tabsets.length > 0) {
      // Horizontal layout: just tabsets in root
      applyWidthRatios(tabsets);
    }

    debug('FlexLayout', 'Applied module-based ratios');
  }, [model]);

  // Swap active panel with panel in specified direction (Cmd+Arrow)
  // Moves the active tab past the target tabset, then applies module-based ratios
  const swapActivePanel = useCallback((direction) => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) {
      debug('FlexLayout', 'No active tabset');
      return;
    }

    const activeTab = activeTabset.getSelectedNode();
    if (!activeTab) {
      debug('FlexLayout', 'No active tab to swap');
      return;
    }

    // Find target tabset in direction
    const targetTabset = findTabsetInDirection(activeTabset, direction);
    if (!targetTabset) {
      debug('FlexLayout', 'No tabset found in direction:', direction);
      return;
    }

    // Move active tab past the target (in the direction pressed)
    // This creates: pressing Right on [A][B] -> [B][A]
    const dockLocation = getDockLocation(direction);
    model.doAction(Actions.moveNode(
      activeTab.getId(),
      targetTabset.getId(),
      dockLocation,
      -1,
      true
    ));

    // After the move, apply module-based ratios
    // Each module gets its default width ratio regardless of position
    setTimeout(() => {
      applyModuleBasedRatios();
    }, 50);

    debug('FlexLayout', 'Swapped panel', direction);
  }, [model, findTabsetInDirection, getDockLocation, applyModuleBasedRatios]);

  // Move active panel to new tabset in direction (Cmd+Alt+Arrow)
  const moveToNewTabset = useCallback((direction) => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) return;

    const activeTab = activeTabset.getSelectedNode();
    if (!activeTab) return;

    // Move to root in the specified direction (creates new tabset)
    const rootNode = model.getRoot();
    const dockLocation = getDockLocation(direction);
    model.doAction(Actions.moveNode(
      activeTab.getId(),
      rootNode.getId(),
      dockLocation,
      -1,
      true
    ));

    // Apply module-based ratios after the move
    setTimeout(() => {
      applyModuleBasedRatios();
    }, 50);

    debug('FlexLayout', 'Moved panel to new tabset', direction);
  }, [model, getDockLocation, applyModuleBasedRatios]);

  // Group active panel as tab with panel in direction (Cmd+Shift+Arrow)
  const groupAsTab = useCallback((direction) => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) return;

    const activeTab = activeTabset.getSelectedNode();
    if (!activeTab) return;

    // Find target tabset in direction
    const targetTabset = findTabsetInDirection(activeTabset, direction);
    if (!targetTabset) {
      debug('FlexLayout', 'No tabset found in direction:', direction);
      return;
    }

    // Move to target tabset as a tab (CENTER location = same tabset)
    model.doAction(Actions.moveNode(
      activeTab.getId(),
      targetTabset.getId(),
      DockLocation.CENTER,
      -1,
      true
    ));
    debug('FlexLayout', 'Grouped panel as tab in direction', direction);
  }, [model, findTabsetInDirection]);

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

    // Listen for menu commands
    const handleMenuCommand = async (command) => {
      debug('FlexLayout', 'Menu command:', command);

      switch (command) {
        // File commands
        case 'open-file': {
          // Use multi-file dialog (same as Cmd+O and + button)
          const filePaths = await window.ansiktenAPI?.invoke('open-multi-file-dialog');
          if (filePaths && filePaths.length > 0) {
            if (window.fileQueue?.add) {
              window.fileQueue.add(filePaths);
              setTimeout(() => window.fileQueue.start?.(), 100);
            } else {
              moduleAPI.emit('load-image', { imagePath: filePaths[0] });
            }
          }
          break;
        }

        // Layout template commands
        case 'layout-template-review':
        case 'layout-review':
          loadLayout('review');
          break;
        case 'layout-template-comparison':
        case 'layout-comparison':
          loadLayout('comparison');
          break;
        case 'layout-template-full-image':
          loadLayout('review');
          break;
        case 'layout-template-stats':
        case 'layout-database':
          loadLayout('database');
          break;
        case 'layout-review-with-logs':
          loadLayout('review-with-logs');
          break;
        case 'layout-full-review':
          loadLayout('full-review');
          break;
        case 'reset-layout':
          loadLayout('review');
          break;

        // Layout manipulation commands
        case 'layout-add-column':
          addTabset('column');
          break;
        case 'layout-remove-column':
          removeEmptyTabset();
          break;
        case 'layout-add-row':
          addTabset('row');
          break;
        case 'layout-remove-row':
          removeEmptyTabset();
          break;

        // Move to new column/row commands (Cmd+Alt+Arrow via menu)
        case 'layout-move-new-left':
          moveToNewTabset('left');
          break;
        case 'layout-move-new-right':
          moveToNewTabset('right');
          break;
        case 'layout-move-new-above':
          moveToNewTabset('above');
          break;
        case 'layout-move-new-below':
          moveToNewTabset('below');
          break;

        // Open module commands
        case 'open-image-viewer':
          openModule('image-viewer');
          break;
        case 'open-original-view':
          openModule('original-view');
          break;
        case 'open-log-viewer':
          openModule('log-viewer');
          break;
        case 'open-review-module':
          openModule('review-module');
          break;
        case 'open-statistics-dashboard':
          openModule('statistics-dashboard');
          break;
        case 'open-player-count':
          openModule('player-count');
          break;
        case 'open-culling':
          openModule('culling');
          break;
        case 'open-import':
          openModule('import');
          break;
        case 'open-rename-nef':
          openModule('rename-nef');
          break;
        case 'open-database-management':
          openModule('database-management');
          break;
        case 'open-refine-faces':
          openModule('refine-faces');
          break;
        case 'open-file-queue':
          openModule('file-queue');
          break;
        case 'open-theme-editor':
          openModule('theme-editor');
          break;
        case 'layout-queue-review':
          loadLayout('queue-review');
          break;

        case 'open-preferences':
          openModule('preferences');
          break;

        // Theme commands
        case 'theme-light':
          themeManager.setPreference('light');
          break;
        case 'theme-dark':
          themeManager.setPreference('dark');
          break;
        case 'theme-system':
          themeManager.setPreference('system');
          break;

        // View commands - broadcast to modules
        default:
          moduleAPI.emit(command, {});
      }
    };

    const offMenuCommand = window.ansiktenAPI.on('menu-command', handleMenuCommand);

    // CLI culling target (`ansikten culling DIR`): close the face-review panel
    // (culling is a different workflow — Review shouldn't sit in the layout
    // while culling) and open/focus the culling module as a tab, leaving every
    // OTHER open tab untouched. Then hand it the folder scope once it has
    // subscribed. Using waitForListeners avoids a lost-event race on a cold
    // start where the module hasn't mounted yet — same guard the
    // FileQueue→ImageViewer handshake uses for 'load-image'.
    const handleOpenCulling = async ({ roots, clear, recursive }) => {
      // Open culling FIRST so it docks into the still-valid active tabset.
      // Closing Review first could delete the active tabset, leaving openModule
      // with no host (getActiveTabset() → undefined) and silently dropping the
      // culling tab — so the order matters.
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
      offReviewDirty?.();
    };
  }, [ready, loadLayout, addTabset, removeEmptyTabset, openModule, closeModule, moduleAPI, moveToNewTabset]);

  // Expose workspace API globally for debugging
  useEffect(() => {
    if (!model) return;

    window.workspace = {
      model,
      layoutRef,
      openModule,
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
  }, [model, openModule, closePanel, loadLayout, addTabset, removeEmptyTabset, swapActivePanel, moveToNewTabset, groupAsTab, applyModuleBasedRatios, moduleAPI]);

  // NOTE: Auto-load from queue is handled by FileQueueModule, not here

  if (!model) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#666'
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
