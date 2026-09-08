#!/usr/bin/env python3
"""Embedding-stability gate for InsightFace version upgrades.

Detection and embeddings are the load-bearing part of the whole app: the
known-faces database (``encodings.pkl``) stores L2-normalized 512-dim vectors
produced by a specific InsightFace release. If a new release ships a different
model revision or changed preprocessing, the *same* aligned crop drifts to a
new embedding and the existing database silently degrades.

This script quantifies that risk. It runs in two modes:

    extract   Detect faces in test images with the InsightFace installed in the
              current interpreter and dump ``{bbox, embedding}`` per face to an
              ``.npz`` file. Run once per version (each in its own venv).

    compare   Load two extract dumps, match faces across them by bounding-box
              IoU, and report cosine similarity between the matched embeddings
              plus bbox drift. This is the gate: same crop must produce
              cosine-sim > 0.999 between the old and new release.

Both versions read identical RGB arrays (RAW is decoded once, deterministically,
via ``rawpy.postprocess()``), so the only variable between the two dumps is the
InsightFace release itself.

Usage
-----
    # In the OLD venv (e.g. insightface 0.7.3):
    python -m benchmarks.upgrade_compare extract --out /tmp/old.npz IMG...

    # In the NEW venv (e.g. insightface 1.0.1):
    python -m benchmarks.upgrade_compare extract --out /tmp/new.npz IMG...

    # In either venv:
    python -m benchmarks.upgrade_compare compare /tmp/old.npz /tmp/new.npz
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

# Make the repo backend/ importable so we exercise the *real* InsightFaceBackend
# call signatures (FaceAnalysis(...).prepare(ctx_id=-1, det_size=(640, 640))).
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


def _load_rgb(path: Path) -> np.ndarray:
    """Decode an image to an RGB uint8 array (RAW via rawpy, else PIL)."""
    suffix = path.suffix.lower()
    if suffix in {".nef", ".cr2", ".cr3", ".arw", ".dng", ".raf", ".rw2", ".orf"}:
        import rawpy

        with rawpy.imread(str(path)) as raw:
            return raw.postprocess()
    from PIL import Image

    return np.array(Image.open(path).convert("RGB"))


def _dlib_loc_to_xyxy(loc: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """dlib (top, right, bottom, left) -> (x1, y1, x2, y2)."""
    top, right, bottom, left = loc
    return left, top, right, bottom


def cmd_extract(args: argparse.Namespace) -> int:
    import insightface

    from face_backends import InsightFaceBackend

    det_size = (args.det_size, args.det_size)
    backend = InsightFaceBackend(model_name=args.model, ctx_id=args.ctx_id, det_size=det_size)

    records: list[dict] = []
    images = [Path(p) for p in args.images]
    for img_path in images:
        if not img_path.exists():
            print(f"[skip] missing: {img_path}", file=sys.stderr)
            continue
        rgb = _load_rgb(img_path)
        locations, encodings = backend.detect_faces(rgb, model="", upsample=0)
        for loc, enc in zip(locations, encodings):
            x1, y1, x2, y2 = _dlib_loc_to_xyxy(loc)
            records.append(
                {
                    "image": img_path.name,
                    "bbox": np.array([x1, y1, x2, y2], dtype=np.float64),
                    "embedding": np.asarray(enc, dtype=np.float64),
                }
            )
        print(f"[{img_path.name}] {len(locations)} face(s)", file=sys.stderr)

    if not records:
        print("No faces detected in any input image.", file=sys.stderr)
        return 1

    np.savez_compressed(
        args.out,
        version=insightface.__version__,
        det_size=np.array(det_size),
        images=np.array([r["image"] for r in records]),
        bboxes=np.stack([r["bbox"] for r in records]),
        embeddings=np.stack([r["embedding"] for r in records]),
    )
    print(
        f"Wrote {len(records)} face(s) from {len(images)} image(s) "
        f"(insightface {insightface.__version__}) -> {args.out}",
        file=sys.stderr,
    )
    return 0


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


def cmd_compare(args: argparse.Namespace) -> int:
    old = np.load(args.old, allow_pickle=True)
    new = np.load(args.new, allow_pickle=True)

    ver_old = str(old["version"])
    ver_new = str(new["version"])
    print(f"OLD: insightface {ver_old}  ({old['embeddings'].shape[0]} faces)")
    print(f"NEW: insightface {ver_new}  ({new['embeddings'].shape[0]} faces)")
    print()

    old_by_img: dict[str, list[int]] = {}
    for i, name in enumerate(old["images"]):
        old_by_img.setdefault(str(name), []).append(i)

    matched: list[tuple[float, float, str]] = []  # (cosine, iou, image)
    unmatched_new = 0
    total_new = new["embeddings"].shape[0]

    used_old: set[int] = set()
    for j in range(total_new):
        name = str(new["images"][j])
        nb = new["bboxes"][j]
        candidates = [i for i in old_by_img.get(name, []) if i not in used_old]
        if not candidates:
            unmatched_new += 1
            continue
        ious = [(_iou(old["bboxes"][i], nb), i) for i in candidates]
        best_iou, best_i = max(ious, key=lambda t: t[0])
        if best_iou < args.iou_thresh:
            unmatched_new += 1
            continue
        used_old.add(best_i)
        # Both embeddings are L2-normalized -> dot product is cosine similarity.
        e_old = old["embeddings"][best_i]
        e_new = new["embeddings"][j]
        cos = float(np.dot(e_old, e_new) / (np.linalg.norm(e_old) * np.linalg.norm(e_new)))
        matched.append((cos, best_iou, name))

    unmatched_old = old["embeddings"].shape[0] - len(used_old)

    if not matched:
        print("GATE: NO-GO — no faces could be matched across versions.")
        return 2

    cosines = np.array([m[0] for m in matched])
    ious = np.array([m[1] for m in matched])

    print(f"Matched faces (IoU >= {args.iou_thresh}): {len(matched)}")
    print(f"Unmatched OLD faces: {unmatched_old}   Unmatched NEW faces: {unmatched_new}")
    print()
    print("Cosine similarity (old vs new embedding, same crop):")
    print(f"  min    = {cosines.min():.6f}")
    print(f"  mean   = {cosines.mean():.6f}")
    print(f"  median = {np.median(cosines):.6f}")
    print(f"  max    = {cosines.max():.6f}")
    print()
    print("Bounding-box IoU (detection parity):")
    print(f"  min  = {ious.min():.4f}")
    print(f"  mean = {ious.mean():.4f}")
    print()
    print("Per-face detail:")
    for cos, iou, name in sorted(matched):
        print(f"  cos={cos:.6f}  iou={iou:.4f}  {name}")
    print()

    gate_pass = cosines.min() > args.gate and unmatched_new == 0 and unmatched_old == 0
    if gate_pass:
        print(f"GATE: PASS — all matched faces cosine > {args.gate} and detection parity is exact.")
        return 0
    if cosines.min() > args.gate:
        print(
            f"GATE: REVIEW — embeddings are stable (min cos {cosines.min():.6f} > {args.gate}) "
            f"but detection parity differs (unmatched old={unmatched_old}, new={unmatched_new})."
        )
        return 3
    print(
        f"GATE: NO-GO — embedding drift exceeds threshold "
        f"(min cosine {cosines.min():.6f} <= {args.gate}). Do not upgrade without re-enrollment."
    )
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ex = sub.add_parser("extract", help="Detect + embed faces with the current InsightFace")
    p_ex.add_argument("images", nargs="+", help="Image paths (NEF/RAW or standard formats)")
    p_ex.add_argument("--out", required=True, help="Output .npz path")
    p_ex.add_argument("--model", default="buffalo_l")
    p_ex.add_argument("--ctx-id", type=int, default=-1)
    p_ex.add_argument("--det-size", type=int, default=640)
    p_ex.set_defaults(func=cmd_extract)

    p_cmp = sub.add_parser("compare", help="Compare two extract dumps")
    p_cmp.add_argument("old", help="OLD-version .npz")
    p_cmp.add_argument("new", help="NEW-version .npz")
    p_cmp.add_argument(
        "--iou-thresh", type=float, default=0.5, help="Min IoU to call two boxes the same face"
    )
    p_cmp.add_argument(
        "--gate", type=float, default=0.999, help="Min per-face cosine to pass the gate"
    )
    p_cmp.set_defaults(func=cmd_compare)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
