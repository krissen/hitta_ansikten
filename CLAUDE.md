# CLAUDE.md

Instructions for Claude Code when working in this repository.

---

## Project Overview

**Hitta ansikten** - Face recognition for event photography.

- **Backend**: Python CLI + FastAPI server
- **Frontend**: Electron workspace with FlexLayout
- **Data**: `~/.local/share/faceid/`

For architecture details: [docs/dev/architecture.md](docs/dev/architecture.md)

---

## Critical Rules

### Git Workflow

- **master is protected** - all changes via PR
- **dev is main branch** - feature branches from dev
- **Never commit to master directly**
- **Never delete master or dev**

```bash
git checkout dev
git checkout -b feature/my-feature
# ... work ...
git commit -m "(scope) description"
git push origin feature/my-feature
# Create PR to dev
```

For full workflow: [docs/dev/contributing.md](docs/dev/contributing.md)

### Commit Messages

- **NO Claude references** in commits or PRs
- **Never** add "Generated with Claude" footers
- **Never** add "Co-Authored-By: Claude"

Format: `(scope) description`
- `(filename)` for single file
- `(feature)` for multi-file feature
- `(type)` for general changes (fix, docs, refactor)

---

## Quick Commands

### Backend

```bash
cd backend
./hitta_ansikten.py 2024*.NEF              # Process images
./hitta_ansikten.py --rename --processed . # Rename processed
./hitta_ansikten.py --fix 250101.NEF       # Reprocess file
./hantera_ansikten.py                      # Database management
```

### Frontend

```bash
cd frontend
npm run build:workspace
npx electron .
```

For CLI reference: [docs/user/cli-reference.md](docs/user/cli-reference.md)

---

## Architecture Summary

### Backend

| Component | Purpose |
|-----------|---------|
| `hitta_ansikten.py` | Main CLI (~2000 lines) |
| `faceid_db.py` | Database layer |
| `face_backends.py` | InsightFace/dlib abstraction |
| `api/` | FastAPI server |

### Frontend

| Component | Purpose |
|-----------|---------|
| `main.js` | Electron entry |
| `src/renderer/workspace/` | FlexLayout React |
| `src/renderer/modules/` | UI modules |

Modules: ImageViewer, ReviewModule, FileQueueModule, LogViewer, OriginalView, StatisticsDashboard, DatabaseManagement, PreferencesModule, ThemeEditor

For full architecture: [docs/dev/architecture.md](docs/dev/architecture.md)

---

## Key Concepts

### Face Recognition Backends

| Backend | Encoding | Threshold | Status |
|---------|----------|-----------|--------|
| InsightFace | 512-dim | ~0.4 | Primary |
| dlib | 128-dim | ~0.54 | Legacy |

Config in `~/.local/share/faceid/config.json`:
```json
{
  "backend": { "type": "insightface" }
}
```

### Data Files

| File | Purpose |
|------|---------|
| `encodings.pkl` | Known faces |
| `processed_files.jsonl` | Processed files |
| `attempt_stats.jsonl` | Attempt log |

For data formats: [docs/dev/database.md](docs/dev/database.md)

---

## Gotchas

- RAW files are `.NEF` (Nikon)
- Filename format: `YYMMDD_HHMMSS[-N][_names].NEF`
- Worker process handles detection, main process owns DB writes
- Encodings only compared against same backend type
- SHA1 hash used for file identity

---

## Code Principles

From AGENTS.md:
- **KISS** - Simple, readable solutions
- **DRY** - Extract common logic
- **YAGNI** - No speculative features
- Comments and docs in English
- User-facing strings in Swedish

### Documentation Maintenance

**Always assess if code changes require documentation updates.**

- Bug fixes: Usually no doc update needed
- API/feature changes: Update relevant docs
- **MINIMUM**: Note gaps in [TODO.md](TODO.md)
- **IDEAL**: Update docs alongside code

See [AGENTS.md](AGENTS.md) for detailed guidelines.

---

## Related Docs

- [Architecture](docs/dev/architecture.md)
- [API Reference](docs/dev/api-reference.md)
- [Database](docs/dev/database.md)
- [Theming](docs/dev/theming.md)
- [Contributing](docs/dev/contributing.md)
- [TODO](TODO.md)
