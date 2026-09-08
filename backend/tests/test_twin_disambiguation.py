"""Tests for the k-NN twin recognition tie-break in DetectionService."""

from unittest.mock import MagicMock

import numpy as np

from api.services.detection_service import DetectionService
from tests.conftest import InMemoryDBStore


def _service():
    svc = DetectionService.__new__(DetectionService)
    svc.known_faces = {}
    svc.ignored_faces = []
    svc.hard_negatives = {}
    svc.processed_files = []
    be = MagicMock()
    be.backend_name = "insightface"
    # Cosine distance over unit vectors (matches InsightFaceBackend).
    be.compute_distances = lambda encs, t: 1.0 - (np.asarray(encs) @ np.asarray(t))
    svc.backend = be
    # _person_match_encodings / matching now route through the FaceDBStore;
    # back it with the service's own live collections (no disk access).
    svc.store = InMemoryDBStore(svc)
    return svc


def _unit(seed, dim=16):
    v = np.random.RandomState(seed).randn(dim)
    return v / np.linalg.norm(v)


def _entry(vec):
    v = np.asarray(vec, dtype=float)
    return {"encoding": v / np.linalg.norm(v), "backend": "insightface"}


def _cluster(base, seeds, jitter=0.05):
    return [_entry(base + jitter * _unit(s)) for s in seeds]


def test_knn_picks_the_nearer_twin():
    svc = _service()
    a = _unit(0)
    b = a + 0.3 * _unit(99)
    svc.known_faces = {
        "Wilmer": _cluster(a, range(1, 6)),
        "Maximilian": _cluster(b, range(10, 15)),
    }
    probe_a = np.asarray(_entry(a + 0.05 * _unit(2))["encoding"])
    probe_b = np.asarray(_entry(b + 0.05 * _unit(11))["encoding"])

    assert svc._disambiguate_distinct_pair(probe_a, "Wilmer", "Maximilian", 5) == "Wilmer"
    assert svc._disambiguate_distinct_pair(probe_b, "Wilmer", "Maximilian", 5) == "Maximilian"


def test_knn_vote_beats_a_single_noisy_nearest_crop():
    # Wilmer has one outlier crop that sits nearest the probe, but the probe is
    # really Maximilian — a k-NN vote should still pick Maximilian, where a plain
    # 1-NN would be fooled by the single outlier.
    svc = _service()
    a = _unit(0)
    b = a + 0.4 * _unit(99)
    probe = np.asarray(_entry(b + 0.02 * _unit(3))["encoding"])
    wilmer = _cluster(a, range(1, 6))
    wilmer.append(_entry(probe + 0.01 * _unit(7)))  # one crop very close to the probe
    svc.known_faces = {"Wilmer": wilmer, "Maximilian": _cluster(b, range(10, 16))}

    assert svc._disambiguate_distinct_pair(probe, "Wilmer", "Maximilian", 5) == "Maximilian"


def test_returns_none_when_a_side_has_no_encodings():
    svc = _service()
    svc.known_faces = {
        "Wilmer": _cluster(_unit(0), range(1, 4)),
        "Maximilian": [{"encoding": None, "is_manual": True, "backend": "insightface"}],
    }
    probe = np.asarray(_entry(_unit(0))["encoding"])
    assert svc._disambiguate_distinct_pair(probe, "Wilmer", "Maximilian", 5) is None


def test_person_match_encodings_filters_backend_and_manual():
    svc = _service()
    svc.known_faces = {
        "X": [
            _entry(_unit(1)),
            {"encoding": None, "is_manual": True, "backend": "insightface"},
            {"encoding": _unit(2), "backend": "dlib"},
        ]
    }
    assert len(svc._person_match_encodings("X")) == 1
    assert svc._person_match_encodings("missing") == []


def _alt(name, distance):
    return {
        "name": name,
        "distance": distance,
        "confidence": int((1 - distance) * 100),
        "is_ignored": False,
    }


def _twin_service():
    svc = _service()
    a = _unit(0)
    b = a + 0.3 * _unit(99)
    svc.known_faces = {
        "Wilmer": _cluster(a, range(1, 6)),
        "Maximilian": _cluster(b, range(10, 15)),
    }
    svc.config = {"twin_margin": 0.1, "twin_knn_k": 5}
    return svc, a, b


def test_maybe_disambiguate_overrides_and_reorders():
    # The probe is really Maximilian but top1 (nearest single crop) is Wilmer.
    # The override must choose Maximilian AND move it to the front of the
    # alternatives so the "recommended" chip / `1` key agree (issue-001).
    svc, a, b = _twin_service()
    probe = np.asarray(_entry(b + 0.04 * _unit(11))["encoding"])
    alts = [_alt("Wilmer", 0.20), _alt("Maximilian", 0.24), _alt("Other", 0.50)]
    out = svc._maybe_disambiguate_twins(probe, alts, "name", {("Maximilian", "Wilmer")})
    assert out is not None
    chosen, chosen_distance, reordered, info = out
    assert chosen == "Maximilian"
    assert reordered[0]["name"] == "Maximilian"  # recommended chip now agrees
    assert chosen_distance == 0.24
    assert [a_["name"] for a_ in reordered] == ["Maximilian", "Wilmer", "Other"]
    assert info["chosen"] == "Maximilian" and info["between"] == ["Wilmer", "Maximilian"]


def test_maybe_disambiguate_skips_unregistered_or_wide_gap():
    svc, a, b = _twin_service()
    probe = np.asarray(_entry(a + 0.04 * _unit(2))["encoding"])
    near = [_alt("Wilmer", 0.20), _alt("Maximilian", 0.24)]
    # Not in registry → no override.
    assert svc._maybe_disambiguate_twins(probe, near, "name", set()) is None
    # Registered but gap exceeds twin_margin (0.1) → no override.
    wide = [_alt("Wilmer", 0.20), _alt("Maximilian", 0.40)]
    assert svc._maybe_disambiguate_twins(probe, wide, "name", {("Maximilian", "Wilmer")}) is None
    # Wrong match_case → no override.
    assert svc._maybe_disambiguate_twins(probe, near, "ign", {("Maximilian", "Wilmer")}) is None
    # An ignored top candidate → no override.
    ign = [{**_alt("Wilmer", 0.20), "is_ignored": True}, _alt("Maximilian", 0.24)]
    assert svc._maybe_disambiguate_twins(probe, ign, "name", {("Maximilian", "Wilmer")}) is None


def test_detected_face_model_carries_disambiguated():
    # The route model must pass the field through to clients (else the feature is
    # silently dropped before the frontend can render it).
    from api.routes.detection import BoundingBox, DetectedFace

    face = DetectedFace(
        face_id="x",
        bounding_box=BoundingBox(x=0, y=0, width=1, height=1),
        confidence=0.5,
        disambiguated={"between": ["A", "B"], "chosen": "A", "method": "knn", "k": 3},
    )
    assert face.model_dump()["disambiguated"]["chosen"] == "A"


def test_distinct_pairs_version_changes_with_registry(tmp_path, monkeypatch):
    import api.services.detection_service as d

    monkeypatch.setattr(d, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = _service()
    assert svc._distinct_pairs_version() == 0  # absent → 0
    (tmp_path / "distinct_pairs.json").write_text("[]")
    assert svc._distinct_pairs_version() != 0  # present → mtime-based version


def test_cached_detection_meta_uses_composite_key(tmp_path, monkeypatch):
    # mark_review_complete reads detection metadata via the SAME composite key the
    # detect cache writes under — not the bare file hash (the issue-002 regression,
    # which silently logged time_seconds=0 / default scale).
    import api.services.detection_service as d

    monkeypatch.setattr(d, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = _service()
    svc.cache = {}
    h = "abc123"
    svc.cache[svc._detection_cache_key(h)] = {
        "detection_meta": {"scale_label": "mid", "scale_px": 4500},
        "processing_time_ms": 123.0,
    }
    assert h not in svc.cache  # nothing stored under the bare hash
    meta, t = svc._cached_detection_meta(h)
    assert meta["scale_label"] == "mid" and meta["scale_px"] == 4500 and t == 123.0
    assert svc._cached_detection_meta(None) == ({}, 0)
    assert svc._cached_detection_meta("missing") == ({}, 0)
