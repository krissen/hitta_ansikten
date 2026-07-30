import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['src/**/*.test.{js,jsx}', 'tests/**/*.test.{js,jsx}'],
    // Worker threads rather than Vitest's default child processes. This is a
    // measured choice, not a preference — the numbers and their conditions are
    // in CHANGELOG.md, and the short version is: the dominant cost in this suite
    // is jsdom construction (~0.2 s per file, ~9 s of summed test execution
    // against ~31 s of summed environment), and a thread pays it more cheaply
    // than a forked process.
    //
    // Serial wall clock went 13-14 s -> ~10 s, measured as three alternating
    // pairs so both arms met the same background load. The result that decided
    // it is the contention one: with ten full suites running against each other
    // on an 8-core M2, the fork pool went red 5 of 10 runs — every failure a
    // `Test timed out in 20000ms`, none an assertion — while the thread pool
    // went 0 of 10 twice, the second time under a HIGHER background load than
    // the fork arm ever saw. Threads degrade more gently, which is exactly the
    // property this suite needs.
    //
    // `isolate: false` was measured too and rejected: 51 tests fail, because the
    // suite's files install their own globals (localStorage shims,
    // window.ansiktenAPI, document listeners) and a shared environment leaks
    // them between files. Per-file isolation stays on.
    pool: 'threads',
    // Vitest defaults to 5 s per test. The component tests here mount whole
    // modules (CullingModule, PlayerCountModule, FlexLayoutWorkspace) into
    // jsdom, which is CPU-bound: they run in 10-100 ms on an idle machine but
    // measure 3-6 s under heavy CPU contention. That put the first test of each
    // file — the one paying the module's first-mount cost — just over the 5 s
    // line, which is what made CI red at random.
    //
    // This is a budget, not a cure for a race: every wait in the suite either
    // polls (waitFor/findBy) or advances a fake clock, so a genuinely stuck
    // test still fails — 15 s later instead of 5 s. Nothing sits out the clock
    // deliberately.
    //
    // 20 s originally, lowered on measurement once the thread pool landed. Under
    // the ten-parallel-suites recipe — the harshest contention this suite has
    // been put under — the per-test distribution is p50 1.1 s, p90 2.4 s,
    // p99 4.3 s and a worst single test of 6.2 s (1605 tests over 500 ms across
    // ten runs). 15 s is 2.4x that worst case, so the headroom that made CI
    // green is intact while the ceiling stops being room to drift into. It is
    // deliberately not lowered to the observed maximum: CI runners are smaller
    // than this machine, and a budget that only just fits is the flake it was
    // meant to prevent.
    testTimeout: 15000,
    // Same reasoning for hooks (default 10 s). Several suites do the module's
    // `await import(...)` inside beforeAll to control mock ordering, so the hook
    // pays the transform cost for a whole component tree — the one-time cost the
    // contention multiplies hardest.
    hookTimeout: 15000,
    // The guard on those budgets. A 20 s ceiling is necessary headroom, but it
    // is also room to drift into: nothing reports a test creeping from 100 ms
    // toward 15 s until it crosses, and by then the branch has quietly turned a
    // race into a slow pass. The default reporter already prints a duration for
    // every test over this threshold, so setting it deliberately is the whole
    // mechanism — no extra tooling, and it fires on GREEN runs, which is the
    // point.
    //
    // 7.5 s is half the budget, and it is chosen to be silent when nothing is
    // wrong: the slowest test in the suite idles at ~125 ms, and the worst
    // single test measured under ten parallel suites is 6.2 s (p99 4.3 s). So a
    // healthy run — contended or not — prints nothing at all, and anything that
    // does print is genuinely halfway to timing out. Alarm rather than haystack;
    // --reporter=verbose would annotate all ~938 tests every run, which nobody
    // diffs. Take the full distribution as a manual run when it is actually
    // wanted: `--slowTestThreshold=500` is how the numbers above were produced.
    //
    // Was 10 s, against a 20 s budget it never once fired under — a guard that
    // cannot fire is not a guard. Both numbers came down together, so the
    // half-the-budget relationship is preserved rather than eroded.
    slowTestThreshold: 7500,
  },
  esbuild: {
    jsx: 'automatic',
  },
});
