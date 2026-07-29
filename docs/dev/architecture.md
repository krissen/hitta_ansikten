# Architecture

System overview for Ansikten.

---

## Overview

Ansikten is a monorepo with two main components:

```
ansikten/
├── backend/          # Python CLI + FastAPI server
├── frontend/         # Electron workspace (React + FlexLayout)
└── shared/           # Common type definitions
```

### Backend

- **CLI Tool**: Terminal-based batch processing (`hitta_ansikten.py`) (legacy name)
- **FastAPI Server**: REST API + WebSocket for frontend integration
- **Face Recognition**: InsightFace (ONNX Runtime)

### Frontend

- **Electron App**: Cross-platform desktop application
- **FlexLayout**: GIMP-like modular workspace with dockable panels
- **Modules**: Image Viewer, Face Review, Statistics, Database Management, Refine Faces

---

## Backend Architecture

### Core Components

Shared logic lives in the `core/` package, imported by both the legacy CLI and
the FastAPI backend. The old top-level modules survive as thin deprecation shims
(`import faceid_db` / `cli_config` / `cli_image` / `cli_matching` re-export the
matching `core.*` module — `faceid_db` even aliases itself to `core.db` in
`sys.modules`, so patching one name patches both).

| File / package | Purpose |
|----------------|---------|
| `core/config.py` | Configuration and settings (shim: `cli_config`) |
| `core/matching.py` | Face-matching / threshold utilities (shim: `cli_matching`) |
| `core/image.py` | RAW/image loading and resizing (shim: `cli_image`) |
| `core/db.py` | Database layer — pickle/JSONL I/O, locking, migration (shim: `faceid_db`) |
| `core/attempts.py` | Attempt-statistics JSONL logger |
| `core/naming.py` | Filename ↔ person-name helpers |
| `core/playerstats.py` | Player-count statistics + exclusion config |
| `core/files.py` | Canonical supported image-extension sets |
| `hitta_ansikten.py` | Main CLI entry point (legacy name) |
| `face_backends.py` | Pluggable backend abstraction (InsightFace) |
| `api/server.py` | FastAPI server entry point |
| `api/routes/` | REST API endpoints |
| `api/services/` | Service layer (detection, management, statistics, …) |
| `api/websocket/` | WebSocket handlers |

### Backend Data Layer

The server holds the face DB in memory through a single authority — the
process-wide **`FaceDBStore`** (`api/services/db_store.py`) — instead of each
service keeping its own copy:

- **One store, four collections.** `known_faces` (dict), `ignored_faces`
  (list), `hard_negatives` (dict), `processed_files` (list), loaded once from
  `core.db.load_database()`.
- **Access API.** `snapshot()` returns the live collections; `read(fn)` runs a
  read-only aggregation under the store lock; `mutate(fn, touches=...)` applies
  a write, bumps the version, and marks the named collections dirty; `flush()`
  writes now (for endpoints that promise durability and for shutdown).
- **External-change detection.** Every access cheap-stats the backing files and
  reloads when a file's `(st_mtime_ns, st_size)` fingerprint differs from the
  recorded baseline (e.g. the CLI wrote while the GUI was open).
- **Debounced, per-collection saves.** A mutation schedules a *leading-coalesce*
  save 500 ms after the first mutation of a burst; dirty flags accumulate and
  the save rewrites only the dirty union (`save_database(only=...)`), so a
  confirm no longer rewrites all four files.
- **Version counter.** A monotonic `version` is bumped on every mutation/reload,
  letting downstream caches detect staleness cheaply.
- **Single-writer model.** The GUI serializes writes through the store;
  CLI-vs-server concurrent writes remain last-writer-wins.

**`MatchingIndex`** (`api/services/matching_index.py`) precomputes the
per-backend stacked candidate matrices (lenient/strict known + ignored +
per-person hard negatives) once per store `version` and reuses them across every
detected face until the DB changes. It is version-invalidated (rebuilt under
`store.read` with double-checked locking) rather than restacked per match. The
hard-negative matrices let the API match path skip a person when the probe is
closer than `hard_negative_distance` to one of their hard negatives — the same
rejection rule the CLI's `best_matches` applies, so the GUI stops re-suggesting
identities the user has explicitly corrected away.

Services are reached through **lazy getters** (`get_detection_service()` etc.)
that construct the singleton on first use with double-checked locking — no
import-time construction.

### Schema-marker migration

`core.db.load_database()` normalizes every encoding entry to the modern dict
form (backend metadata, `encoding_hash`). To avoid re-running that pass on every
load, the first migration writes a `db_meta.json` sidecar recording
`{"schema": <DB_SCHEMA_VERSION>}` (atomic temp-file + rename). Subsequent loads
read the marker and skip the per-entry pass. The data files are rewritten only
when normalization actually changed something (`save_database(only=...)`); a
corrupt entry suppresses both the save-back and the marker; a missing/malformed
marker falls back to a full pass. Bumping `DB_SCHEMA_VERSION` forces a fresh
pass + re-save on next load.

### Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLI Processing                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   1. Parse Input        2. Skip Processed     3. Preprocess Worker   │
│   ┌─────────────┐       ┌─────────────┐       ┌─────────────────┐    │
│   │ Expand globs │  →   │ Check hash  │   →   │ Background proc │    │
│   │ Filter .NEF  │       │ in JSONL    │       │ Load RAW→RGB    │    │
│   └─────────────┘       └─────────────┘       │ Detect faces    │    │
│                                                │ Match database  │    │
│                                                │ Queue results   │    │
│                                                └─────────────────┘    │
│                                                         │             │
│   6. Mark Processed     5. Save Encodings    4. Main Loop            │
│   ┌─────────────┐       ┌─────────────┐      ┌─────────────────┐     │
│   │ Write to    │  ←    │ Update      │  ←   │ Display preview │     │
│   │ processed   │       │ encodings.pkl│      │ User review     │     │
│   └─────────────┘       └─────────────┘      │ Accept/Ignore   │     │
│                                               └─────────────────┘     │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Multi-Resolution Strategy

The backend tries multiple resolutions for face detection:

1. **Downsample** (2800px) - Fast first pass
2. **Midsample** (4500px) - Balance of speed and accuracy
3. **Fullres** (8000px) - Maximum accuracy for difficult faces

### Face Recognition Backend

InsightFace is the only supported backend:

| Backend | Encoding | Distance | Threshold |
|---------|----------|----------|-----------|
| **InsightFace** | 512-dim | Cosine | ~0.45 |

> **Note:** dlib was deprecated in January 2026. Existing dlib encodings are left in place; remove them on demand with `scripts/archive/rensa_dlib.py` or the remove-dlib refinement endpoint.

---

## Frontend Architecture

### Component Hierarchy

```
Electron Main Process
├── main.js                  # Entry point
├── src/main/index.js        # Window management
├── src/main/menu.js         # App menu + shortcuts
└── src/main/backend-service.js  # Auto-start FastAPI

Electron Renderer Process
├── workspace-flex.html      # FlexLayout HTML
└── src/renderer/
    ├── workspace/
    │   └── flexlayout/
    │       ├── index.jsx              # React entry
    │       ├── FlexLayoutWorkspace.jsx  # Main component
    │       ├── workspaceCommands.js  # Single command router (typed intents)
    │       ├── moduleRegistry.js     # Declarative module catalog (role + metadata)
    │       ├── workflowSteps.js      # Pipeline steps / tools / continuation chain
    │       ├── workflows.js          # Per-step factory layout specs
    │       ├── workspaceMorph.js     # Non-destructive layout morph (applyWorkspace)
    │       ├── stepLayoutMemory.js   # Per-step remembered layout
    │       ├── layouts.js            # Non-pipeline preset layouts
    │       ├── menuCommands.js       # Menu/shortcut command dispatch
    │       ├── tabNames.js           # i18n tab titles
    │       └── tabsetUtils.js        # Active-tabset helpers
    ├── components/           # React module components (flat + per-module dirs)
    │   ├── ReviewModule.jsx  #   review/    — FaceCard, reviewActions, keyboard
    │   ├── CullingModule.jsx #   culling/   — FilterBar, StatsPanel, preview hook
    │   ├── FileQueueModule.jsx #  fileQueue/ — reducer, prefs, rename/preprocess hooks
    │   ├── ImageViewer.jsx   # Review viewer: loading/NEF, events, face overlay
    │   ├── CanvasImageView.jsx #  Shared prop-driven canvas core (zoom/pan/fit)
    │   └── …                 # Statistics, Database, RefineFaces, Import, RenameNef, …
    ├── hooks/                # Shared hooks (useActiveTabset, useWebSocket, …)
    ├── shared/               # api-client (HTTP + WS singleton), utilities
    └── context/              # ModuleAPI context providers
```

The larger modules are decomposed: each keeps its top-level `*.jsx` component in
`components/` and pushes pure logic, sub-components, and hooks into a
same-named subdirectory (`components/review/`, `components/culling/`,
`components/fileQueue/`). Cross-cutting hooks live in `hooks/` — notably
`useActiveTabset`, which gates a module's keyboard shortcuts on its tabset being
active and supports *companion* modules (a keyboard-less surface, e.g. the image
viewer, counts as active for its driver module).

`CanvasImageView.jsx` is the shared, presentational canvas core: it owns the
canvas element, zoom mode / factor / pan, device-pixel-ratio handling, and
wheel/drag panning for a single decoded image, and exposes an imperative ref
(`zoom`, `resetZoom`, `autoFit`, `setPan`, `getTransform`, `centerOnRect`,
`applyTransform`) plus an optional `drawOverlay(ctx, { scale, x, y })` callback.
It carries no application concerns (no module events, global shortcuts, i18n, or
face knowledge). `ImageViewer.jsx` is the review-workflow wrapper around it —
image loading / NEF pipeline, module-event wiring, keyboard shortcuts, menu
state, and the face-box overlay (drawn via `drawOverlay`). The viewport math
(zoom clamping, zoom-around-a-point, centering) lives in the pure, unit-tested
`shared/canvasViewport.js`; contain-fit geometry stays in `shared/fitTransform.js`.
The same core is intended for reuse by the culling loupe.

### Session Permission Model

Browser permissions are **deny-by-default**. Without an explicit handler an
Electron session falls back to the built-in default, which grants most requests
(camera, microphone, geolocation, notifications) to whatever page it loads — a
needlessly wide surface for a local `file://` workspace.

`src/main/permissions.js` owns the policy; `installPermissionPolicies()` in
`src/main/index.js` installs it on app ready, before any window loads content:

| Session | Window | Allowed |
|---------|--------|---------|
| `persist:ansikten` | Workspace | `clipboard-sanitized-write` (copy-logs button in the log viewer) |
| default session | Splash (sets no partition) | nothing |
| any later session | — | nothing, via the `session-created` catch-all |

The catch-all matters because the table above would otherwise only cover the
two sessions that existed when it was written: a future `BrowserView`,
`<webview>` or extra partition would be born on Electron's permissive default.
`installSessionPermissionDefaults()` hooks `app.on('session-created')` and gives
anything unrecognised an empty allowlist. Sessions that already carry a
deliberate policy are skipped, so the two orders are both safe — the event fires
synchronously inside `session.fromPartition()`, before the caller installs its
allowlist, and the deliberate policy then overrides the catch-all. The default
session exists before app ready and never fires the event, which is why it is
named explicitly. Measured on a normal run (startup, workspace load, DevTools
open), Electron creates exactly these two sessions and no hidden internal one.

Two handlers are installed per session, `setPermissionRequestHandler` and
`setPermissionCheckHandler`: Chromium consults the synchronous *check* before the
asynchronous *request* on several paths, so installing only the request handler
would leave the check on Electron's permissive default and make the outcome
path-dependent. Both handlers share one decision function built from one
allowlist, so they cannot drift apart. Denials are logged with the `[Main]`
prefix (request denials always, check denials once per permission since checks
can be polled), so a missing allowlist entry surfaces as a log line rather than a
silent no-op. Adding a permission means adding it to the allowlist in
`permissions.js` — nowhere else, and in the same change as the code that calls
it: a permission granted ahead of its consumer is an open hole for as long as
the consumer is missing.

### Module Communication

Modules communicate via `ModuleAPI`:

```javascript
// Emit event to other modules
api.emit('image-loaded', { path: '/path/to/image.nef' });

// Listen for events
api.on('face-selected', (data) => { /* handle */ });

// Backend HTTP calls
const result = await api.http.post('/api/v1/detect-faces', { imagePath });

// WebSocket events
api.ws.on('progress', (data) => { /* update UI */ });
```

### Layout System

FlexLayout uses a tree-based model:

```
Row (root)
├── TabSet (left panel)
│   └── Tab (Review Module)
└── TabSet (main area)
    └── Tab (Image Viewer)
```

`layouts.js` (`getLayoutByName` / `layoutNames`) holds the non-pipeline preset
layouts still reachable from **Fönster → Layoutmallar**:
- `review` - Review panel + Image Viewer
- `review-with-logs` - Review + Image Viewer + Log Viewer
- `comparison` - Image Viewer + Original View
- `full-review` - Grid with Review, Image Viewer, Original View, Logs
- `queue-review` - File Queue + Review + Image Viewer
- `database` - Database Management + Statistics

### Workflow steps and the command router

Primary navigation is the five-step pipeline (Import → Rename → Review → Count →
Culling), defined once in `workflowSteps.js` and rendered by the always-visible
**WorkflowBar**. Switching step does **not** rebuild the model: `enterStep` calls
`workspaceMorph.applyWorkspace`, which transforms the live FlexLayout model toward
the target step's factory spec (`workflows.js`) with `moveNode`/`addNode`/`deleteTab`
Actions, so a mounted module keeps its React instance (and state) across the switch.
`keepMounted` modules (the File Queue) and modules with unsaved edits (a dirty
Review) are parked alive in a collapsed background border rather than closed, so a
step switch is non-destructive and never prompts. Each step remembers the shape the
user leaves it in (`stepLayoutMemory.js`).

Every way to open a module, enter a step, or load a layout — the menu dispatch
table, the `window.workspace` global, the moduleAPI `open-*` events, and the
main-process CLI launch bridge — is a thin adapter that builds a typed intent and
calls `dispatch` on the single command router (`workspaceCommands.js`). The router
buffers intents that arrive before the workspace signals `workspace-ready` and
flushes them in order. Placement of a freshly-opened tab is resolved from the
module's `role` in `moduleRegistry.js` (`main`/`side`/`bottom`), never from the
active tabset. The interaction and navigation rules are codified in
[UX Principles](ux-principles.md).

---

## Data Flow

### CLI Workflow

```
User                    CLI                    Database
  │                      │                        │
  │──./hitta_ansikten.py │                        │
  │     *.NEF───────────→│                        │
  │                      │──load_database()──────→│
  │                      │←─────encodings.pkl─────│
  │                      │                        │
  │                      │ [Preprocess Worker]    │
  │                      │    ↓                   │
  │←────preview.jpg──────│                        │
  │                      │                        │
  │──accept/ignore──────→│                        │
  │                      │──save_encoding()──────→│
  │                      │──mark_processed()─────→│
```

### Frontend Workflow

```
Frontend              Backend API             Database
   │                      │                      │
   │──GET /api/database/people────────────────→│
   │←─────────[people list]───────────────────←│
   │                      │                      │
   │──POST /api/detect-faces─→│                  │
   │                         │──detect()────────→│
   │←────[faces, matches]────│                   │
   │                         │                   │
   │──POST /api/confirm-identity─→│              │
   │                             │──save()──────→│
   │←────{status: ok}────────────│               │
```

---

## Configuration

### Backend Config

Location: `~/.local/share/faceid/config.json`

```json
{
  "detection_model": "hog",
  "backend": {
    "type": "insightface",
    "insightface": {
      "model_name": "buffalo_l",
      "ctx_id": -1
    }
  },
  "backend_thresholds": {
    "insightface": {
      "match_threshold": 0.45,
      "ignore_distance": 0.35,
      "hard_negative_distance": 0.32
    }
  },
  "auto_ignore": false,
  "image_viewer_app": "Ansikten"
}
```

> Match/ignore/hard-negative thresholds live only in `backend_thresholds.<backend>`
> (single source of truth, per distance metric). Legacy top-level flat threshold keys
> are migrated away on load (`config_version` → 2), and an audit-era InsightFace
> `match_threshold` of exactly 0.40 is raised to 0.45 (`config_version` → 3). See
> [Database](database.md#config).

### Frontend Config

Stored in localStorage:
- Layout state
- Theme preference (light/dark/system)
- Module-specific settings

---

## Key Design Decisions

### Multiprocessing Safety

- Worker process handles CPU-intensive tasks (face detection)
- Main process owns all database writes
- Communication via multiprocessing Queue
- Worker initializes its own backend instance

### File Identity

- SHA1 hash used for file identity
- Avoids reprocessing renamed files
- Hash stored in `processed_files.jsonl`

### Encoding Compatibility

- All encodings use InsightFace (512-dim vectors)
- Legacy dlib encodings are left in place; remove them on demand with `scripts/archive/rensa_dlib.py` or the remove-dlib refinement endpoint

### Preprocessing Cache

- Located in `./preprocessed_cache/`
- Enables resuming interrupted processing
- Cache key: `{file_hash}.pkl`
- Deleted after consumption

---

## See Also

- [API Reference](api-reference.md) - REST and WebSocket endpoints
- [Database](database.md) - Data files and formats
- [UX Principles](ux-principles.md) - Interaction and navigation rules
- [Theming](theming.md) - CSS variable system
