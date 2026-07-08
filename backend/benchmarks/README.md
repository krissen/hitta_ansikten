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

## Model abstractions, cache & baseline (PR B2)

On top of the B1 resolver sits a small model-evaluation core:

- **`models/base.py`** — light `Detector` / `RecognitionModel` protocols (a
  `Face` = bbox xyxy + 5 landmarks + score; recognition embeds a *pre-aligned*
  112×112 BGR crop to an L2-normalized vector). These are deliberately **not**
  the app's `FaceBackend` ABC.
- **`models/align.py`** — the canonical `align_112` (insightface `norm_crop`),
  the single alignment every model consumes.
- **`models/buffalo.py`** — `BuffaloDetector` (SCRFD via `FaceAnalysis`,
  detection module only, configurable `det_size`) and `BuffaloRecognition`
  (the `w600k_r50` head run *directly* on an aligned crop, bypassing its
  internal detector; preprocessing is insightface's own `get_feat`).
- **`cache.py`** — 3-level cache under `_data/`: the B1 `source_index.json`,
  then `detections/<image_hash>.<detector>.npz` and `emb/<model>/<face_id>.npy`.
  Adding a model recomputes only that model's column; reruns are cheap.
- **`dataset.py`** — runs the detector per resolved image, IoU≥0.5-matches
  detections to the DB's stored boxes, and writes `_data/dataset.jsonl` with
  every DB face bucketed `matched` / `detector_missed` / `unresolved`.
- **`baseline_check.py`** — regression test: recomputed buffalo_l embedding vs
  the stored `encodings.pkl` vector (cosine similarity distribution).

```bash
cd backend
python -m benchmarks.dataset          # build _data/dataset.jsonl (+ bucket counts)
python -m benchmarks.baseline_check   # cosine sim: recomputed vs stored
```

Because the detector re-runs at the app's default `det_size=(640, 640)` and the
recognition head shares insightface's exact preprocessing, recomputed vectors
reproduce the stored ones at cosine ≈ 1.0.

## Metrics + report layer (PR B3)

The analytical core sits on top of the B2 dataset/cache:

- **`metrics.py`** — pure functions over embeddings + labels (numpy in,
  dataclasses out, no I/O, no insightface):
  - `closed_set_identification` — leave-one-out rank-1/rank-5 in two gallery
    modes: per-person centroid (mean → re-L2) and all-encodings max-sim (the
    probe's own vector excluded).
  - `open_set_identification` — DIR@rank1 vs FAR for held-out / ignored probes
    that must be rejected.
  - `build_pairs` + `verification_roc` — genuine/impostor pair scoring, ROC AUC
    and TAR@FAR (1e-2 / 1e-3), with impostor subsets: all-comers, same-surname
    (siblings), and the `distinct_pairs` twin pair.
  - `twin_confusion_rate` — fraction of twin probes whose nearest wrong-person
    is the co-twin.
  - `threshold_sweep` — cosine-distance grid 0.20–0.80 step 0.01 →
    precision/recall/FAR/FRR per point (the empirical check on the app's
    0.4 / 0.35 defaults).
  - `detection_recall` / `detection_recall_by_stratum` — matched /
    (matched + detector_missed), overall and per stratum.
- **`embeddings.py`** — turns `matched` dataset rows into embeddings (cached,
  reusing B2's `_data/emb/`) plus a blur score (variance of the Laplacian of the
  aligned crop, cached under `_data/blur/<detector>.json`).
- **`report.py`** — per-face strata assignment (bbox-area quartile, blur
  quartile, is_manual, sibling surname, twin, event, attempt-log hardness),
  markdown/CSV rendering, and matplotlib (Agg) plots.
- **`run.py`** — the CLI orchestrator: index → dataset → embeddings → metrics →
  `_data/report.md`, `_data/report.csv`, `_data/plots/*.png`. Seeded RNG for any
  sampling; the config (seed, split, roots, model list, partial flag) is written
  into the report header. Wall-clock per stage is recorded but marked
  informational.

```bash
cd backend
# Full run over the default roots (or a staging dir), buffalo_l:
python -m benchmarks.run --models buffalo_l ~/.local/share/faceid/benchmark_staging

# Quick partial run (cap DB records, flag the report as partial):
python -m benchmarks.run --limit 500 --seed 7 --partial
```

Strata note: `blur` (variance of Laplacian on the aligned crop) is computed at
embed time and cached; `hardness` joins `attempt_stats.jsonl` by source basename
(images that needed multiple detection attempts are "hard"). matplotlib is a
runtime dependency already (used by the app), so no extra install is needed.

## Layout

| File | Role |
|---|---|
| `resolver.py` | Pure index + join core (SHA1→path, incremental cache) |
| `db_access.py` | Read-only DB → `FaceRecord` extraction (incl. stored encoding) |
| `strata.py` | Pure stratification (quartiles, surnames, twins, events) |
| `config.py` | Photo-root discovery + data-file locations |
| `cache.py` | 3-level on-disk cache (detections + embeddings) |
| `dataset.py` | Detector run + IoU match → per-face dataset manifest |
| `models/` | `Detector`/`RecognitionModel` protocols, alignment, buffalo adapters |
| `metrics.py` | Pure metric functions (closed/open-set, ROC, sweep, twins, det recall) |
| `embeddings.py` | Matched rows → cached embeddings + blur score |
| `report.py` | Strata assignment, markdown/CSV rendering, matplotlib plots |
| `resolve.py` | CLI: build index, report resolution |
| `dataset.py` | CLI: assemble `_data/dataset.jsonl` |
| `baseline_check.py` | CLI: recomputed-vs-stored cosine regression |
| `report_feasibility.py` | CLI: full markdown feasibility report |
| `run.py` | CLI: full pipeline → `_data/report.md` + `.csv` + `plots/` |
| `_data/` | Generated cache/reports/lists (gitignored) |

Tests live in `backend/tests/test_benchmark_resolver.py`,
`backend/tests/test_benchmark_models.py`, `test_benchmark_metrics.py` and
`test_benchmark_report.py`; they use synthetic tmp dirs, a fabricated mini-DB,
hand-computable embeddings, and fake models — the only insightface-dependent
test is guarded by an import check. They never touch the real database.
