/**
 * Layout geometry helpers for the FlexLayout workspace.
 *
 * These operate on a FlexLayout model (and, where DOM position is needed, a
 * ref to the Layout element) to locate tabsets, find neighbours in a
 * direction, apply module-based size ratios, and move/swap/group the active
 * panel. Extracted from FlexLayoutWorkspace as plain functions so they can be
 * unit-tested with fake models/rects; the workspace wraps them in useCallback.
 */

import { Actions, DockLocation } from 'flexlayout-react';
import { debug } from '../../shared/debug.js';

// Module-specific default layout ratios
// widthRatio: proportion of row width (horizontal split)
// heightRatio: proportion when in a secondary row (vertical split)
// row: default row (1 = primary/top, 2 = secondary/bottom)
export const MODULE_LAYOUT = {
  'review-module': {
    widthRatio: 0.15, // 15% width in its row
    heightRatio: 0.7, // Primary row gets 70% height
    row: 1,
  },
  'image-viewer': {
    widthRatio: 0.85, // 85% width in its row
    heightRatio: 0.7, // Primary row gets 70% height
    row: 1,
  },
  'original-view': {
    widthRatio: 0.5, // 50% when sharing row
    heightRatio: 0.7, // Primary row
    row: 1,
  },
  'log-viewer': {
    widthRatio: 0.5, // 50% when sharing row with stats
    heightRatio: 0.3, // Secondary row gets 30% height
    row: 2,
  },
  'statistics-dashboard': {
    widthRatio: 0.5, // 50% when sharing row with log
    heightRatio: 0.3, // Secondary row gets 30% height
    row: 2,
  },
  'database-management': {
    widthRatio: 0.5, // 50% when sharing row
    heightRatio: 0.3, // Secondary row
    row: 2,
  },
  'file-queue': {
    widthRatio: 0.15, // 15% width in sidebar
    heightRatio: 0.7, // Primary row
    row: 1,
  },
  'theme-editor': {
    widthRatio: 0.5, // 50% when sharing row
    heightRatio: 0.7, // Primary row
    row: 1,
  },
  'player-count': {
    widthRatio: 0.5, // 50% when sharing row
    heightRatio: 0.7, // Primary row
    row: 1,
  },
  culling: {
    widthRatio: 0.7, // wide - it holds list + image side by side
    heightRatio: 0.7, // Primary row
    row: 1,
  },
  trash: {
    widthRatio: 1.0, // full pane - a simple list view
    heightRatio: 0.7, // Primary row
    row: 1,
  },
  import: {
    widthRatio: 0.4, // compact form
    heightRatio: 0.7, // Primary row
    row: 1,
  },
  'rename-nef': {
    widthRatio: 0.5, // preview table
    heightRatio: 0.7, // Primary row
    row: 1,
  },
};

// Helper: Get DockLocation from direction string
export function getDockLocation(direction) {
  switch (direction) {
    case 'left':
      return DockLocation.LEFT;
    case 'right':
      return DockLocation.RIGHT;
    case 'above':
    case 'up':
      return DockLocation.TOP;
    case 'below':
    case 'down':
      return DockLocation.BOTTOM;
    default:
      return DockLocation.RIGHT;
  }
}

// Get tabset position in layout (using bounding rect)
export function getTabsetPosition(model, layoutRef, tabset) {
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
          rect,
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

    const tabsetIndex = tabsets.findIndex((ts) => ts.getId() === tabsetId);
    if (tabsetIndex >= 0 && tabsetIndex < allElements.length) {
      const element = allElements[tabsetIndex];
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect,
      };
    }
  }

  return { x: 0, y: 0 };
}

// Find tabset in direction based on position
export function findTabsetInDirection(model, layoutRef, fromTabset, direction) {
  const tabsets = [];
  model.visitNodes((node) => {
    if (node.getType() === 'tabset') {
      tabsets.push(node);
    }
  });

  if (tabsets.length < 2) return null;

  const fromPos = getTabsetPosition(model, layoutRef, fromTabset);

  // Filter tabsets in the specified direction
  const candidates = tabsets.filter((ts) => {
    if (ts.getId() === fromTabset.getId()) return false;
    const pos = getTabsetPosition(model, layoutRef, ts);

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
    const posA = getTabsetPosition(model, layoutRef, a);
    const posB = getTabsetPosition(model, layoutRef, b);
    const distA = Math.sqrt(
      Math.pow(posA.x - fromPos.x, 2) + Math.pow(posA.y - fromPos.y, 2),
    );
    const distB = Math.sqrt(
      Math.pow(posB.x - fromPos.x, 2) + Math.pow(posB.y - fromPos.y, 2),
    );
    return distA - distB;
  });

  return candidates[0];
}

// Apply module-based ratios to all tabsets
// Handles both width ratios (horizontal) and height ratios (vertical)
export function applyModuleBasedRatios(model) {
  const root = model.getRoot();
  if (!root) return;

  // Helper: Get module layout config
  const getModuleLayout = (moduleId) =>
    MODULE_LAYOUT[moduleId] || { widthRatio: 0.5, heightRatio: 0.5, row: 1 };

  // Helper: Apply width ratios to tabsets in a row
  const applyWidthRatios = (children) => {
    const tabsetsWithModules = [];
    children.forEach((child) => {
      if (child.getType() === 'tabset') {
        const selectedTab = child.getSelectedNode();
        if (selectedTab) {
          const moduleId = selectedTab.getComponent();
          const layout = getModuleLayout(moduleId);
          tabsetsWithModules.push({
            node: child,
            moduleId,
            ratio: layout.widthRatio,
          });
        }
      }
    });

    if (tabsetsWithModules.length < 2) return;

    // Normalize ratios
    const totalRatio = tabsetsWithModules.reduce((sum, t) => sum + t.ratio, 0);
    tabsetsWithModules.forEach((t) => {
      const weight = Math.round((t.ratio / totalRatio) * 100);
      model.doAction(Actions.updateNodeAttributes(t.node.getId(), { weight }));
      debug('FlexLayout', `Set ${t.moduleId} width weight to ${weight}`);
    });
  };

  // Helper: Apply height ratios to rows
  const applyHeightRatios = (rows) => {
    if (rows.length < 2) return;

    // Determine height ratio for each row based on its modules
    const rowHeights = rows.map((row) => {
      // Find modules in this row
      let heightRatio = 0.5; // default
      row.getChildren().forEach((child) => {
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
    rowHeights.forEach((r) => {
      const weight = Math.round((r.heightRatio / totalHeight) * 100);
      model.doAction(Actions.updateNodeAttributes(r.node.getId(), { weight }));
      debug('FlexLayout', `Set row height weight to ${weight}`);
    });
  };

  // Process root children
  const children = root.getChildren();
  const rows = children.filter((c) => c.getType() === 'row');
  const tabsets = children.filter((c) => c.getType() === 'tabset');

  if (rows.length > 0) {
    // Vertical layout: multiple rows
    applyHeightRatios(rows);
    // Apply width ratios within each row
    rows.forEach((row) => applyWidthRatios(row.getChildren()));
  } else if (tabsets.length > 0) {
    // Horizontal layout: just tabsets in root
    applyWidthRatios(tabsets);
  }

  debug('FlexLayout', 'Applied module-based ratios');
}

// Swap active panel with panel in specified direction (Cmd+Arrow)
// Moves the active tab past the target tabset, then applies module-based ratios
export function swapActivePanel(model, layoutRef, direction) {
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
  const targetTabset = findTabsetInDirection(
    model,
    layoutRef,
    activeTabset,
    direction,
  );
  if (!targetTabset) {
    debug('FlexLayout', 'No tabset found in direction:', direction);
    return;
  }

  // Move active tab past the target (in the direction pressed)
  // This creates: pressing Right on [A][B] -> [B][A]
  const dockLocation = getDockLocation(direction);
  model.doAction(
    Actions.moveNode(
      activeTab.getId(),
      targetTabset.getId(),
      dockLocation,
      -1,
      true,
    ),
  );

  // After the move, apply module-based ratios
  // Each module gets its default width ratio regardless of position
  setTimeout(() => {
    applyModuleBasedRatios(model);
  }, 50);

  debug('FlexLayout', 'Swapped panel', direction);
}

// Move active panel to new tabset in direction (Cmd+Alt+Arrow)
export function moveToNewTabset(model, direction) {
  const activeTabset = model.getActiveTabset();
  if (!activeTabset) return;

  const activeTab = activeTabset.getSelectedNode();
  if (!activeTab) return;

  // Move to root in the specified direction (creates new tabset)
  const rootNode = model.getRoot();
  const dockLocation = getDockLocation(direction);
  model.doAction(
    Actions.moveNode(
      activeTab.getId(),
      rootNode.getId(),
      dockLocation,
      -1,
      true,
    ),
  );

  // Apply module-based ratios after the move
  setTimeout(() => {
    applyModuleBasedRatios(model);
  }, 50);

  debug('FlexLayout', 'Moved panel to new tabset', direction);
}

// Group active panel as tab with panel in direction (Cmd+Shift+Arrow)
export function groupAsTab(model, layoutRef, direction) {
  const activeTabset = model.getActiveTabset();
  if (!activeTabset) return;

  const activeTab = activeTabset.getSelectedNode();
  if (!activeTab) return;

  // Find target tabset in direction
  const targetTabset = findTabsetInDirection(
    model,
    layoutRef,
    activeTabset,
    direction,
  );
  if (!targetTabset) {
    debug('FlexLayout', 'No tabset found in direction:', direction);
    return;
  }

  // Move to target tabset as a tab (CENTER location = same tabset)
  model.doAction(
    Actions.moveNode(
      activeTab.getId(),
      targetTabset.getId(),
      DockLocation.CENTER,
      -1,
      true,
    ),
  );
  debug('FlexLayout', 'Grouped panel as tab in direction', direction);
}
