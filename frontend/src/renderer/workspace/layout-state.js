/**
 * Layout State Tracker
 *
 * Tracks layout state and ratios for smart panel add/remove behavior.
 * Enables tiling window manager-like ratio preservation.
 */

export class LayoutStateTracker {
  constructor() {
    this.ratioHistory = [];      // Stack of previous ratio states
    this.maxHistorySize = 10;    // Limit history to prevent memory issues
  }

  /**
   * Capture current layout ratios before a layout change
   * @param {DockviewComponent} dockview - Dockview instance
   */
  captureState(dockview) {
    try {
      const layout = dockview.toJSON();
      if (!layout.grid || !layout.grid.root) {
        console.warn('[LayoutState] No grid root found');
        return;
      }

      const state = {
        timestamp: Date.now(),
        ratios: this.extractRatios(layout.grid.root),
        groupCount: dockview.groups.length
      };

      this.ratioHistory.push(state);

      // Trim history if needed
      if (this.ratioHistory.length > this.maxHistorySize) {
        this.ratioHistory.shift();
      }

      console.log('[LayoutState] Captured state:', state.ratios);
    } catch (err) {
      console.error('[LayoutState] Failed to capture state:', err);
    }
  }

  /**
   * Get the most recent captured state
   * @returns {object|null} Previous state or null
   */
  getLastState() {
    return this.ratioHistory.length > 0
      ? this.ratioHistory[this.ratioHistory.length - 1]
      : null;
  }

  /**
   * Pop and return the most recent state (for restoration)
   * @returns {object|null} Previous state or null
   */
  popState() {
    return this.ratioHistory.pop() || null;
  }

  /**
   * Extract ratios from a grid tree node
   * @param {object} node - Grid tree node
   * @param {string} path - Current path in tree (for debugging)
   * @returns {object} Ratio information
   */
  extractRatios(node, path = 'root') {
    if (!node) return null;

    if (node.type === 'branch') {
      // This is a split container
      const children = node.data || [];
      const totalSize = children.reduce((sum, child) => sum + (child.size || 1), 0);

      return {
        type: 'branch',
        direction: node.direction || 'row',
        children: children.map((child, i) => ({
          size: child.size || 1,
          ratio: (child.size || 1) / totalSize,
          content: this.extractRatios(child, `${path}.${i}`)
        }))
      };
    } else if (node.type === 'leaf') {
      // This is a group (leaf node)
      return {
        type: 'leaf',
        size: node.size || 1,
        groupId: node.data?.id || null
      };
    }

    return null;
  }

  /**
   * Apply saved ratios to current layout
   * @param {DockviewComponent} dockview - Dockview instance
   * @param {object} savedRatios - Previously saved ratios
   */
  applyRatios(dockview, savedRatios) {
    try {
      const layout = dockview.toJSON();
      if (!layout.grid || !layout.grid.root) {
        console.warn('[LayoutState] No grid root for ratio application');
        return;
      }

      // Apply ratios to the layout tree
      this.applyRatiosToNode(layout.grid.root, savedRatios);

      // Restore the modified layout
      dockview.fromJSON(layout);
      console.log('[LayoutState] Applied ratios');
    } catch (err) {
      console.error('[LayoutState] Failed to apply ratios:', err);
    }
  }

  /**
   * Recursively apply ratios to a layout tree node
   * @param {object} node - Current layout node
   * @param {object} savedNode - Corresponding saved ratio node
   */
  applyRatiosToNode(node, savedNode) {
    if (!node || !savedNode) return;

    if (node.type === 'branch' && savedNode.type === 'branch') {
      const children = node.data || [];
      const savedChildren = savedNode.children || [];

      // Match children by position and apply sizes
      const minLen = Math.min(children.length, savedChildren.length);
      for (let i = 0; i < minLen; i++) {
        if (savedChildren[i].size) {
          children[i].size = savedChildren[i].size;
        }
        if (savedChildren[i].content) {
          this.applyRatiosToNode(children[i], savedChildren[i].content);
        }
      }
    }
  }

  /**
   * Restore ratios after a panel was removed
   * Uses the last captured state to restore sibling ratios
   * @param {DockviewComponent} dockview - Dockview instance
   */
  restoreRatiosAfterRemove(dockview) {
    const lastState = this.popState();
    if (!lastState) {
      console.log('[LayoutState] No previous state to restore');
      return;
    }

    // Only restore if we're going from more groups to fewer
    if (dockview.groups.length >= lastState.groupCount) {
      console.log('[LayoutState] Group count increased, not restoring');
      return;
    }

    this.applyRatios(dockview, lastState.ratios);
  }

  /**
   * Calculate new sizes when adding a panel to preserve existing ratios
   * New panel "takes from" its reference panel proportionally
   * @param {DockviewComponent} dockview - Dockview instance
   * @param {string} referenceGroupId - Group ID of the reference panel
   * @param {number} newPanelRatio - Ratio for new panel (0-1, relative to reference)
   * @returns {object} Layout with adjusted sizes
   */
  calculateSizesForAdd(dockview, referenceGroupId, newPanelRatio = 0.5) {
    const layout = dockview.toJSON();
    if (!layout.grid || !layout.grid.root) return layout;

    // Find the reference group in the tree and calculate new sizes
    this.adjustSizesForAdd(layout.grid.root, referenceGroupId, newPanelRatio);

    return layout;
  }

  /**
   * Recursively adjust sizes for a new panel addition
   * @param {object} node - Current node
   * @param {string} referenceGroupId - Reference group ID
   * @param {number} ratio - Ratio for new panel
   * @returns {boolean} True if reference was found and adjusted
   */
  adjustSizesForAdd(node, referenceGroupId, ratio) {
    if (!node) return false;

    if (node.type === 'branch') {
      const children = node.data || [];

      for (let i = 0; i < children.length; i++) {
        const child = children[i];

        // Check if this is the reference group
        if (child.type === 'leaf' && child.data?.id === referenceGroupId) {
          // Found it - the new panel will take 'ratio' of this panel's size
          // After split, original gets (1-ratio) and new gets (ratio)
          const originalSize = child.size || 1;
          child.size = Math.floor(originalSize * (1 - ratio));
          // New panel will be added with size = floor(originalSize * ratio)
          console.log(`[LayoutState] Adjusted reference group size: ${originalSize} -> ${child.size}`);
          return true;
        }

        // Recurse into branches
        if (child.type === 'branch') {
          if (this.adjustSizesForAdd(child, referenceGroupId, ratio)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Get current layout ratios as a simple object for debugging
   * @param {DockviewComponent} dockview - Dockview instance
   * @returns {object} Current ratios
   */
  getCurrentRatios(dockview) {
    const layout = dockview.toJSON();
    if (!layout.grid || !layout.grid.root) return null;
    return this.extractRatios(layout.grid.root);
  }

  /**
   * Clear all history
   */
  clearHistory() {
    this.ratioHistory = [];
    console.log('[LayoutState] History cleared');
  }
}
