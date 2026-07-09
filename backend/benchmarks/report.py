"""Report + plot rendering for the benchmark harness.

Consumes the metric dataclasses from :mod:`benchmarks.metrics` (plus the
``EmbeddedFace`` rows and the raw dataset manifest) and renders:

* ``_data/report.md`` — per-model x per-stratum markdown tables with a config
  header (seed, split, roots, model list, partial-data flag).
* ``_data/report.csv`` — one row per embedded face (labels, strata, per-mode
  rank-1 correctness, det score, blur).
* ``_data/plots/*.png`` — ROC curves, the threshold sweep, per-stratum rank-1
  bars, and the open-set DIR-vs-FAR curve (matplotlib, Agg backend).

Plotting imports matplotlib lazily and forces the non-interactive Agg backend,
so importing this module never requires a display or matplotlib itself.
"""

from __future__ import annotations

import csv
import datetime as _dt
from dataclasses import dataclass, field
from pathlib import Path

from . import metrics as M
from .embeddings import EmbeddedFace
from .strata import bbox_quartile_label, quartile_thresholds, surname

PLOTS_DIRNAME = "plots"

# Stratum dimensions computed for the per-face (matched) analysis. ``event`` and
# ``hardness`` are injected by the runner (they need the DB record / attempt log,
# not just the embedded face), so they may be absent for some faces.
FACE_STRATA = (
    "bbox_quartile", "blur_quartile", "is_manual", "event",
    "sibling_surname", "twin", "hardness",
)


# ---------------------------------------------------------------------------
# per-face stratum assignment
# ---------------------------------------------------------------------------
def _numeric_quartile_labels(values, labeler):
    thresholds = quartile_thresholds([v for v in values if v is not None])
    return [labeler(v, thresholds) for v in values]


def assign_face_strata(
    faces: list[EmbeddedFace],
    *,
    twin_pair: list[str] | None = None,
) -> list[dict[str, str]]:
    """Return a per-face dict of ``dimension -> bucket`` label.

    Quartiles (bbox area, blur) are computed over the supplied ``faces`` so the
    buckets are balanced for whatever partial set we have.
    """
    twins = set(twin_pair or [])
    # shared-surname groups present in this set (>=2 distinct identities)
    by_surname: dict[str, set[str]] = {}
    for f in faces:
        s = surname(f.identity)
        if s:
            by_surname.setdefault(s, set()).add(f.identity)
    sibling_surnames = {s for s, ids in by_surname.items() if len(ids) >= 2}

    bbox_labels = _numeric_quartile_labels(
        [f.bbox_area for f in faces], bbox_quartile_label
    )
    blur_labels = _numeric_quartile_labels(
        [f.blur for f in faces], _blur_quartile_label
    )

    out: list[dict[str, str]] = []
    for i, f in enumerate(faces):
        s = surname(f.identity)
        out.append(
            {
                "bbox_quartile": bbox_labels[i],
                "blur_quartile": blur_labels[i],
                "is_manual": "manual" if f.is_manual else "detected",
                "sibling_surname": s if s in sibling_surnames else "(none)",
                "twin": "twin" if f.identity in twins else "(non-twin)",
            }
        )
    return out


def _blur_quartile_label(blur, thresholds) -> str:
    if blur is None:
        return "no_blur"
    q1, q2, q3 = thresholds
    if blur <= q1:
        return "Q1_blurriest"
    if blur <= q2:
        return "Q2"
    if blur <= q3:
        return "Q3"
    return "Q4_sharpest"


# ---------------------------------------------------------------------------
# per-model result container
# ---------------------------------------------------------------------------
@dataclass
class ModelResult:
    model_name: str
    n_faces: int
    n_identities: int
    closed_centroid: M.ClosedSetResult
    closed_maxsim: M.ClosedSetResult
    roc: dict  # subset -> ROCResult
    sweep: list  # list[SweepPoint]
    sweep_opt: object  # SweepPoint
    twin: object | None  # TwinConfusionResult
    openset: object | None  # OpenSetResult
    det_recall_overall: dict
    det_recall_by: dict  # dim -> {bucket -> recall dict}
    rank1_by_stratum: dict  # dim -> {bucket -> {rate, n}}
    timings: dict = field(default_factory=dict)


def rank1_by_stratum(
    result: M.ClosedSetResult,
    face_strata: list[dict[str, str]],
    dims=FACE_STRATA,
) -> dict:
    """Aggregate rank-1 correctness per stratum bucket from a ClosedSetResult."""
    out: dict[str, dict[str, dict]] = {}
    flags = result.rank_flags.get(1, [])
    for dim in dims:
        buckets: dict[str, list[bool]] = {}
        for pi, flag in zip(result.probe_indices, flags):
            bucket = face_strata[pi].get(dim, "(n/a)")
            buckets.setdefault(bucket, []).append(flag)
        out[dim] = {
            b: {"rate": (sum(v) / len(v)) if v else 0.0, "n": len(v)}
            for b, v in sorted(buckets.items())
        }
    return out


# ---------------------------------------------------------------------------
# markdown rendering
# ---------------------------------------------------------------------------
def _pct(x) -> str:
    return f"{100 * x:.1f}%" if x == x else "n/a"  # x==x guards NaN


def render_markdown(results: list[ModelResult], meta: dict) -> str:
    L: list[str] = []
    L.append("# Face-recognition benchmark — metrics report")
    L.append("")
    L.append(f"_Generated {meta.get('generated')}_")
    L.append("")
    if meta.get("partial"):
        L.append("> **PARTIAL DATA.** The backup restore was still running; these "
                 "numbers cover only the currently-resolvable subset and are not "
                 "the final evaluation.")
        L.append("")
    L.append("## Run configuration")
    L.append("")
    L.append("| Key | Value |")
    L.append("|---|---|")
    for k in ("models", "seed", "roots", "db", "n_faces_total", "n_identities_total",
              "dataset_buckets", "det_size", "max_impostor_pairs"):
        if k in meta:
            L.append(f"| {k} | {meta[k]} |")
    L.append("")

    for r in results:
        L.extend(_render_model(r))
    return "\n".join(L) + "\n"


def _render_model(r: ModelResult) -> list[str]:
    L: list[str] = []
    L.append(f"## Model: `{r.model_name}`")
    L.append("")
    L.append(f"- Faces embedded: **{r.n_faces}** across **{r.n_identities}** identities")
    L.append("")

    # closed-set
    L.append("### Closed-set identification (leave-one-out)")
    L.append("")
    L.append("| Gallery mode | Probes | Rank-1 | Rank-5 |")
    L.append("|---|---:|---:|---:|")
    for label, res in (("per-person centroid", r.closed_centroid),
                       ("all-encodings max-sim", r.closed_maxsim)):
        L.append(f"| {label} | {res.n_probes} | {_pct(res.rank1)} | {_pct(res.rank5)} |")
    L.append("")

    # verification ROC
    L.append("### Verification ROC (genuine vs impostor)")
    L.append("")
    L.append("| Impostor subset | Genuine | Impostor | AUC | TAR@FAR=1e-2 | TAR@FAR=1e-3 |")
    L.append("|---|---:|---:|---:|---:|---:|")
    for subset, roc in r.roc.items():
        L.append(
            f"| {subset} | {roc.n_genuine} | {roc.n_impostor} | {roc.auc:.4f} | "
            f"{_pct(roc.tar_at_far.get(1e-2, float('nan')))} | "
            f"{_pct(roc.tar_at_far.get(1e-3, float('nan')))} |"
        )
    L.append("")

    # twin
    if r.twin is not None:
        t = r.twin
        L.append("### Twin confusion")
        L.append("")
        L.append(f"- Pair: **{t.twin_a} / {t.twin_b}**")
        L.append(f"- Twin probes: **{t.n_probes}**, nearest-wrong-person-is-co-twin: "
                 f"**{t.n_confused}** ({_pct(t.rate)})")
        L.append("")

    # threshold sweep
    L.append("### Threshold sweep (cosine distance)")
    L.append("")
    if r.sweep_opt is not None:
        o = r.sweep_opt
        L.append(f"- Empirical F1 optimum at distance **{o.distance:.2f}** "
                 f"(precision {_pct(o.precision)}, recall {_pct(o.recall)}, "
                 f"FAR {_pct(o.far)}, FRR {_pct(o.frr)})")
    L.append("- App defaults: match_threshold **0.45**, ignore_distance **0.35**")
    L.append("")
    L.append("| Distance | Precision | Recall | FAR | FRR |")
    L.append("|---:|---:|---:|---:|---:|")
    marks = {0.30, 0.35, 0.40, 0.45, 0.50, 0.60}
    for p in r.sweep:
        if round(p.distance, 2) in marks:
            tag = " ⟵ app" if round(p.distance, 2) in (0.35, 0.45) else ""
            L.append(f"| {p.distance:.2f}{tag} | {_pct(p.precision)} | {_pct(p.recall)} | "
                     f"{_pct(p.far)} | {_pct(p.frr)} |")
    L.append("")

    # open-set
    if r.openset is not None:
        os_ = r.openset
        L.append("### Open-set identification (DIR@rank1 vs FAR)")
        L.append("")
        L.append(f"- Known probes: **{os_.n_known}**, unknown (reject) probes: "
                 f"**{os_.n_unknown}**")
        for f, d in sorted(os_.dir_at_far.items()):
            L.append(f"- DIR @ FAR<={f:g}: **{_pct(d)}**")
        L.append("")

    # detection recall
    L.append("### Detector recall (matched / (matched + detector_missed))")
    L.append("")
    dr = r.det_recall_overall
    L.append(f"- Overall: **{_pct(dr['recall'])}** "
             f"({dr['matched']}/{dr['matched'] + dr['detector_missed']}; "
             f"{dr['unresolved']} unresolved excluded)")
    L.append("")
    for dim, buckets in r.det_recall_by.items():
        L.append(f"**By {dim}**")
        L.append("")
        L.append("| Bucket | Matched | Missed | Recall |")
        L.append("|---|---:|---:|---:|")
        for b, rec in buckets.items():
            L.append(f"| {b} | {rec['matched']} | {rec['detector_missed']} | "
                     f"{_pct(rec['recall'])} |")
        L.append("")

    # per-stratum rank-1
    L.append("### Rank-1 by stratum (max-sim gallery)")
    L.append("")
    for dim, buckets in r.rank1_by_stratum.items():
        if not buckets:
            continue
        L.append(f"**By {dim}**")
        L.append("")
        L.append("| Bucket | Probes | Rank-1 |")
        L.append("|---|---:|---:|")
        for b, v in buckets.items():
            L.append(f"| {b} | {v['n']} | {_pct(v['rate'])} |")
        L.append("")

    if r.timings:
        L.append("### Timings (informational)")
        L.append("")
        for stage, secs in r.timings.items():
            L.append(f"- {stage}: {secs:.2f}s")
        L.append("")

    return L


# ---------------------------------------------------------------------------
# CSV rendering
# ---------------------------------------------------------------------------
def write_csv(
    path: Path,
    per_model_faces: dict[str, list[EmbeddedFace]],
    per_model_strata: dict[str, list[dict]],
    per_model_rank1: dict[str, dict[int, dict[int, bool]]],
) -> Path:
    """One row per (model, face). ``per_model_rank1[model][mode][face_index]``
    is the rank-1 flag or missing (probe was skipped)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "model", "face_id", "identity", "image_hash", "is_manual",
        "det_score", "bbox_area", "bbox_quartile", "blur", "blur_quartile",
        "sibling_surname", "twin", "rank1_centroid", "rank1_maxsim",
    ]
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for model, faces in per_model_faces.items():
            strata = per_model_strata[model]
            r1c = per_model_rank1[model].get("centroid", {})
            r1m = per_model_rank1[model].get("max_sim", {})
            for i, f in enumerate(faces):
                st = strata[i]
                w.writerow({
                    "model": model,
                    "face_id": f.face_id,
                    "identity": f.identity,
                    "image_hash": f.image_hash,
                    "is_manual": f.is_manual,
                    "det_score": f"{f.det_score:.4f}" if f.det_score is not None else "",
                    "bbox_area": f.bbox_area if f.bbox_area is not None else "",
                    "bbox_quartile": st.get("bbox_quartile", ""),
                    "blur": f"{f.blur:.2f}" if f.blur is not None else "",
                    "blur_quartile": st.get("blur_quartile", ""),
                    "sibling_surname": st.get("sibling_surname", ""),
                    "twin": st.get("twin", ""),
                    "rank1_centroid": _flag(r1c.get(i)),
                    "rank1_maxsim": _flag(r1m.get(i)),
                })
    return path


def _flag(v) -> str:
    return "" if v is None else ("1" if v else "0")


# ---------------------------------------------------------------------------
# plots
# ---------------------------------------------------------------------------
def _mpl():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    return plt


def plot_roc(results: list[ModelResult], out: Path) -> Path:
    plt = _mpl()
    fig, ax = plt.subplots(figsize=(6, 5))
    for r in results:
        for subset, roc in r.roc.items():
            if roc.n_genuine and roc.n_impostor:
                ax.plot(roc.fpr, roc.tpr, label=f"{r.model_name}:{subset} (AUC {roc.auc:.3f})")
    ax.plot([0, 1], [0, 1], "k--", alpha=0.3)
    ax.set_xlabel("False accept rate")
    ax.set_ylabel("True accept rate")
    ax.set_title("Verification ROC")
    ax.legend(fontsize=7, loc="lower right")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)
    return out


def plot_sweep(result: ModelResult, out: Path) -> Path:
    plt = _mpl()
    d = [p.distance for p in result.sweep]
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.plot(d, [p.precision for p in result.sweep], label="precision")
    ax.plot(d, [p.recall for p in result.sweep], label="recall")
    ax.plot(d, [p.far for p in result.sweep], label="FAR")
    ax.plot(d, [p.frr for p in result.sweep], label="FRR")
    for x, c in ((0.40, "tab:red"), (0.35, "tab:purple")):
        ax.axvline(x, color=c, linestyle=":", alpha=0.7, label=f"app {x:.2f}")
    if result.sweep_opt is not None:
        ax.axvline(result.sweep_opt.distance, color="green", linestyle="--",
                   alpha=0.7, label=f"F1 opt {result.sweep_opt.distance:.2f}")
    ax.set_xlabel("Cosine distance threshold")
    ax.set_ylabel("Rate")
    ax.set_title(f"Threshold sweep — {result.model_name}")
    ax.legend(fontsize=7)
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)
    return out


def plot_rank1_bars(result: ModelResult, out: Path, dim: str = "bbox_quartile") -> Path:
    plt = _mpl()
    buckets = result.rank1_by_stratum.get(dim, {})
    names = list(buckets.keys())
    rates = [buckets[n]["rate"] for n in names]
    ns = [buckets[n]["n"] for n in names]
    fig, ax = plt.subplots(figsize=(7, 4.5))
    bars = ax.bar(names, rates, color="tab:blue")
    for bar, n in zip(bars, ns):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01,
                f"n={n}", ha="center", va="bottom", fontsize=7)
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("Rank-1")
    ax.set_title(f"Rank-1 by {dim} — {result.model_name}")
    ax.tick_params(axis="x", labelrotation=30, labelsize=8)
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)
    return out


def plot_openset(results: list[ModelResult], out: Path) -> Path | None:
    plt = _mpl()
    have = [r for r in results if r.openset is not None and r.openset.n_unknown]
    if not have:
        return None
    fig, ax = plt.subplots(figsize=(6, 5))
    for r in have:
        os_ = r.openset
        # sort by FAR for a readable curve
        pts = sorted(zip(os_.far, os_.dir))
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        ax.plot(xs, ys, marker=".", label=r.model_name)
    ax.set_xlabel("False accept rate")
    ax.set_ylabel("Detection & identification rate (rank 1)")
    ax.set_title("Open-set DIR vs FAR")
    ax.legend(fontsize=8)
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)
    return out


def write_plots(results: list[ModelResult], plots_dir: Path) -> list[Path]:
    plots_dir = Path(plots_dir)
    plots_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    written.append(plot_roc(results, plots_dir / "roc.png"))
    op = plot_openset(results, plots_dir / "openset_dir_far.png")
    if op:
        written.append(op)
    for r in results:
        safe = r.model_name.replace("/", "_")
        written.append(plot_sweep(r, plots_dir / f"sweep_{safe}.png"))
        for dim in ("bbox_quartile", "blur_quartile"):
            if r.rank1_by_stratum.get(dim):
                written.append(
                    plot_rank1_bars(r, plots_dir / f"rank1_{dim}_{safe}.png", dim)
                )
    return written


def now_iso() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")
