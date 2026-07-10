"""Assemble the per-face evaluation dataset from DB records + local images.

For every source image the DB references that is currently resolvable on disk
(via B1's ``source_index``), run the detector once (cached), then IoU-match its
detections against the DB's stored bounding boxes to attach identity labels and
5-point landmarks. Each DB face lands in one of three buckets:

* ``matched`` — a detection overlaps the stored bbox (IoU >= threshold); this
  face is usable for re-encoding (kps attached).
* ``detector_missed`` — the source image is present but the detector produced no
  box overlapping the stored bbox (a detector-recall signal).
* ``unresolved`` — the source image is not locally present, so nothing can be
  recomputed for it.

The assembled manifest is written to ``_data/dataset.jsonl`` (one JSON object
per DB face). Image decoding / detection require insightface + a real image, so
the pure matching logic (``iou``, ``match_detections``) is factored out and unit
tested without them.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from . import cache
from . import config as cfg
from .db_access import DEFAULT_DB_PATH, FaceRecord, load_db_records
from .resolver import SourceIndex, sha1_file  # noqa: F401  (sha1_file handy for callers)

IOU_THRESHOLD = 0.5

MATCHED = "matched"
DETECTOR_MISSED = "detector_missed"
UNRESOLVED = "unresolved"


def iou(box_a, box_b) -> float:
    """Intersection-over-union of two xyxy boxes."""
    ax1, ay1, ax2, ay2 = (float(v) for v in box_a)
    bx1, by1, bx2, by2 = (float(v) for v in box_b)
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0.0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def best_match(db_bbox_xyxy, det_bboxes, threshold: float = IOU_THRESHOLD):
    """Return ``(index, iou)`` of the best-overlapping detection, or ``(None, best)``.

    ``det_bboxes`` is an ``(n, 4)`` array. Returns the index only when the best
    IoU meets ``threshold``.
    """
    best_i, best_iou = None, 0.0
    for i, det in enumerate(det_bboxes):
        score = iou(db_bbox_xyxy, det)
        if score > best_iou:
            best_i, best_iou = i, score
    if best_i is not None and best_iou >= threshold:
        return best_i, best_iou
    return None, best_iou


@dataclass
class DatasetFace:
    """One DB face's row in the assembled manifest."""

    identity: str
    image_hash: str
    bucket: str
    face_id: str
    db_bbox_xyxy: list | None
    det_bbox_xyxy: list | None
    kps: list | None
    score: float | None
    iou: float | None
    path: str | None
    is_manual: bool
    has_encoding: bool


def load_bgr(path: str | Path) -> np.ndarray:
    """Load an image as BGR uint8, decoding RAW via rawpy when needed."""
    import cv2

    p = Path(path)
    if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff"}:
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img is not None:
            return img
    # RAW or cv2 miss: decode via rawpy -> RGB -> BGR.
    import rawpy

    with rawpy.imread(str(p)) as raw:
        rgb = raw.postprocess()
    return rgb[:, :, ::-1].copy()


def build_dataset(
    records: list[FaceRecord],
    index: SourceIndex,
    detector,
    *,
    iou_threshold: float = IOU_THRESHOLD,
    force: bool = False,
) -> list[DatasetFace]:
    """Assemble per-face dataset rows, running + caching detection per image.

    ``detector`` must expose ``.name`` and ``.detect(img_bgr)`` (the ``Detector``
    protocol). Images are decoded and detected only for resolvable, non-manual,
    box-bearing faces; results are cached so reruns are cheap.
    """
    h2p = index.hash_to_paths()
    # Group DB faces by source-image hash.
    by_hash: dict[str, list[FaceRecord]] = {}
    for r in records:
        by_hash.setdefault(r.sha1, []).append(r)

    rows: list[DatasetFace] = []
    for sha1, recs in by_hash.items():
        paths = h2p.get(sha1, [])
        def db_id_for(r):
            return r.encoding_hash or cache.deterministic_face_id(
                sha1, r.bbox_xyxy or (0, 0, 0, 0)
            )

        if not paths:
            for r in recs:
                rows.append(
                    DatasetFace(
                        identity=r.identity,
                        image_hash=sha1,
                        bucket=UNRESOLVED,
                        face_id=db_id_for(r),
                        db_bbox_xyxy=list(r.bbox_xyxy) if r.bbox_xyxy else None,
                        det_bbox_xyxy=None,
                        kps=None,
                        score=None,
                        iou=None,
                        path=None,
                        is_manual=r.is_manual,
                        has_encoding=r.encoding is not None,
                    )
                )
            continue

        path = paths[0]
        # Decode the image lazily: when this (image, detector) pair is already
        # cached, skip the (expensive, RAW-heavy) image decode entirely.
        det = None if force else cache.load_detections(sha1, detector.name)
        if det is None:
            img = load_bgr(path)
            det = cache.get_or_compute_detections(sha1, detector, img, force=force)

        for r in recs:
            db_box = r.bbox_xyxy
            if db_box is None:
                rows.append(
                    DatasetFace(
                        identity=r.identity, image_hash=sha1, bucket=DETECTOR_MISSED,
                        face_id=db_id_for(r), db_bbox_xyxy=None, det_bbox_xyxy=None,
                        kps=None, score=None, iou=None, path=path,
                        is_manual=r.is_manual, has_encoding=r.encoding is not None,
                    )
                )
                continue
            idx, score = best_match(db_box, det.bboxes, iou_threshold)
            if idx is None:
                rows.append(
                    DatasetFace(
                        identity=r.identity, image_hash=sha1, bucket=DETECTOR_MISSED,
                        face_id=db_id_for(r), db_bbox_xyxy=list(db_box),
                        det_bbox_xyxy=None, kps=None, score=None, iou=round(score, 4),
                        path=path, is_manual=r.is_manual,
                        has_encoding=r.encoding is not None,
                    )
                )
            else:
                rows.append(
                    DatasetFace(
                        identity=r.identity, image_hash=sha1, bucket=MATCHED,
                        face_id=db_id_for(r), db_bbox_xyxy=list(db_box),
                        det_bbox_xyxy=[float(v) for v in det.bboxes[idx]],
                        kps=det.kps[idx].tolist(),
                        score=float(det.scores[idx]), iou=round(score, 4),
                        path=path, is_manual=r.is_manual,
                        has_encoding=r.encoding is not None,
                    )
                )
    return rows


def write_manifest(rows: list[DatasetFace], path: Path | None = None) -> Path:
    """Persist the dataset manifest to ``_data/dataset.jsonl``."""
    path = Path(path) if path else cfg.DATA_DIR / "dataset.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for row in rows:
            f.write(json.dumps(asdict(row)) + "\n")
    return path


def bucket_counts(rows: list[DatasetFace]) -> dict[str, int]:
    counts = {MATCHED: 0, DETECTOR_MISSED: 0, UNRESOLVED: 0}
    for r in rows:
        counts[r.bucket] = counts.get(r.bucket, 0) + 1
    return counts


def main(argv=None) -> int:
    import argparse
    import sys

    from .models.buffalo import DEFAULT_DET_SIZE, BuffaloDetector
    from .resolve import build_index

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("roots", nargs="*", help="Photo roots to scan (override config).")
    ap.add_argument("--config", default=None, help="Path to a roots.json config.")
    ap.add_argument("--cache", default=str(cfg.CACHE_PATH), help="Index cache path.")
    ap.add_argument("--db", default=str(DEFAULT_DB_PATH), help="encodings.pkl path.")
    ap.add_argument("--det-size", type=int, default=DEFAULT_DET_SIZE[0], help="SCRFD det_size (square).")
    ap.add_argument("--force", action="store_true", help="Recompute cached detections.")
    args = ap.parse_args(argv)

    cfg.ensure_data_dir()
    roots = cfg.resolve_roots(args.roots or None, args.config)
    if not roots:
        print("No photo roots found to scan.", file=sys.stderr)
        return 2

    index = build_index(roots, args.cache)
    records = load_db_records(args.db)
    detector = BuffaloDetector(det_size=args.det_size)

    rows = build_dataset(records, index, detector, force=args.force)
    manifest = write_manifest(rows)
    counts = bucket_counts(rows)
    print(f"Dataset: {len(rows)} faces -> {manifest}")
    for bucket, n in counts.items():
        print(f"  {bucket:16s} {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
