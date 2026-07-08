"""Compare two (or more) face detectors against the DB ground truth.

Detection is the lever this evaluates: for each detector, run it over the same
resolved source images (cached), IoU-match its boxes to the DB's stored boxes,
and report

* **detection recall** = matched / (matched + detector_missed), overall and per
  stratum — the small-face bbox-area quartiles especially (where SCRFD is known
  to drop faces), plus manual-vs-detected;
* **new faces found** = detections that overlap *no* DB box (IoU < 0.5). These
  are potential extra recall the DB never captured; they cannot be auto-scored
  against ground truth, so they are only counted (with a confidence floor).

Only detection is exercised — no recognition/embedding — so this is fast and
isolates the detector. Detections are cached per (image, detector) under
``_data/detections/`` and reused by ``run.py``.

Usage (from ``backend/``)::

    python -m benchmarks.detect_compare                       # buffalo_l vs yolov8n-face
    python -m benchmarks.detect_compare ~/.local/share/faceid/benchmark_staging \\
        --detectors buffalo_l yolov8n-face
    python -m benchmarks.detect_compare --new-face-conf 0.5   # stricter "new face" floor

Note: because ``--detectors`` takes one-or-more values, put any positional
photo roots *before* it (or after another flag), else argparse folds the root
path into the detector list.

Cache caveat (mirrors the buffalo convention across the harness): the detection
cache is keyed by detector *name* only, not input size — rerun with ``--force``
after changing ``--det-size``, or the cache serves the previous size's boxes.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import cache
from . import config as cfg
from . import dataset as ds
from . import metrics as M
from .db_access import DEFAULT_DB_PATH, load_db_records
from .strata import bbox_quartile_label, quartile_thresholds


# ---------------------------------------------------------------------------
# detector registry (name -> zero-arg-ish factory). Kept separate from run.py's
# model factories: here we only need the detector half.
# ---------------------------------------------------------------------------
def _make_buffalo(det_size: int):
    from .models.buffalo import BuffaloDetector

    return BuffaloDetector(det_size=(det_size, det_size))


def _make_yolo(name: str):
    def factory(det_size: int):
        from .models.yoloface import YoloFaceDetector

        return YoloFaceDetector(model_name=name, input_size=det_size)

    return factory


DETECTOR_FACTORIES = {
    "buffalo_l": _make_buffalo,
    "yolov8n-face": _make_yolo("yolov8n-face"),
    "yolov8n-face-raw": _make_yolo("yolov8n-face-raw"),
}


def _bbox_area(bbox_xyxy) -> int | None:
    if not bbox_xyxy:
        return None
    x1, y1, x2, y2 = bbox_xyxy
    return int(abs((x2 - x1) * (y2 - y1)))


def count_new_faces(
    rows: list[ds.DatasetFace],
    detector,
    index,
    *,
    conf: float,
    iou_threshold: float = ds.IOU_THRESHOLD,
) -> tuple[int, int]:
    """Count detections that overlap no DB box (IoU < ``iou_threshold``).

    Returns ``(new_faces, images_scanned)``. Detections are read from the cache
    written during :func:`dataset.build_dataset`, so nothing is recomputed. A
    detection is "new" when its best IoU against *every* DB box in that image is
    below ``iou_threshold`` and its score is >= ``conf``.
    """
    h2p = index.hash_to_paths()
    db_boxes_by_hash: dict[str, list] = {}
    for r in rows:
        if r.db_bbox_xyxy:
            db_boxes_by_hash.setdefault(r.image_hash, []).append(r.db_bbox_xyxy)

    new_faces = 0
    images = 0
    for sha1, db_boxes in db_boxes_by_hash.items():
        if not h2p.get(sha1):
            continue  # unresolved image; nothing detected
        cached = cache.load_detections(sha1, detector.name)
        if cached is None:
            continue
        images += 1
        for i in range(len(cached)):
            if float(cached.scores[i]) < conf:
                continue
            det_box = cached.bboxes[i]
            best = max((ds.iou(db, det_box) for db in db_boxes), default=0.0)
            if best < iou_threshold:
                new_faces += 1
    return new_faces, images


def evaluate_detector(name, factory, records, index, *, det_size, force):
    """Build the dataset for one detector and return (rows, detector)."""
    detector = factory(det_size)
    rows = ds.build_dataset(records, index, detector, force=force)
    return rows, detector


def _fmt_recall(rec: dict) -> str:
    return (
        f"{rec['recall'] * 100:5.1f}%  "
        f"({rec['matched']}/{rec['matched'] + rec['detector_missed']})"
    )


def main(argv=None) -> int:
    from .resolve import build_index

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--detectors",
        nargs="+",
        default=["buffalo_l", "yolov8n-face"],
        help=f"Detectors to compare (available: {', '.join(DETECTOR_FACTORIES)}).",
    )
    ap.add_argument("roots", nargs="*", help="Photo roots to scan (override config).")
    ap.add_argument("--config", default=None, help="Path to a roots.json config.")
    ap.add_argument("--cache", default=str(cfg.CACHE_PATH), help="Index cache path.")
    ap.add_argument("--db", default=str(DEFAULT_DB_PATH), help="encodings.pkl path.")
    ap.add_argument("--det-size", type=int, default=640, help="Square detector input.")
    ap.add_argument("--new-face-conf", type=float, default=0.5,
                    help="Confidence floor for counting a detection as a new face.")
    ap.add_argument("--limit", type=int, default=None, help="Cap DB records (quick runs).")
    ap.add_argument("--force", action="store_true", help="Ignore caches, recompute.")
    args = ap.parse_args(argv)

    unknown = [d for d in args.detectors if d not in DETECTOR_FACTORIES]
    if unknown:
        print(f"Unknown detector(s): {unknown}. Available: {list(DETECTOR_FACTORIES)}",
              file=sys.stderr)
        return 2

    cfg.ensure_data_dir()
    roots = cfg.resolve_roots(args.roots or None, args.config)
    if not roots:
        print("No photo roots found to scan.", file=sys.stderr)
        return 2

    index = build_index(roots, args.cache)
    records = load_db_records(args.db)
    if args.limit:
        records = records[: args.limit]

    # Ground-truth bbox-area quartile thresholds are detector-independent (they
    # come from the DB's stored boxes), so compute once for comparable strata.
    gt_areas = [a for a in (_bbox_area(r.bbox_xyxy) for r in records) if a is not None]
    thr = quartile_thresholds(gt_areas)

    per_detector = {}
    for name in args.detectors:
        print(f"[{name}] running detection over dataset ...", file=sys.stderr)
        rows, detector = evaluate_detector(
            name, DETECTOR_FACTORIES[name], records, index,
            det_size=args.det_size, force=args.force,
        )
        det_rows = [r for r in rows if r.bucket in (ds.MATCHED, ds.DETECTOR_MISSED)]
        overall = M.detection_recall(r.bucket for r in det_rows)
        by_quartile = M.detection_recall_by_stratum(
            det_rows,
            lambda r: r.bucket,
            lambda r: bbox_quartile_label(_bbox_area(r.db_bbox_xyxy), thr),
        )
        by_manual = M.detection_recall_by_stratum(
            det_rows,
            lambda r: r.bucket,
            lambda r: "manual" if r.is_manual else "detected",
        )
        new_faces, images = count_new_faces(
            rows, detector, index, conf=args.new_face_conf
        )
        per_detector[name] = {
            "overall": overall,
            "by_quartile": by_quartile,
            "by_manual": by_manual,
            "new_faces": new_faces,
            "images": images,
        }

    _print_report(per_detector, args)
    return 0


def _print_report(per_detector: dict, args) -> None:
    names = list(per_detector)
    print()
    print("=" * 72)
    print("Detection comparison vs DB ground truth")
    print(f"  det_size={args.det_size}  new-face-conf={args.new_face_conf}")
    print("=" * 72)

    first = per_detector[names[0]]["overall"]
    n = first["matched"] + first["detector_missed"]
    print(f"\nScored DB faces (matched + detector_missed): N = {n}")
    print(f"Unresolved DB faces (no local source, excluded): {first['unresolved']}")

    print("\nOverall detection recall")
    for name in names:
        print(f"  {name:20s} {_fmt_recall(per_detector[name]['overall'])}")

    print("\nDetection recall by bbox-area quartile (Q1 = smallest faces)")
    quarts = sorted({q for name in names for q in per_detector[name]["by_quartile"]})
    header = "  " + "stratum".ljust(14) + "".join(f"{name:>26s}" for name in names)
    print(header)
    for q in quarts:
        cells = ""
        for name in names:
            rec = per_detector[name]["by_quartile"].get(q)
            cells += (f"{_fmt_recall(rec):>26s}" if rec else f"{'-':>26s}")
        print("  " + q.ljust(14) + cells)

    print("\nDetection recall by manual vs detected origin")
    origins = sorted({o for name in names for o in per_detector[name]["by_manual"]})
    for o in origins:
        cells = ""
        for name in names:
            rec = per_detector[name]["by_manual"].get(o)
            cells += (f"{_fmt_recall(rec):>26s}" if rec else f"{'-':>26s}")
        print("  " + o.ljust(14) + cells)

    print("\nNew faces found (detections overlapping NO DB box; count-only)")
    for name in names:
        d = per_detector[name]
        print(f"  {name:20s} {d['new_faces']:6d}  over {d['images']} images")
    print()


if __name__ == "__main__":
    raise SystemExit(main())
