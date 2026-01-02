# Architecture

System overview for Hitta ansikten.

---

## Overview

Hitta ansikten is a monorepo with two main components:

```
hitta_ansikten/
├── backend/          # Python CLI + FastAPI server
├── frontend/         # Electron workspace (React + FlexLayout)
└── shared/           # Common type definitions
```

### Backend

- **CLI Tool**: Terminal-based batch processing (`hitta_ansikten.py`)
- **FastAPI Server**: REST API + WebSocket for frontend integration
- **Face Recognition**: Pluggable backends (InsightFace, dlib)

### Frontend

- **Electron App**: Cross-platform desktop application
- **FlexLayout**: GIMP-like modular workspace with dockable panels
- **Modules**: Image Viewer, Face Review, Statistics, Database Management

---

## Backend Architecture

### Core Components

| File | Purpose |
|------|---------|
| `hitta_ansikten.py` | Main CLI entry point (~2000 lines) |
| `faceid_db.py` | Database layer, handles all I/O |
| `face_backends.py` | Pluggable backend abstraction |
| `api/server.py` | FastAPI server entry point |
| `api/routes/` | REST API endpoints |
| `api/websocket/` | WebSocket handlers |

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

### Face Recognition Backends

| Backend | Encoding | Distance | Threshold | Notes |
|---------|----------|----------|-----------|-------|
| **InsightFace** | 512-dim | Cosine | ~0.4 | Primary, faster, more accurate |
| **dlib** | 128-dim | Euclidean | ~0.54 | Legacy support |

Backend selection in `config.json`:
```json
{
  "backend": {
    "type": "insightface"
  }
}
```

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
    │       ├── index.jsx           # React entry
    │       ├── FlexLayoutWorkspace.jsx  # Main component
    │       ├── ModuleWrapper.jsx   # Vanilla JS wrapper
    │       └── layouts.js          # Preset configurations
    └── modules/
        ├── image-viewer/      # Canvas rendering
        ├── review-module/     # Face review UI
        ├── file-queue/        # File management
        ├── log-viewer/        # Log display
        ├── original-view/     # NEF comparison
        ├── statistics-dashboard/
        └── database-management/
```

### Module Communication

Modules communicate via `ModuleAPI`:

```javascript
// Emit event to other modules
api.emit('image-loaded', { path: '/path/to/image.nef' });

// Listen for events
api.on('face-selected', (data) => { /* handle */ });

// Backend HTTP calls
const result = await api.http.post('/api/detect-faces', { imagePath });

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

Preset layouts defined in `layouts.js`:
- `review` - Review panel + Image Viewer
- `comparison` - Image Viewer + Original View
- `full-review` - 2x2 grid with all modules
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
  "image_viewer_app": "Bildvisare"
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

### Backend Filtering

- Encodings only compared against same backend type
- dlib encodings never compared to InsightFace encodings
- Enables gradual migration between backends

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
