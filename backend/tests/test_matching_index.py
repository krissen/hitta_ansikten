"""Equivalence, invalidation, and benchmark tests for the matching index.

The version-invalidated ``MatchingIndex`` replaces the per-call matrix
rebuilds in DetectionService's four matching helpers. These tests pin that the
refactor is behavior-preserving:

* ``NaiveMatcher`` reimplements the four helpers exactly as they looked at the
  fork point (rebuild every call, no index). It is the reference oracle.
* The equivalence tests run naive-vs-index over a synthetic DB (12+ people,
  multiple encodings each, some ignored, some hard negatives, plus off-backend
  and manual/None entries) for many probes and assert identical outputs.
* An invalidation test drives the real confirm path and asserts the next match
  sees the newly written person (the store version bump rebuilds the index).
* A benchmark compares per-face match cost naive-vs-index on a 100-person DB.
"""

import time
from collections import OrderedDict

import numpy as np
import pytest

from api.services.detection_service import DetectionService
from tests.conftest import InMemoryDBStore


class FakeBackend:
    """Deterministic Euclidean backend (matches test_detection_service)."""

    def __init__(self, backend_name="insightface"):
        self.backend_name = backend_name

    def compute_distances(self, matrix, encoding):
        matrix = np.asarray(matrix, dtype=float)
        encoding = np.asarray(encoding, dtype=float)
        return np.linalg.norm(matrix - encoding, axis=1)

    def get_model_info(self):
        return {"version": "test-v1", "model": "test-model"}


def _service(backend_name="insightface", config=None):
    svc = DetectionService.__new__(DetectionService)
    svc.config = config or {}
    svc.backend = FakeBackend(backend_name)
    svc.known_faces = {}
    svc.ignored_faces = []
    svc.hard_negatives = {}
    svc.processed_files = []
    svc.cache = OrderedDict()
    svc.encoding_cache = OrderedDict()
    svc.image_cache = OrderedDict()
    svc.image_cache_ttl = 1800
    svc.store = InMemoryDBStore(svc)
    svc._cache_db_version = svc.store.version
    return svc


# ---------------------------------------------------------------------------
# Reference (naive) implementations — copied verbatim from the pre-index
# helpers so any divergence in the index shows up as a test failure.
# ---------------------------------------------------------------------------

class NaiveMatcher:
    def __init__(self, backend):
        self.backend = backend

    def _lenient_rows(self, entries):
        rows = []
        for entry in entries:
            if isinstance(entry, dict):
                enc = entry.get("encoding")
                be = entry.get("backend", "dlib")
            else:
                enc = entry
                be = "dlib"
            if enc is not None and be == self.backend.backend_name:
                rows.append(enc)
        return rows

    def _strict_rows(self, entries):
        # Mirrors _match_encoding / _match_encoding_alternatives: an explicit
        # backend key equal to the active backend, and a 1-D encoding.
        rows = []
        for entry in entries:
            if isinstance(entry, dict) and entry.get("backend") == self.backend.backend_name:
                enc = entry.get("encoding")
                if enc is not None:
                    arr = np.asarray(enc)
                    if arr.ndim == 1:
                        rows.append(arr)
        return rows

    def _is_hard_negative(self, hardneg, name, encoding, threshold):
        negs = self._lenient_rows(hardneg.get(name, [])) if hardneg else []
        if not negs:
            return False
        d = self.backend.compute_distances(np.array(negs), encoding)
        return float(np.min(d)) < threshold

    def match_encoding(self, known, encoding, hardneg=None, hard_neg_thr=0.45):
        # STRICT candidate set (same as alternatives), so person_name and
        # match_alternatives[0] can never diverge.
        best_name = None
        best_distance = None
        for name, entries in known.items():
            if self._is_hard_negative(hardneg or {}, name, encoding, hard_neg_thr):
                continue
            person = self._strict_rows(entries)
            if person:
                distances = self.backend.compute_distances(np.array(person), encoding)
                md = float(np.min(distances))
                if best_distance is None or md < best_distance:
                    best_distance = md
                    best_name = name
        return best_name, best_distance

    def match_ignored(self, ignored, encoding):
        rows = []
        for entry in ignored:
            if isinstance(entry, dict):
                enc = entry.get("encoding")
                be = entry.get("backend", "dlib")
            else:
                enc = entry
                be = "dlib"
            if enc is not None and be == self.backend.backend_name:
                arr = np.asarray(enc)
                if arr.ndim == 1:
                    rows.append(arr)
        if not rows:
            return None, None
        m = np.vstack(rows)
        d = self.backend.compute_distances(m, encoding)
        return int(np.argmin(d)), float(np.min(d))

    def person_match_encodings(self, known, name):
        out = []
        for entry in known.get(name, []):
            if isinstance(entry, dict):
                enc = entry.get("encoding")
                be = entry.get("backend", "dlib")
            else:
                enc = entry
                be = "dlib"
            if enc is not None and be == self.backend.backend_name:
                out.append(enc)
        return out

    def alternatives(self, known, ignored, encoding, top_n=9,
                     hardneg=None, hard_neg_thr=0.45):
        all_matches = []
        for name, entries in known.items():
            if self._is_hard_negative(hardneg or {}, name, encoding, hard_neg_thr):
                continue
            rows = []
            for e in entries:
                if isinstance(e, dict) and e.get("backend") == self.backend.backend_name:
                    enc = e.get("encoding")
                    if enc is not None:
                        arr = np.asarray(enc)
                        if arr.ndim == 1:
                            rows.append(arr)
            if rows:
                d = self.backend.compute_distances(np.vstack(rows), encoding)
                md = float(np.min(d))
                conf = max(0, min(100, int((1.0 - md) * 100)))
                all_matches.append({"name": name, "distance": md,
                                    "confidence": conf, "is_ignored": False})
        _, ign = self.match_ignored(ignored, encoding)
        if ign is not None:
            conf = max(0, min(100, int((1.0 - ign) * 100)))
            all_matches.append({"name": "ign", "distance": ign,
                                "confidence": conf, "is_ignored": True})
        all_matches.sort(key=lambda x: x["distance"])
        return all_matches[:top_n]


# ---------------------------------------------------------------------------
# Synthetic databases
# ---------------------------------------------------------------------------

def _vec(rng, dim):
    return rng.standard_normal(dim).astype(float)


def _entry(vec, backend="insightface"):
    return {"encoding": np.asarray(vec, dtype=float), "backend": backend}


def _build_db(rng, n_people=12, dim=16, active="insightface"):
    """A varied DB: multiple encodings/person, off-backend, manual, ignored."""
    known = {}
    for p in range(n_people):
        entries = [_entry(_vec(rng, dim), active)
                   for _ in range(rng.integers(2, 6))]
        # Sprinkle an off-backend entry (must be filtered out by both helpers).
        if p % 3 == 0:
            entries.append(_entry(_vec(rng, dim), "dlib"))
        # Sprinkle a manual/None entry (no usable encoding).
        if p % 4 == 0:
            entries.append({"encoding": None, "backend": active, "is_manual": True})
        # Sprinkle a raw-array entry (treated as dlib by the lenient filter).
        if p % 5 == 0:
            entries.append(_vec(rng, dim))
        known[f"Person{p:02d}"] = entries
    ignored = [_entry(_vec(rng, dim), active) for _ in range(8)]
    ignored.append(_entry(_vec(rng, dim), "dlib"))  # off-backend, filtered
    hardneg = {"Person00": [_entry(_vec(rng, dim), active)]}
    return known, ignored, hardneg


@pytest.mark.parametrize("active", ["insightface", "dlib"])
def test_index_matches_naive_for_all_four_helpers(active):
    rng = np.random.default_rng(1234)
    known, ignored, hardneg = _build_db(rng, active=active)

    svc = _service(backend_name=active)
    svc.known_faces = known
    svc.ignored_faces = ignored
    svc.hard_negatives = hardneg
    svc.config = {"match_threshold": 0.54, "ignore_distance": 0.48,
                  "prefer_name_margin": 0.15}

    naive = NaiveMatcher(svc.backend)

    # Probes: 40 random vectors plus every stored encoding (exact hits).
    probes = [_vec(rng, 16) for _ in range(40)]
    for entries in known.values():
        for e in entries:
            enc = e.get("encoding") if isinstance(e, dict) else e
            if enc is not None:
                probes.append(np.asarray(enc, dtype=float))

    # Hard-negative threshold the service resolves for this config/backend
    # (FakeBackend has no distance_metric → euclidean default 0.45).
    hard_neg_thr = svc._hard_negative_threshold()

    for probe in probes:
        # 1. nearest-person (hard negatives skip a rejected person)
        assert svc._match_encoding(probe) == naive.match_encoding(
            known, probe, hardneg, hard_neg_thr
        )

        # 2. ignored (index + distance)
        assert svc._match_ignored(probe) == naive.match_ignored(ignored, probe)

        # 3. alternatives (full ordered list of dicts; hard negatives dropped)
        got = svc._match_encoding_alternatives(probe, top_n=9)
        exp = naive.alternatives(
            known, ignored, probe, top_n=9, hardneg=hardneg, hard_neg_thr=hard_neg_thr
        )
        assert got == exp

    # 4. person_match_encodings for every name (+ a missing one)
    for name in list(known.keys()) + ["Nonexistent"]:
        got_rows = svc._person_match_encodings(name)
        exp_rows = naive.person_match_encodings(known, name)
        assert len(got_rows) == len(exp_rows)
        for g, e in zip(got_rows, exp_rows):
            assert np.array_equal(np.asarray(g), np.asarray(e))


def test_mutation_invalidates_index_confirm_then_match():
    """A confirm writes a new encoding; the next match must see the new person.

    Exercises the version-bump → index-rebuild path through the real confirm
    helper (``_confirm_identity_nosave`` → ``store.mutate``).
    """
    rng = np.random.default_rng(7)
    svc = _service()
    svc.known_faces = {"Alice": [_entry(_vec(rng, 16))]}

    probe = _vec(rng, 16)
    # Before confirm, Zoe does not exist — nearest is Alice (or None).
    before_name, _ = svc._match_encoding(probe)
    assert before_name != "Zoe"

    # Confirm the probe itself as a brand-new person via the real write path.
    svc.encoding_cache["face_new"] = (probe, {"x": 0, "y": 0, "width": 1, "height": 1}, "hash", None)
    version_before = svc.store.version
    svc._confirm_identity_nosave("face_new", "Zoe", "/tmp/img.jpg")
    assert svc.store.version > version_before  # mutation bumped the version

    # The rebuilt index now includes Zoe; the probe is an exact hit (distance 0).
    after_name, after_dist = svc._match_encoding(probe)
    assert after_name == "Zoe"
    assert after_dist == pytest.approx(0.0)


def test_index_rebuilds_only_on_version_change(monkeypatch):
    """Repeated matches at a stable version rebuild the matrices exactly once."""
    rng = np.random.default_rng(3)
    svc = _service()
    svc.known_faces = {f"P{i}": [_entry(_vec(rng, 16))] for i in range(5)}

    idx = svc._get_matching_index()
    calls = {"n": 0}
    orig = idx._rebuild

    def counting_rebuild():
        calls["n"] += 1
        orig()

    monkeypatch.setattr(idx, "_rebuild", counting_rebuild)

    for _ in range(10):
        svc._match_encoding(_vec(rng, 16))
        svc._match_ignored(_vec(rng, 16))
    assert calls["n"] == 1  # built once, reused across every call

    # A mutation forces exactly one more rebuild.
    svc.store.mutate(lambda k, i, h, p: k.update({"New": [_entry(_vec(rng, 16))]}))
    svc._match_encoding(_vec(rng, 16))
    assert calls["n"] == 2


@pytest.mark.benchmark
def test_benchmark_index_vs_naive(capsys):
    """Per-face match cost: naive (rebuild every call) vs index (build once).

    Not a strict perf gate under load, but the index must not be slower; the
    numbers are printed (run with -s) for the PR body.
    """
    rng = np.random.default_rng(99)
    n_people, per_person, dim = 100, 5, 128
    known = {f"Person{p:03d}": [_entry(_vec(rng, dim)) for _ in range(per_person)]
             for p in range(n_people)}
    ignored = [_entry(_vec(rng, dim)) for _ in range(20)]

    svc = _service()
    svc.known_faces = known
    svc.ignored_faces = ignored
    naive = NaiveMatcher(svc.backend)

    probes = [_vec(rng, dim) for _ in range(200)]

    # Warm the index once (mirrors steady-state: index already built).
    svc._match_encoding(probes[0])

    # Mirror the real per-face path in _detect_and_match_faces: nearest-person +
    # ignored + top-N alternatives. (This microbenchmark excludes the per-call
    # store.read()/file-stat overhead the index also removes in production, so
    # it is a conservative lower bound on the real speedup.)
    t0 = time.perf_counter()
    for probe in probes:
        naive.match_encoding(known, probe)
        naive.match_ignored(ignored, probe)
        naive.alternatives(known, ignored, probe, top_n=9)
    naive_s = time.perf_counter() - t0

    t0 = time.perf_counter()
    for probe in probes:
        svc._match_encoding(probe)
        svc._match_ignored(probe)
        svc._match_encoding_alternatives(probe, top_n=9)
    index_s = time.perf_counter() - t0

    print(f"\n[benchmark] {n_people} people x {per_person} enc, dim={dim}, "
          f"{len(probes)} faces (match_encoding + match_ignored + alternatives):")
    print(f"  naive : {naive_s * 1000:8.2f} ms total  "
          f"({naive_s / len(probes) * 1e6:7.1f} us/face)")
    print(f"  index : {index_s * 1000:8.2f} ms total  "
          f"({index_s / len(probes) * 1e6:7.1f} us/face)")
    print(f"  speedup: {naive_s / index_s:.1f}x")

    assert index_s < naive_s
