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

## LVFace adapter (PR B4)

A second recognition head sits alongside buffalo_l: **LVFace** (ByteDance,
ICCV 2025 — a Large Vision-Transformer face model, MIT-licensed ONNX weights on
Hugging Face [`bytedance-research/LVFace`](https://huggingface.co/bytedance-research/LVFace),
variants Tiny/Small/Base/Large).

- **`models/download.py`** — model-acquisition CLI. Downloads a named model from
  the Hub (via `huggingface_hub` if importable, else dependency-free streaming
  HTTPS) into `_data/models/<name>/` (gitignored) and maintains the **committed**
  [`models/models_manifest.json`](models/models_manifest.json) (source URL,
  sha256, license, embedding dim, preprocessing note). The Hub stores each LFS
  blob's **sha256 as its git-LFS oid**, so the manifest hash doubles as an
  integrity check on every future download.
- **`models/lvface.py`** — `LVFaceRecognition` runs the ONNX head directly via
  `onnxruntime` on the benchmark's canonical 112×112 BGR crop. Preprocessing is
  **verified against the reference** (github.com/bytedance/LVFace
  `inference_onnx.py`): BGR→RGB, transpose to NCHW float32, normalize
  `(x−127.5)/127.5` → `[-1, 1]`. The ONNX emits a **raw** 512-d embedding (the
  reference L2-normalizes only at cosine time); the adapter L2-normalizes to
  honor the `RecognitionModel` contract (cosine is invariant to that). Variant
  selection (Base default) or an explicit `model_path`; dynamic-batch embed with
  a padding fallback for a statically-pinned batch dim.
- **`models/verify_lvface_parity.py`** — the **parity gate**. Feeds the *same*
  aligned crop through (a) the adapter and (b) a verbatim port of the reference
  preprocessing into the *same* ONNX session, and requires cosine `> 0.999`.
  Because both share identical weights, any lower cosine is a pure preprocessing
  discrepancy (wrong channel order / mean-scale / layout) — the one failure mode
  that silently corrupts embeddings and yields a false "LVFace is worse"
  conclusion. Run once per variant after downloading weights.

```bash
cd backend

# List known models / download the Base variant:
python -m benchmarks.models.download --list
python -m benchmarks.models.download lvface_base

# Parity gate (must print PARITY OK, cosine > 0.999):
python -m benchmarks.models.verify_lvface_parity --variant lvface_base

# Two-model comparison report (comma-separated --models):
python -m benchmarks.run ~/.local/share/faceid/benchmark_staging \
    --models buffalo_l,lvface_base
```

> **Weights are never committed.** Only `models_manifest.json` (name, URL,
> sha256, license, dim, preprocessing) is under version control; the `.onnx`
> files live under the gitignored `_data/models/`.

## AdaFace IR-101 adapter (PR B5)

A third recognition head: **AdaFace** (Kim et al., CVPR 2022 — quality-adaptive
margin, MIT, [`github.com/mk-minchul/AdaFace`](https://github.com/mk-minchul/AdaFace)).
The OODFace study ranks AdaFace strongest on **hard / low-quality faces** (blur,
small faces) — this app's exact pain points — so it is the most interesting
challenger to buffalo_l. Unlike LVFace, AdaFace ships **no official ONNX**: the
published weights are PyTorch checkpoints, so there is an extra export step.

- **`models/export_adaface.py`** — one-shot CLI for a **networked machine**.
  Downloads the IR-101 WebFace12M checkpoint (MIT HF mirror
  `marcelo-victor/adaface_ir101_webface12m`, or `--checkpoint PATH` for the
  authoritative Google-Drive file from the AdaFace repo), loads the vendored
  IR-101 architecture, exports to ONNX (dynamic batch, opset 17, embedding head
  only), runs **torch-vs-ONNX parity** (cosine > 0.999 on random inputs + a real
  crop if present), and records checkpoint/ONNX sha256 + license + preprocessing
  + opset in the committed `models_manifest.json`. **Torch is an export-time
  dependency only** — never a benchmark runtime dep; run it in a scratch venv.
- **`models/_adaface_ir101_net.py`** — the vendored IR-101 backbone (MIT,
  © 2022 Minchul Kim), a faithful trimmed port (`ir` mode only) so export can
  reconstruct the net and load the checkpoint `state_dict` with `strict=True`.
- **`models/adaface.py`** — `AdaFaceRecognition` runs the exported ONNX via
  `onnxruntime` on the canonical 112×112 BGR crop. Preprocessing is **verified
  against the reference** (AdaFace `inference.py` `to_input`): `to_input` starts
  from a PIL **RGB** image and reverses the channel axis to feed the net **BGR**,
  then normalizes `(x−127.5)/127.5`. Our crop is *already* BGR, so the adapter
  applies **no channel swap** — the exact opposite of LVFace. Getting this wrong
  silently tanks AdaFace's score and yields a false "AdaFace is worse"
  conclusion; the parity test pins it. The IR-101 backbone L2-normalizes its
  embedding internally, and the adapter re-normalizes (idempotent) to honor the
  `RecognitionModel` contract.

```bash
# --- networked machine, scratch venv (torch is export-time only) ---
python3 -m venv /tmp/adaface-export && . /tmp/adaface-export/bin/activate
pip install torch onnx onnxruntime onnxscript huggingface_hub numpy pillow
cd backend
python -m benchmarks.models.export_adaface          # download + export + verify

# --- any machine with the exported ONNX under _data/models/adaface_ir101/ ---
python -m benchmarks.run ~/.local/share/faceid/benchmark_staging \
    --models buffalo_l,lvface_base,adaface_ir101
```

> `onnxscript` is only needed by newer torch's exporter; the CLI forces the
> legacy TorchScript exporter (`dynamo=False`) so it also works without it.

## YOLO-face detector + detection comparison (PR B6)

SCRFD-10GF (buffalo_l's detector, 2021) trails newer YOLO-family face detectors
on WIDERFACE Hard, and for crowded event/sports photos detection is likely a
bigger lever than recognition. B6 adds a YOLO-face detector adapter and a
detector-vs-detector comparison against the same DB ground truth.

- **`models/yoloface.py`** — `YoloFaceDetector(Detector)`: an onnxruntime-only
  adapter for a YOLOv8-face ONNX with **5-point landmarks** (the landmarks
  `align_112`/`norm_crop` needs, in SCRFD order). Letterbox preprocessing,
  box+landmark+score decode, greedy NMS, and coordinate mapping back to the
  original image. Two ONNX layouts are auto-detected: the **raw YOLOv8-pose
  head** `(1, 4+nc+3K, N)` (the adapter runs its own confidence filter + NMS)
  and the **NMS-baked head** `(1, M, 6+3K)` (already suppressed; only
  confidence-filtered). **No torch/ultralytics at runtime** — only onnxruntime.
- **`models/download.py`** — B6 extends the B4 `ModelSpec` design minimally:
  optional `url` (direct download, e.g. a GitHub release asset, bypassing the
  HF resolve endpoint) and `kind` (`"detector"`) fields. `yolov8n-face` is
  registered in `KNOWN_MODELS` and fetched checksum-verified into
  `_data/models/<name>/`; its manifest entries (including the offline-produced
  `yolov8n-face-raw`, with honest `null` hashes per the AdaFace precedent) live
  in the committed `models_manifest.json`, and `update_manifest` now preserves
  hand-maintained fields (`license_note`, `note`) on CLI rewrites.
- **`detect_compare.py`** — runs two+ detectors over the same resolved images,
  IoU-matches to the DB's stored boxes, and reports **detection recall**
  (matched / (matched + detector_missed)) overall and per stratum (bbox-area
  quartiles — small faces especially — and manual vs detected), plus **new faces
  found** (detections overlapping no DB box; count-only, since they can't be
  auto-scored against ground truth). Detection-only, so it's fast; detections
  are cached per (image, detector) and shared with `run.py`.
- **`run.py`** also gains `yolov8n-face` / `yolov8n-face-raw` model entries
  (YOLO detector + buffalo_l recognition head — the mirror image of the
  LVFace/AdaFace factories) so the full pipeline can run on YOLO detections too.

```bash
cd backend

# Fetch the default YOLO-face ONNX (onnxruntime-only, checksum-verified):
python -m benchmarks.models.download yolov8n-face

# Compare SCRFD (buffalo_l) vs YOLOv8-face on the DB ground truth:
python -m benchmarks.detect_compare ~/.local/share/faceid/benchmark_staging \
    --detectors buffalo_l yolov8n-face
```

### Results on the current staging set (2026-07-08, restore still in progress)

`detect_compare` over `~/.local/share/faceid/benchmark_staging/` (975 resolved
images, **N = 1991** scored DB faces; 102 of those have no stored bbox and can
never match — they penalize both detectors equally), both detectors at 640:

| Metric | buffalo_l (SCRFD-10GF) | yolov8n-face |
|---|---|---|
| Overall detection recall | **94.6 %** (1884/1991) | 93.1 % (1853/1991) |
| — excluding `no_bbox` | **99.7 %** (1884/1889) | 98.1 % (1853/1889) |
| Q1 (smallest faces) | **99.2 %** (483/487) | 95.1 % (463/487) |
| Q2 | **100.0 %** (559/559) | 98.9 % (553/559) |
| Q3 | **99.8 %** (509/510) | 99.0 % (505/510) |
| Q4 (largest) | **100.0 %** (333/333) | 99.7 % (332/333) |
| New faces found (conf ≥ 0.5, count-only) | 2279 | 1871 |

**Takeaway:** the *nano* YOLOv8-face does **not** beat SCRFD-10GF on this data —
SCRFD leads everywhere, most clearly on the smallest faces (Q1: +4.1 pp). That
is consistent with model class: yolov8**n** (~8 GFLOPs) vs SCRFD-**10GF**; the
WIDERFACE-Hard advantage reported for YOLO-family detectors comes from the
larger variants. The adapter + manifest make A/B-ing `yolov8l-face` /
`yolov12*-face` (same release; needs a one-time raw-head export) a config
change — tracked in ROADMAP (B6+).

### Model + license

The default `yolov8n-face` is a pre-exported ONNX (NMS baked in) from the
[akanametov/yolo-face](https://github.com/akanametov/yolo-face) 1.0.0 release,
trained on WIDERFACE, **AGPL-3.0** (ultralytics-derived). AGPL-3.0 is acceptable
for this **local, non-shipped benchmark tooling** — the weights are never bundled
into the distributed app; do not redistribute them inside a proprietary product.
The optional `yolov8n-face-raw` (same weights, no baked NMS — exercises the
adapter's own NMS path) is produced offline with a **one-time** ultralytics
export in a scratch venv (never the project venv); the exact command is in the
manifest's `note` field. Both are documented in `models_manifest.json`.

### Large-variant A/B + end-to-end YOLO pipeline (2026-07-10, full restore)

B6 left one question open (ROADMAP B6+): the *nano* YOLO lost to SCRFD, but does
a **large** YOLO-face variant close — or beat — that gap where model class
plausibly explains nano's loss? The large `yolov8l-face` / `yolov12l-face`
weights (same akanametov release, one-time raw-head export) were A/B'd against
SCRFD on the full restore, and the nano end-to-end pipeline was run through the
buffalo_l recognition head.

`detect_compare` over the full-restore staging (2014 images, **N = 3030** scored
DB faces; 102 have no stored bbox and can never match — they penalize every
detector equally), all detectors at `det_size=640`, new-face conf ≥ 0.5:

| Metric | buffalo_l (SCRFD-10GF) | yolov8n-face | yolov8l-face | yolov12l-face |
|---|---:|---:|---:|---:|
| Overall recall | **96.5 %** (2923/3030) | 95.3 % (2888/3030) | 96.4 % (2920/3030) | 96.3 % (2918/3030) |
| Q1 (smallest faces) | **99.4 %** (648/652) | 96.0 % (626/652) | 99.1 % (646/652) | 99.1 % (646/652) |
| Q2 | **100.0 %** | 99.0 % | **100.0 %** | 99.9 % |
| Q3 | **99.9 %** | 99.4 % | **99.9 %** | 99.7 % |
| Q4 (largest) | **100.0 %** | 99.9 % | 99.9 % | 99.9 % |
| New faces found (count-only) | 4099 | 3527 | 4338 | 4342 |

**Takeaways:**

1. **The large variants close the nano gap but beat SCRFD nowhere.** `yolov8l` /
   `yolov12l` recover almost all of nano's deficit (Q1 96.0 % → 99.1 %), but
   SCRFD still leads or ties every quartile — most clearly on the smallest faces
   (Q1: SCRFD 99.4 % vs 99.1 %). There is no stratum where a larger YOLO wins.
2. **The large akanametov weights are landmark-less.** They are plain
   *detectors* with no 5-point landmark head, so they **cannot** feed
   `align_112`/`norm_crop` (alignment needs the 5 points) and therefore cannot
   drive the recognition path — see the `models_manifest.json` note. Only the
   nano weights carry landmarks, so end-to-end was run with nano alone.
3. **End-to-end nano → buffalo_l is recognition-equivalent** on commonly-detected
   faces. Feeding `yolov8n-face` detections into the buffalo_l head embeds 2888
   faces / 96 identities (vs 2923 / 97 for the SCRFD path); rank-1 max-sim
   **98.8 % vs 98.7 %**, rank-5 99.7 % vs 99.8 %, twin rank-1 80.4 % vs 79.6 %,
   open-set DIR@FAR≤0.01 86.0 % vs 86.4 %, and the threshold sweep reproduces the
   app defaults (0.45 / 0.35). On the faces both detectors find, recognition is a
   wash — the detector swap changes nothing downstream; SCRFD's higher recall
   simply means **more faces embedded**.

**Verdict:** B6+ closes the detector question. No YOLO variant beats SCRFD on
recall, the large ones can't drive recognition, and nano is recognition-equivalent
only on faces SCRFD already detects. **SCRFD (buffalo_l) is retained** — consistent
with the audit decision report. The end-to-end report lives in
`_data/report_yolo.md` (gitignored); the full `detect_compare` printout is in
`_data/b6plus_runs.log`.

## Layout

| File | Role |
|---|---|
| `resolver.py` | Pure index + join core (SHA1→path, incremental cache) |
| `db_access.py` | Read-only DB → `FaceRecord` extraction (incl. stored encoding) |
| `strata.py` | Pure stratification (quartiles, surnames, twins, events) |
| `config.py` | Photo-root discovery + data-file locations |
| `cache.py` | 3-level on-disk cache (detections + embeddings) |
| `dataset.py` | Detector run + IoU match → per-face dataset manifest |
| `models/` | `Detector`/`RecognitionModel` protocols, alignment, buffalo + LVFace adapters |
| `models/download.py` | CLI: fetch model weights (HF or direct URL) + committed `models_manifest.json` |
| `models/lvface.py` | LVFace ONNX recognition adapter (onnxruntime, verified preprocessing) |
| `models/verify_lvface_parity.py` | CLI: parity gate (adapter vs reference pipeline, cosine > 0.999) |
| `models/adaface.py` | AdaFace IR-101 ONNX recognition adapter (BGR no-swap, verified `to_input`) |
| `models/export_adaface.py` | CLI (networked): checkpoint → ONNX export + torch-parity + manifest |
| `models/_adaface_ir101_net.py` | Vendored IR-101 backbone (MIT, © Minchul Kim), export-time only |
| `models/yoloface.py` | YOLO-face ONNX detector (letterbox, decode, NMS, 5-pt landmarks) |
| `detect_compare.py` | CLI: SCRFD-vs-YOLO detection recall + new-faces-found |
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
`backend/tests/test_benchmark_models.py`, `test_benchmark_metrics.py`,
`test_benchmark_report.py`, `test_benchmark_lvface.py` and
`test_benchmark_yoloface.py`; they use synthetic tmp dirs, a fabricated
mini-DB, hand-computable embeddings, fake models, a tiny on-the-fly ONNX head
(for the LVFace adapter), and synthetic detector tensors (for the YOLO decode) —
the insightface- and real-weight-dependent tests are guarded by
import/existence checks. They never touch the real database and never hit the
network.
