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

- The **WorkflowBar** (`components/WorkflowBar.jsx`) is always visible above the
  layout and highlights the active pipeline step. The active step is tracked in
  `FlexLayoutWorkspace` (`activeStep`) and set both by step clicks and by the
  in-app hand-off events (`open-rename-nef`, `open-review-queue`, `open-culling`,
  `open-import`).
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

- The WorkflowBar and StartupLanding render the **same** steps, in the same
  order, with the same labels, from **one** source: `workflowSteps.js`
  (`WORKFLOW_STEPS`, `WORKFLOW_TOOLS`, `CONTINUE_BY_STEP`). Never fork this list.
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

- Steps are reachable three ways: the WorkflowBar (persistent), the
  StartupLanding (empty workspace), and the CLI verbs (`ansikten faces|culling|
  import`). Power users get keyboard shortcuts and the tools menu; newcomers get
  the numbered steps.

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
     only path that still confirms is **Reset layout**, which alone rebuilds the
     model via `Model.fromJson` (`loadLayout`).
   - Full-model replacement (`loadLayout`) is reserved for Reset layout and the
     initial load; never put it on a path a live panel can be on.

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
   in `workflowSteps.js` if it is a pipeline step, and the bar/landing pick it up
   automatically.

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
