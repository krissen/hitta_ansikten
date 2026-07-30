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

## Phase 1 — Finish the toolchain

Do this first. It is the only phase where an unfinished state is actively
harmful: `select` currently describes a rule set nobody chose, and `shared/` is
still unlinted.

### 1.1 Remaining ruff families, one PR each

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
| 1.1b | `LOG015`, `G201` | 120 + 41 | mechanical, but read the diff — `G201` rewrites `logger.error(..., exc_info=True)` into `logger.exception` and changes what gets logged |
| 1.1c | `SIM102` | 17 | **not** an autofix, contrary to the first draft of this plan. ruff offers no safe fix (3 of the 17 have an *unsafe* one). Twelve sit in `core/matching.py` as triple-nested guard chains that collapse into long compound conditions, so each is a readability judgement. Its own PR, not a passenger on an autofix. **Done** — all 17 collapsed and **no `noqa` was needed**: the twelve `core/matching.py` chains read better as one flat parenthesized `and`-chain than as four indent levels, and short-circuit order was preserved at every site (two conditions have order-dependent side effects — a logging call and a `setdefault`) |
| 1.1d | `BLE001` | 66 | blind `except Exception`. Every site is a decision: narrow the exception, or keep it and say why. A mechanical pass here **will** change behaviour |
| 1.1e | `DTZ005` | 26 | naive `datetime.now()`. Same character. Note that `attempt_stats.jsonl` timestamps are naive today and the analysis in `benchmarks/label_usage.py` parses them — changing them is a data-format change, not a lint fix |

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

### 1.3 Ignore-marker consolidation

Four mechanisms filter the same concept — labels meaning "this is not a person":

| site | set |
|---|---|
| `core/naming.py` | `IGNORE_MARKERS` = `{ignorerad, ign, okänt, okant}` — the canonical one, added in #251 |
| `core/db.py:507` | `{ignorerad, okänt, ign}` — missing `okant` |
| `api/services/rename_service.py` | near-copy |
| `api/services/statistics_service.py:115` | **partly dead**: matches on the whole label including the `#N\n` prefix, so `label.strip().lower() == "ign"` can never be true for a prefixed label, and `okänt`/`okant` are absent entirely |

`statistics_service` therefore **undercounts ignores** relative to the other
three. The defect is *latent today* — those markers occur zero times in the
current corpus, verified via `benchmarks/label_usage.py`, so published statistics
are unaffected.

Consolidate onto `core.naming.IGNORE_MARKERS`. **Fix `statistics_service`'s
prefix matching, not merely its marker set** — swapping the set alone leaves the
dead branch dead. Because the sets genuinely differ, this changes behaviour on
any corpus containing `okant`; say so in the changelog rather than presenting it
as a refactor.

---

## Phase 2 — Finish the action catalog

`workspace/actions/actionCatalog.js` (#249) is the single source for *which
actions exist*, but it is not yet the source for *what they do*.

### 2.1 Take the app menu into the catalog

The menu — `src/main/menu.js` → `menu-command` IPC → `flexlayout/menuCommands.js`
— is a third dispatch path the catalog does not model. Roughly 25 menu-only
actions are absent: `Cmd+S` save-all, bare `Escape` discard, every
`Cmd+Shift+<letter>` module accelerator, theme switching, layout templates,
open-trash.

Add a third `route.via` (or a `menuCommand` field) and take the missing actions
in. The route-target validation added in #249 should be extended to cover it, so
a menu command with no listener fails the test rather than the user.

### 2.2 `reload-database` is dead

`menu.js:157` sends `reload-database`; no renderer listener exists, so it falls
through to the default broadcast and does nothing. `Cmd+R` looks like it works.

Either wire it to a real reload of the database views or remove the menu entry.
Do not leave it. If 2.1 lands first, its validation test catches this
automatically — which is a good reason to do them in that order.

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

### 3.1 Microtask counting

Culling and PlayerCount tests settle effects with a hand-counted number of
`await Promise.resolve()` inside `act()`, sometimes two in a row. Microtask
ordering is deterministic, so this is **not** load-dependent and was not the
cause of the flakiness — but it couples each test to how many awaits the
component happens to have before its next observable change.

The failure mode is invisible: if a component grows an await, a *negative*
assertion silently stops testing anything and keeps passing. #256 hit exactly
this and fixed two instances with
`await vi.advanceTimersByTimeAsync(0)` under the fake clock; the ROADMAP entry
records the idiom as a forward rule.

Sweep the rest. Prefer settling on rendered outcome (`waitFor` on what the user
would see) over counting internal steps.

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

### 3.3 `PreferencesManager.load()` does not persist migration

`load()` never writes back the migrated result and `mergeWithDefaults` copies the
stored version over the default, so an install stays at its old version and
re-enters `migrate()` on every launch until an unrelated write happens to save.

Harmless while `migrate()` is a pure merge — which it is — but the method is
documented as the seam for future per-version steps, and the first
non-idempotent one will run repeatedly. The fix (`save()` after migrating)
changes when preferences first touch disk, which is why it is its own PR and not
a line in someone else's.

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
