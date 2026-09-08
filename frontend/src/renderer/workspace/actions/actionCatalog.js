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
 * Scope, stated plainly: the catalog covers the actions reachable from those four
 * keyboard listeners AND from the app menu (src/main/menu.js → `menu-command`
 * IPC → flexlayout/menuCommands.js) — the third trigger path, which carries some
 * two dozen menu-only actions (Cmd+S save-all, theme switching, layout templates,
 * the Cmd+Shift+<letter> module accelerators). Every command menu.js sends is
 * declared here; the catalog test fails if one is added without an entry, or if a
 * declared command has no handler at all.
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
 *             means a double-tap of that key (e.g. '+×2'). Empty for a menu-only
 *             action with no accelerator (Papperskorg, the theme entries): such an
 *             action still has a binding, it is just `menuCommand` rather than a
 *             key. One of the two must be non-empty.
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
 *             any bus today (see "Unrouted actions" below). Three buses, no new
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
 *               { via: 'menu', command }          — the menu-command table
 *                                                   (menuCommands.js) performs it
 *                                                   itself, with a direct call on
 *                                                   its workspace ctx and no bus
 *                                                   underneath: theme switching,
 *                                                   the layout-geometry helpers,
 *                                                   the file dialog, the welcome
 *                                                   card. `command` is the
 *                                                   `menu-command` string, or an
 *                                                   array where one action has one
 *                                                   command per target (the four
 *                                                   move-to-new-tabset directions).
 *               { …, fills: ['moduleId'] }        — the intent is a template: the
 *                                                   listed fields are supplied by
 *                                                   the caller (e.g. from a
 *                                                   'range' action's value), so a
 *                                                   deliberate gap is not a typo.
 *             A property with one event per state (boxes on/off, auto-center,
 *             file info) is two actions, one per state — the bus has no toggle
 *             event, and the keyboard key that toggles is listed on both.
 *   menuCommand
 *             The `menu-command` string(s) the app menu sends to trigger this
 *             action. Declared, never inferred — including on an 'emit' action
 *             whose command happens to equal `route.event`. The duplication is
 *             deliberate: `route` says how the action is *performed*, `menuCommand`
 *             says the menu can *trigger* it, and those are independent facts. An
 *             emit action reachable only from a keyboard listener has no menu item
 *             at all, and deriving one from its event name would invent a binding
 *             that does not exist. String or array; an array is one action with one
 *             command per target (the zoom pair, the four move-to-new-tabset
 *             directions). A 'menu' action carries its command in `route.command`
 *             instead, since there the command IS the route.
 *   help      false to keep the action out of the shortcuts-help overlay, or an
 *             override object for how its row renders: { keys, sep }. `keys`
 *             overrides the row's key list (used where one help row covers an
 *             action's primary bindings only, or covers a pair of actions);
 *             `sep` is the joiner between keys ('+' when omitted).
 *
 * Unrouted actions (`route: null`) are real actions that no bus can trigger yet.
 * Two kinds, and they need opposite fixes: most are implemented inline in a
 * keyboard listener, and migrating those four listeners onto this catalog — giving
 * each action a bus target — is deliberately a separate change (see phase 2.3).
 * The rest are menu items with a `menuCommand` that nothing handles at all: those
 * are defects, listed in KNOWN_DEAD_MENU_COMMANDS below, not work in progress.
 */

/**
 * Shortcuts-help sections, in display order. `modules` lists the module ids that
 * make a section the "active" one in the overlay.
 * @type {{ id: string, titleKey: string, modules: string[] }[]}
 */
export const SECTIONS = [
  { id: 'navigation', titleKey: 'shortcuts.sections.navigation', modules: [] },
  { id: 'layout', titleKey: 'shortcuts.sections.layout', modules: [] },
  {
    id: 'image-viewer',
    titleKey: 'modules.image-viewer',
    modules: ['image-viewer', 'original-view'],
  },
  {
    id: 'face-review',
    titleKey: 'modules.review-module',
    modules: ['review-module'],
  },
  { id: 'file-queue', titleKey: 'modules.file-queue', modules: ['file-queue'] },
  { id: 'culling', titleKey: 'modules.culling', modules: ['culling'] },
  { id: 'general', titleKey: 'shortcuts.sections.general', modules: [] },
];

/** Allowed `kind` values. */
export const ACTION_KINDS = ['trigger', 'range', 'delta'];

/** Allowed `scope` values. */
export const ACTION_SCOPES = ['global', 'module', 'destructive'];

/** Allowed `route.via` values — the buses an action can be performed on. */
export const ACTION_ROUTE_BUSES = ['emit', 'dispatch', 'menu'];

/**
 * Menu commands the app menu sends that nothing handles: no entry in
 * menuCommands.js and no module subscribed to the broadcast fallback, so the item
 * would be visible, possibly carry an accelerator, and do nothing when picked.
 *
 * **Empty, and meant to stay that way.** It held eight entries when the menu was
 * taken into the catalog — all eight orphaned by one commit, 5686ff9 (2025-12-31),
 * which deleted the dockview `workspace.js` that implemented them and left the
 * menu items behind. They were removed in phase 2.2 rather than reimplemented; see
 * CHANGELOG for the per-item reasoning.
 *
 * The constant stays as the obvious home for a future exception, and so the
 * honesty test below keeps guarding: an entry added here must be a command the
 * menu really sends AND really has no handler, so it cannot be used to silence an
 * unrelated failure. Adding to it should feel like filing a defect, because it is.
 * @type {readonly string[]}
 */
export const KNOWN_DEAD_MENU_COMMANDS = Object.freeze([]);

/**
 * The mirror image of the list above: handlers in menuCommands.js that no menu
 * item sends. Not dead in the same way — each works if something dispatches it —
 * but unreachable from the menu, which is the table's only caller.
 *
 * **Also empty, also meant to stay that way.** It held six layout-template
 * aliases, stranded when the Window menu was rewritten around the pipeline steps;
 * phase 2.2 deleted them. Two of that family (`layout-template-comparison`,
 * `layout-template-stats`) kept their menu items and remain.
 *
 * Kept for the same reason as the list above: without it the reachability check is
 * one-directional — it can prove a catalogued command has a handler, but never
 * that a handler has a caller.
 * @type {readonly string[]}
 */
export const KNOWN_UNREACHABLE_HANDLERS = Object.freeze([]);

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
 *         | { via: 'menu', command: string | string[] }
 *         | null,
 *   menuCommand?: string | string[],
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

  // Menu-only: Visa ▸ <module>. Each opens one module through the open-module
  // intent; the Cmd+Shift+<letter> accelerators are the menu's, not a listener's,
  // and have never been in the shortcuts overlay. `owner` is the module the action
  // opens (the same reading general.preferences already used); `scope` is 'global'
  // because opening a module is precisely what you do when it is not mounted.
  {
    id: 'nav.openImageViewer',
    owner: 'image-viewer',
    section: 'navigation',
    titleKey: 'modules.image-viewer',
    keys: [],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'image-viewer' },
    },
    menuCommand: 'open-image-viewer',
    help: false,
  },
  {
    id: 'nav.openOriginalView',
    owner: 'original-view',
    section: 'navigation',
    titleKey: 'menu.view.openOriginalView',
    keys: ['Cmd', 'Shift', 'O'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'original-view' },
    },
    menuCommand: 'open-original-view',
    help: false,
  },
  {
    id: 'nav.openLogViewer',
    owner: 'log-viewer',
    section: 'navigation',
    titleKey: 'menu.view.openLogViewer',
    keys: ['Cmd', 'L'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'log-viewer' },
    },
    menuCommand: 'open-log-viewer',
    help: false,
  },
  {
    id: 'nav.openReviewModule',
    owner: 'review-module',
    section: 'navigation',
    titleKey: 'menu.view.openReviewModule',
    keys: ['Cmd', 'Shift', 'F'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'review-module' },
    },
    menuCommand: 'open-review-module',
    help: false,
  },
  {
    id: 'nav.openStatistics',
    owner: 'statistics-dashboard',
    section: 'navigation',
    titleKey: 'modules.statistics-dashboard',
    keys: ['Cmd', 'Shift', 'S'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'statistics-dashboard' },
    },
    menuCommand: 'open-statistics-dashboard',
    help: false,
  },
  {
    // The menu's Cmd+Shift+I opens the module; the router ALSO knows an
    // 'open-import' handoff intent (CLI launch, with a destination folder). The
    // menu item is the plain open, so that is what this action declares.
    id: 'nav.openImport',
    owner: 'import',
    section: 'navigation',
    titleKey: 'modules.import',
    keys: ['Cmd', 'Shift', 'I'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'import' },
    },
    menuCommand: 'open-import',
    help: false,
  },
  {
    id: 'nav.openRenameNef',
    owner: 'rename-nef',
    section: 'navigation',
    titleKey: 'modules.rename-nef',
    keys: ['Cmd', 'Shift', 'B'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'rename-nef' },
    },
    menuCommand: 'open-rename-nef',
    help: false,
  },
  {
    id: 'nav.openPlayerCount',
    owner: 'player-count',
    section: 'navigation',
    titleKey: 'modules.player-count',
    keys: ['Cmd', 'Shift', 'K'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'player-count' },
    },
    menuCommand: 'open-player-count',
    help: false,
  },
  {
    id: 'nav.openCulling',
    owner: 'culling',
    section: 'navigation',
    titleKey: 'modules.culling',
    keys: ['Cmd', 'Shift', 'G'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'culling' },
    },
    menuCommand: 'open-culling',
    help: false,
  },
  {
    id: 'nav.openTrash',
    owner: 'trash',
    section: 'navigation',
    titleKey: 'menu.view.openTrash',
    keys: [],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'trash' },
    },
    menuCommand: 'open-trash',
    help: false,
  },
  {
    id: 'nav.openDatabase',
    owner: 'database-management',
    section: 'navigation',
    titleKey: 'modules.database-management',
    keys: ['Cmd', 'Shift', 'D'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'database-management' },
    },
    menuCommand: 'open-database-management',
    help: false,
  },
  {
    id: 'nav.openRefineFaces',
    owner: 'refine-faces',
    section: 'navigation',
    titleKey: 'modules.refine-faces',
    keys: ['Cmd', 'Shift', 'E'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'refine-faces' },
    },
    menuCommand: 'open-refine-faces',
    help: false,
  },
  {
    id: 'nav.openFileQueue',
    owner: 'file-queue',
    section: 'navigation',
    titleKey: 'modules.file-queue',
    keys: ['Cmd', 'Shift', 'U'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'file-queue' },
    },
    menuCommand: 'open-file-queue',
    help: false,
  },
  {
    id: 'nav.openThemeEditor',
    owner: 'theme-editor',
    section: 'navigation',
    titleKey: 'menu.theme.editor',
    keys: ['Cmd', 'Shift', 'T'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'theme-editor' },
    },
    menuCommand: 'open-theme-editor',
    help: false,
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
    route: {
      via: 'dispatch',
      intent: { type: 'open-workflow-step' },
      fills: ['moduleId'],
    },
    scope: 'global',
    // Fönster ▸ Arbetsflödessteg — one menu item per step, all the same action.
    // menuCommands.js generates the five handlers from WORKFLOW_STEPS, so this
    // list is the same order by construction.
    menuCommand: [
      'workflow-step-import',
      'workflow-step-rename',
      'workflow-step-review',
      'workflow-step-count',
      'workflow-step-culling',
    ],
  },
  {
    id: 'layout.addColumn',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.addColumn',
    keys: ['Cmd', 'Shift', ']'],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'menu', command: 'layout-add-column' },
  },
  {
    id: 'layout.removeColumn',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.removeColumn',
    keys: ['Cmd', 'Shift', '['],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'menu', command: 'layout-remove-column' },
  },
  {
    id: 'layout.addRow',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.addRow',
    keys: ['Cmd', 'Shift', '}'],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'menu', command: 'layout-add-row' },
  },
  {
    id: 'layout.removeRow',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.removeRow',
    keys: ['Cmd', 'Shift', '{'],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'menu', command: 'layout-remove-row' },
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
    // In a listener (FlexLayoutWorkspace), never listed in the overlay. The menu
    // has one item per direction (Fönster ▸ Layout), hence four commands for the
    // one action — the same shape as the arrow-set the keys describe.
    id: 'layout.moveToNewTabset',
    owner: null,
    section: 'layout',
    titleKey: 'shortcuts.desc.layout.moveToNewTabset',
    keys: ['Cmd', 'Alt', '←→↑↓'],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'menu',
      command: [
        'layout-move-new-left',
        'layout-move-new-right',
        'layout-move-new-above',
        'layout-move-new-below',
      ],
    },
    help: false,
  },

  // Menu-only layout actions. None has ever been in the overlay: they are picked
  // from Fönster, and the two with accelerators (Cmd+Shift+L, Cmd+Shift+1..5)
  // were never documented as keyboard shortcuts.
  {
    id: 'layout.templateComparison',
    owner: null,
    section: 'layout',
    titleKey: 'menu.window.comparisonMode',
    keys: [],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'load-layout', name: 'comparison' },
    },
    menuCommand: 'layout-template-comparison',
    help: false,
  },
  {
    // Labelled "Statistikläge"; the layout it loads is named 'database'.
    id: 'layout.templateStats',
    owner: null,
    section: 'layout',
    titleKey: 'menu.window.statsMode',
    keys: [],
    kind: 'trigger',
    scope: 'global',
    route: {
      via: 'dispatch',
      intent: { type: 'load-layout', name: 'database' },
    },
    menuCommand: 'layout-template-stats',
    help: false,
  },
  {
    // Sole owner of Cmd+Shift+L since the collision with the external-editor
    // item was resolved: this action is global, that one was module-scoped.
    id: 'layout.reset',
    owner: null,
    section: 'layout',
    titleKey: 'menu.window.resetLayout',
    keys: ['Cmd', 'Shift', 'L'],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'dispatch', intent: { type: 'reset-layout' } },
    menuCommand: 'reset-layout',
    help: false,
  },
  {
    id: 'layout.resetAll',
    owner: null,
    section: 'layout',
    titleKey: 'menu.window.resetAllLayouts',
    keys: [],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'dispatch', intent: { type: 'reset-all-layouts' } },
    menuCommand: 'reset-all-layouts',
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
    menuCommand: ['zoom-in', 'zoom-out'],
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
    menuCommand: 'reset-zoom',
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
    menuCommand: 'auto-fit',
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
    menuCommand: 'boxes-show',
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
    menuCommand: 'boxes-hide',
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
    menuCommand: 'boxes-all',
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
    menuCommand: 'boxes-single',
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
    menuCommand: 'auto-center-enable',
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
    menuCommand: 'auto-center-disable',
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
    menuCommand: 'file-info-show',
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
    menuCommand: 'file-info-hide',
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
    menuCommand: 'undo-face-action',
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
    menuCommand: 'delete-current-file',
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
    menuCommand: 'undo-delete-file',
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
    // Arkiv ▸ Öppna bild… — menuCommands opens the multi-file dialog itself and
    // hands the paths to window.fileQueue, so the menu table is the performer.
    route: { via: 'menu', command: 'open-file' },
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
    // The Cmd+Shift+L collision is resolved: Arkiv ▸ Öppna original i extern
    // editor lost that accelerator, layout.reset kept it. This action is
    // module-scoped (CullingModule is the only subscriber), so a global
    // accelerator did nothing outside Gallra spelare while consuming the key
    // everywhere — and inside it, bare 'L' already triggers this. The menu item
    // remains, without an accelerator, for discoverability.
    id: 'culling.openLightroom',
    owner: 'culling',
    section: 'culling',
    titleKey: 'shortcuts.desc.culling.openLightroom',
    keys: ['L'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'open-raw-in-lightroom' },
    menuCommand: 'open-raw-in-lightroom',
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
    // Hjälp ▸ Tangentbordsgenvägar (Cmd+/) toggles the same overlay as '?'. The
    // overlay row keeps listing '?' only, as it always has.
    route: { via: 'menu', command: 'show-keyboard-shortcuts' },
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
    route: {
      via: 'dispatch',
      intent: { type: 'open-module', moduleId: 'preferences' },
    },
    // Three menu items send it: the mac app menu (Cmd+,), the Arkiv menu on
    // Windows/Linux (Ctrl+,) and Visa ▸ Inställningar (Cmd+Shift+P). One command.
    menuCommand: 'open-preferences',
  },
  {
    id: 'general.saveAll',
    owner: 'review-module',
    section: 'general',
    titleKey: 'menu.file.saveAll',
    keys: ['Cmd', 'S'],
    kind: 'trigger',
    scope: 'module',
    // No table entry: menuCommands' fallback broadcasts the command name, and
    // ReviewModule subscribes to it. The menu is the only trigger there is.
    route: { via: 'emit', event: 'save-all-changes' },
    menuCommand: 'save-all-changes',
    help: false,
  },
  {
    // Bare Escape as a global menu accelerator. ReviewModule discards its pending
    // edits on it; the culling Escape actions are a separate, module-local
    // listener (culling.closeMenu and friends above).
    id: 'general.discardChanges',
    owner: 'review-module',
    section: 'general',
    titleKey: 'menu.file.discard',
    keys: ['Esc'],
    kind: 'trigger',
    scope: 'module',
    route: { via: 'emit', event: 'discard-changes' },
    menuCommand: 'discard-changes',
    help: false,
  },
  {
    id: 'general.showWelcome',
    owner: null,
    section: 'general',
    titleKey: 'menu.help.showWelcome',
    keys: [],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'menu', command: 'show-welcome' },
    help: false,
  },
  {
    // Visa ▸ Tema ▸ … — three items, three preferences, no accelerators. Handled
    // by menuCommands calling themeManager directly, so 'menu' is the bus.
    id: 'general.themeLight',
    owner: null,
    section: 'general',
    titleKey: 'menu.theme.light',
    keys: [],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'menu', command: 'theme-light' },
    help: false,
  },
  {
    id: 'general.themeDark',
    owner: null,
    section: 'general',
    titleKey: 'menu.theme.dark',
    keys: [],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'menu', command: 'theme-dark' },
    help: false,
  },
  {
    id: 'general.themeSystem',
    owner: null,
    section: 'general',
    titleKey: 'menu.theme.followSystem',
    keys: [],
    kind: 'trigger',
    scope: 'global',
    route: { via: 'menu', command: 'theme-system' },
    help: false,
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

/**
 * Every `menu-command` string that triggers an action, read from the two places a
 * binding is *declared*: `route.command` (the menu table performs the action) and
 * `menuCommand` (the menu triggers an action some other bus performs).
 *
 * Nothing is inferred. An earlier version derived the binding for 'emit' actions
 * from their event name, on the reasoning that the menu sends the event verbatim.
 * That was true of all 17 emit actions — but by coincidence, not by rule: an emit
 * action reachable only from a keyboard listener has no menu item, and the
 * inference would have invented a menu command for it. Worse, it made the "is this
 * command still sent by the menu?" check unable to fail, because the thing being
 * checked was derived from the thing it was checked against. Declaring the binding
 * costs one line per action and makes all three directions independently testable.
 * @param {typeof ACTIONS[number]} action
 * @returns {string[]}
 */
export function menuCommandsOf(action) {
  const out = [];
  const push = (v) => {
    if (Array.isArray(v)) out.push(...v);
    else if (typeof v === 'string') out.push(v);
  };
  if (action.route?.via === 'menu') push(action.route.command);
  push(action.menuCommand);
  return out;
}
