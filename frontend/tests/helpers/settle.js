/**
 * Settle a component's pending effect chain without counting its steps.
 *
 * The pattern this replaces is `await act(async () => { fireEvent.click(x);
 * await Promise.resolve(); })`, sometimes with two or three flushes in a row.
 * Microtask ordering is deterministic, so that is not flaky — but the number of
 * flushes is tied to how many `await`s the component's chain happens to have
 * before its next observable change. Add one `await` to `loadList` and the test
 * fails for a reason unrelated to the change. Worse, a *negative* assertion
 * ("the fence held", "nothing was posted") silently stops testing anything: it
 * cannot tell "the guard worked" from "the continuation never ran", so it keeps
 * passing while asserting nothing.
 *
 * `settle()` awaits a whole macrotask instead. Every microtask queued by the
 * component — however many `await`s deep — drains before the next macrotask
 * runs, so the wait is independent of the chain's length. What it deliberately
 * does NOT wait for is a promise that is still genuinely pending (a hung
 * request, a debounce timer): those stay in flight, which is what the fenced /
 * cancelled-request tests need.
 *
 * Prefer settling on a rendered outcome (`waitFor`, `findBy*`) when the test has
 * one — that asserts what the user would see. Use `settle()` where there is no
 * positive anchor to wait for: mounts whose outcome differs per test, and the
 * step before a negative assertion.
 *
 * Works under both clocks, which matters because Testing Library's `waitFor`
 * does not: its fake-timer detection is gated on a `jest` global that Vitest
 * does not define, so under `vi.useFakeTimers()` `waitFor` polls a clock that
 * never advances and burns its full `asyncUtilTimeout` in real time. Under a
 * fake clock this helper advances the timers instead; that is the
 * `vi.advanceTimersByTimeAsync(0)` idiom from #256, which ROADMAP.md records as
 * the forward rule.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export async function settle() {
  await act(async () => {
    // Vitest's own predicate rather than sniffing the sinon `clock` marker on
    // globalThis.setTimeout: that marker is an implementation detail, and if it
    // ever moves this would silently take the real-timer branch and hang on a
    // clock that never advances until the test times out.
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0);
    } else {
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
  });
}
