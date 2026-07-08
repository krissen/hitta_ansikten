/**
 * FlexLayout Default Layouts
 *
 * Predefined layout templates for common workspace configurations.
 * Uses FlexLayout's JSON format: Row -> TabSet -> Tab hierarchy.
 */

import { t } from '../../../i18n/index.js';

/**
 * Default review layout: Review panel (15%) | Image Viewer (85%)
 */
export const reviewLayout = {
  global: {
    tabEnableClose: true,
    tabSetEnableMaximize: true,
    tabSetEnableDrag: true,
    tabSetEnableDrop: true,
    tabSetMinWidth: 100,
    tabSetMinHeight: 100,
    borderMinSize: 100,
    splitterSize: 4,
    enableEdgeDock: true,
    tabEnableRenderOnDemand: true  // Unmount hidden tabs to save CPU
  },
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'tabset',
        weight: 15,
        children: [
          {
            type: 'tab',
            name: t('modules.review-module'),
            component: 'review-module',
            enableRenderOnDemand: false,
            config: { moduleId: 'review-module' }
          }
        ]
      },
      {
        type: 'tabset',
        weight: 85,
        children: [
          {
            type: 'tab',
            name: t('modules.image-viewer'),
            component: 'image-viewer',
            config: { moduleId: 'image-viewer' }
          }
        ]
      }
    ]
  }
};

/**
 * Review with logs layout: Review | Image Viewer on top, Log Viewer full-width below
 *
 * ┌─────────┬─────────────┐
 * │ Review  │ ImageViewer │  (horizontal row, 15/85)
 * ├─────────┴─────────────┤
 * │   LogViewer (full)    │  (tabset, 100% width)
 * └───────────────────────┘
 */
export const reviewWithLogsLayout = {
  global: {
    tabEnableClose: true,
    tabSetEnableMaximize: true,
    tabSetEnableDrag: true,
    tabSetEnableDrop: true,
    tabSetMinWidth: 100,
    tabSetMinHeight: 100,
    borderMinSize: 100,
    splitterSize: 4,
    enableEdgeDock: true,
    tabEnableRenderOnDemand: true  // Unmount hidden tabs to save CPU
  },
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'row',
        weight: 80,
        children: [
          {
            type: 'tabset',
            weight: 15,
            children: [
              {
                type: 'tab',
                name: t('modules.review-module'),
                component: 'review-module',
                config: { moduleId: 'review-module' }
              }
            ]
          },
          {
            type: 'tabset',
            weight: 85,
            children: [
              {
                type: 'tab',
                name: t('modules.image-viewer'),
                component: 'image-viewer',
                config: { moduleId: 'image-viewer' }
              }
            ]
          }
        ]
      },
      {
        type: 'tabset',
        weight: 20,
        children: [
          {
            type: 'tab',
            name: t('modules.log-viewer'),
            component: 'log-viewer',
            config: { moduleId: 'log-viewer' }
          }
        ]
      }
    ]
  }
};

/**
 * Comparison layout: Image Viewer | Original View
 */
export const comparisonLayout = {
  global: {
    tabEnableClose: true,
    tabSetEnableMaximize: true,
    tabSetEnableDrag: true,
    tabSetEnableDrop: true,
    tabSetMinWidth: 100,
    tabSetMinHeight: 100,
    borderMinSize: 100,
    splitterSize: 4,
    enableEdgeDock: true,
    tabEnableRenderOnDemand: true  // Unmount hidden tabs to save CPU
  },
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'tabset',
        weight: 50,
        children: [
          {
            type: 'tab',
            name: t('modules.image-viewer'),
            component: 'image-viewer',
            config: { moduleId: 'image-viewer' }
          }
        ]
      },
      {
        type: 'tabset',
        weight: 50,
        children: [
          {
            type: 'tab',
            name: t('modules.original-view'),
            component: 'original-view',
            config: { moduleId: 'original-view' }
          }
        ]
      }
    ]
  }
};

/**
 * Full review layout: Review | Image Viewer on top, Original | Log Viewer below
 *
 * ┌─────────┬─────────────┐
 * │ Review  │ ImageViewer │
 * ├─────────┼─────────────┤
 * │Original │  LogViewer  │
 * └─────────┴─────────────┘
 */
export const fullReviewLayout = {
  global: {
    tabEnableClose: true,
    tabSetEnableMaximize: true,
    tabSetEnableDrag: true,
    tabSetEnableDrop: true,
    tabSetMinWidth: 100,
    tabSetMinHeight: 100,
    borderMinSize: 100,
    splitterSize: 4,
    enableEdgeDock: true,
    tabEnableRenderOnDemand: true  // Unmount hidden tabs to save CPU
  },
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'row',
        weight: 70,
        children: [
          {
            type: 'tabset',
            weight: 15,
            children: [
              {
                type: 'tab',
                name: t('modules.review-module'),
                component: 'review-module',
                config: { moduleId: 'review-module' }
              }
            ]
          },
          {
            type: 'tabset',
            weight: 85,
            children: [
              {
                type: 'tab',
                name: t('modules.image-viewer'),
                component: 'image-viewer',
                config: { moduleId: 'image-viewer' }
              }
            ]
          }
        ]
      },
      {
        type: 'row',
        weight: 30,
        children: [
          {
            type: 'tabset',
            weight: 40,
            children: [
              {
                type: 'tab',
                name: t('modules.original-view'),
                component: 'original-view',
                config: { moduleId: 'original-view' }
              }
            ]
          },
          {
            type: 'tabset',
            weight: 60,
            children: [
              {
                type: 'tab',
                name: t('modules.log-viewer'),
                component: 'log-viewer',
                config: { moduleId: 'log-viewer' }
              }
            ]
          }
        ]
      }
    ]
  }
};

/**
 * Queue review layout: File Queue | Review | Image Viewer
 *
 * ┌──────────┬─────────┬─────────────┐
 * │FileQueue │ Review  │ ImageViewer │
 * │  (15%)   │ (15%)   │   (70%)     │
 * └──────────┴─────────┴─────────────┘
 */
export const queueReviewLayout = {
  global: {
    tabEnableClose: true,
    tabSetEnableMaximize: true,
    tabSetEnableDrag: true,
    tabSetEnableDrop: true,
    tabSetMinWidth: 100,
    tabSetMinHeight: 100,
    borderMinSize: 100,
    splitterSize: 4,
    enableEdgeDock: true,
    tabEnableRenderOnDemand: true  // Unmount hidden tabs to save CPU
  },
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'tabset',
        weight: 15,
        children: [
          {
            type: 'tab',
            name: t('modules.file-queue'),
            component: 'file-queue',
            enableRenderOnDemand: false,
            config: { moduleId: 'file-queue' }
          }
        ]
      },
      {
        type: 'tabset',
        weight: 15,
        children: [
          {
            type: 'tab',
            name: t('modules.review-module'),
            component: 'review-module',
            enableRenderOnDemand: false,
            config: { moduleId: 'review-module' }
          }
        ]
      },
      {
        type: 'tabset',
        weight: 70,
        children: [
          {
            type: 'tab',
            name: t('modules.image-viewer'),
            component: 'image-viewer',
            config: { moduleId: 'image-viewer' }
          }
        ]
      }
    ]
  }
};

/**
 * Database management layout
 */
export const databaseLayout = {
  global: {
    tabEnableClose: true,
    tabSetEnableMaximize: true,
    tabSetEnableDrag: true,
    tabSetEnableDrop: true,
    tabSetMinWidth: 100,
    tabSetMinHeight: 100,
    borderMinSize: 100,
    splitterSize: 4,
    enableEdgeDock: true,
    tabEnableRenderOnDemand: true  // Unmount hidden tabs to save CPU
  },
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'tabset',
        weight: 30,
        children: [
          {
            type: 'tab',
            name: t('modules.database-management'),
            component: 'database-management',
            config: { moduleId: 'database-management' }
          }
        ]
      },
      {
        type: 'tabset',
        weight: 70,
        children: [
          {
            type: 'tab',
            name: t('modules.statistics-dashboard'),
            component: 'statistics-dashboard',
            config: { moduleId: 'statistics-dashboard' }
          }
        ]
      }
    ]
  }
};

/**
 * Single-module layout: one full-width tabset holding just the given module.
 * Used for self-contained workflow modules (culling, player-count, import,
 * rename-nef) opened from the landing page so they fill the workspace instead
 * of docking beside the Review panel.
 * @param {string} moduleId - Module component id
 * @param {string} [title] - Tab title (defaults to moduleId)
 * @returns {object} FlexLayout JSON configuration
 */
export function singleModuleLayout(moduleId, title) {
  return {
    global: {
      tabEnableClose: true,
      tabSetEnableMaximize: true,
      tabSetEnableDrag: true,
      tabSetEnableDrop: true,
      tabSetMinWidth: 100,
      tabSetMinHeight: 100,
      borderMinSize: 100,
      splitterSize: 4,
      enableEdgeDock: true,
      tabEnableRenderOnDemand: true
    },
    layout: {
      type: 'row',
      weight: 100,
      children: [
        {
          type: 'tabset',
          weight: 100,
          children: [
            {
              type: 'tab',
              name: title || moduleId,
              component: moduleId,
              enableRenderOnDemand: false,
              config: { moduleId }
            }
          ]
        }
      ]
    }
  };
}

/**
 * Get layout by name
 * @param {string} name - Layout name
 * @returns {object} FlexLayout JSON configuration
 */
export function getLayoutByName(name) {
  const layouts = {
    'review': reviewLayout,
    'review-with-logs': reviewWithLogsLayout,
    'comparison': comparisonLayout,
    'full-review': fullReviewLayout,
    'queue-review': queueReviewLayout,
    'database': databaseLayout
  };

  return layouts[name] || reviewLayout;
}

/**
 * Available layout names
 */
export const layoutNames = [
  'review',
  'review-with-logs',
  'comparison',
  'full-review',
  'queue-review',
  'database'
];

export default {
  reviewLayout,
  reviewWithLogsLayout,
  comparisonLayout,
  fullReviewLayout,
  queueReviewLayout,
  databaseLayout,
  getLayoutByName,
  layoutNames
};
