/**
 * Motion utilities — honour the OS "reduce motion" accessibility preference.
 *
 * CSS handles reduced-motion for declarative transitions/animations via the
 * global `@media (prefers-reduced-motion: reduce)` block in theme.css. This
 * module covers the JS-driven cases (e.g. programmatic smooth scrolling) that
 * CSS cannot reach.
 *
 * See docs/dev/accessibility.md for the house policy.
 */

/**
 * Whether the user has requested reduced motion at the OS level.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * ScrollBehavior to pass to scrollIntoView / scrollTo, gated on the
 * reduced-motion preference. Returns 'auto' (instant) when motion is reduced,
 * otherwise the requested behavior (default 'smooth').
 * @param {ScrollBehavior} [preferred='smooth']
 * @returns {ScrollBehavior}
 */
export function scrollBehavior(preferred = 'smooth') {
  return prefersReducedMotion() ? 'auto' : preferred;
}
