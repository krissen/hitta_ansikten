# Face-recognition audit — decision report (2026-07)

Status: **final**. This report concludes the face-recognition audit and its
benchmark track (`backend/benchmarks/`, PRs B1–B6). It answers the four
questions the audit set out to settle — **library, model, thresholds,
detector** — from the full-dataset benchmark rather than from priors, and
records the decisions the project will act on.

All numbers below come from a single, reproducible run over the owner's
confirmed face database, evaluated on **identical detections and crops** across
every recognition head (one SCRFD detection pass at `det_size=640`, one
`norm_crop` 112×112 alignment, then each model embeds the same crop). Source
artifacts: `backend/benchmarks/_data/report.md`, `report.csv`, `plots/`
(gitignored — regenerate with the commands in
[Reproduction](#reproduction)).

---

## TL;DR — the four verdicts

1. **Library — keep InsightFace.** No practically better library exists; the
   1.0.1 upgrade is clean and the head is what every alternative would be bolted
   onto anyway.
2. **Model — do not migrate.** buffalo_l ties or beats AdaFace and LVFace on
   every stratum the app actually uses (closed-set rank-1, small faces, twins).
   AdaFace's marginal verification-AUC edge does not translate into
   identification gains, so it does not justify re-enrollment.
3. **Thresholds — raise `match_threshold` 0.40 → 0.45.** This is the one place
   the data changes the standing conclusion. The pair-level sweep's "0.72
   optimum" does **not** apply to the app; an **app-level** sweep (nearest of a
   person's many stored encodings) shows 0.40 is needlessly strict — it leaves
   ~6% of genuine faces unmatched at essentially no precision benefit.
4. **Detector — SCRFD stays, `det_size=640` is adequate, tiling (PR 4b) is not
   warranted.** Effective detector recall on box-bearing faces is ~99.8%
   (99.5% on the smallest-face quartile); the residual gap is five faces and a
   data-hygiene artifact, neither of which tiling would close economically.

---

## Dataset and method

| Property | Value |
|---|---|
| Recognition heads | `buffalo_l` (shipped), `lvface_base`, `adaface_ir101` |
| Matched faces embedded | **2,923** across **97** identities |
| Detector / alignment | SCRFD-10GF @ `det_size=640` → `norm_crop` 112×112 (shared by all heads) |
| Seed | 1234 |
| Impostor pairs (verification) | up to 200,000 sampled |
| Source recovery | 2,099 / 2,188 files SHA1-verified from backup; **89 genuine mismatches** unrecoverable |

The evaluation dataset is the owner's **confirmed** face database. Most original
source images had been archived away after processing; they were restored by
content hash from the home backup (restic) into a staging directory and
SHA1-verified against the database before embedding. The 89 files that could not
be byte-verified are excluded. Recovery is therefore **~96%** of the recoverable
set — the number that also bounds any future re-enrollment (see
[Model](#2-model--do-not-migrate)).

Because the heads run on one shared detection+alignment pass, all model
differences below are **pure recognition** differences — the detector is held
constant and is evaluated separately in
[Detector](#4-detector--scrfd-stays-det_size640-is-adequate).

---

## 1. Library — keep InsightFace

**Decision: keep InsightFace.** No change.

- **The upgrade is clean.** InsightFace was moved 0.7.3 → 1.0.1 (onnxruntime →
  1.27.0) under an embedding-stability gate: the same aligned crop must produce
  cosine-similarity > 0.999 between old and new embeddings. Outcome on the test
  faces was **cosine 1.000000 and bbox-IoU 1.0** — identical embeddings and
  detection, so no `encodings.pkl` drift. 1.0.1 is a lighter pure-Python wheel
  (no C++ face3d build), stays ONNX-only, and is a currently-published release.
  Dependencies are now pinned exactly (`insightface==1.0.1`,
  `onnxruntime==1.27.0`) because the embeddings are the load-bearing artifact.
  Re-runnable gate: `backend/benchmarks/upgrade_compare.py`.
- **There is no better *library*.** The two strongest MIT-licensed challengers,
  LVFace and AdaFace, are **recognition heads shipped as ONNX**, not libraries.
  The benchmark runs them on InsightFace's own SCRFD detector and `norm_crop`
  alignment — i.e. even "switching model" keeps InsightFace as the detection /
  alignment / runtime substrate. Adopting either would mean *adding a head to
  InsightFace*, not replacing it.
- **Ecosystem corroboration.** buffalo_l via InsightFace remains the default in
  comparable open-source photo/face stacks; the audit found no maintained,
  practically-superior drop-in. dlib is deprecated and remains removed
  (InsightFace is the sole active backend).

Note on the 1.0.1 `prepare()` "Auto" `det_size` default
(`[(128,128),(640,640)]`): 128 is a *down*-scale (coarser/faster), **not** a
small-face lever. The app deliberately passes explicit `det_size=(640,640)`; do
not switch to Auto expecting better small-face recall.

---

## 2. Model — do not migrate

**Decision: stay on buffalo_l.** Do not migrate to LVFace or AdaFace.

The decision framework weights **hard strata** (small faces, blur, siblings,
twins) heavily, treats **easy strata** as non-regression floors, and treats
speed as informational only. On the headline number the three heads are a
near-tie (rank-1 max-sim: buffalo 98.7%, adaface 98.7%, lvface 98.2%), so the
real question is whether AdaFace wins the **hard** strata by enough to pay for
re-enrollment. It does not — it slightly *loses* them.

### Headline (closed-set identification, leave-one-out)

| Metric | buffalo_l | adaface_ir101 | lvface_base |
|---|---:|---:|---:|
| Rank-1 (max-sim gallery) | **98.7%** | **98.7%** | 98.2% |
| Rank-1 (per-person centroid) | 98.4% | **98.6%** | 98.2% |
| Rank-5 (max-sim) | 99.8% | 99.8% | 99.5% |

### Hard strata — rank-1 (max-sim), the deciding table

| Stratum | buffalo_l | adaface_ir101 | lvface_base |
|---|---:|---:|---:|
| Q1 smallest bbox | **97.2%** | 96.8% | 95.9% |
| Q1 blurriest | **97.8%** | 97.4% | 97.4% |
| Twin subset (108 probes) | **79.6%** | 73.1% | 74.1% |
| Björneholt (sibling + twin, 116) | **81.0%** | 75.0% | 75.0% |
| Siblings, all surname groups | ~tie | ~tie | ~tie |

buffalo_l is **best or tied on every hard stratum**, and clearly best on the two
that matter most for this dataset (smallest faces and the twin/sibling subset).
AdaFace's reputation as a low-quality/hard-case specialist does **not**
reproduce here on closed-set identification.

### Where AdaFace does edge ahead — and why it doesn't matter for the app

| Verification metric | buffalo_l | adaface_ir101 | lvface_base |
|---|---:|---:|---:|
| AUC (all-comers) | 0.9987 | **0.9990** | 0.9981 |
| TAR@FAR=1e-3 (all-comers) | 97.0% | **98.0%** | 92.5% |
| AUC (same-surname impostors) | 0.9771 | **0.9772** | 0.9728 |
| AUC (twin-pair impostors) | **0.6328** | 0.6292 | 0.5872 |
| Open-set DIR@FAR≤0.01 | 86.4% | 86.4% | 84.7% |

AdaFace wins *verification* (1:1 same/different scoring) by ~1pp at FAR=1e-3.
But the app is a **1:N identification** system — it asks "which enrolled person
is this?", answered by rank-1 nearest-encoding matching. On that task AdaFace is
tied at best and slightly worse on the hard strata, and the open-set
reject-vs-identify curve is a tie. The verification edge does not convert.

### The re-enrollment cost is real; the payoff is zero-to-negative

Migrating heads means re-embedding every enrolled face with the new model. The
database stores encodings, not crops, so re-enrollment must re-run
detection+embedding on the **original** source images — of which ~96% are
recoverable (the 89 unrecoverable files would lose their enrollments outright).
It would also require re-calibrating the twin guard and thresholds against a new
distance distribution. Paying that for a stratum-level **tie/regression** is not
justified.

**LVFace** is the weakest identifier of the three (98.2% headline, 95.9% on
smallest faces, worst verification) *and* has no ecosystem advantage — rejected
outright.

---

## 3. Thresholds — raise `match_threshold` 0.40 → 0.45

**Decision: raise `match_threshold` from 0.40 to 0.45** (cosine distance), keep
`ignore_distance` at 0.35, and codify a **0.40–0.50 band** with 0.45 as the
default. This is the only place in the audit where the data revises the standing
conclusion.

### Why the report's "0.72 optimum" does not apply to the app

`report.md`'s threshold sweep finds a pair-level F1 optimum at cosine distance
**0.72** (buffalo: precision 99.5%, recall 99.0%, FAR 0.4%). That is a
**pair-level** metric: one random genuine pair vs one random impostor pair. The
app does not work that way. In the app a probe is matched to the person whose
**nearest of many stored encodings** is closest (`_match_encoding`), and a name
is auto-filled only if that nearest distance is below `match_threshold`
(`_determine_match_case`). Two consequences the pair-level sweep cannot see:

- **App-level recall at a given distance is far higher** than pair-level recall,
  because the probe gets the *best* of a person's many encodings, not a random
  one.
- **App-level false-accept at 0.72 would be far higher** than the pair-level
  0.4%, because there are many more encodings to accidentally fall within 0.72
  of — across every other person.

So the pair-level curve is the wrong operating curve. The right one is an
**app-level sweep**: for each of the 2,920 cached embeddings, take the nearest
*other* encoding (rank-1), and gate it by threshold.

### App-level sweep (buffalo_l, nearest-person, rank-1 gated)

> As of this report's generation, the sweep basis was **N = 2,920 cached
> embeddings** (non-twin basis N = 2,815). The live cache has since grown to
> 2,923 embeddings; the non-twin basis of 2,815 is stable, so the percentages
> below are unchanged.

Computed from the committed embeddings under `_data/emb/buffalo_l/` joined to
`report.csv`; `correct` = nearest is the right person and within threshold
(auto-fill), `false auto-fill` = nearest is the *wrong* person and within
threshold, `unknown` = nearest is beyond threshold (not auto-filled, but the
nearest person is still surfaced as a review suggestion).

| Threshold | correct (auto-fill) | false auto-fill | unknown |
|---:|---:|---:|---:|
| 0.40 ⟵ current | 93.4% | 0.65% | 5.96% |
| 0.45 | 96.2% | 0.72% | 3.05% |
| 0.50 | 97.2% | 0.79% | 2.02% |
| 0.60 | 97.9% | 0.96% | 1.16% |
| 0.72 | 98.2% | 1.27% | 0.51% |

The "false auto-fill" column is dominated by **the known twin pair**, which the
app already handles with a separate guard. Excluding the twin faces (which the
twin guard, not the threshold, is responsible for) gives the operating curve
that actually governs everyone else:

**buffalo_l, non-twin only (N = 2,815):**

| Threshold | correct | false auto-fill | unknown | false auto-fill (count) |
|---:|---:|---:|---:|---:|
| 0.40 ⟵ current | 94.0% | 0.04% | 5.97% | 1 face |
| 0.45 | 96.8% | 0.04% | 3.13% | 1 face |
| 0.50 | 97.8% | 0.11% | 2.10% | 3 faces |
| 0.55 | 98.2% | 0.28% | 1.53% | 8 faces |
| 0.60 | 98.5% | 0.28% | 1.21% | 8 faces |

**Reading it:** at the current 0.40, the app leaves ~6% of genuine, correctly-
matchable faces as "unknown" — the user must confirm them manually — while
buying essentially nothing (one non-twin false auto-fill in 2,815). Moving to
**0.45 halves the unknown rate (5.97% → 3.13%) at zero additional false
auto-fills**. Moving to 0.50 reaches 2.10% unknown at three total false
auto-fills (0.11%). The twin guard is untouched by any of this.

### Recommendation

- **Adopt `match_threshold = 0.45`** as the new default. It is the strictly-safe
  point: on this dataset it recovers ~2.8pp of genuine matches from the "unknown"
  bucket **at zero measured precision cost**, twin guard unchanged.
- **Codify the 0.40–0.50 band** in config docs: 0.40 = maximum-precision floor,
  0.45 = recommended default, 0.50 = aggressive (2.1% unknown, still only 0.11%
  non-twin false auto-fill). Do not exceed ~0.50 for the shipped, auto-filling
  path; 0.72 is a pair-level artifact, not an app operating point.
- **Keep `ignore_distance = 0.35`.** It governs the separate, user-curated
  "ignored faces" set, which this benchmark did not include; do not move it on
  evidence that doesn't cover it.
- **Asymmetry that backs 0.45.** An "unknown" face is not lost — the review UI
  still surfaces the nearest person as a one-click suggestion. The cost of a low
  threshold is *extra confirmations*; the cost of a high threshold is *wrong
  auto-fills the user must catch and undo*. The data shows 0.45 adds zero of the
  latter, so the trade is one-directional.

> Caveat on the open-set direction: raising the threshold also raises the chance
> that a genuinely **new** (unenrolled) person is auto-matched to someone. The
> open-set split here is synthetic (identities with <2 images treated as
> unknown), so 0.45 is chosen deliberately conservatively. If 0.50 is desired, a
> targeted open-set false-accept sweep at the exact operating distance is a cheap
> follow-up.

---

## 4. Detector — SCRFD stays, `det_size=640` is adequate

**Decision: keep SCRFD-10GF at `det_size=640`. Tiling (PR 4b) is not warranted.
Do not raise the default `det_size`.**

### SCRFD vs YOLOv8n-face (PR B6)

On the detection comparison over the staging set (N = 1,991 scored faces, both
detectors at 640):

| Metric | SCRFD-10GF (buffalo_l) | yolov8n-face |
|---|---:|---:|
| Recall excl. `no_bbox` | **99.7%** | 98.1% |
| Q1 (smallest faces) | **99.2%** | 95.1% |
| Overall (incl. `no_bbox`) | **94.6%** | 93.1% |

SCRFD leads everywhere, most on the smallest faces (**+4.1pp** on Q1). The
*nano* YOLO does not beat a 10-GFLOP SCRFD; the WIDERFACE-Hard advantage reported
for YOLO-family detectors belongs to the larger variants (a config-change A/B,
tracked as B6+, only worth doing if detection becomes the bottleneck — it is
not).

**Update (2026-07-10, B6+ run):** the large-variant A/B was executed on the full
restore. `yolov8l-face` / `yolov12l-face` close the nano gap but do **not** beat
SCRFD anywhere (Q1 99.4 % SCRFD vs 99.1 % for both large variants; SCRFD leads or
ties every quartile), and the large akanametov weights are landmark-less (plain
detectors, no 5-point head) so they cannot drive alignment/recognition. The
detector verdict is unchanged — SCRFD stays. Numbers in
`backend/benchmarks/README.md`.

### Is `det_size=640` and single-pass detection enough?

From the full-dataset detector recall (2,923 matched + 107 missed):

- Reported overall recall is **96.5%**, but 102 of the 107 misses are
  **`no_bbox`** faces — enrolled without a stored bounding box, so they can
  never IoU-match *any* detector and penalize all equally. They are a
  **data-hygiene artifact**, not a detector failure. (96 of them are a single
  jpg event, `251017`, enrolled without stored boxes.)
- Excluding `no_bbox`, effective recall on **box-bearing** faces is
  **2,923 / 2,928 ≈ 99.8%**. On the **smallest-face quartile** it is
  **99.5%** (730/734).
- The genuine residual is therefore **5 faces**: 4 in Q1 (smallest), 1 in Q3.

At ~99.8% effective recall and 99.5% on the smallest faces, **tiling (PR 4b) is
not justified as a default.** The prior local `det_size` measurement (PR #192: 7
full frames, 640 vs 1280) was recall-neutral (±1 face) at 1.2–1.75× wall-time;
the full ground-truth here confirms there is almost nothing left for a
higher-resolution or tiled pass to find. Raising the default `det_size` or
enabling tiling would cost 1.2–1.75×+ for, at most, a handful of the five
residual faces — with no measured net gain.

**What would actually close the residual gap:** (a) the five true misses are the
very smallest faces — a targeted higher-`det_size`/tiled pass *could* recover a
few, but only as an opt-in config rung, never a default; (b) the `no_bbox` /
manual faces are closed only by **data hygiene** (re-enrolling that jpg event
with stored boxes), not by any detector change. `det_size` remains a supported
config knob and the detection-cache key already carries a strategy token
(`d{W}x{H}+t{0|1}`) so a future tiling experiment cannot serve stale detections.

---

## Verified supply chain

Model weights are **never committed** (gitignored under `_data/models/`); only
`backend/benchmarks/models/models_manifest.json` — source, sha256, license, dim,
preprocessing — is under version control. For Hugging Face LFS blobs the sha256
*is* the git-LFS oid, so the manifest hash doubles as a download-integrity check.

| Model | Source | sha256 (weights) | License | Opset |
|---|---|---|---|---|
| `buffalo_l` | InsightFace model zoo (`w600k_r50`) | shipped via `insightface==1.0.1` | MIT | — |
| `adaface_ir101` | exported locally from MIT checkpoint `marcelo-victor/adaface_ir101_webface12m` | `cd84ca15…9ab4a5` (ONNX); checkpoint `0e7a3238…493fd0` | MIT | 17 |
| `lvface_base` | HF `bytedance-research/LVFace` (`LVFace-B_Glint360K.onnx`) | `9d834ed8…d38d1382` | MIT | — |
| `yolov8n-face` | `akanametov/yolo-face` 1.0.0 release | `06b941fd…fd555928` | **AGPL-3.0** | — |

LVFace also has Small/Large/Tiny variants recorded in the manifest with their
own sha256s. **AGPL-3.0 note:** `yolov8n-face` is acceptable for this **local,
non-shipped** benchmark tooling only — the weights are never bundled into the
distributed app and must not be redistributed inside a proprietary product.
AdaFace has no official ONNX; it is exported once, offline, from the PyTorch
checkpoint under a torch-vs-ONNX parity gate (cosine > 0.999).

---

## Reproduction

From `backend/` (so `benchmarks` is importable), pointing at the restored
staging set:

```bash
cd backend

# Full metrics report over all three heads (report.md + report.csv + plots/):
python -m benchmarks.run ~/.local/share/faceid/benchmark_staging \
    --models buffalo_l,lvface_base,adaface_ir101

# Detector comparison (SCRFD vs YOLO):
python -m benchmarks.detect_compare ~/.local/share/faceid/benchmark_staging \
    --detectors buffalo_l yolov8n-face

# Acquire challenger weights (checksum-verified against the manifest):
python -m benchmarks.models.download lvface_base
python -m benchmarks.models.export_adaface        # networked, scratch venv
python -m benchmarks.models.download yolov8n-face

# Preprocessing parity gates (must print cosine > 0.999):
python -m benchmarks.models.verify_lvface_parity --variant lvface_base

# InsightFace 0.7.3 → 1.0.1 embedding-stability gate:
python -m benchmarks.upgrade_compare
```

The app-level threshold sweep in [§3](#3-thresholds--raise-match_threshold-040--045)
is derived directly from `_data/emb/buffalo_l/*.npy` (per-face embeddings) joined
to `report.csv` (identity + twin labels): per face, nearest *other* encoding →
rank-1 person and distance → threshold gating. `report.csv` itself carries only
boolean rank-1 flags, not per-probe distances, so the sweep is computed from the
cached embeddings, not from the CSV alone.

---

## Limitations

- **Survivorship bias.** The evaluation set is the owner's *confirmed* faces —
  faces that were successfully detected and enrolled. Faces the detector missed
  *and* that were never manually added are absent by construction. Recognition
  numbers are therefore optimistic for the full population of faces in the
  photos; they measure "of faces good enough to enroll, how well are they
  recognized", which is the operationally relevant question but not an unbiased
  face-in-the-wild estimate.
- **Synthetic open-set split.** Open-set DIR@FAR uses identities with <2 images
  as the "unknown/reject" set — a proxy, not held-out true strangers. Treat the
  open-set and any 0.50 threshold decision as directional.
- **89 unrecoverable files.** Those source images failed byte-verification and
  are excluded; their enrollments could not be re-embedded for a model
  migration either.
- **Twins are one pair.** All twin conclusions rest on the single Björneholt
  pair (108 probes). Every model confuses them 100% (108/108) — no head solves
  twins, which is exactly why the twin guard is not optional.
- **Detector held constant for recognition.** Recognition comparisons share one
  SCRFD `det_size=640` pass; the detector comparison (B6) ran on a smaller
  staging subset. `det_size` was not varied within the recognition benchmark.
- **Timings are informational.** Wall-clock is single-machine CPU/ONNX; no
  CoreML/GPU path was measured.

---

## Standing recommendations & follow-ups

**Act on now (this report's decisions):**

- **Keep InsightFace; stay on buffalo_l.** No library or model change.
- **Raise `match_threshold` to 0.45** and codify the 0.40–0.50 band (own PR;
  small config + docs change with the app-level rationale above).
- **Keep SCRFD @ `det_size=640`.** Do not enable tiling by default; do not raise
  the default `det_size`.

**Keep in place:**

- **Twin guard stays.** No model solves the twin pair (100% confusion across
  all three); the `distinct_pairs` guard + hard-negative mechanism remains
  essential and threshold-independent.

**Optional future work (carried forward, not blocking):**

- **FIQA enrollment-gating (optional PR).** Gate enrollment on face-image
  quality so low-quality crops never enter the gallery — a cleaner lever than
  chasing the last recognition points.
- **CoreML / GPU timing measurement (optional PR).** Current timings are
  CPU-only and informational; measure the accelerated path before any
  performance claims.
- **Larger YOLO detector A/B (B6+).** Only if detection ever becomes the
  bottleneck — it is not at ~99.8% effective recall.
- **Open-set false-accept sweep at the operating distance** — cheap follow-up if
  0.50 (rather than 0.45) is desired.
- **Staging cleanup after sign-off.** The ~91 GB `benchmark_staging/` restore can
  be removed once this report is accepted; the run is reproducible from backup.

---

## Related docs

- [Architecture](architecture.md) · [Database](database.md) ·
  [API Reference](api-reference.md)
- Benchmark tooling: `backend/benchmarks/README.md`
- Forward-looking backlog: [ROADMAP.md](../../ROADMAP.md) (benchmark track
  B1–B6, det_size / tiling items)
