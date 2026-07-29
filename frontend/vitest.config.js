import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['src/**/*.test.{js,jsx}', 'tests/**/*.test.{js,jsx}'],
    // Vitest defaults to 5 s per test. The component tests here mount whole
    // modules (CullingModule, PlayerCountModule, FlexLayoutWorkspace) into
    // jsdom, which is CPU-bound: they run in 10-100 ms on an idle machine but
    // measure 3-6 s under heavy CPU contention. That put the first test of each
    // file — the one paying the module's first-mount cost — just over the 5 s
    // line, which is what made CI red at random.
    //
    // This is a budget, not a cure for a race: every wait in the suite either
    // polls (waitFor/findBy) or advances a fake clock, so a genuinely stuck
    // test still fails — 20 s later instead of 5 s. Nothing sits out the clock
    // deliberately.
    testTimeout: 20000,
    // Same reasoning for hooks (default 10 s). Several suites do the module's
    // `await import(...)` inside beforeAll to control mock ordering, so the hook
    // pays the transform cost for a whole component tree — the one-time cost the
    // contention multiplies hardest.
    hookTimeout: 20000,
    // The guard on those budgets. A 20 s ceiling is necessary headroom, but it
    // is also room to drift into: nothing reports a test creeping from 100 ms
    // toward 15 s until it crosses, and by then the branch has quietly turned a
    // race into a slow pass. The default reporter already prints a duration for
    // every test over this threshold, so setting it deliberately is the whole
    // mechanism — no extra tooling, and it fires on GREEN runs, which is the
    // point.
    //
    // 10 s is half the budget, and it is chosen to be silent when nothing is
    // wrong: the slowest test in the suite idles at ~125 ms, and legitimately
    // contended component mounts measure 3-6 s. So a healthy run — contended or
    // not — prints nothing at all, and anything that does print is genuinely
    // halfway to timing out. Alarm rather than haystack; --reporter=verbose
    // would annotate all ~930 tests every run, which nobody diffs. Take the
    // full distribution as a manual run when it is actually wanted.
    slowTestThreshold: 10000,
  },
  esbuild: {
    jsx: 'automatic',
  },
});
