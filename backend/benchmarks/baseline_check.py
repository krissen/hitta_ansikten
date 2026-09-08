"""Regression check: recomputed buffalo_l embedding vs the stored DB vector.

The acceptance test for the model abstraction. For every DB-matched face on a
locally resolvable image, this:

1. aligns the face with the *re-detected* landmarks (canonical ``norm_crop``),
2. runs :class:`BuffaloRecognition` on the aligned crop (cached under
   ``_data/emb/``),
3. compares the L2-normalized result against the vector stored in
   ``encodings.pkl`` via cosine similarity.

A faithful re-encode gives cosine ~1.0 (median > 0.99). Because we re-detect the
face rather than reusing the exact landmarks the app used when it first encoded,
small landmark jitter can nudge some sims just below 1.0 — the printed
distribution + per-face failures make any such gap visible rather than hidden.

Run from ``backend/``::

    python -m benchmarks.baseline_check
"""

from __future__ import annotations

import argparse
import sys

import numpy as np

from . import cache
from . import config as cfg
from .dataset import MATCHED, build_dataset, load_bgr
from .db_access import DEFAULT_DB_PATH, load_db_records

PASS_THRESHOLD = 0.99


def _percentiles(values: list[float]) -> dict[str, float]:
    arr = np.asarray(values, dtype=np.float64)
    return {
        "n": int(arr.size),
        "min": float(arr.min()),
        "p1": float(np.percentile(arr, 1)),
        "p5": float(np.percentile(arr, 5)),
        "median": float(np.median(arr)),
        "mean": float(arr.mean()),
        "max": float(arr.max()),
    }


def run(records, index, detector, recognition, *, force=False):
    """Return ``(sims, failures)`` for matched faces with a stored encoding.

    ``sims`` is a list of ``(identity, image_hash, sim)``; ``failures`` is the
    subset with ``sim < PASS_THRESHOLD``.
    """
    from .models.align import align_112

    rows = [
        r
        for r in build_dataset(records, index, detector, force=force)
        if r.bucket == MATCHED and r.has_encoding and r.kps is not None
    ]
    stored_by_id = {
        r.encoding_hash: r.encoding
        for r in records
        if r.encoding_hash is not None and r.encoding is not None
    }

    sims: list[tuple[str, str, float]] = []
    # Group by image so each source file is decoded once.
    by_image: dict[str, list] = {}
    for row in rows:
        by_image.setdefault(row.path, []).append(row)

    for path, image_rows in by_image.items():
        img = load_bgr(path)
        for row in image_rows:
            stored = stored_by_id.get(row.face_id)
            if stored is None:
                continue
            kps = np.asarray(row.kps, dtype=np.float32)

            def _compute():
                aligned = align_112(img, kps)
                return recognition.embed(aligned)

            recomputed = cache.get_or_compute_emb(
                recognition.name, row.face_id, _compute, force=force
            )
            stored_vec = np.asarray(stored, dtype=np.float32).ravel()
            stored_vec = stored_vec / (np.linalg.norm(stored_vec) + 1e-10)
            sim = float(np.dot(recomputed.ravel(), stored_vec))
            sims.append((row.identity, row.image_hash, sim))

    failures = [s for s in sims if s[2] < PASS_THRESHOLD]
    return sims, failures


def main(argv=None) -> int:
    from .models.buffalo import DEFAULT_DET_SIZE, BuffaloDetector, BuffaloRecognition
    from .resolve import build_index

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("roots", nargs="*", help="Photo roots to scan (override config).")
    ap.add_argument("--config", default=None, help="Path to a roots.json config.")
    ap.add_argument("--cache", default=str(cfg.CACHE_PATH), help="Index cache path.")
    ap.add_argument("--db", default=str(DEFAULT_DB_PATH), help="encodings.pkl path.")
    ap.add_argument(
        "--det-size", type=int, default=DEFAULT_DET_SIZE[0], help="SCRFD det_size (square)."
    )
    ap.add_argument("--force", action="store_true", help="Ignore caches, recompute.")
    args = ap.parse_args(argv)

    cfg.ensure_data_dir()
    roots = cfg.resolve_roots(args.roots or None, args.config)
    if not roots:
        print("No photo roots found to scan.", file=sys.stderr)
        return 2

    index = build_index(roots, args.cache)
    records = load_db_records(args.db)
    detector = BuffaloDetector(det_size=args.det_size)
    recognition = BuffaloRecognition()

    sims, failures = run(records, index, detector, recognition, force=args.force)
    if not sims:
        print("No locally-resolvable DB-matched faces with encodings to check.")
        return 1

    stats = _percentiles([s[2] for s in sims])
    print("Cosine similarity: recomputed buffalo_l vs stored encodings.pkl")
    print(f"  faces checked: {stats['n']}")
    print(
        f"  min={stats['min']:.4f}  p1={stats['p1']:.4f}  p5={stats['p5']:.4f}  "
        f"median={stats['median']:.4f}  mean={stats['mean']:.4f}  max={stats['max']:.4f}"
    )
    print(f"  pass (>= {PASS_THRESHOLD}): {stats['n'] - len(failures)}/{stats['n']}")
    if failures:
        print(f"  {len(failures)} below {PASS_THRESHOLD}:")
        for identity, image_hash, sim in sorted(failures, key=lambda s: s[2]):
            print(f"    {sim:.4f}  {identity}  ({image_hash[:12]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
