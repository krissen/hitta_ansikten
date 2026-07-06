# Archived CLI tools

Standalone legacy and one-shot command-line tools that are **not** used by the
GUI, the FastAPI backend, or any runtime code path. They were moved here from
the `backend/` root during a repository audit (2026-07) after verifying — with a
project-wide `grep` for `import`/`from` of each module name — that nothing
imports them.

Nothing was deleted: every script still works. They are archived, not removed,
because they remain occasionally useful for manual database maintenance,
inspection, and one-off migrations.

## Contents

| Script | Purpose |
|--------|---------|
| `analysera_ansikten.py` | Database statistics and analytics (ported into `api/services/statistics_service.py`) |
| `hantera_ansikten.py` | Interactive database management — rename/merge/delete people (ported into `api/services/management_service.py`) |
| `forfina_ansikten.py` | Refine encodings — outlier/cluster filtering and shape repair |
| `ratta_ansikten.py` | Review and correct existing matches / ignored faces |
| `rensa_dlib.py` | Remove all legacy dlib encodings from the database (dlib is deprecated) |
| `migrera_processed.py` | One-shot migration of the old `processed.txt` to `processed_files.jsonl` |
| `inspect_encodings.py` | Inspect `encodings.pkl` entries by filename/hash |
| `update_encodings_with_filehash.py` | One-shot: add file hashes to old encoding entries |

## How to run

These scripts import shared backend modules such as `faceid_db` and `cli_config`
that live in `backend/`. Each script that needs them adds `backend/` (three
levels up from the script) to `sys.path` at the top, so you can run them
directly from the `backend/` directory:

```bash
cd backend
python scripts/archive/rensa_dlib.py --dry-run
python scripts/archive/inspect_encodings.py --help
```

If you prefer not to rely on the bootstrap, set `PYTHONPATH` instead:

```bash
PYTHONPATH=backend python backend/scripts/archive/rensa_dlib.py --dry-run
```

Use the same Python environment as the backend (it needs the backend's
dependencies, e.g. `numpy`, and — for a few scripts — `prompt_toolkit`).
