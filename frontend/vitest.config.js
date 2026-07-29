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
  },
  esbuild: {
    jsx: 'automatic',
  },
});
