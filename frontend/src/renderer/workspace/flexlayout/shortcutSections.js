/**
 * Keyboard-shortcut catalog for the workspace shortcuts-help overlay.
 *
 * Exported for characterization tests (data-shape + dispatch fencing) and
 * consumed by ShortcutsHelp.jsx. Behavior-neutral: same value, merely also
 * reachable by name.
 */

import { t } from '../../../i18n/index.js';

export const SHORTCUT_SECTIONS = [
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
      { keys: ['Alt', 'Enter'], desc: t('shortcuts.desc.review.manualSuffix') },
      { keys: ['Shift', 'Cmd', 'A'], desc: t('shortcuts.desc.review.acceptAll') },
      { keys: ['Cmd', 'Z'], desc: t('shortcuts.desc.review.undo') },
      { keys: ['Cmd', '⌫'], desc: t('shortcuts.desc.review.deleteToTrash') },
      { keys: ['Cmd', 'Shift', '⌫'], desc: t('shortcuts.desc.review.undoDelete') },
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
      { keys: ['+', '-'], desc: t('shortcuts.desc.culling.zoom'), sep: ' / ' },
      { keys: ['='], desc: t('shortcuts.desc.culling.resetZoom') },
      { keys: ['0'], desc: t('shortcuts.desc.culling.autoFit') },
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
