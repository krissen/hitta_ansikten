/**
 * Keyboard-shortcut sections for the workspace shortcuts-help overlay.
 *
 * Derived from the action catalog (workspace/actions/actionCatalog.js) — the
 * overlay no longer carries its own copy of the action list. Same one-source
 * rule the pipeline steps follow (WORKFLOW_STEPS in workflowSteps.js): the
 * catalog declares the actions and their section, this file only turns them into
 * the display rows ShortcutsHelp.jsx renders.
 *
 * Per action, the row shows its `keys` and its resolved `titleKey`. An action's
 * `help` field adjusts that: `false` keeps it out of the overlay (it exists, but
 * has never been documented there), `{ keys }` overrides the displayed key list
 * (a row that covers only the primary bindings, or a pair of actions), and
 * `{ sep }` sets the joiner between keys — ShortcutsHelp defaults it to '+', so
 * `sep` is emitted only where declared.
 */

import { t } from '../../../i18n/index.js';
import { SECTIONS, actionsForSection } from '../actions/actionCatalog.js';

/** Build one display row from a catalog action. */
function toRow(action) {
  const row = {
    keys: action.help?.keys ?? action.keys,
    desc: t(action.titleKey),
  };
  if (action.help?.sep) row.sep = action.help.sep;
  return row;
}

export const SHORTCUT_SECTIONS = SECTIONS.map((section) => ({
  id: section.id,
  title: t(section.titleKey),
  modules: section.modules,
  shortcuts: actionsForSection(section.id)
    .filter((action) => action.help !== false)
    .map(toRow),
}));
