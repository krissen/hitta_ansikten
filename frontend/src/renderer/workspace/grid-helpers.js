/**
 * Grid Helpers
 *
 * Provides directional navigation and layout manipulation helpers
 * for the Dockview workspace grid.
 */

import { debug, debugWarn, debugError } from '../shared/debug.js';

/**
 * Find the nearest group in a specific direction from the given group
 * @param {DockviewComponent} dockview - Dockview instance
 * @param {DockviewGroupPanel} fromGroup - Starting group
 * @param {string} direction - Direction: 'left', 'right', 'above', 'below'
 * @returns {DockviewGroupPanel|null} Nearest group in direction, or null
 */
export function findGroupInDirection(dockview, fromGroup, direction) {
  if (!fromGroup || !fromGroup.element) return null;

  const groups = dockview.groups;
  if (groups.length < 2) return null;

  const fromRect = fromGroup.element.getBoundingClientRect();

  // Filter groups that are in the specified direction
  const candidates = groups.filter(g => {
    if (g === fromGroup) return false;
    if (!g.element) return false;

    const rect = g.element.getBoundingClientRect();

    switch (direction) {
      case 'left':
        // Group is to the left if its right edge is at or before our left edge
        return rect.right <= fromRect.left + 5; // 5px tolerance
      case 'right':
        // Group is to the right if its left edge is at or after our right edge
        return rect.left >= fromRect.right - 5;
      case 'above':
        // Group is above if its bottom edge is at or before our top edge
        return rect.bottom <= fromRect.top + 5;
      case 'below':
        // Group is below if its top edge is at or after our bottom edge
        return rect.top >= fromRect.bottom - 5;
      default:
        return false;
    }
  });

  if (candidates.length === 0) return null;

  // Sort by distance to find nearest
  const sorted = sortByDistance(candidates, fromRect, direction);
  return sorted[0] || null;
}

/**
 * Sort groups by distance from reference rect in given direction
 * @param {DockviewGroupPanel[]} groups - Groups to sort
 * @param {DOMRect} fromRect - Reference rectangle
 * @param {string} direction - Direction for sorting
 * @returns {DockviewGroupPanel[]} Sorted groups (nearest first)
 */
function sortByDistance(groups, fromRect, direction) {
  const fromCenterX = fromRect.left + fromRect.width / 2;
  const fromCenterY = fromRect.top + fromRect.height / 2;

  return groups.sort((a, b) => {
    const rectA = a.element.getBoundingClientRect();
    const rectB = b.element.getBoundingClientRect();

    const centerAX = rectA.left + rectA.width / 2;
    const centerAY = rectA.top + rectA.height / 2;
    const centerBX = rectB.left + rectB.width / 2;
    const centerBY = rectB.top + rectB.height / 2;

    // Primary: distance in the direction of movement
    // Secondary: perpendicular alignment (prefer aligned groups)
    switch (direction) {
      case 'left':
      case 'right': {
        // Primary: horizontal distance
        const distA = Math.abs(centerAX - fromCenterX);
        const distB = Math.abs(centerBX - fromCenterX);
        if (Math.abs(distA - distB) > 10) return distA - distB;
        // Secondary: vertical alignment
        return Math.abs(centerAY - fromCenterY) - Math.abs(centerBY - fromCenterY);
      }
      case 'above':
      case 'below': {
        // Primary: vertical distance
        const distA = Math.abs(centerAY - fromCenterY);
        const distB = Math.abs(centerBY - fromCenterY);
        if (Math.abs(distA - distB) > 10) return distA - distB;
        // Secondary: horizontal alignment
        return Math.abs(centerAX - fromCenterX) - Math.abs(centerBX - fromCenterX);
      }
      default:
        return 0;
    }
  });
}

/**
 * Get all groups in a specific direction (not just nearest)
 * @param {DockviewComponent} dockview - Dockview instance
 * @param {DockviewGroupPanel} fromGroup - Starting group
 * @param {string} direction - Direction
 * @returns {DockviewGroupPanel[]} All groups in direction, sorted by distance
 */
export function getAllGroupsInDirection(dockview, fromGroup, direction) {
  if (!fromGroup || !fromGroup.element) return [];

  const groups = dockview.groups;
  const fromRect = fromGroup.element.getBoundingClientRect();

  const candidates = groups.filter(g => {
    if (g === fromGroup) return false;
    if (!g.element) return false;

    const rect = g.element.getBoundingClientRect();

    switch (direction) {
      case 'left':
        return rect.right <= fromRect.left + 5;
      case 'right':
        return rect.left >= fromRect.right - 5;
      case 'above':
        return rect.bottom <= fromRect.top + 5;
      case 'below':
        return rect.top >= fromRect.bottom - 5;
      default:
        return false;
    }
  });

  return sortByDistance(candidates, fromRect, direction);
}

/**
 * Add a new empty column (group) to the right of active group
 * @param {DockviewComponent} dockview - Dockview instance
 * @returns {DockviewGroupPanel|null} The new group, or null if failed
 */
export function addColumn(dockview) {
  const activeGroup = dockview.activeGroup;
  if (!activeGroup) {
    // No active group, add to the right edge
    return dockview.addGroup({ direction: 'right' });
  }

  return dockview.addGroup({
    referenceGroup: activeGroup,
    direction: 'right'
  });
}

/**
 * Add a new empty row (group) below active group
 * @param {DockviewComponent} dockview - Dockview instance
 * @returns {DockviewGroupPanel|null} The new group, or null if failed
 */
export function addRow(dockview) {
  const activeGroup = dockview.activeGroup;
  if (!activeGroup) {
    // No active group, add to the bottom
    return dockview.addGroup({ direction: 'below' });
  }

  return dockview.addGroup({
    referenceGroup: activeGroup,
    direction: 'below'
  });
}

/**
 * Remove the active group if empty, or confirm with user if has panels
 * @param {DockviewComponent} dockview - Dockview instance
 * @param {boolean} force - Force remove even if has panels
 * @returns {boolean} True if removed, false otherwise
 */
export function removeActiveGroup(dockview, force = false) {
  const activeGroup = dockview.activeGroup;
  if (!activeGroup) return false;

  // Don't remove last group
  if (dockview.groups.length <= 1) {
    debugWarn('FlexLayout', 'Cannot remove last group');
    return false;
  }

  // Check if group has panels
  if (activeGroup.panels.length > 0 && !force) {
    const confirmed = confirm(
      `This group has ${activeGroup.panels.length} panel(s). Remove anyway?`
    );
    if (!confirmed) return false;
  }

  // Close all panels in group first
  const panels = [...activeGroup.panels];
  panels.forEach(panel => {
    dockview.removePanel(panel);
  });

  // Remove the group
  dockview.removeGroup(activeGroup);
  return true;
}

/**
 * Get the approximate grid position of a group
 * @param {DockviewComponent} dockview - Dockview instance
 * @param {DockviewGroupPanel} group - Target group
 * @returns {{row: number, col: number}} Grid position (0-indexed)
 */
export function getGroupPosition(dockview, group) {
  if (!group || !group.element) return { row: 0, col: 0 };

  const groups = dockview.groups;
  const targetRect = group.element.getBoundingClientRect();

  // Count groups to the left and above
  let col = 0;
  let row = 0;

  groups.forEach(g => {
    if (g === group || !g.element) return;
    const rect = g.element.getBoundingClientRect();

    // Group is to the left if its center is left of our left edge
    if (rect.left + rect.width / 2 < targetRect.left) {
      col++;
    }

    // Group is above if its center is above our top edge
    if (rect.top + rect.height / 2 < targetRect.top) {
      row++;
    }
  });

  return { row, col };
}

/**
 * Count columns and rows in current layout
 * @param {DockviewComponent} dockview - Dockview instance
 * @returns {{columns: number, rows: number}} Layout dimensions
 */
export function getLayoutDimensions(dockview) {
  const groups = dockview.groups;
  if (groups.length === 0) return { columns: 0, rows: 0 };

  // Get unique X and Y positions
  const xPositions = new Set();
  const yPositions = new Set();

  groups.forEach(g => {
    if (!g.element) return;
    const rect = g.element.getBoundingClientRect();
    // Round to avoid floating point issues
    xPositions.add(Math.round(rect.left));
    yPositions.add(Math.round(rect.top));
  });

  return {
    columns: xPositions.size,
    rows: yPositions.size
  };
}

/**
 * Navigate focus to group in direction
 * @param {DockviewComponent} dockview - Dockview instance
 * @param {string} direction - Direction: 'left', 'right', 'above', 'below'
 * @returns {boolean} True if navigation successful
 */
export function navigateInDirection(dockview, direction) {
  const activeGroup = dockview.activeGroup;
  if (!activeGroup) return false;

  const targetGroup = findGroupInDirection(dockview, activeGroup, direction);
  if (!targetGroup) return false;

  // Focus the first panel in target group, or the group itself if empty
  const targetPanel = targetGroup.activePanel || targetGroup.panels[0];
  if (targetPanel) {
    targetPanel.api.setActive();
    return true;
  }

  // Empty group - focus the group directly
  if (targetGroup.api && typeof targetGroup.api.setActive === 'function') {
    targetGroup.api.setActive();
    return true;
  }

  // Fallback: try to focus the group element
  if (targetGroup.element) {
    targetGroup.element.focus();
    return true;
  }

  return false;
}
