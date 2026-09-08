"""Tests for the benchmark report/run glue (strata, rendering, hardness join).

Uses synthetic ``EmbeddedFace`` rows and fabricated attempt logs — no
insightface, no real DB, no matplotlib rendering to screen.
"""

from __future__ import annotations

import json

import numpy as np

from benchmarks import metrics as M
from benchmarks import report as R
from benchmarks import run as RUN
from benchmarks.embeddings import EmbeddedFace


def _face(fid, ident, *, area=1000, blur=100.0, manual=False, det=0.9):
    v = np.zeros(4)
    v[hash(ident) % 4] = 1.0
    return EmbeddedFace(
        face_id=fid,
        identity=ident,
        image_hash="h" + fid,
        embedding=v,
        is_manual=manual,
        det_score=det,
        bbox_area=area,
        blur=blur,
        path="/x/" + fid + ".jpg",
    )


def test_assign_face_strata_quartiles_and_siblings():
    faces = [
        _face("1", "Anna Berg", area=100, blur=10.0),
        _face("2", "Bo Berg", area=500, blur=50.0),
        _face("3", "Cara Ek", area=900, blur=90.0),
        _face("4", "Cara Ek", area=1500, blur=200.0),
    ]
    strata = R.assign_face_strata(faces, twin_pair=["Anna Berg", "Bo Berg"])
    # Berg is a shared surname (Anna + Bo) -> sibling group; Ek is not.
    assert strata[0]["sibling_surname"] == "Berg"
    assert strata[2]["sibling_surname"] == "(none)"
    # twin membership
    assert strata[0]["twin"] == "twin"
    assert strata[2]["twin"] == "(non-twin)"
    # quartile labels populated
    assert strata[0]["bbox_quartile"].startswith("Q1")
    assert strata[0]["blur_quartile"].startswith("Q1")


def test_rank1_by_stratum_aggregates():
    # 4 probes, indices 0..3; flags T,T,F,T on a 2-bucket dimension
    res = M.ClosedSetResult(
        mode="max_sim",
        n_probes=4,
        ranks=(1,),
        rank_rates={1: 0.75},
        probe_indices=[0, 1, 2, 3],
        rank_flags={1: [True, True, False, True]},
    )
    strata = [
        {"is_manual": "detected"},
        {"is_manual": "detected"},
        {"is_manual": "manual"},
        {"is_manual": "manual"},
    ]
    out = R.rank1_by_stratum(res, strata, dims=("is_manual",))
    assert out["is_manual"]["detected"]["rate"] == 1.0
    assert out["is_manual"]["manual"]["rate"] == 0.5
    assert out["is_manual"]["manual"]["n"] == 2


def test_hardness_loader(tmp_path):
    p = tmp_path / "attempt_stats.jsonl"
    lines = [
        {"filename": "/pics/a.NEF", "attempts": [{"i": 0}]},
        {"filename": "/pics/b.NEF", "attempts": [{"i": 0}, {"i": 1}]},
        {"garbage": True},
    ]
    p.write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    h = RUN.load_attempt_hardness(p)
    assert h["a.NEF"] == 1
    assert h["b.NEF"] == 2
    assert RUN._hardness_bucket(h["a.NEF"]) == "easy_1_attempt"
    assert RUN._hardness_bucket(h["b.NEF"]) == "hard_multi_attempt"
    assert RUN._hardness_bucket(None) == "(unknown)"


def test_openset_split_disjoint_and_labelled():
    faces = []
    for ident in ("A", "B", "C", "D"):
        for k in range(3):
            faces.append(_face(f"{ident}{k}", ident))
    rng = np.random.default_rng(0)
    gE, gL, pE, pL = RUN.build_openset_split(faces, rng, holdout_frac=0.5)
    # every probe label is either a known gallery label or the sentinel
    known = set(gL)
    for lab in pL:
        assert lab == "__unknown__" or lab in known
    # gallery + probe counts add up to all faces
    assert len(gL) + len(pL) == len(faces)


def test_render_markdown_smoke():
    E, labels = _tiny_embeddings()
    cc = M.closed_set_identification(E, labels, mode=M.CENTROID)
    cm = M.closed_set_identification(E, labels, mode=M.MAX_SIM)
    pairs = M.build_pairs(E, labels)
    result = R.ModelResult(
        model_name="fake",
        n_faces=len(labels),
        n_identities=len(set(labels)),
        closed_centroid=cc,
        closed_maxsim=cm,
        roc={"all-comers": M.verification_roc(pairs.genuine, pairs.impostor_all)},
        sweep=M.threshold_sweep(pairs.genuine, pairs.impostor_all),
        sweep_opt=M.sweep_optimum(M.threshold_sweep(pairs.genuine, pairs.impostor_all)),
        twin=None,
        openset=None,
        det_recall_overall={"matched": 6, "detector_missed": 1, "unresolved": 0, "recall": 6 / 7},
        det_recall_by={},
        rank1_by_stratum={},
        timings={"embeddings": 1.2},
    )
    md = R.render_markdown(
        [result], {"generated": "now", "models": "fake", "seed": 1, "partial": True}
    )
    assert "metrics report" in md
    assert "PARTIAL DATA" in md
    assert "Threshold sweep" in md
    assert "match_threshold **0.45**" in md  # app default marked


def _tiny_embeddings():
    dim = 6
    E, labels = [], []
    for ax, name in ((0, "A"), (1, "B"), (2, "C")):
        base = np.eye(dim)[ax]
        for _ in range(2):
            E.append(base + 0.01)
            labels.append(name)
    return M.unit_rows(np.asarray(E)), labels


def test_write_csv_roundtrip(tmp_path):
    faces = [_face("1", "A"), _face("2", "A"), _face("3", "B")]
    strata = R.assign_face_strata(faces)
    rank1 = {"centroid": {0: True, 1: False}, "max_sim": {0: True}}
    out = R.write_csv(tmp_path / "report.csv", {"m": faces}, {"m": strata}, {"m": rank1})
    text = out.read_text().splitlines()
    assert text[0].startswith("model,face_id,identity")
    assert len(text) == 4  # header + 3 faces
    assert "rank1_centroid" in text[0]
