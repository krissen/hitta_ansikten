"""CLI: run the full benchmark pipeline and write the metrics report.

Orchestrates, per model:

    resolver index -> dataset (detector run, cached) -> embeddings (cached)
    -> metrics -> report.md / report.csv / plots/*.png

Usage (from ``backend/``)::

    python -m benchmarks.run --models buffalo_l
    python -m benchmarks.run ~/.local/share/faceid/benchmark_staging --models buffalo_l,lvface_base
    python -m benchmarks.run --limit 500 --seed 7      # quick partial run

Everything read is treated as strictly read-only (DB + photos). All output
lands under ``_data/`` (gitignored). Wall-clock per stage is recorded but is
informational only — this harness prioritizes correctness, not timing.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

from . import config as cfg
from . import metrics as M
from . import report as R
from .dataset import DETECTOR_MISSED, MATCHED, build_dataset
from .db_access import (
    DEFAULT_DB_PATH,
    DEFAULT_DISTINCT_PAIRS_PATH,
    FaceRecord,
    load_db_records,
)
from .embeddings import compute_embeddings, stack_embeddings
from .strata import bbox_quartile_label, quartile_thresholds, surname


# ---------------------------------------------------------------------------
# model registry
# ---------------------------------------------------------------------------
def _make_buffalo(det_size):
    from .models.buffalo import BuffaloDetector, BuffaloRecognition

    return BuffaloDetector(det_size=det_size), BuffaloRecognition()


def _make_lvface(variant: str):
    """Factory for an LVFace variant.

    LVFace ships a recognition head only, so detection + alignment reuse
    buffalo_l's SCRFD detector (the benchmark's canonical alignment). Sharing
    the detector name means LVFace runs reuse the cached buffalo_l detections.
    """

    def factory(det_size):
        from .models.buffalo import BuffaloDetector
        from .models.lvface import LVFaceRecognition

        return BuffaloDetector(det_size=det_size), LVFaceRecognition(variant)

    return factory


def _make_adaface(det_size):
    """Factory for AdaFace IR-101.

    Like LVFace, AdaFace ships a recognition head only, so detection +
    alignment reuse buffalo_l's SCRFD detector (the benchmark's canonical
    alignment) and its cached detections. The ONNX must be exported first via
    ``python -m benchmarks.models.export_adaface`` (AdaFace has no official ONNX).
    """
    from .models.adaface import AdaFaceRecognition
    from .models.buffalo import BuffaloDetector

    return BuffaloDetector(det_size=det_size), AdaFaceRecognition()


MODEL_FACTORIES = {
    "buffalo_l": _make_buffalo,
    "lvface_tiny": _make_lvface("lvface_tiny"),
    "lvface_small": _make_lvface("lvface_small"),
    "lvface_base": _make_lvface("lvface_base"),
    "lvface_large": _make_lvface("lvface_large"),
    "adaface_ir101": _make_adaface,
}


# ---------------------------------------------------------------------------
# attempt-log hardness join
# ---------------------------------------------------------------------------
def load_attempt_hardness(path: Path | str) -> dict[str, int]:
    """basename -> number of detection attempts logged (a rough hardness proxy).

    An image the detector cleared on the first attempt is "easy"; one that
    needed rescaling/upsampling retries is "hard". Missing / malformed lines are
    skipped defensively.
    """
    import os

    out: dict[str, int] = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                fname = rec.get("filename")
                attempts = rec.get("attempts")
                if not fname or not isinstance(attempts, list):
                    continue
                out[os.path.basename(fname)] = len(attempts)
    except OSError:
        return {}
    return out


def _hardness_bucket(n_attempts: int | None) -> str:
    if n_attempts is None:
        return "(unknown)"
    return "easy_1_attempt" if n_attempts <= 1 else "hard_multi_attempt"


# ---------------------------------------------------------------------------
# open-set split
# ---------------------------------------------------------------------------
def build_openset_split(faces, rng, *, holdout_frac: float = 0.3):
    """Split embedded faces into (gallery, gallery_labels, probes, probe_labels).

    A random ~``holdout_frac`` of identities are held out entirely (their faces
    are unknown/reject probes, tagged with a sentinel label). For the retained
    identities with >=2 faces, one face is a known probe and the rest are
    gallery. Singleton retained identities become unknown probes (no gallery).
    """
    by_id: dict[str, list[int]] = {}
    for i, f in enumerate(faces):
        by_id.setdefault(f.identity, []).append(i)

    ids = sorted(by_id)
    rng.shuffle(ids)
    n_holdout = int(round(len(ids) * holdout_frac))
    holdout = set(ids[:n_holdout])

    g_idx, g_lab, p_idx, p_lab = [], [], [], []
    for ident in ids:
        idxs = by_id[ident]
        if ident in holdout or len(idxs) < 2:
            for i in idxs:
                p_idx.append(i)
                p_lab.append("__unknown__")
        else:
            probe = idxs[0]
            p_idx.append(probe)
            p_lab.append(ident)
            for i in idxs[1:]:
                g_idx.append(i)
                g_lab.append(ident)

    E = np.stack([faces[i].embedding for i in g_idx]) if g_idx else np.empty((0, 1))
    P = np.stack([faces[i].embedding for i in p_idx]) if p_idx else np.empty((0, 1))
    return E, g_lab, P, p_lab


# ---------------------------------------------------------------------------
# per-model pipeline
# ---------------------------------------------------------------------------
def run_model(
    model_name: str,
    records: list[FaceRecord],
    index,
    *,
    det_size: int,
    distinct_pairs: list[list[str]],
    hardness: dict[str, int],
    seed: int,
    max_impostor_pairs: int,
    force: bool,
):
    """Build dataset+embeddings for one model and compute all metrics.

    Returns ``(ModelResult, faces, face_strata, rank1_maps)``.
    """
    factory = MODEL_FACTORIES[model_name]
    detector, recognition = factory((det_size, det_size))
    timings: dict[str, float] = {}

    t0 = time.perf_counter()
    rows = build_dataset(records, index, detector, force=force)
    timings["dataset (detect+match)"] = time.perf_counter() - t0

    rec_by_id = {r.encoding_hash: r for r in records if r.encoding_hash}

    t0 = time.perf_counter()
    faces = compute_embeddings(
        rows, recognition, detector_name=detector.name, force=force
    )
    timings["embeddings"] = time.perf_counter() - t0

    E, labels = stack_embeddings(faces)
    n_faces = len(faces)
    n_identities = len(set(labels))

    twin_pair = distinct_pairs[0] if distinct_pairs else None
    twin_present = (
        twin_pair is not None
        and twin_pair[0] in set(labels)
        and twin_pair[1] in set(labels)
    )

    t0 = time.perf_counter()
    closed_centroid = M.closed_set_identification(E, labels, mode=M.CENTROID)
    closed_maxsim = M.closed_set_identification(E, labels, mode=M.MAX_SIM)
    timings["closed-set"] = time.perf_counter() - t0

    # verification pairs + ROC
    rng = np.random.default_rng(seed)
    t0 = time.perf_counter()
    pairs = M.build_pairs(
        E, labels, twin_pair=twin_pair, rng=rng, max_impostor_pairs=max_impostor_pairs
    )
    roc = {
        "all-comers": M.verification_roc(pairs.genuine, pairs.impostor_all),
    }
    if pairs.impostor_same_surname.size:
        roc["same-surname"] = M.verification_roc(pairs.genuine, pairs.impostor_same_surname)
    if pairs.impostor_twin.size:
        roc["twin-pair"] = M.verification_roc(pairs.genuine, pairs.impostor_twin)
    timings["verification"] = time.perf_counter() - t0

    sweep = M.threshold_sweep(pairs.genuine, pairs.impostor_all)
    sweep_opt = M.sweep_optimum(sweep) if sweep else None

    twin = None
    if twin_present:
        twin = M.twin_confusion_rate(E, labels, twin_pair[0], twin_pair[1])

    # open-set
    openset = None
    if n_identities >= 4:
        os_rng = np.random.default_rng(seed + 1)
        gE, gL, pE, pL = build_openset_split(faces, os_rng)
        if gL and pL:
            openset = M.open_set_identification(gE, gL, pE, pL)

    # detection recall (over all matched + missed rows)
    det_rows = [r for r in rows if r.bucket in (MATCHED, DETECTOR_MISSED)]
    det_overall = M.detection_recall(r.bucket for r in det_rows)
    det_by = _detection_recall_strata(det_rows, rec_by_id, hardness, twin_pair)

    # per-face strata for the embedded (matched) set
    face_strata = R.assign_face_strata(faces, twin_pair=twin_pair)
    for i, f in enumerate(faces):
        rec = rec_by_id.get(f.face_id)
        face_strata[i]["event"] = (rec.event_prefix if rec and rec.event_prefix else "(unknown)")
        base = rec.basename if rec else None
        face_strata[i]["hardness"] = _hardness_bucket(
            hardness.get(base) if base else None
        )

    rank1_strata = R.rank1_by_stratum(closed_maxsim, face_strata)

    result = R.ModelResult(
        model_name=model_name,
        n_faces=n_faces,
        n_identities=n_identities,
        closed_centroid=closed_centroid,
        closed_maxsim=closed_maxsim,
        roc=roc,
        sweep=sweep,
        sweep_opt=sweep_opt,
        twin=twin,
        openset=openset,
        det_recall_overall=det_overall,
        det_recall_by=det_by,
        rank1_by_stratum=rank1_strata,
        timings=timings,
    )

    rank1_maps = {
        "centroid": dict(zip(closed_centroid.probe_indices, closed_centroid.rank_flags.get(1, []))),
        "max_sim": dict(zip(closed_maxsim.probe_indices, closed_maxsim.rank_flags.get(1, []))),
    }
    return result, faces, face_strata, rank1_maps


def _detection_recall_strata(det_rows, rec_by_id, hardness, twin_pair) -> dict:
    """Per-stratum detector recall over matched+missed rows (record-derived)."""
    twins = set(twin_pair or [])
    areas = [
        int(abs((r.db_bbox_xyxy[2] - r.db_bbox_xyxy[0]) * (r.db_bbox_xyxy[3] - r.db_bbox_xyxy[1])))
        for r in det_rows if r.db_bbox_xyxy
    ]
    thr = quartile_thresholds(areas)

    def area_of(r):
        if not r.db_bbox_xyxy:
            return None
        x1, y1, x2, y2 = r.db_bbox_xyxy
        return int(abs((x2 - x1) * (y2 - y1)))

    # shared-surname groups among these rows
    by_surname: dict[str, set[str]] = {}
    for r in det_rows:
        s = surname(r.identity)
        if s:
            by_surname.setdefault(s, set()).add(r.identity)
    siblings = {s for s, ids in by_surname.items() if len(ids) >= 2}

    def strat(dim):
        def key(r):
            if dim == "bbox_quartile":
                return bbox_quartile_label(area_of(r), thr)
            if dim == "is_manual":
                return "manual" if r.is_manual else "detected"
            if dim == "event":
                rec = rec_by_id.get(r.face_id)
                return rec.event_prefix if rec and rec.event_prefix else "(unknown)"
            if dim == "sibling_surname":
                s = surname(r.identity)
                return s if s in siblings else "(none)"
            if dim == "twin":
                return "twin" if r.identity in twins else "(non-twin)"
            if dim == "hardness":
                rec = rec_by_id.get(r.face_id)
                base = rec.basename if rec else None
                return _hardness_bucket(hardness.get(base) if base else None)
            return "(n/a)"
        return key

    out = {}
    for dim in ("bbox_quartile", "is_manual", "event", "sibling_surname", "twin", "hardness"):
        out[dim] = M.detection_recall_by_stratum(det_rows, lambda r: r.bucket, strat(dim))
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _load_distinct_pairs(path) -> list[list[str]]:
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def main(argv=None) -> int:
    from .resolve import build_index

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--models", default="buffalo_l",
                    help="Comma-separated models to evaluate "
                         f"(available: {', '.join(MODEL_FACTORIES)}).")
    ap.add_argument("roots", nargs="*", help="Photo roots to scan (override config).")
    ap.add_argument("--config", default=None, help="Path to a roots.json config.")
    ap.add_argument("--cache", default=str(cfg.CACHE_PATH), help="Index cache path.")
    ap.add_argument("--db", default=str(DEFAULT_DB_PATH), help="encodings.pkl path.")
    ap.add_argument("--distinct-pairs", default=str(DEFAULT_DISTINCT_PAIRS_PATH))
    ap.add_argument("--attempts", default=str(Path("~/.local/share/faceid/attempt_stats.jsonl").expanduser()))
    ap.add_argument("--det-size", type=int, default=640, help="SCRFD det_size (square).")
    ap.add_argument("--seed", type=int, default=1234, help="RNG seed for any sampling.")
    ap.add_argument("--max-impostor-pairs", type=int, default=200_000)
    ap.add_argument("--limit", type=int, default=None, help="Cap DB records (quick runs).")
    ap.add_argument("--force", action="store_true", help="Ignore caches, recompute.")
    ap.add_argument("--out-md", default=str(cfg.DATA_DIR / "report.md"))
    ap.add_argument("--out-csv", default=str(cfg.DATA_DIR / "report.csv"))
    ap.add_argument("--plots-dir", default=str(cfg.DATA_DIR / R.PLOTS_DIRNAME))
    ap.add_argument("--partial", action="store_true",
                    help="Flag the report as partial (restore still running).")
    args = ap.parse_args(argv)

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    unknown = [m for m in models if m not in MODEL_FACTORIES]
    if unknown:
        print(f"Unknown model(s): {unknown}. Available: {list(MODEL_FACTORIES)}", file=sys.stderr)
        return 2

    cfg.ensure_data_dir()
    roots = cfg.resolve_roots(args.roots or None, args.config)
    if not roots:
        print("No photo roots found to scan.", file=sys.stderr)
        return 2

    index = build_index(roots, args.cache)
    records = load_db_records(args.db)
    total_faces = len(records)
    total_ids = len({r.identity for r in records})
    if args.limit:
        records = records[: args.limit]
    distinct_pairs = _load_distinct_pairs(args.distinct_pairs)
    hardness = load_attempt_hardness(args.attempts)

    results = []
    per_model_faces = {}
    per_model_strata = {}
    per_model_rank1 = {}
    dataset_buckets = None
    for model_name in models:
        print(f"[{model_name}] building dataset + embeddings ...", file=sys.stderr)
        result, faces, face_strata, rank1_maps = run_model(
            model_name, records, index,
            det_size=args.det_size,
            distinct_pairs=distinct_pairs,
            hardness=hardness,
            seed=args.seed,
            max_impostor_pairs=args.max_impostor_pairs,
            force=args.force,
        )
        results.append(result)
        per_model_faces[model_name] = faces
        per_model_strata[model_name] = face_strata
        per_model_rank1[model_name] = rank1_maps
        if dataset_buckets is None:
            dataset_buckets = (
                f"matched={result.det_recall_overall['matched']}, "
                f"detector_missed={result.det_recall_overall['detector_missed']}, "
                f"unresolved(faces)~= (see feasibility report)"
            )
        print(f"[{model_name}] faces={result.n_faces} ids={result.n_identities} "
              f"rank1(maxsim)={result.closed_maxsim.rank1:.3f}", file=sys.stderr)

    meta = {
        "generated": R.now_iso(),
        "partial": args.partial,
        "models": ", ".join(models),
        "seed": args.seed,
        "roots": ", ".join(str(r) for r in roots),
        "db": args.db,
        "n_faces_total": total_faces,
        "n_identities_total": total_ids,
        "dataset_buckets": dataset_buckets or "n/a",
        "det_size": f"{args.det_size}x{args.det_size}",
        "max_impostor_pairs": args.max_impostor_pairs,
    }

    md = R.render_markdown(results, meta)
    Path(args.out_md).write_text(md)
    R.write_csv(Path(args.out_csv), per_model_faces, per_model_strata, per_model_rank1)
    plots = R.write_plots(results, Path(args.plots_dir))

    print(f"Wrote report: {args.out_md}", file=sys.stderr)
    print(f"Wrote CSV:    {args.out_csv}", file=sys.stderr)
    print(f"Wrote {len(plots)} plot(s) to {args.plots_dir}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
