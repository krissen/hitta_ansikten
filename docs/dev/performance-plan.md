# Performance Plan

Forward-looking, **release-scoped** plan for a performance-focused release
(sprints, deliverables, Definition of Done). This is deliberately narrower than
the top-level [ROADMAP.md](../../ROADMAP.md), which is the living
backlog / known-issues / tech-debt list across all horizons. When any of the
work below is picked up, track it as a normal roadmap item and check it off in
[CHANGELOG.md](../../CHANGELOG.md) once shipped.

> **Status: largely delivered.** The 2026 full-codebase audit (PRs #122–#162)
> shipped most of this plan piecemeal rather than as a single tagged release.
> Each sprint below is annotated with what landed and its PR/area; the genuinely
> open items are collected under [Remaining work](#remaining-work) and tracked in
> [ROADMAP.md](../../ROADMAP.md). This document is now a record of that plan and
> its outcome, not an unexecuted proposal.

---

## Scope

This release focuses on end-to-end performance and efficiency improvements:

- Backend request latency and event loop health
- Database I/O efficiency during review flows
- Frontend runtime overhead and responsiveness
- Better scalability for larger face databases and longer sessions

---

## Sprint 1 - Foundation and largest latency gains

### Goals

- Remove major backend event-loop blocking
- Reduce time-to-first-result for face detection
- Establish baseline performance instrumentation

### Planned work

- **[Done]** Move heavy detection and thumbnail work off the async event loop —
  `detection_service`, `statistics_service`, and `import_service` run blocking
  CPU/IO work via `asyncio.to_thread` / executors (delivered piecemeal across
  the audit).
- **[Remaining]** Add concurrency limits for expensive endpoints (`detect`,
  `thumbnail`, `preprocess`) — no per-endpoint semaphore exists yet.
- **[Done]** Reuse `file_hash` across flows to avoid repeated large-file hashing
  — detection returns `file_hash`; `mark-review-complete`/`batch-confirm` accept
  it back so the file isn't re-hashed.
- **[Done]** Reduce aggressive frontend polling where event-driven updates are
  available — `LogViewer` reacts to log events instead of its old 100 ms poll;
  the statistics dashboard's refresh is user-toggleable with a configurable
  interval.

### Deliverables

- P95 latency for `/api/v1/detect-faces` improved by at least 30%
- No noticeable UI freeze during concurrent operations
- Baseline/perf dashboard for detection latency, thumbnail latency, CPU peaks

### Risks

- Worker pool saturation if concurrency limits are misconfigured

---

## Sprint 2 - I/O and data-flow efficiency

### Goals

- Minimize database write amplification
- Improve save performance in review workflows
- Reduce repeated heavy reads for statistics

### Planned work

- **[Done] Per-collection dirty-flag saves** — `core.db.save_database` now
  takes an optional `only={'known','ignored','hardneg','processed'}` so a save
  rewrites only the named files (single-file saves skip the thread pool);
  `FaceDBStore.mutate(fn, touches=...)` accumulates a dirty union across
  coalesced mutations and the debounced save writes exactly that union, then
  clears the flags and re-records only the written files' fingerprints. Net
  effect on the review hot path: a confirm-identity now rewrites `encodings.pkl`
  (+ `hardneg.pkl` only when the user corrected a suggestion) and, separately,
  `processed_files.jsonl` — never `ignored.pkl`; an ignore rewrites only
  `ignored.pkl`. This cuts write amplification from 4 files/save to 1-2 on the
  common paths.
- **[Done, Phase D] Persist database once per burst, not once per face** — the
  shared store's 500 ms leading-coalesce debounce already collapses a burst of
  per-face mutations into one save (`batch_confirm`/`mark_review_complete`
  flush synchronously for durability).
- **[Done] Batch review-save endpoint** — `POST /api/v1/batch-confirm`
  (`routes/detection.py`) takes an image's confirmations + ignores in one
  request with a single database save; the review flow submits there
  (`ReviewModule.saveAllChanges`) instead of N individual calls.
- **[Done] One-time DB normalization with schema marker** — `core.db.load_database`
  no longer re-runs `normalize_encoding_entry` over every entry on every load.
  The first load of an un-migrated DB normalizes, saves the result back (via
  `save_database(only=...)`, only the collections that had migrated entries), and
  writes a `db_meta.json` sidecar (`{"schema": 2}`) atomically; subsequent loads
  read the marker and skip the per-entry pass. Safety: the data files are
  rewritten only when normalization actually changed something; a corrupt entry
  suppresses both the save-back and the marker (preserving today's drop-in-memory
  behavior); a missing/malformed marker falls back to a full pass. Trusting the
  marker is safe because every consume site (`core.matching`, the
  management/refinement/statistics services) already tolerates bare arrays and
  backend-less dicts. Measured on a synthetic 5000-entry DB: the already-migrated
  load dropped ~32% (≈8.0 → ≈5.4 ms), eliminating the per-entry pass — the
  residual cost is pickle deserialization.
- **[Done, Phase D, step D4] Statistics caching strategy** — `get_summary` is
  now version-keyed on `store.version` (DB parts invalidate immediately; TTL
  only guards the non-store attempt/app-log parts). Any further incremental
  handling is optional.
- **[Done] Statistics refresh interval in UI controls actual fetch cadence** —
  `StatisticsDashboard` drives its `useAutoRefresh` from a user-set interval and
  an on/off toggle (`refreshInterval` pref → `interval`).

### Deliverables

- 60-90% fewer database writes during review sessions
  - Delivered on both axes: confirm/ignore saves now touch 1-2 of the four files
    instead of all four (per-collection saves), and `batch-confirm` collapses an
    image's per-face writes into a single save (fewer *saves*, not just smaller
    ones).
- P95 for review-save improved by at least 50%
- Reduced disk I/O spikes during batch review

### Risks

- Batch error handling must clearly define partial-success behavior

---

## Sprint 3 - Scalability and sustained responsiveness

### Goals

- Improve matching performance as dataset size grows
- Lower idle/runtime overhead in frontend
- Maintain smooth UX in long sessions

### Planned work

- **[done]** Optimize matching path with precompiled/indexed structures — `MatchingIndex`
  (`api/services/matching_index.py`) builds the per-backend stacked candidate matrices
  once per store version and reuses them across every detected face; the four
  DetectionService matching helpers consume it instead of restacking matrices per call.
- **[done]** Cache invalidation strategy tied to database mutation/reload events — the index
  is tagged with the `FaceDBStore.version` it was built from and rebuilt (under `store.read`,
  guarded by double-checked locking) whenever the version moves; every mutation/reload bumps
  the version, so a confirm/ignore or external reload can never be served against a stale index.
- **[Done]** Replace log polling with event-driven updates in UI — `LogViewer`
  now reacts to log events instead of its old 100 ms poll.
- **[Remaining]** Pause or throttle background refresh for hidden/inactive
  modules — refresh is user-toggleable but not auto-paused when a module is off
  the active tabset.
- **[Remaining]** Reduce unnecessary global listener rebinding.

### Deliverables

- Detection throughput improved by at least 40% on large dataset benchmarks — **partially met
  at the matching layer.** The synthetic microbenchmark (100 people × 5 encodings, dim 128,
  200 faces; nearest-person + ignored + top-N alternatives) shows ~1.5× (≈300 ms → ≈197 ms)
  from eliminating per-face matrix construction alone. That is a conservative lower bound: it
  runs against an in-memory store and so excludes the per-call `store.read()`/file-stat overhead
  the index also removes in production. Whole-pipeline throughput (dominated by InsightFace
  inference and image decode) is unaffected — the 40% target applies to the matching path this
  work targets, not end-to-end detection. Equivalence pinned by `tests/test_matching_index.py`
  (naive-vs-index over all four helpers, both active backends).
- Lower renderer idle CPU usage in steady-state operation
- Stable responsiveness across long-running sessions

### Risks

- Cache invalidation logic must be exact to avoid stale match behavior — **mitigated:** the index
  reproduces each helper's exact filtering/order (distances, tie-breaking, argmin index, alternative
  ranking) and is version-invalidated; an explicit confirm-then-match test proves a newly written
  encoding is visible on the next match.

---

## Remaining work

The following items from this plan are **not** yet done and are tracked as
forward-looking entries in [ROADMAP.md](../../ROADMAP.md):

- **Concurrency limits** for expensive endpoints (`detect`, `thumbnail`,
  `preprocess`) — no per-endpoint semaphore yet.
- **Backend distance-optimization** — the broader matching/distance-compute work
  beyond the `MatchingIndex` already shipped.
- **Auto-pause/throttle background refresh** for hidden/inactive modules, and
  reducing global listener rebinding.

Everything else in Sprints 1-3 has landed (see the per-item `[Done]` annotations
above).

---

## Definition of Done (all sprints)

- Performance measured before/after on the same dataset and scenarios
- Regression tests added for changed critical endpoints/flows
- Telemetry and logs verify p95 latency, error rate, and throughput
- No functional regressions in review, preprocessing, or rename workflows
