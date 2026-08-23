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
 * Every entry must have a caller in the renderer today. A permission granted
 * ahead of the code that needs it is an unguarded hole for as long as the
 * caller is missing — add it in the same change as its consumer.
 *
 * Audited against the renderer sources: nothing in the app calls
 * getUserMedia, the Geolocation API, the Notification API (toasts are
 * in-page React), the Fullscreen API or the File System Access API — those
 * are all denied, and denying them is not a regression.
 */
const WORKSPACE_PERMISSIONS = Object.freeze([
  // navigator.clipboard.writeText() behind the "copy logs" button in
  // LogViewer; Chromium routes writeText through clipboard-sanitized-write.
  'clipboard-sanitized-write',
  // navigator.requestMIDIAccess() behind shared/midi/client.js — the
  // X-TOUCH MINI control surface. Chromium refuses the request unless BOTH
  // names are allowed, even though nothing here sends SysEx yet.
  'midi',
  'midiSysex',
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

// Sessions that already carry a policy. Lets the catch-all listener leave a
// deliberately-configured session alone regardless of which order the two run
// in (see installSessionPermissionDefaults).
const configured = new WeakSet();

/**
 * Does this session already have a policy installed?
 *
 * @param {Electron.Session} targetSession
 * @returns {boolean}
 */
function hasPermissionPolicy(targetSession) {
  return configured.has(targetSession);
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
  configured.add(targetSession);

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

/**
 * Close every session the app creates from now on, including ones this file
 * does not know about (a future BrowserView, <webview> or extra partition).
 *
 * Without this the policy would only cover the two sessions that happened to
 * exist when it was written, and any later partition would be born on
 * Electron's permissive default. New sessions get an empty allowlist: a
 * session nobody has thought about is exactly the one that should grant
 * nothing, and the denial log line says which one to add if that is wrong.
 *
 * Sessions with a deliberate policy are skipped, so this is order-independent
 * — whether the event fires before or after installPermissionPolicies() runs,
 * the deliberate allowlist wins and is never clobbered by the catch-all.
 *
 * @param {Electron.App} electronApp
 * @param {(msg: string) => void} [log]
 */
function installSessionPermissionDefaults(electronApp, log = console.log) {
  electronApp.on("session-created", (created) => {
    if (hasPermissionPolicy(created)) return;
    applyPermissionPolicy(created, { label: "unnamed", allowed: [], log });
    log("[Main] Permission policy: new session created, granted nothing");
  });
}

module.exports = {
  WORKSPACE_PERMISSIONS,
  createPermissionDecider,
  applyPermissionPolicy,
  hasPermissionPolicy,
  installSessionPermissionDefaults,
};
