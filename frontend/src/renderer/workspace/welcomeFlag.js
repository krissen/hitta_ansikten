/**
 * First-run welcome flag.
 *
 * The StartupLanding welcome card is shown only the FIRST time the app opens a
 * normal (non-CLI) session. Once the user has seen and dismissed it — by opening
 * a step, loading an image, or via the Help ▸ "Visa välkomstguiden" menu closing
 * it again — this persistent flag is set, and subsequent launches go straight
 * into the workspace with the WorkflowBar (no landing).
 *
 * Fail-open toward SHOWING: any missing, corrupt or unreadable value counts as
 * "not yet welcomed", so a genuine first-run user always gets the guide.
 */

const WELCOME_KEY = 'ansikten-welcomed';

/** True only when the flag is explicitly the string 'true'. Anything else
 *  (missing, corrupt, storage error) is treated as not-yet-welcomed. */
export function hasBeenWelcomed() {
  try {
    return window.localStorage.getItem(WELCOME_KEY) === 'true';
  } catch {
    return false; // storage unavailable → fail open to showing the guide
  }
}

/** Record that the user has seen the welcome card. Idempotent; a storage
 *  failure is non-fatal (the card simply reappears on the next launch). */
export function markWelcomed() {
  try {
    window.localStorage.setItem(WELCOME_KEY, 'true');
  } catch {
    /* non-fatal */
  }
}
