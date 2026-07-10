"""Tests for the benchmark metric layer.

All fixtures are hand-constructed synthetic embeddings — three identities in
(near-)orthogonal subspaces plus a known impostor and a constructed twin
near-pair. Nothing here imports insightface or touches the real DB / photos.
"""

from __future__ import annotations

import numpy as np
import pytest

from benchmarks import metrics as M


# ---------------------------------------------------------------------------
# synthetic embedding builders
# ---------------------------------------------------------------------------
def _orthogonal_identities(dim: int = 8, per: int = 3, jitter: float = 0.02, seed: int = 0):
    """Three identities living on orthogonal axes with small within-id jitter.

    Returns (embeddings, labels). Same-identity vectors are near-identical;
    cross-identity vectors are near-orthogonal (cosine ~ 0).
    """
    rng = np.random.default_rng(seed)
    axes = {"A": 0, "B": 1, "C": 2}
    E, labels = [], []
    for name, ax in axes.items():
        base = np.zeros(dim)
        base[ax] = 1.0
        for _ in range(per):
            v = base + jitter * rng.standard_normal(dim)
            E.append(v / np.linalg.norm(v))
            labels.append(name)
    return np.asarray(E), labels


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def test_unit_rows_normalizes():
    E = M.unit_rows(np.array([[3.0, 4.0], [0.0, 0.0]]))
    assert np.isclose(np.linalg.norm(E[0]), 1.0)
    assert np.allclose(E[1], 0.0)  # zero row untouched


def test_cosine_sim_matrix_orthogonal():
    E, _ = _orthogonal_identities()
    S = M.cosine_sim_matrix(E, E)
    assert np.allclose(np.diag(S), 1.0, atol=1e-6)
    # A vs B blocks near zero
    assert abs(S[0, 3]) < 0.2


# ---------------------------------------------------------------------------
# closed-set identification
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("mode", [M.CENTROID, M.MAX_SIM])
def test_closed_set_perfect_on_orthogonal(mode):
    E, labels = _orthogonal_identities(per=4)
    res = M.closed_set_identification(E, labels, mode=mode, ranks=(1, 5))
    assert res.n_probes == 12  # all faces are probes (each id has >=2)
    assert res.rank1 == pytest.approx(1.0)
    assert res.rank5 == pytest.approx(1.0)


def test_closed_set_skips_singletons():
    E, labels = _orthogonal_identities(per=2)
    # append a singleton identity that must be skipped as a probe
    lone = np.zeros(E.shape[1])
    lone[7] = 1.0
    E2 = np.vstack([E, lone])
    labels2 = labels + ["Solo"]
    res = M.closed_set_identification(E2, labels2, mode=M.MAX_SIM)
    assert res.n_probes == 6  # the 3 orthogonal ids x2; Solo skipped
    assert "Solo" not in {labels2[i] for i in res.probe_indices}


def test_closed_set_rank1_flags_align():
    E, labels = _orthogonal_identities(per=3)
    res = M.closed_set_identification(E, labels, mode=M.CENTROID, ranks=(1,))
    assert len(res.rank_flags[1]) == res.n_probes
    assert all(res.rank_flags[1])


# ---------------------------------------------------------------------------
# open-set identification
# ---------------------------------------------------------------------------
def test_open_set_rejects_unknown():
    dim = 8
    # gallery: identities A, B
    gA = np.eye(dim)[0]
    gB = np.eye(dim)[1]
    gallery = np.array([gA, gA, gB, gB])
    g_labels = ["A", "A", "B", "B"]
    # probes: a genuine A, a genuine B, and an unknown (orthogonal axis)
    pA = gA + 0.01 * np.ones(dim)
    pA = pA / np.linalg.norm(pA)
    pB = gB + 0.01 * np.ones(dim)
    pB = pB / np.linalg.norm(pB)
    unk = np.eye(dim)[5]
    probes = np.array([pA, pB, unk])
    p_labels = ["A", "B", "__ignored__"]

    res = M.open_set_identification(gallery, g_labels, probes, p_labels)
    assert res.n_known == 2
    assert res.n_unknown == 1
    # At a threshold above the unknown's best gallery sim (~0) but below the
    # genuine sims (~1), DIR should be 1.0 and FAR 0.0.
    dir_at_low_far = res.dir_at_far[0.01]
    assert dir_at_low_far == pytest.approx(1.0)


def test_open_set_curve_monotone_in_threshold():
    E, labels = _orthogonal_identities(per=3)
    # split: gallery = first 2 of each, probes = the 3rd + an unknown
    res = M.open_set_identification(
        E[:6], labels[:6], E[6:], labels[6:] + [], thresholds=np.linspace(-1, 1, 21)
    )
    far = np.asarray(res.far)
    # FAR is non-increasing as the acceptance threshold rises
    assert np.all(np.diff(far) <= 1e-9)


# ---------------------------------------------------------------------------
# verification pairs + ROC
# ---------------------------------------------------------------------------
def test_build_pairs_counts_and_separation():
    E, labels = _orthogonal_identities(per=3)
    pairs = M.build_pairs(E, labels, twin_pair=None)
    # 3 identities x C(3,2)=3 genuine each = 9 genuine pairs
    assert pairs.genuine.size == 9
    # genuine clearly separated from impostors
    assert pairs.genuine.min() > pairs.impostor_all.max()


def test_roc_auc_perfect_and_chance():
    genuine = np.array([0.9, 0.95, 0.99])
    impostor = np.array([0.0, 0.1, 0.2])
    assert M.roc_auc(genuine, impostor) == pytest.approx(1.0)
    # identical distributions -> AUC 0.5 (all ties)
    same = np.array([0.5, 0.5, 0.5])
    assert M.roc_auc(same, same) == pytest.approx(0.5)


def test_verification_roc_monotonicity_and_tar():
    genuine = np.array([0.7, 0.8, 0.9, 0.95])
    impostor = np.array([-0.1, 0.0, 0.1, 0.2, 0.3])
    roc = M.verification_roc(genuine, impostor, far_targets=(1e-2,))
    fpr = np.asarray(roc.fpr)
    tpr = np.asarray(roc.tpr)
    # ROC is traced from strict->lenient thresholds: both non-decreasing
    assert np.all(np.diff(fpr) >= -1e-9)
    assert np.all(np.diff(tpr) >= -1e-9)
    assert roc.auc == pytest.approx(1.0)
    # perfectly separable -> TAR 1.0 even at FAR 0
    assert roc.tar_at_far[1e-2] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# twin confusion
# ---------------------------------------------------------------------------
def test_twin_confusion_on_constructed_near_pair():
    dim = 8
    # Twins live close together on axis 0 (small angular gap); a third
    # identity C sits on axis 3, far from both.
    t1 = np.eye(dim)[0]
    t2 = np.zeros(dim)
    t2[0], t2[1] = np.cos(0.15), np.sin(0.15)
    c = np.eye(dim)[3]
    E = np.array([t1, t1 * 0.99 + 0.01 * t2, t2, t2 * 0.99 + 0.01 * t1, c, c])
    E = M.unit_rows(E)
    labels = ["Max", "Max", "Vil", "Vil", "C", "C"]
    res = M.twin_confusion_rate(E, labels, "Max", "Vil")
    # every twin probe's nearest wrong-person is the co-twin (C is far away)
    assert res.n_probes == 4
    assert res.rate == pytest.approx(1.0)


def test_twin_confusion_zero_when_far():
    dim = 8
    a = np.eye(dim)[0]
    b = np.eye(dim)[1]
    # a decoy identity D sits *between* the twins so it, not the co-twin,
    # becomes the nearest wrong-person.
    d = np.zeros(dim)
    d[0], d[1] = 0.8, 0.8
    E = M.unit_rows(np.array([a, a, b, b, d, d]))
    labels = ["Max", "Max", "Vil", "Vil", "D", "D"]
    res = M.twin_confusion_rate(E, labels, "Max", "Vil")
    assert res.rate == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# threshold sweep
# ---------------------------------------------------------------------------
def test_threshold_sweep_endpoints_and_grid():
    genuine = np.array([0.7, 0.8, 0.9])
    impostor = np.array([0.0, 0.1, 0.2])
    pts = M.threshold_sweep(genuine, impostor, start=0.20, stop=0.80, step=0.01)
    assert len(pts) == 61  # inclusive grid 0.20..0.80
    assert pts[0].distance == pytest.approx(0.20)
    assert pts[-1].distance == pytest.approx(0.80)
    # At distance 0.20 (sim_threshold 0.80): only genuine >=0.8 accepted (2),
    # no impostors -> perfect precision, FAR 0.
    p0 = pts[0]
    assert p0.tp == 2 and p0.fp == 0
    assert p0.precision == pytest.approx(1.0)
    assert p0.far == pytest.approx(0.0)
    # Recall = TP / n_genuine
    assert p0.recall == pytest.approx(2 / 3)


def test_sweep_confusion_counts_consistent():
    genuine = np.array([0.5, 0.6])
    impostor = np.array([0.3, 0.4, 0.5])
    for p in M.threshold_sweep(genuine, impostor):
        assert p.tp + p.fn == genuine.size
        assert p.fp + p.tn == impostor.size
        assert p.frr == pytest.approx(1.0 - p.recall)


def test_sweep_optimum_picks_best_f1():
    genuine = np.array([0.7, 0.8, 0.9])
    impostor = np.array([-0.5, -0.4, 0.0])
    pts = M.threshold_sweep(genuine, impostor)
    best = M.sweep_optimum(pts)
    assert best.precision == pytest.approx(1.0)
    assert best.recall == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# detection recall
# ---------------------------------------------------------------------------
def test_detection_recall_overall():
    buckets = [M.MATCHED, M.MATCHED, M.DETECTOR_MISSED, M.UNRESOLVED]
    r = M.detection_recall(buckets)
    assert r["matched"] == 2
    assert r["detector_missed"] == 1
    assert r["unresolved"] == 1
    assert r["recall"] == pytest.approx(2 / 3)  # unresolved excluded


def test_detection_recall_by_stratum():
    rows = [
        {"bucket": M.MATCHED, "q": "Q1"},
        {"bucket": M.DETECTOR_MISSED, "q": "Q1"},
        {"bucket": M.MATCHED, "q": "Q2"},
        {"bucket": M.UNRESOLVED, "q": "Q2"},
    ]
    out = M.detection_recall_by_stratum(
        rows, lambda r: r["bucket"], lambda r: r["q"]
    )
    assert out["Q1"]["recall"] == pytest.approx(0.5)
    assert out["Q2"]["recall"] == pytest.approx(1.0)
