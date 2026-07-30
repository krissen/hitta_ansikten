# Follow-up plan — toolchain, action catalog, test harness

**Written:** 2026-07-29. **Status:** proposed, not started.

This is a *scoped* plan in the sense [CLAUDE.md](../../CLAUDE.md) gives the word:
[ROADMAP.md](../../ROADMAP.md) is the living backlog across all horizons; this
file sequences one coherent block of it and states why the order is what it is.
Like [performance-plan.md](performance-plan.md), it is meant to be finished and
then deleted, not maintained forever.

---

## Context

On 2026-07-29 a session shipped nine PRs (#248–#256). Six of them were the MIDI
control-surface groundwork; three came out of problems the first six exposed:

- **#254** — backend CI had been red since 2026-07-18 with 947 ruff findings in
  code nobody had touched. `backend/pyproject.toml` declared `ruff>=0.6` with no
  upper bound and `extend-select = ["I"]`, i.e. *ruff's implicit default set plus
  I*. That default set is version-dependent; ruff 0.16.0 widened it. The lint
  rules were replaced by somebody else's release.
- **#255** — first family of the widened rule set adopted (PEP 585/604).
- **#256** — six frontend test files failing intermittently in CI, none
  reproducible in isolation, and the *set* of failures moving between runs.

Three separate gaps were found, and they are the same gap wearing different
clothes: **somewhere a tool inherited a default nobody controlled.** Ruff's rule
set. `shared/*.py`, which no linter reaches. And a future root ruff config that
would have opened red for an unrelated reason — caught in review before it was
written.

That pattern is the reason this plan exists as a document rather than as five
roadmap lines: the remaining items are individually small and collectively a
single subject.

---

## Scope

**In scope** — the residue of that session:

1. Ruff rule adoption, remaining families (ROADMAP line 60)
2. Lint coverage for `shared/` (line 64)
3. Consolidating the four divergent ignore-marker mechanisms (line 134)
4. Completing the action catalog: the app menu as third bus (line 150), the dead
   `reload-database` command (line 151), migrating the four keyboard listeners
   (line 152)
5. Test-harness debt: microtask counting (line 153), contention cost profile
   (line 154)
6. `PreferencesManager.load()` never persists the migration (line 142)

**Out of scope, deliberately:**

- **The MIDI hardware track.** Everything from experiment E4 onward is gated on
  hardware that has not arrived. See [midi.md](midi.md). Do not start it here.
- **The rest of ROADMAP.** Roughly forty other open items — RAW format coverage,
  accessibility, undo semantics, theming, performance. They are real, they are
  tracked, and they are not this subject. Picking them up here would turn a
  finishable plan into a permanent one.

---

## Phase 1 — Finish the toolchain — **Done**

All three sections are closed (1.1 #254–#262, 1.2 #263, 1.3). The unfinished
state this phase existed to end is gone: `select` in `backend/pyproject.toml`
describes the rule set the project actually chose, `shared/` is linted from a
root config that inherits that set, and the ignore-marker vocabulary has one
definition.

### 1.1 Remaining ruff families, one PR each — **Done**

All five phases are adopted. `select` in `backend/pyproject.toml` now describes
the set the project actually chose, and `ruff check .` in `backend/` is clean
against both 0.16.0 and 0.15.x. Nothing here is outstanding; the section is kept
only for the measurement recipe and the `noqa` warning below, which apply to any
future rule adoption.


`select` in `backend/pyproject.toml` grows one family per PR. Remaining, with
counts **re-measured against ruff 0.16.0 on 2026-07-29 under the current
config**. The 947 figure quoted above and in ROADMAP was taken under the *old*
configuration, before the modern-typing family was adopted; it does not describe
what is left. The measured total was 292.

**How to measure a family — applies to every phase below.** Always measure with
`--extend-select <RULE>` on top of the locked set, never with `--select`:

```bash
ruff check . --extend-select RUF100 --statistics   # correct
ruff check . --select RUF100                       # wrong — replaces the set
```

`--select` *replaces* the rule set instead of extending it, so the rules that are
normally on get switched off. Any `# noqa` naming one of them then looks unused
and the count comes out too high. Measuring `RUF100` that way gave 30 and 24
findings; the actual number under the project's configuration is 22.

| PR | rules | count | character |
|---|---|---|---|
| 1.1a | `RUF100` | 22 | autofix, but **not** mechanical — see the noqa warning below. **Done** |
| 1.1b | `LOG015`, `G201` | 120 + 41 | mechanical, but read the diff — `G201` rewrites `logger.error(..., exc_info=True)` into `logger.exception` and changes what gets logged. Both counts confirmed on measurement; all 41 `G201` sites verified to be inside an `except` handler, so no site needed to keep `exc_info=True`. **Done** |
| 1.1c | `SIM102` | 17 | **not** an autofix, contrary to the first draft of this plan. ruff offers no safe fix (3 of the 17 have an *unsafe* one). Twelve sit in `core/matching.py` as triple-nested guard chains that collapse into long compound conditions, so each is a readability judgement. Its own PR, not a passenger on an autofix. **Done** — all 17 collapsed and **no `noqa` was needed**: the twelve `core/matching.py` chains read better as one flat parenthesized `and`-chain than as four indent levels, and short-circuit order was preserved at every site (two conditions have order-dependent side effects — a logging call and a `setdefault`) |
| 1.1d | `BLE001` | **67** (0.15.20) / **66** (0.16.0) | blind `except Exception`. Every site is a decision: narrow the exception, or keep it and say why. A mechanical pass here **will** change behaviour. **Done** — 21 narrowed (so an unexpected exception now propagates there), 36 kept broad with `# noqa: BLE001` and a motivation written from the code, 7 in `scripts/archive/` covered by a `per-file-ignores` entry, and 2 no-op `try`/`except` blocks deleted rather than annotated (`core/config.py` guarded a `logging.getLogger().setLevel()` that cannot raise; `rename_service.py` opened a RAW with rawpy only to `pass`). Two traps for the remaining phases: `rawpy.LibRawError` does **not** inherit from `OSError`, and **BLE001 is itself version-dependent** — 0.16.0 exempts handlers logging with `logger.warning(..., exc_info=True)` while 0.15.20 does not, so a `noqa` there is required by one version and reported as RUF100 by the other (that one site, `api/server.py:51`, keeps the broad catch and switched to `logger.exception(...)`, which both versions exempt — no directive needed, and one would be RUF100 in both). That single site **is** the whole 67-vs-66 gap, verified by diffing both versions' finding lists over the same tree — so the 66 in this table was never stale, it was measured with 0.16.0. When a future phase reports a count, say which ruff version produced it. The same exemption means this count is independent of 1.1b: both `logger.error(..., exc_info=True)` and the rewritten `logger.exception(...)` are exempt |
| 1.1e | `DTZ005` | 26 | naive `datetime.now()`. Same character. Count confirmed on measurement. **Done** — 19 sites became aware **local** (`.astimezone()`) and 2 aware UTC; **5 deliberately stayed naive** behind `# noqa: DTZ005` because they write or read a persistent on-disk format. The plan's warning about `attempt_stats.jsonl` held, and `trash/manifest.jsonl` turned out to be the same case but sharper: `purge_expired()` compares `fromisoformat(trashed_at)` against a `datetime.now()` cutoff, and an aware cutoff raises `TypeError` on every pre-existing naive entry — a failure the surrounding `except (ValueError, TypeError)` does not catch, because it wraps the *parse*, not the comparison. Note the interaction with **1.1d**, checked on rebase: both callers of `purge_expired` now have a broad `except Exception`, so the failure would not surface as a crash but as a **silent** one — retention logs an exception and purges nothing, and the naive entries that trip it are never removed, so it never self-heals. Local rather than UTC for the 19 was itself a judgement: archive filenames and report headers want local wall clock, and the `created_at` / `last_accessed` fields already sit on disk as naive local, so `.astimezone()` keeps the digits and only appends an offset. That matters concretely for `last_accessed`, which the preprocessing cache sorts as a **string** for LRU eviction — mixed naive/aware values still order correctly, verified. The migration that would make the two naive formats aware is logged under **Teknisk skuld > Backend** in ROADMAP |

**`E402` has no phase.** An earlier draft listed it as 1.1c with 112 findings.
That count came from the old configuration; the rule is already part of `E4` in
the locked set and measures **zero** today (`api/server.py` carries its
`per-file-ignores` entry, `preprocessed_cache/` is excluded). There is nothing to
adopt — do not reintroduce the phase.

Order matters: 1.1a and 1.1b are cheap and build confidence in the process;
1.1c–e need judgement and should not be attempted while the mechanical ones are
still outstanding, because a reviewer cannot tell them apart in one diff.

**Warning for every future `noqa` sweep — this recurs each time `select`
grows.** `RUF100` flags any `# noqa` that suppresses nothing, and a directive
naming a rule that is **not yet selected** counts as unused. Two classes, and
only one is safe to delete:

- **(a) `noqa` for a selected rule that genuinely does not fire.** Safe to
  remove; the autofix is right.
- **(b) `noqa` for a rule outside `select`.** Removing it is correct per the
  rule, but the *justification* dies with the comment — and it is needed again
  the day that rule is adopted, which is precisely what this plan does. Read the
  code and establish what the construct actually does, then either preserve the
  reason as a plain comment or, if there turns out to be no reason, delete the
  construct. Do not guess the reason from the rule name, and do not write a
  justification the code does not support: a comment that preserves a
  misconception is worse than no comment, because it is what gets cited to put
  the directive back.

1.1a hit exactly one class (b) case: `# noqa: B006` on `last_shown` in
`core/image.py`. It looked like a deliberate mutable default; reading the code
showed the one-slot list is written at both exits of `show_temp_image` and never
read — write-only since the function was first written. The parameter was
deleted rather than annotated, which removes the violation instead of explaining
it. **Deletion is a legitimate outcome of class (b), often the better one.**
Never run `--fix` over a `noqa` sweep without reading each removed line.

**Verification for every one of these**, established in #254/#255 and not
optional:

- `ruff check .` clean in `backend/` against **both** 0.16.0 and 0.15.x. A config
  that is clean under only one version has reintroduced the original bug.
- `pytest`, with counts before and after.
- For anything touching `api/`: confirm the FastAPI app still imports and
  registers the same number of routes as `dev`. Better, and what the #255
  reviewer did: build the OpenAPI schema from both trees and diff it. Pytest does
  not necessarily reach every route module.

### 1.2 Lint coverage for `shared/`

`shared/shared_types.py` and `shared/generate_schemas.py` are real project source
in the repo root. Nothing lints them: the config lives in
`backend/pyproject.toml`, and CI runs ruff with `working-directory: backend`.

Both files are **clean today** (fixed by hand in #255), so this PR turns the
check on rather than fixing a backlog.

**The one thing that must not be got wrong:** the repo root has no
`pyproject.toml` or `ruff.toml`, so `ruff check shared/` without `--config`
discovers no configuration at all and falls back to 0.16's *default* set — which
reports `EXE001` on `generate_schemas.py:1`. **Mirror `select` explicitly in
whatever root config you add.** Letting ruff fall back to its default is the
exact bug that took CI down on 2026-07-18.

Two shapes work: a root config that points at the same rule set, or a second CI
step for `shared/`. Either is fine; the mirroring is what matters.

**Done** — root shape, with the rule set *inherited* rather than mirrored by
hand: `ruff.toml` in the repo root is one line, `extend =
"backend/pyproject.toml"`, and CI gains a `ruff check .` step run from the repo
root in the backend job. The step lints `.` rather than an enumerated `shared/`
deliberately: enumeration is the same drift that caused this phase — a new
top-level directory would be silently unlinted again. From the root it sweeps 148
files (149 under 0.16.0, which counts `ruff.toml` itself), all of `backend/` plus
`shared/`, clean on both versions in ~20 ms. `backend/` being swept twice is not a
duplicate check to remove: the backend step runs with `backend/` as the invocation
root, which is the shape developers use locally, and the root step is the drift
guard. Inheriting satisfies the "never fall back to the
default" requirement without creating a second `select` list to keep in sync —
the next rule adoption in `backend/pyproject.toml` covers `shared/` in the same
edit. That the inherited set really applies is verified by a negative test rather
than assumed: an injected `List[int]` annotation reports `UP006`/`UP035`, which
are **not** in ruff's default set, plus `F401`/`E402` — 5 findings, exit 1, on
both 0.15.20 and 0.16.0. The inheritance was then checked against a *later*
adoption rather than only the set that existed when it was written: with 1.1e
merged, `DTZ005` appears in the root config's enabled rules without `ruff.toml`
being touched, and an injected `datetime.now()` in `shared/` is reported from the
root on both versions. The `--config backend/pyproject.toml` shape was measured
too and also works, but leaves the trap open for anyone running ruff locally or
through an editor from the root, where no flag is passed. Three things worth
knowing for later:

- **`backend/` is unaffected, and that is measured, not argued.** Ruff resolves
  each file against the nearest configuration, so `backend/pyproject.toml` still
  wins there: `ruff check . --show-settings` in `backend/` is byte-identical
  before and after the root config exists (438 lines, `project_root` unchanged).
- **Relative globs in an inherited config resolve against the directory of the
  file that *defines* them.** `per-file-ignores` for `"api/server.py"` in
  `backend/pyproject.toml` resolves to `<root>/backend/api/server.py` even when
  ruff is invoked from the repo root (`--show-settings`:
  `absolute_matcher = …/backend/api/server.py`), and it keeps working: a decoy
  `<root>/api/server.py` with a deliberate `E402` **is** reported on both
  versions, while `backend/api/server.py` stays exempt. The inherited
  `extend-exclude` behaves the same way — a probe file under
  `backend/preprocessed_cache/` is still excluded from a root-level run. So
  backend-relative entries in the backend config are safe to add; they mean the
  same thing from either root. **`--config` is the shape that differs**: passing
  `--config backend/pyproject.toml` resolves those globs against the working
  directory instead (`<root>/api/server.py`), which **inverts which file is
  protected**: run from the root, `backend/api/server.py` loses its exemption and
  its two deliberate `E402` are reported on both versions, while the decoy would
  be the file exempted. That is the strongest reason the root config was chosen
  over the flag. One setting genuinely does follow the
  invocation root: `linter.src` becomes `<root>` + `<root>/src`, which is inert
  here (no first-party imports are resolved from the root).
- **A root-level run does sweep Python placed anywhere not excluded, `frontend/`
  included** — verified with a probe file, which was reported. There is no Python
  under `frontend/` today, so the step is green; if a build helper lands there it
  gets the same rule set, which is the intent.

The shebang and the 100644 mode on `generate_schemas.py` are left alone
deliberately: the documented invocation is `python shared/generate_schemas.py`,
never `./generate_schemas.py`, and `EXE001` is outside the locked set. The bug
was the fallback, not the file.

### 1.3 Ignore-marker consolidation — **Done**

The four mechanisms are one. New leaf module `backend/core/labels.py` owns the
vocabulary — `IGNORE_MARKERS`, the written marker `CANONICAL_IGNORE_MARKER`, and
the readers `strip_label_index` / `is_ignore_name` / `is_ignore_label` — and
imports nothing from `core`, so `core.db` and `core.naming` can both use it
without the import cycle that a home in `core/naming.py` would have created.
Prefix stripping now exists in exactly one function.

Two readers rather than one, because the call sites genuinely differ: `core.db`,
`core.naming` and `rename_service` de-prefix the label themselves and hold a
bare name (`is_ignore_name`), while `statistics_service` holds the raw display
label (`is_ignore_label`, which strips `#N\n` first).

`statistics_service`'s prefix matching is fixed, not just its marker set, so
`#3\nign` now counts as an ignore. Matching is exact instead of
`endswith("ignorerad")`: a person name ending in a marker (`X ignorerad`) counts
as a person. Measured on the corpus (25 306 labels): 10 508 exact `ignorerad`,
zero `ign`/`okänt`/`okant`, and zero labels that the old `endswith()` branch
caught but exact matching does not — so today's published figures are unchanged
in both directions. `extract_face_labels` gained the `okant` it lacked.

`tests/test_ignore_markers.py` is the invariant matrix that keeps the class from
returning: every marker in case and whitespace variants × prefixed and bare ×
every consolidated path, plus a cross-path agreement test asserting one verdict
per label. 134 new tests.

Two of those pin a divergence this change deliberately does **not** remove: the
second live prefix form `#manuell\n<name>`, written by `add_manual_face` for a
hand-named face. `core/labels.py` knows only `#N`, so `core/naming.py` and
`rename_service` keep such a name while `extract_face_labels` drops it — 256
names across 222 used attempts in the current corpus, of 274 `#manuell` labels
in all, which is every label that is not `#N`. Pre-existing, documented in both
docstrings, and tracked in ROADMAP as its own behaviour-changing PR.

This closes **all of Phase 1** — 1.1 landed as #254–#262, 1.2 as #263, and 1.3
here. Phase 2 is next.

---

## Phase 2 — Finish the action catalog

`workspace/actions/actionCatalog.js` (#249) is the single source for *which
actions exist*, but it is not yet the source for *what they do*.

### 2.1 Take the app menu into the catalog — **Done**

The menu — `src/main/menu.js` → `menu-command` IPC → `flexlayout/menuCommands.js`
— is a third dispatch path the catalog does not model. Roughly 25 menu-only
actions are absent: `Cmd+S` save-all, bare `Escape` discard, every
`Cmd+Shift+<letter>` module accelerator, theme switching, layout templates,
open-trash.

Add a third `route.via` (or a `menuCommand` field) and take the missing actions
in. The route-target validation added in #249 should be extended to cover it, so
a menu command with no listener fails the test rather than the user.

**Done** — both mechanisms, because the plan's "or" turned out to be two
different questions. `route: { via: 'menu', command }` is the third bus: the
menu-command table performs the action *itself*, with a direct call on its
workspace ctx and nothing underneath (theme switching, the layout-geometry
helpers, the file dialog, the welcome card). A separate `menuCommand` field is
the *binding* — which menu item triggers an action some other bus performs, and
that is genuinely extra information only for `dispatch` actions, where the
command name is nothing the intent mentions (`open-review-module` →
`open-module review-module`).

The first draft went further and said an `emit` action needs *no* `menuCommand`,
because menu.js sends the event name verbatim so `route.event` already is the
command. **Review caught that as wrong**, and the reasoning is worth keeping:
it held for all 17 emit actions by coincidence, not by rule — an emit action
reachable only from a keyboard listener has no menu item at all — and, worse, it
made the third-direction check *unable to fail*, because the binding being checked
was derived from the very file it was checked against. Bindings are now declared
on every action and inferred on none, at a cost of one line each.

**Measured, not eyeballed:** 28 actions added (58 → 86), and the catalog declares
all **64** distinct commands menu.js sends, asserted in three directions — every
command sent is declared, every command declared has a handler, every command
declared is still sent. The first write-up said 26, 60 → 86 and 63; all three
numbers were estimated rather than counted, and all three were wrong.

Three things worth carrying forward. **The dead-command count was 8, not 1.** The
validation caught `reload-database` as the plan predicted, and seven more nobody
had logged: the five `grid-preset-*` items (Cmd+Shift+1..5) and
`export-layout` / `import-layout`. They sit in `KNOWN_DEAD_MENU_COMMANDS` with a
TODO pointing here, and 2.2 is now a bigger item than its heading suggests — see
the note there. **`Cmd+R` is doubly wrong:** the dead `reload-database` is a menu
*accelerator*, and a menu accelerator wins over any renderer keydown, so it also
makes the catalog's `general.reload` ("Ladda om fönstret", same key) unreachable.
Both halves are one decision. **And the mirror exists:** six handlers in
menuCommands.js that no menu item sends (`KNOWN_UNREACHABLE_HANDLERS`), all
layout-template aliases stranded when the Window menu was rewritten. 2.2 empties
both lists.

**The Escape question, which gates 2.3.** `Escape` is a global menu accelerator
(Arkiv ▸ Kasta ändringar). If the rule that makes `general.reload` unreachable
holds generally, it should also make four catalogued Esc actions unreachable —
`review.cancel` and the three culling ones. It is not established that it does:
CullingModule's capture-phase listeners may win, or Electron may treat `Escape`
unlike letter accelerators. **This needs a GUI run to settle and cannot be
answered by reading the code.** Settle it before migrating any Escape listener —
migrating a listener whose key may never reach it would cement a bug in catalog
form. Logged in ROADMAP as a must-verify.

Nothing about the running app changed: every new action carries `help: false`, so
the derived shortcuts overlay is byte-identical (verified by diffing
`SHORTCUT_SECTIONS` across the change, not by eye). Surfacing the menu
accelerators in the overlay is a real question — a dozen of them are undocumented
keyboard shortcuts — but it is a UI decision, not this PR's.

### 2.2 `reload-database` is dead — **Done**

`menu.js:157` sends `reload-database`; no renderer listener exists, so it falls
through to the default broadcast and does nothing. `Cmd+R` looks like it works.

Either wire it to a real reload of the database views or remove the menu entry.
Do not leave it. If 2.1 lands first, its validation test catches this
automatically — which is a good reason to do them in that order.

**Scope revised after 2.1 landed.** The validation found eight dead commands, not
one, and this item now owns all of them — they are listed in
`KNOWN_DEAD_MENU_COMMANDS` in `actionCatalog.js`, and the phase is finished when
that list is empty and the constant is deleted (the test asserts a listed command
is still both dead and still sent, so a stale exception cannot survive either):

| Menu item | Command(s) | Accelerator |
|---|---|---|
| Arkiv ▸ Ladda om databas | `reload-database` | `Cmd+R` |
| Fönster ▸ Rutnätsförval | `grid-preset-{50-50,60-40,70-30,30-70,40-60}` | `Cmd+Shift+1..5` |
| Fönster ▸ Exportera layout… | `export-layout` | — |
| Fönster ▸ Importera layout… | `import-layout` | — |

Three are worse than merely inert. `Cmd+R` and `Cmd+Shift+1..5` are menu
accelerators, and a menu accelerator wins over any renderer keydown, so those keys
are *consumed* — `Cmd+R` in particular shadows the catalog's `general.reload`, and
removing the menu entry is what would make that key work at all. The two layout
items end in an ellipsis, which promises a file dialog that never opens. Deciding
per item (wire up or remove) is the work; deleting is a legitimate outcome for any
of them, and probably the right one for the grid presets, whose ratios the
draggable splitters already give.

**Done — all fourteen removed, and the history is what decided it.** For the eight
dead *commands*, `git log -S` converged on one commit: **5686ff9 (2025-12-31),
"Remove dockview mode"**, which deleted `workspace.js` and with it the switch
cases that implemented them. The menu items stayed behind. So these were not
never-implemented stubs — they were a working feature set orphaned by a
layout-engine migration, and *nothing has worked for seven months without a single
bug report*. That is the strongest evidence available that the features are not
wanted, and it turned every per-item decision towards removal rather than
reimplementation.

**The six handler aliases do not share that history**, and an earlier draft of
this section was wrong to say they did — review caught it. Searching `menu.js`
per alias gives three answers, not one: `layout-template-review` (added in
`40ae5b0`) and `layout-queue-review` (added in `7240497`) *had* menu items and
kept them well past the dockview removal, losing them only in `fe4cfe1` (#237,
the Window-menu rewrite around the pipeline morph); `layout-review`,
`layout-comparison`, `layout-database` and `layout-review-with-logs` have **never**
had a menu item in any commit — the search is empty for all four, so they were
programmatic table entries from the start. Same outcome, different reasons: two
are leftovers from a menu rewrite, four were never menu-driven at all. The lesson
is the one this plan keeps relearning — verify per item; a shared symptom is not
a shared cause.

| Item | Decision | Why |
|---|---|---|
| Arkiv ▸ Ladda om databas (`Cmd+R`) | Remove menu item | The backend endpoint lives and is tested, so wiring was possible — but the accelerator shadows the window reload FlexLayoutWorkspace really implements, and the old code reported via `alert()`. A DB reload belongs as a button in Databashantering, not on a global key. Endpoint untouched. **Side effect: `Cmd+R` starts working** — `FlexLayoutWorkspace.jsx:624` has always implemented it, the menu accelerator was intercepting the key. |
| Fönster ▸ Rutnätsförval (`Cmd+Shift+1..5`) | Remove submenu | Emulated dragging a splitter to a fixed ratio; FlexLayout splitters are draggable, so the feature *is* the interaction it stood in for. Never documented. Frees five keys that read as siblings of the `Cmd+1..5` steps. |
| Fönster ▸ Exportera/Importera layout | Remove items | Per-step layout memory plus reset-layout / reset-all-layouts cover the need; layout JSON on disk is a debugging aid. Never documented, and the ellipsis promised a dialog that never opened. |
| Six `layout-*` handler aliases | Remove | The menu is the dispatch table's only caller, so an alias without a menu item is unreachable by construction — whether it lost one (two of them) or never had one (four). The two surviving templates stay; `load-layout` still accepts every name in `layouts.js`. |

Both exception lists are now empty and **kept, not deleted**. An empty list plus
its honesty test is cheap regression protection: a future entry must be a command
the menu really sends and really fails to handle, so the list cannot be used to
silence an unrelated failure. Adding to it should feel like filing a defect.

Test count is unchanged at 938 — no test was added or removed. Two
characterization tests drove the layout presets through now-deleted aliases and
were retargeted to the surviving command names with identical assertions. The
derived shortcuts overlay is also unchanged, which is the expected result rather
than a lucky one: every removed action was `help: false`, so the overlay never
advertised any of it.

**The Cmd+Shift+L collision is resolved in the same PR** (ROADMAP had tracked it
since v1.8.0): Återställ layout keeps the key, the external-editor item gets no
accelerator. The argument is scope, not mnemonics — `open-raw-in-lightroom` is
module-scoped, so a *global* accelerator did nothing outside Gallra spelare while
consuming the key everywhere, and inside it the bare `L` already works. ROADMAP's
own suggestion (move the editor to `Cmd+Alt+L`) was deliberately not taken: it
recreates the same problem in milder form.

### 2.3 Migrate the four keyboard listeners

The largest item in this plan and the one with the most regression risk.

Semantics still live inline in `hooks/useKeyboardShortcuts.js`,
`components/review/useReviewKeyboard.js`, `CullingModule.jsx` (a window listener
**plus four capture-phase listeners**) and `FlexLayoutWorkspace.jsx`.

**Do not do this as one PR.** One listener per PR, in ascending order of risk:

1. `useKeyboardShortcuts.js` — the generic hook, simplest guards
2. `FlexLayoutWorkspace.jsx` — few bindings
3. `useReviewKeyboard.js` — one listener, clean structure
4. `CullingModule.jsx` — last, and on its own

`CullingModule` is where the historical double-trash bug lived; see the header
comment in `hooks/useActiveTabset.js`. Its four capture-phase listeners exist for
reasons that are not obvious from reading them, and consolidating them is a
separate change from migrating them. Do not do both at once.

**Precedent to follow:** #249 wrote a characterization test *before* refactoring
and required it to pass unchanged afterwards. Do the same per listener: assert
that every key produces the same state transition through the catalog as it does
today. That equivalence assertion is the deliverable; the migration is the
mechanism.

---

## Phase 3 — Test-harness debt

Both items are consequences of #256 rather than regressions from it.

### 3.1 Microtask counting — **Done**

Culling and PlayerCount tests settled effects with a hand-counted number of
`await Promise.resolve()` inside `act()`, sometimes two in a row. Microtask
ordering is deterministic, so this was **not** load-dependent and was not the
cause of the flakiness — but it coupled each test to how many awaits the
component happens to have before its next observable change.

The failure mode is invisible: if a component grows an await, a *negative*
assertion silently stops testing anything and keeps passing. #256 hit exactly
this and fixed two instances with
`await vi.advanceTimersByTimeAsync(0)` under the fake clock; the ROADMAP entry
records the idiom as a forward rule.

Sweep the rest. Prefer settling on rendered outcome (`waitFor` on what the user
would see) over counting internal steps.

**Done** — 96 flushes gone from 15 files. The sweep was wider than the two module
families named above: FileQueue, Review, RenameNef, ImageViewer and the
FlexLayout morph/move tests carried the same pattern. Rendered outcome where a
test has one (`waitFor`/`findBy*`); where it does not — mount helpers whose
outcome differs per test, and the step before a purely negative assertion — a
full macrotask through a new shared helper, `frontend/tests/helpers/settle.js`.
Four things worth carrying forward:

1. **`waitFor` cannot be used under a fake clock.** Testing Library's fake-timer
   detection is gated on a `jest` global that Vitest does not define, so a
   `waitFor` under `vi.useFakeTimers()` polls a clock that never advances and
   burns its whole `asyncUtilTimeout` in real time. `settle()` detects the clock
   itself and advances timers instead; any wait added under a fake clock must do
   the same.
2. **Settling on the request is not settling on the render it causes.** A
   `waitFor` on a POST can return before the response has been applied, leaving a
   render pending when the test ends; it commits during teardown — after
   `vi.restoreAllMocks()` — and throws there instead. The culling Cmd+Z test hit
   exactly this and now ends with a drain.
3. **A mount helper rarely has one rendered outcome.** `loadFiles` in
   `cullingModuleFence` cannot wait for file rows: two of its callers load in
   grid mode, where the list does not render at all. Helpers drain; individual
   tests wait for outcomes.
4. **One weak test surfaced.** `cullingStatsScope`'s "does NOT blank the panel on
   a player-only filter" claimed in its comment that a refetch had been issued
   but never asserted it — it would have passed had the click done nothing at
   all, because "the rows are still there" is true both when the panel did not
   blank and when nothing happened. It now waits for the `/players/count` call as
   a positive anchor first. **No test failed once its counted flush became a full
   drain**: the guards genuinely hold. What changed is that they are now tested.

Suite unchanged at **938 passed / 96 files** — identical to the base and
identical between runs. (It was 927 on both branch and base when the sweep was
written, three consecutive runs; rebasing onto dev picked up the tests merged
while the branch was open, and both sides moved together to 938.) `npx eslint
tests/` clean.

### 3.2 Contention cost profile

`testTimeout` is 20 s because component tests measure 3–6 s under heavy CPU
sharing instead of 10–100 ms. That is a budget, not an optimisation.

The dominant cost is jsdom setup — `environment` was 487 s across 96 files in the
reproduction run — because Vitest builds a fresh jsdom per file. Options worth
measuring before choosing: a shared environment for the component suites,
`pool: 'threads'` tuning, or splitting the heavy component files out into their
own project.

**Measure before changing.** The reproduction recipe is ten full suites run in
parallel against each other; four is not enough and produces a misleading
all-green. Baselines on unmodified code were 9/10 runs red at `load average` ~170
and 5/10 on a lighter machine — same method, both 0/10 after #256.

`slowTestThreshold: 10000` is the guard that makes this observable: nothing
prints on a healthy run, and anything that does print is genuinely halfway to
timing out. If work here makes tests faster, that threshold should come down with
them.

### 3.3 `PreferencesManager.load()` does not persist migration — **Done**

`load()` never wrote back the migrated result and `mergeWithDefaults` copies the
stored version over the default, so an install stayed at its old version and
re-entered `migrate()` on every launch until an unrelated write happened to save.

Harmless while `migrate()` is a pure merge — which it is — but the method is
documented as the seam for future per-version steps, and the first
non-idempotent one would have run repeatedly. The fix (`save()` after migrating)
changes when preferences first touch disk, which is why it was its own PR and not
a line in someone else's.

**Done** — `load()` migrates and writes the result back. Four decisions worth
carrying forward, two of them from the review round.

**Only the migration branch writes:** a payload already at the current version is
merged in memory and left alone on disk, so an ordinary launch costs no write;
writing unconditionally after `load()` would have been simpler but turned every
start into a storage write with nothing changed. The fresh-install branch (no
stored payload) is untouched and still writes nothing until the user saves.

**The migration only runs forwards.** The stored version is read as
`Number.isFinite(parsed.version) ? parsed.version : 0` and compared with `<`,
not `!==`. `Number.isFinite` rather than a `??` default on purpose: `??`
substitutes only for `null`/`undefined`, so a hand-edited `"version": "1"` would
survive as a string — and `"1" < 2` coerces to true while `"3" < 2` is false, so
a string version would decide the direction by accident, in the one case (someone
editing the file by hand) where the payload is least trustworthy. Anything that is
not a finite number counts as version 0, older than everything, and migrates.
A payload from a *newer* build (the user ran a later version and rolled
back) is left alone: stamping it down to this version's number while the newer
keys stay on disk would make the next newer launch re-run its own per-version step
on already-migrated data, which is the double application this write exists to
prevent. The same gap remains open on the *user-write* path: `save()` still stamps
unconditionally. Logged in ROADMAP.md — closing it starts with a question about
data, not about numbering: a payload after rollback-plus-save is *mixed*, the
newer build's keys sitting beside the older build's writes, and no single version
number describes it honestly.

**Only the stored payload is persisted, not the merged tree.** `migrate()` takes
and returns storage shape; writing the merge would freeze today's defaults into
the install, so a later change to a default would never reach it. Checked before
choosing the split rather than after: the eight readers in `fileQueuePrefs.js`
parse the stored blob directly, bypassing this module — and every one already
falls back with `?? default` for missing keys, which they must, since a fresh
install has never written anything at all. The split therefore makes the stored
blob look *more* like the shape they were written for, not less.

**Error handling lives in one write path**, `persistStored()`, which catches, logs
and returns `false`; `save()` now goes through it too. `load()` runs from the
constructor, so a throw there would take the singleton with it; a read-only or
full backend degrades to the old behaviour (migration applies in memory, the
version stays put on disk, the step repeats next start) instead of breaking
startup. The idempotence requirement on a future per-version step therefore
remains, for the weaker reason.

Frontend suite **927 → 932 passed** across 96 files, `npm run build:workspace`
clean.

One test-harness lesson from the CI round, kept because it generalises: the test
file installs its own storage **unconditionally** now. Doing it conditionally made
the file environment-dependent and turned CI red — under Node 26 the bare
`localStorage` global is Node's own (unavailable) built-in, so the shim installed
and `localStorage.setItem = …` took effect, while CI's Node has no such built-in,
Vitest's jsdom left a **real** `Storage` there, and assigning to `setItem` on a
jsdom Storage does not replace the method at all: the proxy stores an *item* named
"setItem" and the real method keeps running. The refuse-writes test then refused
nothing while still passing. Both instrumented tests now also assert that the
instrument is connected — the same "prove the negative had its chance" rule as
3.1.

---

## Working rules for this plan

Carried from the session that produced it, because each was learned the hard way:

1. **Check CI before merging.** Three PRs were merged on 2026-07-29 without
   looking at CI, which had been red for eleven days. It happened to be
   environmental. It might not have been.
2. **A tool must never inherit a default you do not control.** Pin the version
   *and* declare the rule set. This plan exists because that was not done once.
3. **One rule family, one listener, one concern per PR.** A mechanical change and
   a judgement call in the same diff cannot be reviewed.
4. **A fix justified by measurement needs the measurement in the PR**, with its
   conditions. Two different headline numbers in circulation is worse than one
   with a caveat.
5. **Flaky-test remedies that only raise budgets are not remedies.** If a budget
   change is genuinely needed, prove it with a paired ablation — both arms run
   simultaneously, differing only in the budget.

---

## Suggested order

Phase 1 first and in order: it removes active harm and each PR is small.
Phase 2.1 before 2.2 (the validation test catches the dead command for free).
Phase 2.3 last within its phase, one listener at a time, `CullingModule` alone.
Phase 3 can run in parallel with Phase 2 — it touches tests and config, not the
same files.

Nothing here blocks the MIDI hardware track, and the hardware track does not
block anything here.
