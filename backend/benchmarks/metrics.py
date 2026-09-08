"""Pure metric functions over embeddings + labels (numpy in, dataclasses out).

Everything here is a deterministic function of its numeric inputs — no I/O, no
insightface, no DB access — so the whole module is unit-testable against
hand-computable synthetic embeddings. Cosine similarity is a plain dot product
because every embedding the harness produces is L2-normalized (inputs are
re-normalized defensively regardless).

Metric families:

* :func:`closed_set_identification` — rank-1/rank-5 against a gallery, in two
  gallery modes (per-person centroid, and all-encodings max-sim with the probe's
  own vector left out).
* :func:`open_set_identification` — detection-and-identification rate (DIR) at
  rank 1 vs false-accept rate (FAR) over a threshold sweep, for held-out /
  ignored probes that must be rejected.
* :func:`verification_roc` / :func:`build_pairs` — genuine-vs-impostor pair
  scoring, ROC AUC and TAR@FAR, with impostor subsets (all-comers,
  same-surname siblings, the confirmed twin pair).
* :func:`twin_confusion_rate` — fraction of twin probes whose nearest
  wrong-person neighbour is the *other* twin.
* :func:`threshold_sweep` — cosine-distance grid → precision/recall/FAR/FRR,
  the empirical validation of the app's 0.4 / 0.35 defaults.
* :func:`detection_recall` / :func:`detection_recall_by_stratum` — matched /
  (matched + detector_missed) over the dataset buckets, overall and per stratum.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field

import numpy as np

# Dataset bucket names (mirror ``benchmarks.dataset`` without importing it, so
# this module stays dependency-light).
MATCHED = "matched"
DETECTOR_MISSED = "detector_missed"
UNRESOLVED = "unresolved"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def unit_rows(embeddings: np.ndarray, eps: float = 1e-10) -> np.ndarray:
    """Return ``embeddings`` with each row L2-normalized (zero rows untouched)."""
    E = np.asarray(embeddings, dtype=np.float64)
    if E.ndim != 2:
        raise ValueError(f"embeddings must be 2-D (got shape {E.shape})")
    norms = np.linalg.norm(E, axis=1, keepdims=True)
    norms = np.where(norms <= eps, 1.0, norms)
    return E / norms


def cosine_sim_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Full cosine-similarity matrix between the rows of ``a`` and ``b``."""
    return unit_rows(a) @ unit_rows(b).T


def _person_indices(labels: Sequence) -> dict:
    """Map each label to the array of row indices carrying it."""
    out: dict = defaultdict(list)
    for i, y in enumerate(labels):
        out[y].append(i)
    return {k: np.asarray(v, dtype=int) for k, v in out.items()}


# ---------------------------------------------------------------------------
# closed-set identification
# ---------------------------------------------------------------------------
CENTROID = "centroid"
MAX_SIM = "max_sim"


@dataclass
class ClosedSetResult:
    """Closed-set rank-k identification outcome (leave-one-out)."""

    mode: str
    n_probes: int
    ranks: tuple[int, ...]
    rank_rates: dict[int, float]
    probe_indices: list[int] = field(default_factory=list)
    # rank_flags[k] is a list of bools aligned with probe_indices.
    rank_flags: dict[int, list[bool]] = field(default_factory=dict)

    @property
    def rank1(self) -> float:
        return self.rank_rates.get(1, 0.0)

    @property
    def rank5(self) -> float:
        return self.rank_rates.get(5, 0.0)


def closed_set_identification(
    embeddings: np.ndarray,
    labels: Sequence,
    *,
    mode: str = CENTROID,
    ranks: tuple[int, ...] = (1, 5),
) -> ClosedSetResult:
    """Leave-one-out closed-set identification.

    Each face is used once as a probe; the remaining faces of its identity stay
    in the gallery (so its true identity is always present — closed set).
    Identities with only a single face are skipped (no gallery would remain).

    ``mode``:
        * ``"centroid"`` — score each person by cosine sim to that person's
          gallery centroid (mean of the person's remaining vectors, re-L2'd).
        * ``"max_sim"`` — score each person by the max cosine sim over that
          person's individual gallery vectors (probe vector excluded).
    """
    E = unit_rows(embeddings)
    labels = list(labels)
    n = E.shape[0]
    if len(labels) != n:
        raise ValueError("labels length must match embeddings rows")

    persons = _person_indices(labels)
    person_list = list(persons.keys())
    counts = {p: len(idx) for p, idx in persons.items()}

    # Precompute per-person sum (centroid) and the full sim matrix (max_sim).
    sums = {p: E[idx].sum(axis=0) for p, idx in persons.items()}
    sim = E @ E.T if mode == MAX_SIM else None

    probe_indices: list[int] = []
    flags: dict[int, list[bool]] = {k: [] for k in ranks}

    for i in range(n):
        yi = labels[i]
        if counts[yi] < 2:
            continue  # singleton identity: no leave-one-out gallery
        scores = np.empty(len(person_list), dtype=np.float64)
        for j, p in enumerate(person_list):
            idx = persons[p]
            if mode == CENTROID:
                if p == yi:
                    c = (sums[p] - E[i]) / (counts[p] - 1)
                else:
                    c = sums[p] / counts[p]
                norm = np.linalg.norm(c)
                c = c / norm if norm > 1e-10 else c
                scores[j] = float(E[i] @ c)
            elif mode == MAX_SIM:
                if p == yi:
                    others = idx[idx != i]
                    scores[j] = float(sim[i, others].max()) if others.size else -np.inf
                else:
                    scores[j] = float(sim[i, idx].max())
            else:
                raise ValueError(f"unknown mode {mode!r}")

        order = np.argsort(-scores, kind="stable")
        ranked = [person_list[o] for o in order]
        try:
            true_rank = ranked.index(yi) + 1
        except ValueError:
            true_rank = len(ranked) + 1

        probe_indices.append(i)
        for k in ranks:
            flags[k].append(true_rank <= k)

    n_probes = len(probe_indices)
    rates = {k: (float(np.mean(flags[k])) if n_probes else 0.0) for k in ranks}
    return ClosedSetResult(
        mode=mode,
        n_probes=n_probes,
        ranks=tuple(ranks),
        rank_rates=rates,
        probe_indices=probe_indices,
        rank_flags=flags,
    )


# ---------------------------------------------------------------------------
# open-set identification (DIR @ rank 1 vs FAR)
# ---------------------------------------------------------------------------
@dataclass
class OpenSetResult:
    """Open-set identification curve (DIR@rank1 vs FAR)."""

    thresholds: list[float]
    far: list[float]
    dir: list[float]
    n_known: int
    n_unknown: int
    dir_at_far: dict[float, float] = field(default_factory=dict)


def _person_max_scores(
    probe: np.ndarray, gallery: np.ndarray, gallery_labels: Sequence
) -> tuple[list, np.ndarray]:
    """For one probe, return (person_list, per-person max cosine sim)."""
    persons = _person_indices(gallery_labels)
    plist = list(persons.keys())
    sims = probe @ gallery.T
    scores = np.array([sims[persons[p]].max() for p in plist], dtype=np.float64)
    return plist, scores


def open_set_identification(
    gallery_embeddings: np.ndarray,
    gallery_labels: Sequence,
    probe_embeddings: np.ndarray,
    probe_labels: Sequence,
    *,
    thresholds: Sequence[float] | None = None,
    far_targets: Sequence[float] = (0.1, 0.01),
) -> OpenSetResult:
    """Open-set DIR@rank1 vs FAR.

    A probe whose label is not among ``gallery_labels`` (e.g. a held-out
    identity, or an ignored face carrying a sentinel label) is an *impostor*
    that must be rejected. For each threshold ``t``:

    * DIR = fraction of *known* probes whose top-ranked gallery person is
      correct **and** scores >= ``t``;
    * FAR = fraction of *unknown* probes whose top gallery score >= ``t``
      (falsely accepted).
    """
    G = unit_rows(gallery_embeddings)
    P = unit_rows(probe_embeddings)
    gallery_labels = list(gallery_labels)
    probe_labels = list(probe_labels)
    known_set = set(gallery_labels)

    top_score = np.empty(P.shape[0], dtype=np.float64)
    top_correct = np.zeros(P.shape[0], dtype=bool)
    is_known = np.zeros(P.shape[0], dtype=bool)

    for i in range(P.shape[0]):
        plist, scores = _person_max_scores(P[i], G, gallery_labels)
        best = int(np.argmax(scores))
        top_score[i] = scores[best]
        yi = probe_labels[i]
        if yi in known_set:
            is_known[i] = True
            top_correct[i] = plist[best] == yi

    known_scores = top_score[is_known]
    known_correct = top_correct[is_known]
    unknown_scores = top_score[~is_known]
    n_known = int(is_known.sum())
    n_unknown = int((~is_known).sum())

    if thresholds is None:
        pool = np.concatenate([top_score, [-1.0, 1.0]])
        thresholds = np.unique(np.round(pool, 6))
    thresholds = [float(t) for t in np.sort(np.asarray(thresholds, dtype=np.float64))]

    far_list: list[float] = []
    dir_list: list[float] = []
    for t in thresholds:
        if n_known:
            dir_v = float(np.mean(known_correct & (known_scores >= t)))
        else:
            dir_v = 0.0
        far_v = float(np.mean(unknown_scores >= t)) if n_unknown else 0.0
        dir_list.append(dir_v)
        far_list.append(far_v)

    # DIR at (or below) each target FAR: pick the operating point with the
    # highest DIR among thresholds whose FAR <= target.
    dir_at_far: dict[float, float] = {}
    far_arr = np.asarray(far_list)
    dir_arr = np.asarray(dir_list)
    for f in far_targets:
        mask = far_arr <= f
        dir_at_far[float(f)] = float(dir_arr[mask].max()) if mask.any() else 0.0

    return OpenSetResult(
        thresholds=thresholds,
        far=far_list,
        dir=dir_list,
        n_known=n_known,
        n_unknown=n_unknown,
        dir_at_far=dir_at_far,
    )


# ---------------------------------------------------------------------------
# verification pairs, ROC
# ---------------------------------------------------------------------------
@dataclass
class PairSims:
    """Similarity scores for genuine and (subset-tagged) impostor pairs."""

    genuine: np.ndarray
    impostor_all: np.ndarray
    impostor_same_surname: np.ndarray
    impostor_twin: np.ndarray


def _surname(name: str) -> str | None:
    parts = str(name).split()
    return parts[-1] if len(parts) >= 2 else None


def build_pairs(
    embeddings: np.ndarray,
    labels: Sequence,
    *,
    surnames: Sequence | None = None,
    twin_pair: Sequence | None = None,
    rng: np.random.Generator | None = None,
    max_impostor_pairs: int | None = 200_000,
) -> PairSims:
    """Build genuine/impostor pair similarities with impostor subsets.

    * genuine — every within-identity pair.
    * impostor_all — cross-identity pairs (sub-sampled with ``rng`` when the
      full set exceeds ``max_impostor_pairs``; genuine pairs are never sampled).
    * impostor_same_surname — cross-identity pairs sharing a surname (siblings).
    * impostor_twin — cross-identity pairs whose two labels are exactly the
      ``twin_pair`` set.
    """
    E = unit_rows(embeddings)
    labels = list(labels)
    n = E.shape[0]
    if surnames is None:
        surnames = [_surname(y) for y in labels]
    else:
        surnames = list(surnames)
    twin_set = set(twin_pair) if twin_pair else set()

    sim = E @ E.T
    iu, ju = np.triu_indices(n, k=1)
    same = np.array([labels[i] == labels[j] for i, j in zip(iu, ju)])
    pair_sims = sim[iu, ju]

    genuine = pair_sims[same]
    imp_mask = ~same
    imp_i, imp_j, imp_sims = iu[imp_mask], ju[imp_mask], pair_sims[imp_mask]

    same_surname = np.array(
        [surnames[i] is not None and surnames[i] == surnames[j] for i, j in zip(imp_i, imp_j)]
    )
    twin_mask = np.array(
        [{labels[i], labels[j]} == twin_set and len(twin_set) == 2 for i, j in zip(imp_i, imp_j)]
    )

    impostor_same_surname = imp_sims[same_surname] if same_surname.size else imp_sims[:0]
    impostor_twin = imp_sims[twin_mask] if twin_mask.size else imp_sims[:0]

    # Sub-sample the (often huge) all-comers impostor set for tractability.
    if max_impostor_pairs is not None and imp_sims.size > max_impostor_pairs:
        rng = rng or np.random.default_rng(0)
        sel = rng.choice(imp_sims.size, size=max_impostor_pairs, replace=False)
        impostor_all = imp_sims[sel]
    else:
        impostor_all = imp_sims

    return PairSims(
        genuine=genuine,
        impostor_all=impostor_all,
        impostor_same_surname=impostor_same_surname,
        impostor_twin=impostor_twin,
    )


@dataclass
class ROCResult:
    """Verification ROC summary for one genuine/impostor split."""

    auc: float
    n_genuine: int
    n_impostor: int
    fpr: list[float]
    tpr: list[float]
    thresholds: list[float]
    tar_at_far: dict[float, float] = field(default_factory=dict)


def roc_auc(genuine: np.ndarray, impostor: np.ndarray) -> float:
    """Area under the ROC curve = P(genuine sim > impostor sim), ties at 0.5."""
    g = np.asarray(genuine, dtype=np.float64)
    im = np.asarray(impostor, dtype=np.float64)
    if g.size == 0 or im.size == 0:
        return float("nan")
    # Rank-based (Mann-Whitney U) computation, tie-aware.
    all_v = np.concatenate([g, im])
    order = np.argsort(all_v, kind="stable")
    ranks = np.empty_like(order, dtype=np.float64)
    sorted_v = all_v[order]
    i = 0
    n = all_v.size
    while i < n:
        j = i
        while j + 1 < n and sorted_v[j + 1] == sorted_v[i]:
            j += 1
        avg_rank = (i + j) / 2.0 + 1.0  # 1-based average rank for ties
        ranks[order[i : j + 1]] = avg_rank
        i = j + 1
    rank_g = ranks[: g.size].sum()
    u = rank_g - g.size * (g.size + 1) / 2.0
    return float(u / (g.size * im.size))


def verification_roc(
    genuine: np.ndarray,
    impostor: np.ndarray,
    *,
    far_targets: Sequence[float] = (1e-2, 1e-3),
) -> ROCResult:
    """ROC curve, AUC and TAR@FAR for a genuine/impostor similarity split."""
    g = np.asarray(genuine, dtype=np.float64)
    im = np.asarray(impostor, dtype=np.float64)
    thresholds = np.unique(np.concatenate([g, im, [-1.0, 1.0]]))
    thresholds = np.sort(thresholds)[::-1]  # high sim (strict) -> low

    tpr: list[float] = []
    fpr: list[float] = []
    for t in thresholds:
        tpr.append(float(np.mean(g >= t)) if g.size else 0.0)
        fpr.append(float(np.mean(im >= t)) if im.size else 0.0)

    tar_at_far: dict[float, float] = {}
    fpr_arr = np.asarray(fpr)
    tpr_arr = np.asarray(tpr)
    for f in far_targets:
        mask = fpr_arr <= f
        tar_at_far[float(f)] = float(tpr_arr[mask].max()) if mask.any() else 0.0

    return ROCResult(
        auc=roc_auc(g, im),
        n_genuine=int(g.size),
        n_impostor=int(im.size),
        fpr=fpr,
        tpr=tpr,
        thresholds=[float(t) for t in thresholds],
        tar_at_far=tar_at_far,
    )


# ---------------------------------------------------------------------------
# twin confusion
# ---------------------------------------------------------------------------
@dataclass
class TwinConfusionResult:
    """Fraction of twin probes whose nearest wrong-person is the other twin."""

    twin_a: str
    twin_b: str
    n_probes: int
    n_confused: int
    rate: float


def twin_confusion_rate(
    embeddings: np.ndarray,
    labels: Sequence,
    twin_a,
    twin_b,
) -> TwinConfusionResult:
    """For every face of the twin pair, find its nearest *wrong-person*
    neighbour (any face of a different identity, itself excluded). Confusion =
    that neighbour belongs to the co-twin. Rate is over twin probes that have
    at least one wrong-person candidate."""
    E = unit_rows(embeddings)
    labels = list(labels)
    twins = {twin_a, twin_b}
    sim = E @ E.T
    n = E.shape[0]

    n_probes = 0
    n_confused = 0
    for i in range(n):
        if labels[i] not in twins:
            continue
        other_twin = twin_b if labels[i] == twin_a else twin_a
        # candidates: different identity, not self
        cand = [j for j in range(n) if j != i and labels[j] != labels[i]]
        if not cand:
            continue
        n_probes += 1
        cand = np.asarray(cand)
        nearest = cand[int(np.argmax(sim[i, cand]))]
        if labels[nearest] == other_twin:
            n_confused += 1

    rate = (n_confused / n_probes) if n_probes else 0.0
    return TwinConfusionResult(
        twin_a=str(twin_a),
        twin_b=str(twin_b),
        n_probes=n_probes,
        n_confused=n_confused,
        rate=rate,
    )


# ---------------------------------------------------------------------------
# threshold sweep (cosine distance grid)
# ---------------------------------------------------------------------------
@dataclass
class SweepPoint:
    """One cosine-distance operating point over genuine/impostor pairs."""

    distance: float
    sim_threshold: float
    precision: float
    recall: float
    far: float
    frr: float
    tp: int
    fp: int
    fn: int
    tn: int


def threshold_sweep(
    genuine: np.ndarray,
    impostor: np.ndarray,
    *,
    start: float = 0.20,
    stop: float = 0.80,
    step: float = 0.01,
) -> list[SweepPoint]:
    """Sweep a cosine-*distance* grid; a pair is called "same person" when its
    cosine distance <= threshold (i.e. similarity >= 1 - threshold). Returns
    precision/recall/FAR/FRR per grid point — the empirical validation of the
    app's 0.4 / 0.35 defaults."""
    g = np.asarray(genuine, dtype=np.float64)
    im = np.asarray(impostor, dtype=np.float64)
    n_g, n_i = g.size, im.size

    points: list[SweepPoint] = []
    # np.arange can drift on the last step; build an inclusive grid explicitly.
    n_steps = int(round((stop - start) / step))
    grid = [round(start + k * step, 10) for k in range(n_steps + 1)]
    for d in grid:
        sim_t = 1.0 - d
        tp = int(np.sum(g >= sim_t))
        fn = n_g - tp
        fp = int(np.sum(im >= sim_t))
        tn = n_i - fp
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / n_g if n_g else 0.0
        far = fp / n_i if n_i else 0.0
        frr = fn / n_g if n_g else 0.0
        points.append(
            SweepPoint(
                distance=float(d),
                sim_threshold=float(sim_t),
                precision=precision,
                recall=recall,
                far=far,
                frr=frr,
                tp=tp,
                fp=fp,
                fn=fn,
                tn=tn,
            )
        )
    return points


def sweep_optimum(points: Sequence[SweepPoint], beta: float = 1.0) -> SweepPoint:
    """Return the sweep point maximizing F-beta (default F1) of recall/precision."""
    best = None
    best_f = -1.0
    b2 = beta * beta
    for p in points:
        denom = b2 * p.precision + p.recall
        f = (1 + b2) * p.precision * p.recall / denom if denom else 0.0
        if f > best_f:
            best_f, best = f, p
    return best


# ---------------------------------------------------------------------------
# detection recall (over dataset buckets)
# ---------------------------------------------------------------------------
def detection_recall(buckets: Iterable[str]) -> dict:
    """Detector recall = matched / (matched + detector_missed).

    ``unresolved`` faces (source image absent) are excluded from the
    denominator — they are a recovery gap, not a detector miss.
    """
    matched = missed = unresolved = 0
    for b in buckets:
        if b == MATCHED:
            matched += 1
        elif b == DETECTOR_MISSED:
            missed += 1
        elif b == UNRESOLVED:
            unresolved += 1
    denom = matched + missed
    return {
        "matched": matched,
        "detector_missed": missed,
        "unresolved": unresolved,
        "recall": (matched / denom) if denom else 0.0,
    }


def detection_recall_by_stratum(
    rows: Iterable,
    bucket_key: Callable,
    stratum_key: Callable,
) -> dict[str, dict]:
    """Per-stratum detection recall. ``bucket_key(row)`` -> bucket string,
    ``stratum_key(row)`` -> stratum label."""
    by_stratum: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        by_stratum[stratum_key(row)].append(bucket_key(row))
    return {s: detection_recall(bs) for s, bs in sorted(by_stratum.items())}
