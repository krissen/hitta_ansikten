"""Parity gate: our LVFace adapter vs the official reference pipeline.

A silent preprocessing mismatch (wrong channel order, mean/scale, or layout)
does not crash — it just yields worse embeddings, producing a false
"LVFace is worse than buffalo_l" conclusion downstream. This script is the gate
that rules that out: it embeds the **same** aligned crop two ways and reports
their cosine similarity, which must be ``> 0.999``.

* **Reference** — the preprocessing transcribed verbatim from
  github.com/bytedance/LVFace ``inference_onnx.py`` (MIT):
  ``cv2.resize -> BGR2RGB -> transpose CHW -> ((x/255)-0.5)/0.5 -> float32``,
  fed to the same ONNX session; the reference L2-normalizes only at
  similarity time, which we mirror here for a fair cosine.
* **Adapter** — ``LVFaceRecognition.embed`` on the identical crop.

Because both paths load the *same* ONNX weights, any cosine below 1.0 is a pure
preprocessing discrepancy. Run this once per variant after downloading weights::

    python -m benchmarks.models.verify_lvface_parity --variant lvface_base

It sources a real aligned crop from the benchmark dataset if available, else a
deterministic synthetic 112x112 crop (preprocessing parity is
content-independent, so a synthetic crop is a valid check).
"""

from __future__ import annotations

import argparse
import sys

import numpy as np

from .base import l2_normalize
from .download import KNOWN_MODELS, local_path
from .lvface import LVFaceRecognition


def reference_preprocess(aligned_bgr_112: np.ndarray) -> np.ndarray:
    """Verbatim port of LVFace ``inference_onnx.py`` ``_preprocess_image``.

    Kept deliberately close to the upstream code (including the redundant resize)
    so the parity check compares against the *actual* reference, not a
    paraphrase.
    """
    import cv2

    img = aligned_bgr_112
    img_resized = cv2.resize(img, (112, 112))
    img_rgb = cv2.cvtColor(img_resized, cv2.COLOR_BGR2RGB)
    img_transposed = np.transpose(img_rgb, (2, 0, 1))
    img_normalized = ((img_transposed / 255.0) - 0.5) / 0.5
    return img_normalized.astype(np.float32)[np.newaxis, ...]


def reference_embed(session, input_name, output_name, aligned_bgr_112) -> np.ndarray:
    tensor = reference_preprocess(aligned_bgr_112)
    out = session.run([output_name], {input_name: tensor})[0]
    return l2_normalize(np.asarray(out, dtype=np.float32).ravel())


def _synthetic_crop(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(112, 112, 3), dtype=np.uint8)


def _sample_real_crop() -> np.ndarray | None:
    """Align one real dataset face from ``_data/dataset.jsonl``; None if absent."""
    try:
        import json

        from .. import config as cfg
        from ..dataset import MATCHED, load_bgr
        from .align import align_112

        manifest = cfg.DATA_DIR / "dataset.jsonl"
        if not manifest.exists():
            return None
        with open(manifest) as f:
            for line in f:
                row = json.loads(line)
                if row.get("bucket") == MATCHED and row.get("kps") and row.get("path"):
                    kps = np.asarray(row["kps"], dtype=np.float32)
                    return align_112(load_bgr(row["path"]), kps)
        return None
    except Exception:
        return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--variant", default="lvface_base",
                    help="LVFace variant (default lvface_base).")
    ap.add_argument("--model-path", default=None,
                    help="Explicit ONNX path (overrides --variant).")
    ap.add_argument("--threshold", type=float, default=0.999)
    ap.add_argument("--n", type=int, default=3, help="Number of crops to check.")
    args = ap.parse_args(argv)

    import onnxruntime as ort

    if args.model_path:
        model_path = args.model_path
    else:
        if args.variant not in KNOWN_MODELS:
            print(f"Unknown variant {args.variant}", file=sys.stderr)
            return 2
        model_path = local_path(KNOWN_MODELS[args.variant])
        if not model_path.exists():
            print(f"Weights not found: {model_path}\nDownload with: "
                  f"python -m benchmarks.models.download {args.variant}", file=sys.stderr)
            return 2

    adapter = LVFaceRecognition(
        args.variant, model_path=args.model_path, auto_download=False
    )
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    in_name = session.get_inputs()[0].name
    out_name = session.get_outputs()[0].name

    real = _sample_real_crop()
    crops = []
    if real is not None:
        crops.append(real)
    while len(crops) < args.n:
        crops.append(_synthetic_crop(seed=len(crops)))

    worst = 1.0
    for i, crop in enumerate(crops):
        ours = adapter.embed(crop)
        ref = reference_embed(session, in_name, out_name, crop)
        cos = float(np.dot(ours, ref))
        worst = min(worst, cos)
        tag = "real" if (i == 0 and real is not None) else "synthetic"
        print(f"crop {i} ({tag}): cosine(adapter, reference) = {cos:.6f}")

    print(f"\nworst-case cosine = {worst:.6f}  (threshold {args.threshold})")
    if worst >= args.threshold:
        print("PARITY OK")
        return 0
    print("PARITY FAILED — preprocessing mismatch", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
