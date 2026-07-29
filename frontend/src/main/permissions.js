// permissions.js
// Deny-by-default permission policy for the app's Electron sessions.
//
// Without an explicit handler a session falls back to Electron's default,
// which grants most permission requests — camera/microphone, geolocation,
// notifications — to whatever page the session loads. The workspace is a
// local file:// page, so nothing should be asking for those in the first
// place; granting them silently is a needlessly wide surface. This module
// closes it: everything is denied unless it appears in an explicit allowlist.
//
// Two handlers are needed, not one. Chromium consults a synchronous
// permission *check* (setPermissionCheckHandler) before the asynchronous
// *request* (setPermissionRequestHandler) on several paths; if only the
// request handler is installed, the check keeps using Electron's default and
// the outcome becomes path-dependent. Both handlers therefore share one
// decision function built from one allowlist, so the two can never drift.
//
// Pure apart from the session object it is handed: the decision function is
// unit-testable without an Electron session.

/**
 * Permissions the workspace window is allowed to use.
 *
 * Audited against the renderer sources: nothing in the app calls
 * getUserMedia, the Geolocation API, the Notification API (toasts are
 * in-page React), the Fullscreen API or the File System Access API — those
 * are all denied, and denying them is not a regression.
 */
const WORKSPACE_PERMISSIONS = Object.freeze([
  // Web MIDI, for driving the workspace from a hardware control surface.
  'midi',
  // navigator.clipboard.writeText() behind the "copy logs" button in
  // LogViewer; Chromium routes writeText through clipboard-sanitized-write.
  'clipboard-sanitized-write',
]);

/**
 * Build the shared allow/deny decision used by both session handlers.
 *
 * Denials are logged so a missing entry is diagnosable rather than a silent
 * no-op. Request denials are always logged (they follow a user action and are
 * rare); check denials are logged once per permission, since Chromium may
 * poll the check handler and would otherwise flood the log.
 *
 * @param {object} options
 * @param {string} options.label - session name used in log lines.
 * @param {string[]} [options.allowed] - allowlisted permission names.
 * @param {(msg: string) => void} [options.log] - log sink.
 * @returns {(permission: string, context?: {origin?: string, path?: string}) => boolean}
 */
function createPermissionDecider({ label, allowed = [], log = console.log }) {
  const allowSet = new Set(allowed);
  const loggedChecks = new Set();

  return function decide(permission, context = {}) {
    if (allowSet.has(permission)) return true;

    const path = context.path || "request";
    if (path === "check") {
      if (loggedChecks.has(permission)) return false;
      loggedChecks.add(permission);
    }
    const origin = context.origin || "unknown origin";
    log(`[Main] Permission policy: denied '${permission}' (${path}) for ${label} session, origin: ${origin}`);
    return false;
  };
}

/**
 * Install the deny-by-default handlers on a session.
 *
 * @param {Electron.Session} targetSession
 * @param {object} options - see createPermissionDecider.
 * @returns {(permission: string, context?: object) => boolean} the decider,
 *          returned for testing/inspection.
 */
function applyPermissionPolicy(targetSession, options) {
  const decide = createPermissionDecider(options);

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details?.requestingUrl || webContents?.getURL?.();
    callback(decide(permission, { origin, path: "request" }));
  });

  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const origin = requestingOrigin || webContents?.getURL?.();
    return decide(permission, { origin, path: "check" });
  });

  return decide;
}

module.exports = {
  WORKSPACE_PERMISSIONS,
  createPermissionDecider,
  applyPermissionPolicy,
};
