/**
 * Module registry - declarative catalog of the workspace modules.
 *
 * Single source of truth for "which modules exist" in the FlexLayout workspace,
 * and for their placement/behavior metadata. Each entry describes one module:
 *
 *   component    React component rendered for the module.
 *   role         Where a freshly-opened tab docks by default:
 *                  'main'   — the main working area (largest tabset).
 *                  'side'   — a narrow side column (file queue, review).
 *                  'bottom' — a bar under the main area (logs).
 *   weight       Optional preferred tabset weight for the role (metadata; used
 *                by later placement/sizing work, not by this module yet).
 *   singleton    Only one instance allowed; opening focuses the existing tab.
 *                Defaults to true — set false to allow multiple instances.
 *   solo         Self-contained workspace view that fills the workspace when
 *                opened as a workflow step (metadata for the landing/workflow
 *                wiring; no behavior here).
 *   step         Workflow-step id (metadata for the workflow bar / router).
 *   keepMounted  Hint that the module should not be unmounted when hidden
 *                (metadata for later render-on-demand tuning).
 *
 * Backward-compatible `MODULE_COMPONENTS` and `MODULE_TITLES` maps are derived
 * from this catalog so existing callsites keep working unchanged.
 */

import { t } from '../../../i18n/index.js';

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
import { TrashPanel } from '../../components/TrashPanel.jsx';
import { ImportModule } from '../../components/ImportModule.jsx';
import { RenameNefModule } from '../../components/RenameNefModule.jsx';

/**
 * Declarative module catalog. Order defines the canonical module list.
 * @type {Record<string, {
 *   component: React.ComponentType,
 *   role: 'main' | 'side' | 'bottom',
 *   weight?: number,
 *   singleton?: boolean,
 *   solo?: boolean,
 *   step?: string,
 *   keepMounted?: boolean,
 * }>}
 */
export const MODULE_CATALOG = {
  'image-viewer': { component: ImageViewer, role: 'main' },
  'original-view': { component: OriginalView, role: 'main' },
  'log-viewer': { component: LogViewer, role: 'bottom', weight: 20 },
  'statistics-dashboard': { component: StatisticsDashboard, role: 'main' },
  'review-module': { component: ReviewModule, role: 'side', weight: 15, step: 'review' },
  'database-management': { component: DatabaseManagement, role: 'main' },
  'refine-faces': { component: RefineFacesModule, role: 'main' },
  'file-queue': { component: FileQueueModule, role: 'side', weight: 15, keepMounted: true },
  'theme-editor': { component: ThemeEditor, role: 'main' },
  'preferences': { component: PreferencesModule, role: 'main' },
  'player-count': { component: PlayerCountModule, role: 'main', solo: true, step: 'count' },
  'culling': { component: CullingModule, role: 'main', solo: true, step: 'culling' },
  'trash': { component: TrashPanel, role: 'main' },
  'import': { component: ImportModule, role: 'main', solo: true, step: 'import' },
  'rename-nef': { component: RenameNefModule, role: 'main', solo: true, step: 'rename' },
};

// Module component mapping — derived from the catalog for backward compatibility.
export const MODULE_COMPONENTS = Object.fromEntries(
  Object.entries(MODULE_CATALOG).map(([id, entry]) => [id, entry.component])
);

// Module titles (Swedish) — derived from the i18n catalog, keyed by module id.
export const MODULE_TITLES = Object.fromEntries(
  Object.keys(MODULE_CATALOG).map((id) => [id, t(`modules.${id}`)])
);

/**
 * Placement role for a module id, defaulting to 'main' for unknown ids.
 * @param {string} moduleId
 * @returns {'main' | 'side' | 'bottom'}
 */
export function getModuleRole(moduleId) {
  return MODULE_CATALOG[moduleId]?.role || 'main';
}

/**
 * Whether a module is a singleton (only one instance, opening focuses the
 * existing tab). Defaults to true; unknown ids are not singletons.
 * @param {string} moduleId
 * @returns {boolean}
 */
export function isSingletonModule(moduleId) {
  const entry = MODULE_CATALOG[moduleId];
  return entry ? entry.singleton !== false : false;
}

/**
 * Workflow-step id for a module ('import' | 'rename' | 'review' | 'count' |
 * 'culling'), or null when the module is not a pipeline step. Lets the workspace
 * map an opened module back to its step so the WorkflowBar can highlight it.
 * @param {string} moduleId
 * @returns {string | null}
 */
export function getModuleStep(moduleId) {
  return MODULE_CATALOG[moduleId]?.step ?? null;
}

/**
 * Declared role weight for a module, or null when it has none. Used to size a
 * fresh side/bottom split so the new pane opens at its catalog proportion (e.g.
 * 15) with the main area keeping the rest, instead of FlexLayout's default
 * halving. Every split-producing role ('side'/'bottom') carries a weight; 'main'
 * modules never split, so a null here is expected and means "no resize".
 * @param {string} moduleId
 * @returns {number | null}
 */
export function getModuleWeight(moduleId) {
  return MODULE_CATALOG[moduleId]?.weight ?? null;
}
