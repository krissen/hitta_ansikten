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
 * Ensure a layout config carries an empty bottom border.
 *
 * The morphing engine parks keepMounted / dirty modules in a collapsed bottom
 * "background" border to preserve their live state across a step switch. Borders
 * only exist if declared at Model.fromJson time (there is no add-border Action),
 * so every model the workspace builds is passed through this first. An empty
 * border is invisible (FlexLayout renders a border strip only once it has tabs),
 * so this is inert until something is parked.
 *
 * @param {object} config - FlexLayout JSON configuration
 * @returns {object} the config with a bottom border guaranteed
 */
export function ensureBottomBorder(config) {
  const borders = Array.isArray(config.borders) ? config.borders : [];
  if (borders.some((b) => b.location === 'bottom')) return config;
  return {
    ...config,
    borders: [...borders, { type: 'border', location: 'bottom', children: [] }],
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
