"""Characterization tests for DetectionService.

These pin CURRENT behavior of the seams an upcoming refactor will touch
(the service will be moved onto a unified FaceDBStore):

  * match-status decision logic (`_determine_match_case`)
  * single-nearest matching against known faces (`_match_encoding`)
  * detection-cache keying (file hash + distinct-pairs registry version)
  * what `reload_database` clears
  * the confirm-identity mutation path (known_faces + hard_negatives)
  * debounced save coalescing

The InsightFace model is never loaded: the service is built with
``__new__`` and a fake backend (mirrors tests/test_detection_manual_confirm.py).
Some assertions document behavior as-is; latent quirks are flagged NOTE.
"""

import asyncio
import hashlib
from collections import OrderedDict

import numpy as np
import pytest

import api.services.detection_service as det_mod
from api.services.detection_service import DetectionService


class FakeBackend:
    """Deterministic stand-in for the InsightFace backend.

    ``compute_distances`` returns plain Euclidean distances so match logic is
    fully predictable without a model.
    """

    backend_name = "insightface"

    def compute_distances(self, matrix, encoding):
        matrix = np.asarray(matrix, dtype=float)
        encoding = np.asarray(encoding, dtype=float)
        return np.linalg.norm(matrix - encoding, axis=1)

    def get_model_info(self):
        return {"version": "test-v1", "model": "test-model"}


def _service(config=None):
    """A DetectionService with the backend faked and all caches empty."""
    svc = DetectionService.__new__(DetectionService)
    svc.config = config or {}
    svc.backend = FakeBackend()
    svc.known_faces = {}
    svc.ignored_faces = []
    svc.hard_negatives = {}
    svc.processed_files = []
    svc.cache = OrderedDict()
    svc.encoding_cache = OrderedDict()
    svc.image_cache = OrderedDict()
    svc.image_cache_ttl = 1800
    svc._save_pending = False
    svc._save_lock = asyncio.Lock()
    svc._save_task = None
    return svc


def _known_entry(vec, backend="insightface"):
    return {"encoding": np.asarray(vec, dtype=float), "backend": backend}


# --------------------------------------------------------------------------
# 1. Match-status decision logic (_determine_match_case)
# --------------------------------------------------------------------------
# Thresholds pinned to the code defaults: match_threshold=0.54,
# ignore_distance=0.48, prefer_name_margin=0.15.

def _case(name_dist, ignore_dist, config=None):
    return _service(config)._determine_match_case(name_dist, ignore_dist)


def test_match_case_unknown_when_no_distances():
    assert _case(None, None) == "unknown"


def test_match_case_unknown_when_above_thresholds():
    # A name match at 0.60 is beyond match_threshold (0.54) -> not a hit.
    assert _case(0.60, None) == "unknown"


def test_match_case_name_only():
    assert _case(0.30, None) == "name"


def test_match_case_ignore_only():
    assert _case(None, 0.30) == "ign"


def test_match_case_name_clearly_better():
    # name < ignore - margin  (0.20 < 0.45 - 0.15) -> confident name.
    assert _case(0.20, 0.45) == "name"


def test_match_case_ignore_clearly_better():
    assert _case(0.45, 0.20) == "ign"


def test_match_case_uncertain_name_when_close_and_name_nearer():
    # Both hit, |0.30-0.35| = 0.05 < margin, name nearer -> uncertain_name.
    assert _case(0.30, 0.35) == "uncertain_name"


def test_match_case_uncertain_ign_when_close_and_ignore_nearer():
    assert _case(0.35, 0.30) == "uncertain_ign"


def test_match_case_honors_config_thresholds():
    # Tighten the name threshold so 0.30 no longer counts as a name hit.
    cfg = {"match_threshold": 0.25, "ignore_distance": 0.48, "prefer_name_margin": 0.15}
    assert _case(0.30, None, cfg) == "unknown"


# --------------------------------------------------------------------------
# 2. Single-nearest matching (_match_encoding)
# --------------------------------------------------------------------------

def test_match_encoding_picks_nearest_person():
    svc = _service()
    svc.known_faces = {
        "Alice": [_known_entry([0.0, 0.0])],
        "Bob": [_known_entry([10.0, 10.0])],
    }
    name, dist = svc._match_encoding(np.array([1.0, 0.0]))
    assert name == "Alice"
    assert dist == pytest.approx(1.0)


def test_match_encoding_uses_min_over_person_entries():
    svc = _service()
    svc.known_faces = {
        "Alice": [_known_entry([9.0, 9.0]), _known_entry([0.5, 0.0])],
    }
    name, dist = svc._match_encoding(np.array([0.0, 0.0]))
    assert name == "Alice"
    assert dist == pytest.approx(0.5)  # nearest of Alice's two encodings


def test_match_encoding_skips_other_backend_entries():
    # A dlib entry is invisible to the active insightface backend.
    svc = _service()
    svc.known_faces = {"Alice": [_known_entry([0.0, 0.0], backend="dlib")]}
    name, dist = svc._match_encoding(np.array([0.0, 0.0]))
    assert name is None
    assert dist is None


def test_match_encoding_empty_db_returns_none():
    assert _service()._match_encoding(np.array([1.0, 2.0])) == (None, None)


# --------------------------------------------------------------------------
# 3. Detection-cache keying
# --------------------------------------------------------------------------

def test_cache_key_without_registry_uses_version_zero(tmp_path, monkeypatch):
    # No distinct_pairs.json on disk -> version component is 0.
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = _service()
    assert svc._detection_cache_key("abc123") == "abc123@0"


def test_cache_key_folds_registry_version(tmp_path, monkeypatch):
    reg = tmp_path / "distinct_pairs.json"
    reg.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", reg)
    svc = _service()
    key = svc._detection_cache_key("abc123")
    # Key carries the file's mtime_ns; it is not the bare hash.
    assert key.startswith("abc123@")
    assert key != "abc123@0"
    assert str(reg.stat().st_mtime_ns) in key


def test_cache_key_changes_when_registry_changes(tmp_path, monkeypatch):
    reg = tmp_path / "distinct_pairs.json"
    reg.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", reg)
    svc = _service()
    key1 = svc._detection_cache_key("h")
    # A registry edit (new mtime) invalidates cached suggestions.
    import os
    # Bump by a full second so even coarse-mtime filesystems register the change.
    bumped = reg.stat().st_mtime_ns + 1_000_000_000
    os.utime(reg, ns=(bumped, bumped))
    key2 = svc._detection_cache_key("h")
    assert key1 != key2


def test_cached_detection_meta_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = _service()
    key = svc._detection_cache_key("hhh")
    svc.cache[key] = {"detection_meta": {"scale_label": "mid"}, "processing_time_ms": 42}
    meta, ms = svc._cached_detection_meta("hhh")
    assert meta == {"scale_label": "mid"}
    assert ms == 42


def test_cached_detection_meta_missing_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = _service()
    assert svc._cached_detection_meta("absent") == ({}, 0)
    assert svc._cached_detection_meta(None) == ({}, 0)


# --------------------------------------------------------------------------
# 4. reload_database clears caches
# --------------------------------------------------------------------------

def test_reload_database_clears_all_caches(monkeypatch):
    svc = _service()
    svc.cache["k"] = {"faces": []}
    svc.encoding_cache["face_0"] = (np.array([1.0]), {}, "h")
    svc.image_cache["/img"] = (np.zeros((1, 1, 3)), 0.0)

    monkeypatch.setattr(
        det_mod, "load_database",
        lambda: ({"Alice": [_known_entry([1.0, 2.0])]}, [_known_entry([3.0, 4.0])], {}, []),
    )

    result = svc.reload_database()

    assert svc.cache == OrderedDict()
    assert svc.encoding_cache == OrderedDict()
    assert svc.image_cache == OrderedDict()
    assert list(svc.known_faces) == ["Alice"]
    np.testing.assert_array_equal(
        svc.known_faces["Alice"][0]["encoding"], np.array([1.0, 2.0])
    )
    assert result == {
        "status": "success",
        "people_count": 1,
        "ignored_count": 1,
        "cache_cleared": 1,
    }


# --------------------------------------------------------------------------
# 5. confirm-identity mutation path (_confirm_identity_nosave, detected face)
# --------------------------------------------------------------------------

def test_confirm_detected_face_writes_entry():
    svc = _service()
    encoding = np.array([1.0, 2.0, 3.0])
    svc.encoding_cache["face_0"] = (encoding, {"x": 1, "y": 2, "width": 3, "height": 4}, "filehash123")

    out = svc._confirm_identity_nosave("face_0", "Alice", "/photos/a.NEF")

    assert out == {"status": "success", "person_name": "Alice", "encodings_count": 1}
    entry = svc.known_faces["Alice"][0]
    assert entry["hash"] == "filehash123"  # cached file hash reused
    assert entry["file"] == "/photos/a.NEF"
    assert entry["backend"] == "insightface"
    assert entry["backend_version"] == "test-v1"
    assert entry["bounding_box"] == {"x": 1, "y": 2, "width": 3, "height": 4}
    assert entry["encoding_hash"] == hashlib.sha1(encoding.tobytes()).hexdigest()
    np.testing.assert_array_equal(entry["encoding"], encoding)
    # A detected (non-manual) confirm carries no is_manual flag.
    assert "is_manual" not in entry


def test_confirm_with_correction_records_hard_negative():
    svc = _service()
    encoding = np.array([1.0, 2.0])
    svc.encoding_cache["face_0"] = (encoding, {"x": 0, "y": 0, "width": 1, "height": 1}, "h")

    svc._confirm_identity_nosave("face_0", "Bob", "/photos/x.NEF", suggested_name="Alice")

    # The rejected suggestion becomes a hard negative for that name.
    assert "Alice" in svc.hard_negatives
    hn = svc.hard_negatives["Alice"][0]
    assert hn["encoding_hash"] == hashlib.sha1(encoding.tobytes()).hexdigest()
    # NOTE: hard-negative entries omit bounding_box (unlike known_faces entries).
    assert "bounding_box" not in hn
    assert svc.known_faces["Bob"][0]["encoding_hash"] == hn["encoding_hash"]


def test_confirm_same_suggestion_no_hard_negative():
    svc = _service()
    encoding = np.array([1.0])
    svc.encoding_cache["face_0"] = (encoding, {}, "h")
    svc._confirm_identity_nosave("face_0", "Alice", "/p.NEF", suggested_name="Alice")
    assert svc.hard_negatives == {}


def test_confirm_unknown_face_id_raises():
    svc = _service()
    with pytest.raises(ValueError, match="not found in cache"):
        svc._confirm_identity_nosave("face_missing", "Alice", "/p.NEF")


# --------------------------------------------------------------------------
# 6. Debounced save coalescing
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_schedule_save_coalesces_rapid_calls(monkeypatch):
    svc = _service()
    calls = []
    monkeypatch.setattr(det_mod, "save_database", lambda *a, **k: calls.append(1))

    # Two rapid schedules within the 500 ms debounce window -> one save.
    await svc._schedule_save()
    await svc._schedule_save()
    # The second call coalesced into the first task; awaiting it is
    # deterministic (no wall-clock race with the debounce + executor hop).
    await svc._save_task

    assert len(calls) == 1
    assert svc._save_pending is False


@pytest.mark.asyncio
async def test_flush_save_cancels_pending_and_saves_now(monkeypatch):
    svc = _service()
    calls = []
    monkeypatch.setattr(det_mod, "save_database", lambda *a, **k: calls.append(1))

    await svc._schedule_save()   # schedule a debounced save
    await svc._flush_save()      # force immediate save, cancel the debounce

    # _flush_save awaits the cancelled debounce task before saving, so by now
    # the task is settled: exactly one save happened (the flush).
    assert svc._save_task.done()
    assert len(calls) == 1
    assert svc._save_pending is False
