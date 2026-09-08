"""Suggestion consistency: person_name is derived from match_alternatives.

DetectionService used to run two independent matching passes per face —
``_match_encoding`` (person_name) against the LENIENT candidate set and
``_match_encoding_alternatives`` against the STRICT set — so the name shown in
the image viewer could disagree with the name behind the accept keys. These
tests pin the single-pass invariant: for every name-suggesting face, the
suggested ``person_name`` equals the first non-ignored alternative, including
after the twin tie-break reorders the list.

The InsightFace model is never loaded: the service is built with ``__new__`` and
a fake backend (mirrors tests/test_detection_service.py and
tests/test_twin_disambiguation.py).
"""

from collections import OrderedDict

import numpy as np

import api.services.detection_service as det_mod
from api.services.detection_service import DetectionService
from tests.conftest import InMemoryDBStore


class FakeBackend:
    """Deterministic cosine backend over unit vectors (no model load).

    No ``detect_faces_scored`` attribute, so ``_detect_and_match_faces`` takes
    the plain ``detect_faces`` branch (det_score = None).
    """

    backend_name = "insightface"
    distance_metric = "cosine"
    det_size = (1280, 1280)

    def __init__(self, locations, encodings):
        self._locations = locations
        self._encodings = encodings

    def detect_faces(self, rgb, model="hog", upsample=0):
        return self._locations, self._encodings

    def compute_distances(self, matrix, encoding):
        matrix = np.asarray(matrix, dtype=float)
        encoding = np.asarray(encoding, dtype=float)
        return 1.0 - matrix @ encoding

    def get_model_info(self):
        return {"version": "test-v1", "model": "test-model"}


def _service(backend, config=None):
    svc = DetectionService.__new__(DetectionService)
    svc.config = config or {}
    svc.backend = backend
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


def _unit(seed, dim=16):
    v = np.random.RandomState(seed).randn(dim)
    return v / np.linalg.norm(v)


def _entry(vec):
    v = np.asarray(vec, dtype=float)
    return {"encoding": v / np.linalg.norm(v), "backend": "insightface"}


def _cluster(base, seeds, jitter=0.05):
    return [_entry(base + jitter * _unit(s)) for s in seeds]


# Location is (top, right, bottom, left) inside a 100x100 frame.
_LOCATION = (10, 40, 40, 10)
_RGB = np.zeros((100, 100, 3), dtype=np.uint8)


def _detect_one(svc, probe):
    """Run the real detect+match path for a single probe face; return the face."""
    backend = FakeBackend([_LOCATION], [np.asarray(probe, dtype=float)])
    svc.backend = backend
    faces, _meta = svc._detect_and_match_faces(_RGB, 4500, "hash", 1.0)
    assert len(faces) == 1
    return faces[0]


def test_person_name_equals_first_non_ignored_alternative():
    """For a name/uncertain_name case, person_name == alternatives[0].name."""
    svc = _service(FakeBackend([], []))
    real = _unit(0)
    svc.known_faces = {
        "Real": _cluster(real, range(1, 6)),
        "Other": _cluster(_unit(500), range(20, 25)),
    }
    face = _detect_one(svc, _entry(real + 0.02 * _unit(2))["encoding"])

    assert face["match_case"] in ("name", "uncertain_name")
    first_named = next(a for a in face["match_alternatives"] if not a["is_ignored"])
    assert face["person_name"] == first_named["name"]
    assert face["person_name"] == "Real"


def test_lenient_only_entries_never_become_person_name():
    """Entries strict matching drops (ndim != 1, or no explicit backend key)
    must not surface as person_name — the old lenient pass could pick a person
    the alternatives list never contained. Now both use the strict set, so a
    lenient-only candidate can neither win nor even appear."""
    svc = _service(FakeBackend([], []))
    real = _unit(0)
    # "Ghost2d": a backend-tagged but 2-D encoding sitting right on the probe —
    # lenient would have kept it; strict drops it (ndim != 1).
    ghost2d = np.vstack([real, real])
    # "SpectreNoKey": a 1-D encoding on the probe but with no explicit backend
    # key — lenient defaults it to dlib (dropped for insightface anyway), and
    # strict also drops it. Either way it must never be person_name.
    svc.known_faces = {
        "Ghost2d": [{"encoding": ghost2d, "backend": "insightface"}],
        "SpectreNoKey": [{"encoding": real}],
        "Real": _cluster(real, range(1, 6)),
    }
    face = _detect_one(svc, real)

    names = [a["name"] for a in face["match_alternatives"]]
    assert "Ghost2d" not in names
    assert "SpectreNoKey" not in names
    assert face["match_case"] in ("name", "uncertain_name")
    assert face["person_name"] == "Real"
    assert face["person_name"] == face["match_alternatives"][0]["name"]


def test_twin_disambiguation_keeps_person_name_and_alternatives_aligned(tmp_path, monkeypatch):
    """After the twin tie-break reorders the alternatives, person_name still
    equals alternatives[0] (both become the disambiguated choice).

    Wilmer & Maximilian Bjorneholt are the canonical confirmed-distinct twins.
    """
    import api.services.management_service as mgmt_mod

    pairs_path = tmp_path / "distinct_pairs.json"
    pairs_path.write_text('[["Maximilian", "Wilmer"]]', encoding="utf-8")
    monkeypatch.setattr(mgmt_mod, "DISTINCT_PAIRS_PATH", pairs_path)
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", pairs_path)

    svc = _service(
        FakeBackend([], []),
        config={"twin_margin": 0.1, "twin_knn_k": 5},
    )
    a = _unit(0)
    b = a + 0.3 * _unit(99)
    svc.known_faces = {
        "Wilmer": _cluster(a, range(1, 6)),
        "Maximilian": _cluster(b, range(10, 15)),
    }
    # Probe is really Maximilian but a single Wilmer crop may be the nearest —
    # exactly the near-equidistant case the k-NN tie-break exists to fix.
    probe = _entry(b + 0.04 * _unit(11))["encoding"]
    face = _detect_one(svc, probe)

    assert face["disambiguated"] is not None
    chosen = face["disambiguated"]["chosen"]
    assert face["match_case"] in ("name", "uncertain_name")
    assert face["person_name"] == chosen
    assert face["match_alternatives"][0]["name"] == chosen
    assert face["person_name"] == face["match_alternatives"][0]["name"]
