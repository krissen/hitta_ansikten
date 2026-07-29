# UX Principles

This is a living document. It codifies the interaction and navigation rules the
Ansikten workspace is built on, so a future session (human or AI) can extend the
UI without re-deriving them. Every UI PR that makes a new interaction decision
updates this file.

The app is a photographer's pipeline tool with a retro aesthetic. The rules
below apply Jakob Nielsen's usability heuristics to this specific codebase — they
are not abstract; each names the concrete place it lives.

---

## Applied heuristics

### N1 — Visibility of system status

The user should always see where they are in the pipeline and what the app is
doing.

- The **WorkflowBar** (`components/WorkflowBar.jsx`) sits above the layout and
  highlights the active pipeline step. The active step is tracked in
  `FlexLayoutWorkspace` (`activeStep`) and set both by step clicks and by the
  in-app hand-off events (`open-rename-nef`, `open-review-queue`, `open-culling`,
  `open-import`).
- **Autohide (default on, opt-out).** By default the bar slides away after a few
  seconds idle so the workspace reclaims the height (Lightroom module-row
  convention). The N1 discoverability cost — a hidden bar can't show status — is
  paid back two ways so the row is never *recalled*, only *revealed*: a thin
  top-edge hover-zone with a hairline hint brings it down on hover, and **every
  step change reveals it briefly** (`useAutoHide.js` keys the reveal off
  `activeStep`) so the user always sees where the active step landed. An open
  dropdown, keyboard focus inside the bar (`:focus-within`), or the pointer
  resting on it pause the hide timer, so the row can't slide out from under a
  menu or mid tab-navigation (keyboard reach never depends on the mouse-only
  hover-zone). **Content gate:** autohide only runs when a view is actually open
  behind the bar (`hasContent` = `!showLanding && tabCount > 0`); on the welcome
  card / empty workspace the bar stays put — there is nothing behind it to
  uncover, and it stays fully reachable on first run (this subsumes the earlier
  first-run reachability concern). The `false→true` flip (a view opens) starts
  the timer. `hasContent` gates the hook exactly like the `enabled` opt-out. When
  revealed the bar floats as an inset pill (detached from the edges, rounded, an
  accent phosphor glow) so it reads as hovering rather than a docked strip. The
  timer logic is a headless hook (`useWorkflowBarAutoHide`); the slide + pill
  glow are CSS-only and neutralised under `prefers-reduced-motion`. Users who
  want the old always-visible behaviour turn autohide off
  (`workspace.workflowBarAutoHide`) — independent of the show/hide-entirely
  toggle (`workspace.showWorkflowBar`).
- The **working-folder chip** shows which event folder the pipeline is anchored
  to (`shared/workingFolder.js`), and clicking it opens a dropdown with the live
  status of all three working sets at once — the file queue, the scan scope, and
  the anchor. This answers "which file queue belongs to which flow?" on screen
  (N6) instead of making the user reconstruct it. The status lines are built by a
  pure helper (`components/workflowBar/workingSetSummary.js`) fed by display-only
  subscriptions on the shared stores (`subscribeScanScope`, `subscribeQueueStatus`,
  `subscribeWorkingFolder`). **Display-only means display-only:** a subscription
  may render status, never drive a module (the modules' adopt-on-mount stays the
  single adoption path — see navigation rule 4).
- The **file queue** labels its source folder in the module header (`Kö: <mapp>`)
  so a queue is never anonymous.
- Long operations report through the WebSocket progress channel and toasts, not
  silent spinners.

### N3 — User control and freedom

- Adopting an earlier step's working set is always an explicit button
  ("Fortsätt →", the culling "open with scope" button), never an automatic load.
  See the navigation rules below.
- Destructive actions (delete, purge, empty trash) go through `ConfirmDialog`.
- Rename operations are journaled and undoable (`rename_service`, the journal
  line is the source of truth).

### N4 — Consistency and standards

- The pipeline steps, tools and continuation chain come from **one** source:
  `workflowSteps.js` (`WORKFLOW_STEPS`, `WORKFLOW_TOOLS`, `CONTINUE_BY_STEP`).
  The WorkflowBar renders them; never fork this list.
- Actions follow the same rule as the steps: what a user can trigger is declared
  once, in the action catalog (`workspace/actions/actionCatalog.js`). The
  shortcuts overlay derives its sections from it (`shortcutSections.js`) instead
  of carrying a parallel list. Adding a shortcut means adding an action, not
  editing two files that can drift — and an action that is deliberately
  undocumented in the overlay says so (`help: false`) rather than being absent.
  See [Architecture](architecture.md) for the entry shape.
- A module's placement is a property of the module, not of the moment — see the
  navigation rules. The same command always lands a module in the same kind of
  area.
- Platform conventions: a persistent module row (Lightroom), a tools menu, and
  keyboard shortcuts documented in the shortcuts overlay.

### N5 — Error prevention

- Hand-offs that could unmount a live panel with unsaved state are guarded
  (e.g. the culling hand-off will not close Review while it has unsaved
  confirmations; `reviewDirtyRef` in `FlexLayoutWorkspace`).
- Placement resolves against the real model, so a command can't drop a tab into a
  non-existent tabset.

### N6 — Recognition rather than recall

- The pipeline is **on screen** (WorkflowBar), not something the user recalls
  from a menu. This is the core reason the bar exists.
- Modules carry human labels from the i18n catalog, not internal ids.

### N7 — Flexibility and efficiency of use

- Steps are reachable two ways: the WorkflowBar (persistent — clicks or
  `Cmd+1..5`) and the CLI verbs (`ansikten faces|culling|import`). The
  StartupLanding is a welcome/orientation card, not a second step surface (see
  navigation rule 8). Power users get keyboard shortcuts and the tools menu;
  newcomers get the numbered steps in the bar.
- **Each step remembers its layout.** Re-entering a step restores the shape the
  user left it in (extra pane, changed weights), not the bare factory — see
  navigation rule 7.

### N8 — Aesthetic and minimalist design

- The bar is slim (~32 px) and secondary to the content. Tools that are not part
  of the linear pipeline live behind a "Verktyg ▾" menu rather than cluttering
  the row.

---

## Navigation rules

These are hard rules for anyone adding or moving UI.

1. **Pipeline steps are primary navigation.** The five steps
   (Import → Rename → Review → Count → Culling) are the spine of the app and live
   in the always-visible WorkflowBar. New primary flows join the pipeline; they
   do not get bolted onto a menu.

2. **Modules declare their layout role in the catalog.** `moduleRegistry.js`
   assigns each module a `role` (`main`/`side`/`bottom`) plus metadata
   (`weight`, `singleton`, `solo`, `step`, `keepMounted`). Placement is resolved
   from that role via `resolvePlacementTabset` — **placement must never depend on
   the active tabset.** The same command lands the module in the same kind of
   area regardless of where the user last clicked.

3. **Layout switching morphs, it does not replace.** Changing the working step
   transforms the live layout toward the target instead of tearing it down and
   rebuilding it. `enterStep(stepId)` is the sole structural layout-change path:
   it calls `applyWorkspace` (`workspaceMorph.js`), which reshapes the running
   FlexLayout model with `moveNode`/`addNode`/`deleteTab` Actions. Because
   `moveNode` retains a tab's node id, React keeps the same component instance,
   so a mounted module **keeps its state** across the switch. A `keepMounted`
   module (the File Queue) and a module with unsaved edits (a dirty Review) are
   **parked** in a collapsed bottom "background" border — kept alive, out of the
   way — rather than closed. Two consequences follow:
   - A step switch is **non-destructive**, so it needs **no discard prompt**. The
     only path that still confirms is **Reset layout / Reset all layouts**, which
     forget remembered tweaks (rule 7); when a step is active they re-morph to the
     step's **factory** spec (`enterStep(step, { useMemory: false })`), and only
     on a non-pipeline surface (no active step) do they rebuild the model via
     `Model.fromJson` (`loadLayout`).
   - Full-model replacement (`loadLayout`) is reserved for the reset paths on a
     non-step surface and the initial load; never put it on a path a live panel
     can be on.

4. **Adopting a working set is always opt-in.** The three working sets (file
   queue, scan scope, import destination) and the shared working-folder anchor
   are never auto-loaded. A later step reads the anchor to seed a **default** or
   to offer a **button** ("Fortsätt →", the chip dropdown's "Använd i …"); it
   never starts work on its own. The chip dropdown may *subscribe* to the shared
   stores, but only to render status — a subscription must never re-adopt or
   mutate a module. Anchor-setting is not adoption: Review (on folder-load) and
   Räkna (on a run count) re-point the anchor with their `step`, which only
   changes what **Fortsätt →** offers next; it loads nothing.

   The hand-off buttons between steps use one formulation — **Nästa steg:
   `<verb>` →**, a primary button — so the forward move reads the same
   everywhere. The event mechanics behind each button are unchanged; only the
   label/placement are standardised. The full continuation chain lives in
   `CONTINUE_BY_STEP` (`workflowSteps.js`): import → rename → review → count →
   culling, each mapping to a moduleAPI hand-off event the workspace handles by
   morphing into the next step and passing the anchor's roots.

5. **New modules register with a role and, if part of the pipeline, a step.**
   Add the catalog entry (role + optional `step`), add the step to `STEP_ORDER`
   in `workflowSteps.js` if it is a pipeline step, and the bar picks it up
   automatically.

6. **One router opens everything.** Every way to open a module, enter a step, or
   load a layout goes through the single command router
   (`workspace/flexlayout/workspaceCommands.js`) as a typed intent. The menu
   dispatch table, the `window.workspace` global, the in-app moduleAPI `open-*`
   events, and the main-process CLI launch bridge are all **thin adapters** that
   build an intent and call `dispatch` — never a private path to `enterStep` /
   `openModule`. New navigation joins this router; it does not add a fourth
   mechanism.
   - The router **buffers** intents dispatched before the workspace is ready and
     flushes them in order on `markReady()`. This covers the "router not up yet"
     race. The separate "target module not mounted yet" race (a morph mounts the
     destination lazily; its listener subscribes a tick later) is still guarded
     per hand-off by `waitForListeners` inside the router — keep that guard on any
     new hand-off intent.
   - **Cold-start launch uses a handshake, not a timer.** The renderer sends the
     `workspace-ready` IPC once its router and listeners are live; the main
     process holds its resolved launch command until then and delivers it as a
     `workspace-command`. Do not reintroduce a `setTimeout`/`did-finish-load`
     delay to "wait for the renderer" — signal readiness explicitly.
   - **The main process decides the launch AFTER path expansion.** `resolveLaunchCommand`
     (`src/main/launch-command.js`) expands paths first, so a path that matches
     nothing still yields an explicit command (open the step empty) and the
     renderer never guesses landing-suppression from raw argument counts. A CLI
     verb whose paths expand to nothing opens that step's view **empty** rather
     than stranding in the default layout.

7. **Each step remembers its layout (per-step memory).** A pipeline step
   remembers the shape the user leaves it in, so returning restores their tweaks
   (an extra pane, changed weights) instead of the bare factory — the Capture One
   "workspaces" pattern (Nielsen N7). `stepLayoutMemory.js` owns this:
   - **One key per step**, `ansikten-workspace-<step>`. The value is a **pane
     spec** (`{ moduleId, weight }[]`), not a full model — the same shape the
     factory specs (`workflows.js`) use — because memory feeds the
     **non-destructive morph**, not a `Model.fromJson` replace. `snapshotStepSpec`
     reads the live model's real tabsets; `resolveStepSpec` returns the saved
     spec merged with the factory (`mergeWithFactory`) so a step's **essential
     modules can never go missing** even if the user had closed one.
   - **Persistence is scoped and settled.** `handleModelChange` writes the active
     step's spec on real, user-driven changes only; a programmatic morph is
     wrapped in a suppressor (`suppressPersistRef`) so its transient shapes never
     overwrite a memory. Changes made with **no active step** (non-pipeline
     templates, the initial default) are not remembered.
   - **Parked "Bakgrund" tabs are NOT step memory.** A snapshot reads only real
     tabsets, so a Review/File-Queue parked in the background border while the
     user is in another step never leaks into that step's memory — parked tabs
     belong to the live model, not to any step's remembered shape.
   - **Grouped tabs are captured; 2D nesting is not.** A pane is either a single
     module (`{ moduleId, weight }`) or a **tab group** (`{ tabs, active, weight }`
     — several modules stacked in one column, `active` on top). `snapshotStepSpec`
     records a multi-tab tabset as a group with its selected tab, and the morph
     rebuilds it, so per-column grouping and the active tab survive. The remaining
     **limit (KISS):** the morph normalises a spec to one *row* of weighted columns
     (a column may be a group), so 2D row/column nesting is still not captured;
     richer manual arrangements collapse to a single row on re-entry.
   - **A changed review shape is re-migrated once.** An old three-column review
     memory (file-queue | review | image-viewer) is reshaped once into the
     companion-tab form (`migrateReviewMemoryShape`) so the owner's layout change
     reaches existing installs without discarding the user's review tweaks.
   - **Mount is neutral.** Startup always builds the default preset, never a
     remembered layout; per-step memory surfaces only when the user enters a step.
     The pre-per-step single key (`ansikten-flexlayout`) is migrated **once** into
     the review step's memory, then removed (`migrateLegacyLayout`).
   - **Reset** clears the current step's memory and rebuilds it to factory; **Reset
     all layouts** clears every step's memory. Both keep the dirty-Review confirm.

8. **The StartupLanding is orientation, not navigation.** On an empty workspace
   it shows a welcome + a hint pointing at the WorkflowBar — nothing more. The
   steps, the working-set chip, the "Fortsätt →" continuation and the tools menu
   all live in the persistent bar (autohide reveals it on hover / step change),
   which is the **single source** for navigation and continuation. Do not re-add step/tool/continue controls to the
   landing: the bar is present on the empty workspace too, so duplicating them
   there only recreates the double-affordance problem.

   The card **never covers the bar** and is **first-run-only at start**. It
   renders inside the layout host (`.workspace-layout-host`, the area *below* the
   bar) as an `absolute` fill, not a `fixed` viewport overlay — so the WorkflowBar
   stays visible and clickable while the card is up (modals still paint above it).
   A persistent flag (`ansikten-welcomed`, `workspace/welcomeFlag.js`) is set on
   the first dismissal (open a step, load an image, or close it via the menu). The
   flag governs **only** whether the card shows at START over the non-empty
   default layout: first run shows it, later launches drop straight into the
   workspace with no card. There are **two distinct triggers**, and the flag gates
   only the first:
   - **At start**, over the default layout — first-run-only (the flag).
   - **Empty workspace** (every view closed) — the card returns
     **unconditionally**, independent of the flag, so the workspace is never a
     dead end. It fills the host under the always-visible bar.

   The flag is fail-open toward showing (missing/corrupt → not yet welcomed), CLI
   launches (`willLaunch`) never show it at start, and **Help ▸ "Visa
   välkomstguiden"** (`show-welcome`) brings it back on demand.

9. **Companion drivers stay mounted behind their partner, and their keys survive
   being hidden.** Some modules drive a step without owning screen space. The
   Review step is the case: the **File Queue** is a companion tab **behind** the
   Image Viewer (`review` spec = `review-module | [image-viewer (active),
   file-queue]`), not a permanent column. Rules for any such companion:
   - **Keep it mounted while hidden.** A companion is `keepMounted` in the catalog;
     the morph pins its tab to `enableRenderOnDemand:false` so it stays mounted
     (and its listeners live) even when another tab is on top. Its state and its
     event wiring (auto-advance on `review-complete`, `load-image`, trash/undo)
     must not depend on being the visible tab.
   - **Gate its global keys on *mounted-and-not-parked*, not on visibility.** The
     File Queue's `n`/`p` (next/previous file) run whenever the queue is part of
     the active step's workspace — including hidden behind the Image Viewer —
     because gating on `node.isVisible()` would silently break the owner's primary
     review gesture the moment the viewer tab is raised. A queue **parked** in the
     background border (a *different* step is active) is inert: its parent is a
     `border`, and that is the off switch. Focus-dependent keys (Cmd+F, Cmd+A, `/`)
     stay visibility-gated — only the companion navigation gestures move to the
     mounted-not-parked gate.
   - **Surface the partner on a load.** Opening the companion (`Cmd+Shift+U` focuses
     the singleton queue tab) and then loading an image raises the Image Viewer tab
     automatically: the workspace listens for `image-loaded` and, when the viewer
     is hidden behind another tab, `selectTab`s it programmatically (no DOM-focus
     steal). This is the minimal "switch back to the viewer" rule — the loaded
     image is always shown without a manual tab switch.
   - **Don't fight the user on the idempotent path.** `applyWorkspace` reveals a
     group's `active` tab only on a **fresh** build, never on the idempotent fast
     path (the queue re-enters the review step on every file load). If the user has
     opened the hidden companion, a re-entry must not yank the visible tab back.

---

## Style rules

- **Reuse theme variables and shared primitives.** Build on the tokens in
  [theming.md](theming.md) and the components in `components/shared/` (`Button`,
  `IconButton`, `Modal`, …). Do not hardcode colors, spacing, or fonts.
- **A new CSS class needs a reason**; a new theme key needs a stronger one. If
  you add a theme variable it **must** be defined in **every** theme preset (see
  [theming.md](theming.md)) — a key present in only one preset breaks the others.
- **Test light and dark.** Every visual change is checked in both themes before
  it ships.
- **The retro look is intentional.** Keep it; refine it. This is not a dark-first
  redesign.

---

## Related

- [Theming](theming.md) — the variable system and presets.
- [Accessibility](accessibility.md) — keyboard and focus patterns.
- [Architecture](architecture.md) — module and workspace structure.
