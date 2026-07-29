/**
 * Action catalog — the single source of truth for the app's user-triggerable
 * actions.
 *
 * The semantics of "what a user can do" live inside four independent keyboard
 * listeners (useKeyboardShortcuts, useReviewKeyboard, CullingModule,
 * FlexLayoutWorkspace), with the shortcuts-help overlay carrying a
 * hand-maintained copy of the same list. This file is the declared list; the
 * overlay derives its sections from it (see shortcutSections.js). Same rule the
 * pipeline steps already follow (WORKFLOW_STEPS in workflowSteps.js): one
 * source, everything else derived.
 *
 * Scope, stated plainly: the catalog currently covers the actions reachable from
 * those four keyboard listeners. It does NOT yet cover the app menu
 * (src/main/menu.js → `menu-command` IPC → flexlayout/menuCommands.js), which is
 * a third way to trigger actions and carries roughly two dozen menu-only ones
 * (Cmd+S save-all, theme switching, layout templates, the Cmd+Shift+<letter>
 * module accelerators). Taking those in is separate work; see ROADMAP.md.
 *
 * Pure data: no i18n resolution (`titleKey`, not `t()`), no React, no imports
 * with side effects — so it can be unit-tested and read by non-UI code.
 *
 * Entry shape:
 *   id        Stable action id, `<area>.<action>`. Never reused or renamed
 *             lightly — it is the key any binding (keyboard, hardware) refers to.
 *   owner     Module id from moduleRegistry.js that performs the action, or null
 *             for workspace-level actions with no owning module.
 *   section   Shortcuts-help section the action is listed under (SECTIONS below).
 *   titleKey  i18n key for the human-readable label. Not resolved here.
 *   keys      Keyboard bindings, as the help overlay spells them. A '×2' suffix
 *             means a double-tap of that key (e.g. '+×2').
 *   kind      'trigger' — discrete action.
 *             'range'   — absolute value picks among N targets (a fader).
 *             'delta'   — relative change, signed (a knob).
 *   scope     How strictly the action is gated when triggered from something
 *             other than the keyboard:
 *             'global'      — only the app window's focus is required.
 *             'module'      — the owning module must be mounted.
 *             'destructive' — mounted AND deliberately left out of default
 *                             mappings (it deletes things).
 *   route     How the action is performed, or null when it is not reachable from
 *             either bus today (see "Unrouted actions" below). Two buses, no new
 *             mechanism:
 *               { via: 'emit', event }            — moduleAPI.emit(event). The
 *                                                   event must have a live
 *                                                   subscriber; a legacy event
 *                                                   nothing emits is not a target.
 *               { via: 'emit', event, eventDown } — a 'delta' action whose bus
 *                                                   has one event per direction;
 *                                                   `event` increases,
 *                                                   `eventDown` decreases.
 *               { via: 'dispatch', intent }       — createWorkspaceRouter
 *                                                   (workspaceCommands.js).
 *                                                   `intent.type` must be one the
 *                                                   router handles.
 *               { …, fills: ['moduleId'] }        — the intent is a template: the
 *                                                   listed fields are supplied by
 *                                                   the caller (e.g. from a
 *                                                   'range' action's value), so a
 *                                                   deliberate gap is not a typo.
 *             A property with one event per state (boxes on/off, auto-center,
 *             file info) is two actions, one per state — the bus has no toggle
 *             event, and the keyboard key that toggles is listed on both.
 *   help      false to keep the action out of the shortcuts-help overlay, or an
 *             override object for how its row renders: { keys, sep }. `keys`
 *             overrides the row's key list (used where one help row covers an
 *             action's primary bindings only, or covers a pair of actions);
 *             `sep` is the joiner between keys ('+' when omitted).
 *
 * Unrouted actions (`route: null`) are real actions that no bus can trigger yet:
 * they are implemented inline in a keyboard listener. Migrating those four
 * listeners onto this catalog — and giving the unrouted actions a bus target — is
 * deliberately a separate change; this file does not touch them.
 */

/**
 * Shortcuts-help sections, in display order. `modules` lists the module ids that
 * make a section the "active" one in the overlay.
 * @type {{ id: string, titleKey: string, modules: string[] }[]}
 */
export const SECTIONS = [
  { id: 'navigation', titleKey: 'shortcuts.sections.navigation', modules: [] },
  { id: 'layout', titleKey: 'shortcuts.sections.layout', modules: [] },
  { id: 'image-viewer', titleKey: 'modules.image-viewer', modules: ['image-viewer', 'original-view'] },
  { id: 'face-review', titleKey: 'modules.review-module', modules: ['review-module'] },
  { id: 'file-queue', titleKey: 'modules.file-queue', modules: ['file-queue'] },
  { id: 'culling', titleKey: 'modules.culling', modules: ['culling'] },
  { id: 'general', titleKey: 'shortcuts.sections.general', modules: [] },
];

/** Allowed `kind` values. */
export const ACTION_KINDS = ['trigger', 'range', 'delta'];

/** Allowed `scope` values. */
export const ACTION_SCOPES = ['global', 'module', 'destructive'];

/**
 * Every user-triggerable action, grouped by section in display order.
 * @type {{
 *   id: string,
 *   owner: string | null,
 *   section: string,
 *   titleKey: string,
 *   keys: string[],
 *   kind: 'trigger' | 'range' | 'delta',
 *   scope: 'global' | 'module' | 'destructive',
 *   route: { via: 'emit', event: string, eventDown?: string }
 *         | { via: 'dispatch', intent: object }
 *         | null,
 *   help?: false | { keys?: string[], sep?: string },
 * }[]}
 */
export const ACTIONS = [
  // --- Navigation -----------------------------------------------------------
  // Workspace-wide gestures handled by the browser/FlexLayout itself.
  {
    id: 'workspace.moveFocus',
    owner: null,
    section: 'navigation',
    titleKey: 'shortcuts.desc.nav.moveFocus',
    keys: ['Cmd', '←→↑↓'],
    kind: 'trigger',
    scope: 'global',
    route: null,
  },
  {
    id: 'workspace.prevNextItem',
    owner: null,
    section: 'navigation',
    titleKey: 'shortcuts.desc.nav.prevNextItem',
    keys: ['↑', '↓'],
    kind: 'delta',
    scope: 'global',
    route: null,
    help: { sep: '/' },
  },
  {
    id: 'workspace.completeName',
    owner: null,
    section: 'navigation',
    titleKey: 'shortcuts.desc.nav.completeName',
    keys: ['Tab'],
    kind: 'trigger',
    scope: 'global',
    route: null,
  },

  // --- Layout ---------------------------------------------------------------
  {
    id: 'layout.switchStep',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.switchStep',
    keys: ['Cmd', '1-5'],
    kind: 'range',
    // The range value selects a pipeline step; the caller resolves it to the
    // step's moduleId (WORKFLOW_STEPS) and completes the intent — hence `fills`,
    // which marks the intent as a template rather than a malformed one.
    route: { via: 'dispatch', intent: { type: 'open-workflow-step' }, fills: ['moduleId'] },
    scope: 'global',
  },
  {
    id: 'layout.addColumn',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.addColumn',
    keys: ['Cmd', 'Shift', ']'],
    kind: 'trigger',
    scope: 'global',
    route: null,
  },
  {
    id: 'layout.removeColumn',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.removeColumn',
    keys: ['Cmd', 'Shift', '['],
    kind: 'trigger',
    scope: 'global',
    route: null,
  },
  {
    id: 'layout.addRow',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.addRow',
    keys: ['Cmd', 'Shift', '}'],
    kind: 'trigger',
    scope: 'global',
    route: null,
  },
  {
    id: 'layout.removeRow',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.removeRow',
    keys: ['Cmd', 'Shift', '{'],
    kind: 'trigger',
    scope: 'global',
    route: null,
  },
  {
    // In a listener (FlexLayoutWorkspace), never listed in the overlay.
    id: 'layout.groupAsTab',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.groupAsTab',
    keys: ['Cmd', 'Shift', '←→↑↓'],
    kind: 'trigger',
    scope: 'global',
    route: null,
    help: false,
  },
  {
    // In a listener (FlexLayoutWorkspace), never listed in the overlay.
    id: 'layout.moveToNewTabset',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.moveToNewTabset',
    keys: ['Cmd', 'Alt', '←→↑↓'],
    kind: 'trigger',
    scope: 'global',
    route: null,
    help: false,
  },

  // --- Image viewer ---------------------------------------------------------
  {
    id: 'viewer.zoom',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.zoom',
    keys: ['+', '-'],
    kind: 'delta',
    scope: 'module',
    route: { via: 'emit', event: 'zoom-in', eventDown: 'zoom-out' },
    help: { sep: ' / ' },
  },
  {
    id: 'viewer.resetZoom',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.reset',
    // Double-tapping '+' is the same action (useKeyHold's onDoubleTap); the help
    // row documents the plain key only.
    keys: ['=', '+×2'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'reset-zoom' },
    help: { keys: ['='] },
  },
  {
    id: 'viewer.autoFit',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.autoFit',
    // Double-tapping '-' is the same action; the help row documents '0' only.
    keys: ['0', '-×2'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'auto-fit' },
    help: { keys: ['0'] },
  },
  {
    // 'B' toggles the boxes on/off, but the bus has one event per state (the
    // View menu's checkbox emits them), so the two states are two actions. This
    // one owns the help row and its label describes the pair. The older
    // `toggle-boxes-on-off` event is legacy: still listened for, but nothing in
    // the app emits it, so it is not a dispatch target.
    id: 'viewer.boxesShow',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.toggleBoxes',
    keys: ['B'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'boxes-show' },
  },
  {
    id: 'viewer.boxesHide',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.boxesHide',
    keys: ['B'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'boxes-hide' },
    help: false,
  },
  {
    // 'b' toggles between all boxes and only the active one — same two-state
    // shape as the pair above (`toggle-single-all-boxes` is likewise legacy).
    id: 'viewer.boxesAll',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.toggleSingleAll',
    keys: ['b'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'boxes-all' },
  },
  {
    id: 'viewer.boxesSingle',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.boxesSingle',
    keys: ['b'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'boxes-single' },
    help: false,
  },
  {
    // 'c' enables and 'C' disables — two actions, one help row. This one owns the
    // row (and its label describes the pair); viewer.autoCenterOff is hidden.
    id: 'viewer.autoCenterOn',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.autoCenter',
    keys: ['c'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'auto-center-enable' },
    help: { keys: ['c', 'C'], sep: ' / ' },
  },
  {
    id: 'viewer.autoCenterOff',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.autoCenterOff',
    keys: ['C'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'auto-center-disable' },
    help: false,
  },
  {
    // In a listener (ImageViewer), never listed in the overlay. Two-state pair,
    // like the boxes above: 'I' toggles, the View menu's checkbox sets a state.
    id: 'viewer.fileInfoShow',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.toggleFileInfo',
    keys: ['I'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'file-info-show' },
    help: false,
  },
  {
    id: 'viewer.fileInfoHide',
    owner: 'image-viewer',
    section: 'image-viewer',
    titleKey: 'shortcuts.desc.viewer.fileInfoHide',
    keys: ['I'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'file-info-hide' },
    help: false,
  },

  // --- Face review ----------------------------------------------------------
  {
    id: 'review.confirm',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.acceptMatch',
    keys: ['Enter', 'A'],
    kind: 'trigger',
    scope: 'module',
    route: null,
    help: { sep: ' / ' },
  },
  {
    id: 'review.ignore',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.ignoreFace',
    keys: ['I'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'review.rename',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.rename',
    keys: ['R'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'review.selectAlternative',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.selectAlternative',
    keys: ['1-N'],
    kind: 'range',
    scope: 'module',
    route: null,
  },
  {
    id: 'review.prevNextFace',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.prevNextFace',
    keys: ['↑', '↓'],
    kind: 'delta',
    scope: 'module',
    route: null,
    help: { sep: ' / ' },
  },
  {
    id: 'review.skipFile',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.skipFile',
    keys: ['X'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'review.manualSuffix',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.manualSuffix',
    keys: ['Alt', 'Enter'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'review.acceptAll',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.acceptAll',
    keys: ['Shift', 'Cmd', 'A'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'review.undo',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.undo',
    keys: ['Cmd', 'Z'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'undo-face-action' },
  },
  {
    id: 'review.deleteToTrash',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.deleteToTrash',
    keys: ['Cmd', '⌫'],
    kind: 'trigger',
    scope: 'destructive',
    route: { via: 'emit', event: 'delete-current-file' },
  },
  {
    id: 'review.undoDelete',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.undoDelete',
    keys: ['Cmd', 'Shift', '⌫'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'undo-delete-file' },
  },
  {
    id: 'review.cancel',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.cancel',
    keys: ['Esc'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    // In a listener (useReviewKeyboard), never listed in the overlay.
    id: 'review.addManualFace',
    owner: 'review-module',
    section: 'face-review',
    titleKey: 'shortcuts.desc.review.addManualFace',
    keys: ['M'],
    kind: 'trigger',
    scope: 'module',
    route: null,
    help: false,
  },

  // --- File queue -----------------------------------------------------------
  {
    id: 'queue.openFiles',
    owner: 'file-queue',
    section: 'file-queue',
    titleKey: 'shortcuts.desc.queue.openFiles',
    keys: ['Cmd', 'O'],
    kind: 'trigger',
    scope: 'global',
    route: null,
  },
  {
    id: 'queue.navigate',
    owner: 'file-queue',
    section: 'file-queue',
    titleKey: 'shortcuts.desc.queue.navigate',
    keys: ['↑', '↓'],
    kind: 'delta',
    scope: 'module',
    route: null,
    help: { sep: ' / ' },
  },
  {
    id: 'queue.loadFile',
    owner: 'file-queue',
    section: 'file-queue',
    titleKey: 'shortcuts.desc.queue.loadFile',
    keys: ['Enter'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'queue.remove',
    owner: 'file-queue',
    section: 'file-queue',
    titleKey: 'shortcuts.desc.queue.remove',
    keys: ['Delete'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'queue.selectAll',
    owner: 'file-queue',
    section: 'file-queue',
    titleKey: 'shortcuts.desc.queue.selectAll',
    keys: ['Cmd', 'A'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },

  // --- Culling --------------------------------------------------------------
  {
    // 'j'/'k' are vim-style aliases for the arrow bindings; the help row lists
    // the arrows only.
    id: 'culling.nextImage',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.nextImage',
    keys: ['→', '↓', 'j'],
    kind: 'trigger',
    scope: 'module',
    route: null,
    help: { keys: ['→', '↓'], sep: ' / ' },
  },
  {
    id: 'culling.prevImage',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.prevImage',
    keys: ['←', '↑', 'k'],
    kind: 'trigger',
    scope: 'module',
    route: null,
    help: { keys: ['←', '↑'], sep: ' / ' },
  },
  {
    id: 'culling.page',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.page',
    keys: ['Alt', '←→↑↓'],
    kind: 'delta',
    scope: 'module',
    route: null,
  },
  {
    id: 'culling.zoom',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.zoom',
    keys: ['+', '-'],
    kind: 'delta',
    scope: 'module',
    route: null,
    help: { sep: ' / ' },
  },
  {
    id: 'culling.resetZoom',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.resetZoom',
    keys: ['='],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'culling.autoFit',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.autoFit',
    keys: ['0'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'culling.cull',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.cull',
    // Bare Backspace culls too; the help row lists the documented three.
    keys: ['X', 'Delete', '⌫', 'Cmd+⌫'],
    kind: 'trigger',
    scope: 'destructive',
    route: null,
    help: { keys: ['X', 'Delete', 'Cmd+⌫'], sep: ' / ' },
  },
  {
    // Enter means two different things by view mode: in the loupe it renames
    // (this row), in the grid it opens the focused cell in the loupe (below).
    id: 'culling.rename',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.rename',
    keys: ['Enter'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    // In a listener (CullingModule capture-phase Enter/Esc), never in the overlay.
    id: 'culling.openLoupe',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.openLoupe',
    keys: ['Enter'],
    kind: 'trigger',
    scope: 'module',
    route: null,
    help: false,
  },
  {
    // Escape has three outcomes in culling, in this priority order. All three
    // live in the capture-phase listener; none has ever been in the overlay.
    id: 'culling.closeMenu',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.closeMenu',
    keys: ['Esc'],
    kind: 'trigger',
    scope: 'module',
    route: null,
    help: false,
  },
  {
    id: 'culling.discardPendingNames',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.discardPendingNames',
    keys: ['Esc'],
    kind: 'trigger',
    scope: 'module',
    route: null,
    help: false,
  },
  {
    id: 'culling.exitLoupe',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.exitLoupe',
    keys: ['Esc'],
    kind: 'trigger',
    scope: 'module',
    route: null,
    help: false,
  },
  {
    id: 'culling.applyRemovals',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.applyRemovals',
    keys: ['Cmd', 'Enter'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'culling.undo',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.undo',
    keys: ['Cmd', 'Z'],
    kind: 'trigger',
    scope: 'module',
    route: null,
  },
  {
    id: 'culling.openLightroom',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.openLightroom',
    keys: ['L'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'open-raw-in-lightroom' },
  },

  // --- General --------------------------------------------------------------
  {
    id: 'general.showHelp',
    owner: null,
    section: 'general',
    titleKey: 'shortcuts.desc.general.showHelp',
    keys: ['?'],
    kind: 'trigger',
    scope: 'global',
    route: null,
  },
  {
    id: 'general.reload',
    owner: null,
    section: 'general',
    titleKey: 'shortcuts.desc.general.reload',
    keys: ['Cmd', 'R'],
    kind: 'trigger',
    scope: 'global',
    route: null,
  },
  {
    id: 'general.preferences',
    owner: 'preferences',
    section: 'general',
    titleKey: 'shortcuts.desc.general.preferences',
    keys: ['Cmd', ','],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'dispatch', intent: { type: 'open-module', moduleId: 'preferences' } },
  },
  {
    // In a listener (FlexLayoutWorkspace), never listed in the overlay.
    id: 'general.hardReload',
    owner: null,
    section: 'general',
    titleKey: 'shortcuts.desc.general.hardReload',
    keys: ['Cmd', 'Shift', 'R'],
    kind: 'trigger',
    scope: 'global',
    route: null,
    help: false,
  },
];

/**
 * Actions belonging to a section, in catalog order.
 * @param {string} sectionId
 * @returns {typeof ACTIONS}
 */
export function actionsForSection(sectionId) {
  return ACTIONS.filter((a) => a.section === sectionId);
}

/**
 * Look up an action by id.
 * @param {string} id
 * @returns {typeof ACTIONS[number] | undefined}
 */
export function getAction(id) {
  return ACTIONS.find((a) => a.id === id);
}
