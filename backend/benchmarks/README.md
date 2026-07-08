# Face-recognition benchmark tooling

Developer/evaluation tooling that turns the owner's confirmed face database
(`~/.local/share/faceid/encodings.pkl`) into an evaluation dataset. **Not part
of the shipped app** — excluded from the PyInstaller bundle and never imported
by the API server or CLI.

Everything generated goes under `_data/` (gitignored). The face database is
treated as strictly **read-only**; nothing here writes to
`~/.local/share/faceid/`.

## What it does

The confirmed DB records, per face, the **SHA1 of the source image** it came
from. Most of those source files have since moved out of the working
directories (post-processing cleanup), so the recorded paths are stale. This
tooling rebuilds the link by content hash:

1. **`resolve.py`** — walks configurable photo roots, hashes image files
   (SHA1, matching `core.db.get_file_hash`), caches results incrementally in
   `_data/source_index.json` (rehash only when a file's size/mtime changes),
   then joins the index against the DB's recorded hashes and reports the
   resolution rate.
2. **`report_feasibility.py`** — the go/no-go artifact. Produces
   `_data/feasibility_report.md` with recovery rate (images and faces),
   gallery+probe viability (identities with ≥2 recovered distinct images), and
   per-stratum counts (bbox area quartile, manual vs detected, sibling surname
   groups + the confirmed twin pair, per-event by `YYMMDD` prefix). Also writes
   `_data/unresolved_hashes.json` — the list of missing source images (with
   their recorded basenames) that feeds backup recovery.

## Usage

Run from `backend/` (so `benchmarks` is importable):

```bash
cd backend

# Build the index and print resolution rate (scans default local photo roots):
python -m benchmarks.resolve

# Scan explicit roots instead:
python -m benchmarks.resolve ~/Pictures/nerladdat ~/Pictures/framkallat

# Dump per-hash resolution as JSON:
python -m benchmarks.resolve --json > _data/resolutions.json

# Full feasibility report:
python -m benchmarks.report_feasibility
```

### Configuring photo roots

Precedence: CLI args > `_data/roots.json` > auto-detected default roots.

`_data/roots.json`:

```json
{ "roots": ["~/Pictures/nerladdat", "~/Pictures/framkallat"] }
```

## Backup recovery

Most source images are not local but are recoverable from the home backup
(restic on Hetzner, mirrored to the kailash-T7 disk). `unresolved_hashes.json`
lists the recorded basenames to fetch. Look them up with `kosha find <basename>`
(read-only archive query), then restore the relevant event folders into a
staging directory and re-run `resolve.py` pointing at it. See the feasibility
report's "Backup recovery procedure" section for the exact restic commands and
the estimated data volume.

## Layout

| File | Role |
|---|---|
| `resolver.py` | Pure index + join core (SHA1→path, incremental cache) |
| `db_access.py` | Read-only DB → `FaceRecord` extraction |
| `strata.py` | Pure stratification (quartiles, surnames, twins, events) |
| `config.py` | Photo-root discovery + data-file locations |
| `resolve.py` | CLI: build index, report resolution |
| `report_feasibility.py` | CLI: full markdown feasibility report |
| `_data/` | Generated cache/reports/lists (gitignored) |

Tests live in `backend/tests/test_benchmark_resolver.py` and use synthetic tmp
dirs plus a fabricated mini-DB — they never touch the real database.
