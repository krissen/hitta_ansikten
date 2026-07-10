#!/usr/bin/env python3
"""Measure the real detect+recognize pipeline on CPU vs CoreML (macOS).

Closes the audit's "CoreML requested but unmeasured" finding
(``docs/dev/face-recognition-audit-2026-07.md``). **Measurement only — this
never changes the app's provider selection.**

Why this exists
---------------
On macOS ``face_backends.InsightFaceBackend`` *requests*
``['CoreMLExecutionProvider', 'CPUExecutionProvider']``, but insightface's own
``model.prepare(ctx_id=-1, ...)`` unconditionally calls
``session.set_providers(['CPUExecutionProvider'])`` for every model when
``ctx_id < 0`` (see ``insightface/model_zoo/scrfd.py`` and ``arcface_onnx.py``).
So the shipped app **always runs on CPU** on macOS regardless of the requested
list; CoreML is never bound. This script:

1. reports the providers **actually bound** in each mode (ground truth), and
2. quantifies what enabling CoreML would buy (speed) and cost (embedding drift).

The two modes:

* **cpu**    — providers ``['CPUExecutionProvider']``. Identical to the app's
  current effective behaviour after insightface's ``ctx_id=-1`` reset.
* **coreml** — providers ``['CoreMLExecutionProvider', 'CPUExecutionProvider']``,
  re-applied to each session *after* ``prepare`` to undo insightface's forced CPU
  reset. This is the only way to exercise CoreML through the real pipeline
  without patching the app.

What it measures
----------------
* **Per-stage wall time**: decode (RAW→BGR, provider-independent, measured once
  and shared), detect (SCRFD), embed (w600k_r50), with warm-up excluded.
* **Embedding drift (the accuracy gate)**: for the *same* CPU-aligned 112×112
  crops, cosine similarity between the CPU embedding and the CoreML embedding,
  per face. Silent FP16 conversion in the CoreML EP is a documented drift risk;
  if ``min`` cosine drops meaningfully below 1.0 the recommendation is CPU/FP32
  regardless of speed.
* **Bbox parity**: detections from each mode IoU-matched, mean/min IoU and
  matched count — surfaces detection-level drift.

Image selection is deterministic: all ``*.NEF`` under the staging root are
sorted by path, then a seeded ``random.Random(seed).sample`` picks ``N`` (the
sample is re-sorted for stable reporting). Seed and N are recorded in the
report header so the exact set is reproducible.

Usage
-----
    cd backend
    python -m benchmarks.bench_providers \\
        ~/.local/share/faceid/benchmark_staging --num 24 --seed 1337

    # JSON alongside the human report:
    python -m benchmarks.bench_providers <root> --json /tmp/bench_providers.json

The staging DB / photo set is treated strictly read-only.
"""

from __future__ import annotations

import argparse
import json
import platform
import random
import sys
import time
from pathlib import Path

import numpy as np

# Make backend/ importable so `benchmarks.*` resolves when run as a script.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from benchmarks.models.align import align_112  # noqa: E402
from benchmarks.models.buffalo import BuffaloDetector, BuffaloRecognition  # noqa: E402

CPU_PROVIDERS = ["CPUExecutionProvider"]
COREML_PROVIDERS = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
RAW_SUFFIXES = {".nef", ".cr2", ".cr3", ".arw", ".dng", ".raf", ".rw2", ".orf"}


def _load_bgr(path: Path) -> np.ndarray:
    """Decode an image to a BGR uint8 array (RAW via rawpy, else PIL)."""
    suffix = path.suffix.lower()
    if suffix in RAW_SUFFIXES:
        import rawpy

        with rawpy.imread(str(path)) as raw:
            rgb = raw.postprocess()
    else:
        from PIL import Image

        rgb = np.array(Image.open(path).convert("RGB"))
    # insightface expects BGR
    return np.ascontiguousarray(rgb[:, :, ::-1])


def select_images(root: Path, num: int, seed: int) -> list[Path]:
    """Deterministically pick ``num`` NEF paths from ``root`` (documented in header)."""
    all_nef = sorted(p for p in root.rglob("*") if p.suffix.lower() == ".nef")
    if not all_nef:
        return []
    rng = random.Random(seed)
    picked = rng.sample(all_nef, min(num, len(all_nef)))
    return sorted(picked)


class Pipeline:
    """A detector + recognition head with providers pinned to a given mode.

    Both sessions are re-pinned *after* ``prepare`` so that CoreML survives
    insightface's ``ctx_id=-1`` CPU reset. ``actual`` records what onnxruntime
    really bound (the ground truth the app's new logging also emits).
    """

    def __init__(self, providers: list[str], det_size=(640, 640)) -> None:
        self.det = BuffaloDetector(det_size=det_size, ctx_id=-1)
        app = self.det._ensure_app()
        for model in app.models.values():
            model.session.set_providers(list(providers))

        self.rec = BuffaloRecognition(ctx_id=-1)
        rec_model = self.rec._ensure_model()
        rec_model.session.set_providers(list(providers))

        self.actual = {
            "detection": list(app.models["detection"].session.get_providers()),
            "recognition": list(rec_model.session.get_providers()),
        }


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _match_bboxes(faces_a, faces_b, iou_thresh: float = 0.5) -> list[float]:
    """Greedy IoU match; return the IoU of every matched pair."""
    used_b: set[int] = set()
    ious: list[float] = []
    for fa in faces_a:
        best_iou, best_j = 0.0, -1
        for j, fb in enumerate(faces_b):
            if j in used_b:
                continue
            v = _iou(np.asarray(fa.bbox), np.asarray(fb.bbox))
            if v > best_iou:
                best_iou, best_j = v, j
        if best_j >= 0 and best_iou >= iou_thresh:
            used_b.add(best_j)
            ious.append(best_iou)
    return ious


def run(root: Path, num: int, seed: int) -> dict:
    images = select_images(root, num, seed)
    if not images:
        raise SystemExit(f"No .NEF images found under {root}")

    coreml_available = "CoreMLExecutionProvider" in _available_providers()

    print(f"Building CPU pipeline ...", file=sys.stderr)
    cpu = Pipeline(CPU_PROVIDERS)
    print(f"Building CoreML pipeline ...", file=sys.stderr)
    coreml = Pipeline(COREML_PROVIDERS)

    # --- warm-up (excluded from timing): first CoreML run compiles the model ---
    warm_bgr = _load_bgr(images[0])
    for pipe in (cpu, coreml):
        faces = pipe.det.detect(warm_bgr)
        for f in faces[:3]:
            pipe.rec.embed(align_112(warm_bgr, f.kps))

    # --- accumulators ---
    stage = {
        "decode": [],
        "detect_cpu": [],
        "detect_coreml": [],
        "embed_cpu": [],  # per-face
        "embed_coreml": [],  # per-face
    }
    drift_cos: list[float] = []
    bbox_ious: list[float] = []
    per_image: list[dict] = []
    n_faces_total = 0

    for img_path in images:
        t0 = time.perf_counter()
        bgr = _load_bgr(img_path)
        t_decode = time.perf_counter() - t0

        # CPU detect (canonical faces + crops)
        t0 = time.perf_counter()
        faces_cpu = cpu.det.detect(bgr)
        t_det_cpu = time.perf_counter() - t0

        # CoreML detect
        t0 = time.perf_counter()
        faces_coreml = coreml.det.detect(bgr)
        t_det_coreml = time.perf_counter() - t0

        crops = [align_112(bgr, f.kps) for f in faces_cpu]

        img_embed_cpu = 0.0
        img_embed_coreml = 0.0
        for crop in crops:
            t0 = time.perf_counter()
            e_cpu = cpu.rec.embed(crop)
            dt = time.perf_counter() - t0
            stage["embed_cpu"].append(dt)
            img_embed_cpu += dt

            t0 = time.perf_counter()
            e_coreml = coreml.rec.embed(crop)
            dt = time.perf_counter() - t0
            stage["embed_coreml"].append(dt)
            img_embed_coreml += dt

            # Both L2-normalized -> dot product is cosine similarity.
            drift_cos.append(float(np.dot(e_cpu, e_coreml)))

        bbox_ious.extend(_match_bboxes(faces_cpu, faces_coreml))

        stage["decode"].append(t_decode)
        stage["detect_cpu"].append(t_det_cpu)
        stage["detect_coreml"].append(t_det_coreml)
        n_faces_total += len(crops)

        per_image.append(
            {
                "image": img_path.name,
                "faces_cpu": len(faces_cpu),
                "faces_coreml": len(faces_coreml),
                "decode_s": round(t_decode, 4),
                "detect_cpu_s": round(t_det_cpu, 4),
                "detect_coreml_s": round(t_det_coreml, 4),
                "embed_cpu_s": round(img_embed_cpu, 4),
                "embed_coreml_s": round(img_embed_coreml, 4),
            }
        )
        print(
            f"[{img_path.name}] faces cpu={len(faces_cpu)} coreml={len(faces_coreml)} "
            f"det cpu={t_det_cpu:.3f}s coreml={t_det_coreml:.3f}s",
            file=sys.stderr,
        )

    def _sum(key: str) -> float:
        return float(np.sum(stage[key])) if stage[key] else 0.0

    drift = np.array(drift_cos) if drift_cos else np.array([float("nan")])
    ious = np.array(bbox_ious) if bbox_ious else np.array([float("nan")])

    result = {
        "host": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "coreml_available": coreml_available,
        },
        "config": {
            "root": str(root),
            "num_requested": num,
            "num_images": len(images),
            "seed": seed,
            "det_size": [640, 640],
            "n_faces": n_faces_total,
        },
        "actual_providers": {"cpu": cpu.actual, "coreml": coreml.actual},
        "timing_totals_s": {
            "decode": round(_sum("decode"), 3),
            "detect_cpu": round(_sum("detect_cpu"), 3),
            "detect_coreml": round(_sum("detect_coreml"), 3),
            "embed_cpu": round(_sum("embed_cpu"), 3),
            "embed_coreml": round(_sum("embed_coreml"), 3),
        },
        "timing_per_face_ms": {
            "embed_cpu": round(1000 * float(np.mean(stage["embed_cpu"])), 3) if stage["embed_cpu"] else None,
            "embed_coreml": round(1000 * float(np.mean(stage["embed_coreml"])), 3) if stage["embed_coreml"] else None,
        },
        "timing_per_image_ms": {
            "detect_cpu": round(1000 * float(np.mean(stage["detect_cpu"])), 3) if stage["detect_cpu"] else None,
            "detect_coreml": round(1000 * float(np.mean(stage["detect_coreml"])), 3) if stage["detect_coreml"] else None,
        },
        "speedup_coreml_over_cpu": {
            "detect": round(_sum("detect_cpu") / _sum("detect_coreml"), 3) if _sum("detect_coreml") else None,
            "embed": round(_sum("embed_cpu") / _sum("embed_coreml"), 3) if _sum("embed_coreml") else None,
        },
        "embedding_drift_cosine": {
            "n": int(drift.size),
            "min": round(float(np.min(drift)), 6),
            "mean": round(float(np.mean(drift)), 6),
            "median": round(float(np.median(drift)), 6),
        },
        "bbox_parity_iou": {
            "n_matched": int(ious.size),
            "min": round(float(np.min(ious)), 4),
            "mean": round(float(np.mean(ious)), 4),
        },
        "per_image": per_image,
    }
    return result


def _available_providers() -> list[str]:
    import onnxruntime

    return list(onnxruntime.get_available_providers())


def print_report(r: dict) -> None:
    c = r["config"]
    print("\n" + "=" * 70)
    print("CoreML vs CPU pipeline benchmark")
    print("=" * 70)
    print(f"host        : {r['host']['platform']} ({r['host']['machine']})")
    print(f"coreml avail: {r['host']['coreml_available']}")
    print(f"root        : {c['root']}")
    print(f"images      : {c['num_images']} NEF (seed={c['seed']}, requested={c['num_requested']}), "
          f"{c['n_faces']} faces, det_size={tuple(c['det_size'])}")
    print()
    print("Actual bound providers:")
    print(f"  cpu    : det={r['actual_providers']['cpu']['detection']}  "
          f"rec={r['actual_providers']['cpu']['recognition']}")
    print(f"  coreml : det={r['actual_providers']['coreml']['detection']}  "
          f"rec={r['actual_providers']['coreml']['recognition']}")
    print()
    t = r["timing_totals_s"]
    print("Wall-time totals (s), warm-up excluded:")
    print(f"  decode (shared)     : {t['decode']:.3f}")
    print(f"  detect  cpu / coreml: {t['detect_cpu']:.3f} / {t['detect_coreml']:.3f}")
    print(f"  embed   cpu / coreml: {t['embed_cpu']:.3f} / {t['embed_coreml']:.3f}")
    sp = r["speedup_coreml_over_cpu"]
    print(f"  speedup (cpu/coreml): detect x{sp['detect']}   embed x{sp['embed']}")
    print()
    d = r["embedding_drift_cosine"]
    print(f"Embedding drift CoreML vs CPU (same crops), cosine over {d['n']} faces:")
    print(f"  min={d['min']:.6f}  mean={d['mean']:.6f}  median={d['median']:.6f}")
    b = r["bbox_parity_iou"]
    print(f"Bbox parity IoU ({b['n_matched']} matched): min={b['min']:.4f}  mean={b['mean']:.4f}")
    print("=" * 70)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "root",
        nargs="?",
        default=str(Path("~/.local/share/faceid/benchmark_staging").expanduser()),
        help="Staging root to scan for .NEF (read-only)",
    )
    p.add_argument("--num", type=int, default=24, help="Number of images to sample (default 24)")
    p.add_argument("--seed", type=int, default=1337, help="RNG seed for deterministic selection")
    p.add_argument("--json", dest="json_out", default=None, help="Also write full result JSON here")
    args = p.parse_args(argv)

    root = Path(args.root).expanduser()
    result = run(root, args.num, args.seed)
    print_report(result)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(result, indent=2))
        print(f"\nWrote JSON -> {args.json_out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
