# Ansikten

Face recognition tool for event photography.

---

## What is this?

Ansikten helps photographers identify and rename people in large collections of RAW images (NEF). It consists of:

- **Backend** - Python CLI for batch processing + FastAPI server
- **Frontend** - Electron workspace for interactive review

The tool is designed for sports events, school activities, or any context where many people appear across multiple photos.

---

## Quick Start

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# Process images
./hitta_ansikten.py 2024*.NEF

# Rename based on detected faces
./hitta_ansikten.py --rename --processed .
```

### Frontend

```bash
cd frontend
npm install
npm run build:workspace
npx electron .
```

Backend auto-starts on `http://127.0.0.1:5001`

---

## Documentation

### For Users

- [Installation](docs/user/installation.md) - Download prebuilt packages
- [Getting Started](docs/user/getting-started.md) - Development setup
- [CLI Reference](docs/user/cli-reference.md) - Command line usage
- [Workspace Guide](docs/user/workspace-guide.md) - GUI usage
- [Keyboard Shortcuts](docs/user/keyboard-shortcuts.md) - All shortcuts

### For Developers

- [Architecture](docs/dev/architecture.md) - System overview
- [API Reference](docs/dev/api-reference.md) - REST and WebSocket API
- [Database](docs/dev/database.md) - Data files and formats
- [Release Guide](docs/dev/release-guide.md) - Publishing releases
- [Building](docs/dev/building.md) - Build from source
- [Theming](docs/dev/theming.md) - CSS variable system
- [Contributing](docs/dev/contributing.md) - Git workflow and code style
- [Onboarding](docs/dev/onboarding.md) - New developer guide

---

## Features

- **Batch face detection** in RAW files (NEF)
- **Face recognition** against known person database
- **Interactive review** - confirm, reject, or manually name faces
- **Automatic file renaming** based on detected people
- **InsightFace** face recognition (512-dim embeddings, cosine distance)
- **Import (Importera)** - transfer NEFs from a memory card to a destination folder, then eject the card
- **Player count (Räkna spelare)** - count photos per named player from filenames, with over/under-representation stats
- **Culling (Gallra spelare)** - cull photos per player with preview, keystroke culling and undo, backed by a restore-capable trash
- **Trash (Papperskorg)** - review, restore, or empty soft-deleted files
- **Modular workspace** - GIMP-like dockable panel UI
- **Real-time updates** via WebSocket

---

## Project Structure

```
ansikten/
├── backend/          # Python CLI + FastAPI server
├── frontend/         # Electron workspace (FlexLayout)
├── shared/           # Common type definitions
└── docs/             # Documentation
    ├── user/         # User guides
    └── dev/          # Developer guides
```

---

## Data Storage

All persistent data in `~/.local/share/faceid/`:

| File | Description |
|------|-------------|
| `encodings.pkl` | Known faces database |
| `processed_files.jsonl` | Files already processed |
| `attempt_stats.jsonl` | Processing attempt log |
| `config.json` | User configuration |

---

## Technology

**Backend:**
- Python 3.11+
- InsightFace (ONNX Runtime)
- FastAPI, WebSocket, rawpy

**Frontend:**
- Electron
- React + FlexLayout
- Canvas-based image rendering

---

## License

GPL-3.0
