# Performance Plan

Forward-looking, **release-scoped** plan for a performance-focused release
(sprints, deliverables, Definition of Done). This is deliberately narrower than
the top-level [ROADMAP.md](../../ROADMAP.md), which is the living
backlog / known-issues / tech-debt list across all horizons. When any of the
work below is picked up, track it as a normal roadmap item and check it off in
[CHANGELOG.md](../../CHANGELOG.md) once shipped.

> **Status:** this plan is not yet executed. It was originally scoped to
> `v1.2.0`; that tag has shipped without this work, so treat the sprints below
> as the plan for a *future* performance release rather than a specific version.

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

- Move heavy detection and thumbnail work off the async event loop (thread/process workers)
- Add concurrency limits for expensive endpoints (`detect`, `thumbnail`, `preprocess`)
- Reuse `file_hash` across flows to avoid repeated large-file hashing
- Reduce aggressive frontend polling where event-driven updates are available

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

- Add batch review-save endpoint (confirm + ignore in one request per image)
- Persist database once per image review (not once per face)
- Improve statistics caching strategy (longer TTL and incremental handling where possible)
- Update frontend review flow to use batch submit
- Ensure statistics refresh interval in UI controls actual fetch cadence

### Deliverables

- 60-90% fewer database writes during review sessions
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
- Replace log polling with event-driven updates in UI
- Pause or throttle background refresh for hidden/inactive modules
- Reduce unnecessary global listener rebinding

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

## Definition of Done (all sprints)

- Performance measured before/after on the same dataset and scenarios
- Regression tests added for changed critical endpoints/flows
- Telemetry and logs verify p95 latency, error rate, and throughput
- No functional regressions in review, preprocessing, or rename workflows
