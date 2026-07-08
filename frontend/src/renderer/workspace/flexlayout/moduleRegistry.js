/**
 * Module registry - maps workspace module ids to their React components and
 * i18n-derived tab titles.
 *
 * Single source of truth for "which modules exist" in the FlexLayout workspace.
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

// Module component mapping
export const MODULE_COMPONENTS = {
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
  'trash': TrashPanel,
  'import': ImportModule,
  'rename-nef': RenameNefModule
};

// Module titles (Swedish) — derived from the i18n catalog, keyed by module id.
export const MODULE_TITLES = Object.fromEntries(
  Object.keys(MODULE_COMPONENTS).map((id) => [id, t(`modules.${id}`)])
);
