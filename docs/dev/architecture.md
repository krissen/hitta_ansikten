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
per-backend stacked candidate matrices (lenient/strict known + ignored) once per
store `version` and reuses them across every detected face until the DB changes.
It is version-invalidated (rebuilt under `store.read` with double-checked
locking) rather than restacked per match.

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
| **InsightFace** | 512-dim | Cosine | ~0.4 |

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
    │       ├── moduleRegistry.js     # id → component mapping
    │       ├── layouts.js            # Preset layout configurations
    │       ├── menuCommands.js       # Menu/shortcut command dispatch
    │       ├── tabNames.js           # i18n tab titles
    │       └── tabsetUtils.js        # Active-tabset helpers
    ├── components/           # React module components (flat + per-module dirs)
    │   ├── ReviewModule.jsx  #   review/    — FaceCard, reviewActions, keyboard
    │   ├── CullingModule.jsx #   culling/   — FilterBar, StatsPanel, preview hook
    │   ├── FileQueueModule.jsx #  fileQueue/ — reducer, prefs, rename/preprocess hooks
    │   ├── ImageViewer.jsx   # Canvas rendering, zoom/pan
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

Preset layouts defined in `layouts.js` (`getLayoutByName` / `layoutNames`):
- `review` - Review panel + Image Viewer
- `review-with-logs` - Review + Image Viewer + Log Viewer
- `comparison` - Image Viewer + Original View
- `full-review` - Grid with Review, Image Viewer, Original View, Logs
- `queue-review` - File Queue + Review + Image Viewer
- `database` - Database Management + Statistics

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
  "match_threshold": 0.4,
  "auto_ignore": false,
  "image_viewer_app": "Ansikten"
}
```

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
- [Theming](theming.md) - CSS variable system
