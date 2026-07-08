"""Tests for hard-negative filtering in the API/GUI matching path.

The CLI's ``core.matching.best_matches`` already skips a person when the probe
is closer than ``hard_negative_distance`` to one of that person's hard
negatives (the encodings the user explicitly rejected as *not* being them). The
API path (``DetectionService._match_encoding`` /
``_match_encoding_alternatives``, fed by ``MatchingIndex``) used to ignore hard
negatives entirely, so the GUI kept re-suggesting exactly the identities the
user had rejected. These tests pin the fix:

* a hard negative blocks the person for a face like the rejected one, while a
  genuine face of that person (far from the negative) still matches;
* people without hard negatives are unaffected;
* a hard negative may drop a twin from the candidates before the twin k-NN
  tie-break runs — intended, explicit rejection beats the heuristic;
* adding a hard negative bumps the store version so ``MatchingIndex`` rebuilds
  and the new negative is respected without a restart.
"""

from unittest.mock import MagicMock

import numpy as np

from api.services.detection_service import DetectionService
from tests.conftest import InMemoryDBStore

# Manual thresholds so the test geometry is explicit and backend-independent:
# a face within 0.5 cosine distance matches; a face within 0.2 of a hard
# negative blocks that person.
_CONFIG = {
    "threshold_mode": "manual",
    "backend_thresholds": {
        "insightface": {
            "match_threshold": 0.5,
            "ignore_distance": 0.4,
            "hard_negative_distance": 0.2,
        }
    },
    "twin_margin": 0.1,
    "twin_knn_k": 5,
}


def _service(config=None):
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
    svc.store = InMemoryDBStore(svc)
    svc.config = config if config is not None else dict(_CONFIG)
    return svc


def _unit(seed, dim=16):
    v = np.random.RandomState(seed).randn(dim)
    return v / np.linalg.norm(v)


def _entry(vec):
    v = np.asarray(vec, dtype=float)
    return {"encoding": v / np.linalg.norm(v), "backend": "insightface"}


def _cluster(base, seeds, jitter=0.02):
    return [_entry(base + jitter * _unit(s)) for s in seeds]


def _at_cos_distance(base, ortho_seed, dist):
    """Unit vector at cosine distance ``dist`` from unit vector ``base``."""
    base = np.asarray(base, dtype=float)
    w = _unit(ortho_seed, len(base))
    w = w - (w @ base) * base           # Gram-Schmidt: make w orthogonal to base
    w = w / np.linalg.norm(w)
    dot = 1.0 - dist
    v = dot * base + np.sqrt(max(0.0, 1.0 - dot ** 2)) * w
    return v / np.linalg.norm(v)


def test_hard_negative_blocks_a_rejected_lookalike():
    """A face like the rejected one must NOT match; a genuine face still does."""
    svc = _service()
    a = _unit(0)
    svc.known_faces = {"Anna": _cluster(a, range(1, 6))}

    # A look-alike face at cosine distance 0.35 from Anna: within match_threshold
    # (0.5) so it WOULD be suggested as Anna — but the user rejected it.
    lookalike = _at_cos_distance(a, 42, 0.35)
    probe = np.asarray(_entry(lookalike)["encoding"])

    # Without the hard negative, the look-alike matches Anna.
    name, dist = svc._match_encoding(probe)
    assert name == "Anna"
    assert dist < 0.5

    # Register the rejection as a hard negative.
    svc.hard_negatives = {"Anna": [_entry(lookalike)]}
    svc.store.mutate(lambda k, i, h, p: None, touches={"hardneg"})

    # Now the look-alike is blocked (Anna is the only person → no match).
    assert svc._match_encoding(probe) == (None, None)
    # And it is not offered as a candidate either.
    alts = svc._match_encoding_alternatives(probe, top_n=9)
    assert all(a_["name"] != "Anna" for a_ in alts)

    # A genuine Anna face (far from the negative) still matches Anna.
    genuine = np.asarray(_entry(a + 0.02 * _unit(3))["encoding"])
    name2, _ = svc._match_encoding(genuine)
    assert name2 == "Anna"
    assert any(a_["name"] == "Anna" for a_ in svc._match_encoding_alternatives(genuine))


def test_people_without_hard_negatives_are_unaffected():
    """A hard negative on one person must not perturb matching for others."""
    svc = _service()
    a = _unit(0)
    b = _unit(200)
    svc.known_faces = {
        "Anna": _cluster(a, range(1, 6)),
        "Bengt": _cluster(b, range(20, 26)),
    }
    # Anna has a hard negative near a look-alike; Bengt has none.
    lookalike = _at_cos_distance(a, 42, 0.35)
    svc.hard_negatives = {"Anna": [_entry(lookalike)]}

    # A genuine Bengt face matches Bengt exactly as before.
    bengt_probe = np.asarray(_entry(b + 0.02 * _unit(21))["encoding"])
    assert svc._match_encoding(bengt_probe)[0] == "Bengt"

    # The rejected look-alike is blocked for Anna but Bengt remains a candidate;
    # the nearest non-blocked person wins instead of Anna.
    probe = np.asarray(_entry(lookalike)["encoding"])
    name, _ = svc._match_encoding(probe)
    assert name != "Anna"


def test_hard_negative_removes_a_twin_before_the_knn_tiebreak():
    """A hard negative may drop a twin from the candidates, so the twin
    tie-break never runs — intended, explicit rejection beats the heuristic."""
    svc = _service()
    wil = _unit(0)
    ma = wil + 0.3 * _unit(99)
    svc.known_faces = {
        "Wilmer": _cluster(wil, range(1, 6)),
        "Maximilian": _cluster(ma, range(10, 15)),
    }
    # Probe sits nearest Wilmer's cluster (Wilmer would be top1) but the user
    # has rejected Wilmer for faces like this.
    probe = np.asarray(_entry(wil + 0.03 * _unit(2))["encoding"])
    svc.hard_negatives = {"Wilmer": [_entry(wil + 0.03 * _unit(2))]}

    alts = svc._match_encoding_alternatives(probe, top_n=9)
    names = [a_["name"] for a_ in alts]
    # Wilmer is removed from the candidate list entirely.
    assert "Wilmer" not in names
    assert names and names[0] == "Maximilian"

    # With Wilmer gone the pair is no longer both present, so the twin override
    # does not fire — Maximilian stands as the suggestion.
    out = svc._maybe_disambiguate_twins(
        probe, alts, "name", {("Maximilian", "Wilmer")}
    )
    assert out is None


def test_hardneg_mutation_rebuilds_index_without_restart():
    """Adding a hard negative bumps the store version so MatchingIndex rebuilds
    and the new negative is respected on the very next match."""
    svc = _service()
    a = _unit(0)
    svc.known_faces = {"Anna": _cluster(a, range(1, 6))}
    lookalike = _at_cos_distance(a, 42, 0.35)
    probe = np.asarray(_entry(lookalike)["encoding"])

    # Before: the look-alike matches Anna.
    assert svc._match_encoding(probe)[0] == "Anna"

    version_before = svc.store.version
    svc.hard_negatives.setdefault("Anna", []).append(_entry(lookalike))
    svc.store.mutate(lambda k, i, h, p: None, touches={"hardneg"})
    assert svc.store.version > version_before  # mutation bumped the version

    # After: the rebuilt index applies the negative — no restart needed.
    assert svc._match_encoding(probe) == (None, None)
