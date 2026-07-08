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

import hashlib
from collections import OrderedDict

import numpy as np
import pytest

import api.services.detection_service as det_mod
from api.services.detection_service import DetectionService
from tests.conftest import InMemoryDBStore


class FakeBackend:
    """Deterministic stand-in for the InsightFace backend.

    ``compute_distances`` returns plain Euclidean distances so match logic is
    fully predictable without a model.
    """

    backend_name = "insightface"
    distance_metric = "cosine"
    det_size = (1280, 1280)

    def compute_distances(self, matrix, encoding):
        matrix = np.asarray(matrix, dtype=float)
        encoding = np.asarray(encoding, dtype=float)
        return np.linalg.norm(matrix - encoding, axis=1)

    def get_model_info(self):
        return {"version": "test-v1", "model": "test-model"}


def _service(config=None):
    """A DetectionService with the backend faked and all caches empty.

    Reads/mutations route through an InMemoryDBStore backed by the service's own
    live collections (the D3 FaceDBStore migration), so nothing touches disk.
    """
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
    svc.store = InMemoryDBStore(svc)
    svc._cache_db_version = svc.store.version
    return svc


def _known_entry(vec, backend="insightface"):
    return {"encoding": np.asarray(vec, dtype=float), "backend": backend}


# --------------------------------------------------------------------------
# 1. Match-status decision logic (_determine_match_case)
# --------------------------------------------------------------------------
# Thresholds now come from the single source of truth shared with the CLI:
# _get_backend_thresholds(config, backend). With an empty config the insightface
# (cosine) backend yields the canonical defaults match_threshold=0.4,
# ignore_distance=0.35; prefer_name_margin defaults to 0.15.

def _case(name_dist, ignore_dist, config=None):
    return _service(config)._determine_match_case(name_dist, ignore_dist)


def test_match_case_unknown_when_no_distances():
    assert _case(None, None) == "unknown"


def test_match_case_unknown_when_above_thresholds():
    # A name match at 0.45 is beyond the cosine match_threshold (0.4) -> not a
    # hit. This is the "uncertain band" [0.4, ...): no auto-fill here, but the
    # person still surfaces via match_alternatives.
    assert _case(0.45, None) == "unknown"


def test_match_case_name_only():
    assert _case(0.30, None) == "name"


def test_match_case_ignore_only():
    assert _case(None, 0.30) == "ign"


def test_match_case_name_clearly_better():
    # name hits (0.20 < 0.4); ignore misses (0.45 >= 0.35) -> confident name.
    assert _case(0.20, 0.45) == "name"


def test_match_case_ignore_clearly_better():
    # name misses (0.45 >= 0.4); ignore hits (0.20 < 0.35) -> confident ign.
    assert _case(0.45, 0.20) == "ign"


def test_match_case_uncertain_name_when_close_and_name_nearer():
    # Both hit, |0.28-0.30| = 0.02 < margin, name nearer -> uncertain_name.
    assert _case(0.28, 0.30) == "uncertain_name"


def test_match_case_uncertain_ign_when_close_and_ignore_nearer():
    # Both hit, |0.34-0.30| = 0.04 < margin, ignore nearer -> uncertain_ign.
    assert _case(0.34, 0.30) == "uncertain_ign"


def test_match_case_honors_backend_thresholds():
    # Tighten the insightface name threshold via backend_thresholds (the single
    # source of truth) so 0.30 no longer counts as a name hit.
    cfg = {
        "backend_thresholds": {
            "insightface": {
                "match_threshold": 0.25,
                "ignore_distance": 0.35,
                "hard_negative_distance": 0.32,
            }
        },
        "prefer_name_margin": 0.15,
    }
    assert _case(0.30, None, cfg) == "unknown"


def test_match_case_ignores_legacy_flat_keys():
    # Stale euclidean-era flat keys must NOT loosen cosine matching: with only a
    # flat match_threshold=0.6 set, a 0.45 name distance is still "unknown"
    # because the canonical cosine default (0.4) governs.
    cfg = {"match_threshold": 0.6, "ignore_distance": 0.5}
    assert _case(0.45, None, cfg) == "unknown"


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
    # Registry version 0 (no file) + strategy token from the fake backend's det_size.
    assert svc._detection_cache_key("abc123") == "abc123@0#d1280x1280+t0"


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


def test_cache_key_includes_strategy_token(tmp_path, monkeypatch):
    # The det_size-driven strategy token is part of the key so a det_size change
    # can't serve stale detections from another strategy.
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = _service()
    key = svc._detection_cache_key("abc123")
    assert key.endswith("#d1280x1280+t0")


def test_cache_key_changes_when_det_size_differs(tmp_path, monkeypatch):
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = _service()
    key_1280 = svc._detection_cache_key("h")
    svc.backend.det_size = (640, 640)
    key_640 = svc._detection_cache_key("h")
    assert key_1280 != key_640
    assert key_640.endswith("#d640x640+t0")


def test_strategy_token_defaults_when_backend_has_no_det_size(tmp_path, monkeypatch):
    # A backend without det_size (e.g. dlib) yields d0x0+t0 rather than crashing.
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = _service()
    svc.backend.det_size = None
    assert svc._detection_strategy_token() == "d0x0+t0"


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
# 4. reload_database clears caches (RETARGETED to the FaceDBStore)
# --------------------------------------------------------------------------
# Previously reload_database called load_database() itself. It now clears the
# local caches and reads fresh counts through the store (which reloads from disk
# on external change). The DB reload is the store's job; here we simulate it
# having reloaded fresh data and assert the endpoint clears caches + reports the
# store's live counts, re-pinning the match-result cache to the store version.

def test_reload_database_clears_caches_and_reports_store_counts():
    svc = _service()
    svc.cache["k"] = {"faces": []}
    svc.encoding_cache["face_0"] = (np.array([1.0]), {}, "h")
    svc.image_cache["/img"] = (np.zeros((1, 1, 3)), 0.0)

    # Simulate the store having reloaded fresh data from disk.
    svc.known_faces = {"Alice": [_known_entry([1.0, 2.0])]}
    svc.ignored_faces = [_known_entry([3.0, 4.0])]

    result = svc.reload_database()

    assert svc.cache == OrderedDict()
    assert svc.encoding_cache == OrderedDict()
    assert svc.image_cache == OrderedDict()
    assert svc._cache_db_version == svc.store.version
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
# 6. Debounced save routing (RETARGETED to the FaceDBStore)
# --------------------------------------------------------------------------
# DetectionService no longer owns _schedule_save/_flush_save — the debounce and
# its leading-coalesce live in FaceDBStore (exhaustively tested in
# test_db_store.py). These tests pin the SERVICE's contract onto the store:
#  * per-face confirm/ignore mutate the store (scheduling a debounced save) and
#    must NOT flush (preserving the old debounced write cadence);
#  * batch_confirm flushes exactly once for the whole batch.


class RecordingStore(InMemoryDBStore):
    """InMemoryDBStore that counts mutate() and flush() calls."""

    def __init__(self, svc):
        super().__init__(svc)
        self.mutations = 0
        self.flushes = 0

    def mutate(self, fn, touches=None):
        self.mutations += 1
        return super().mutate(fn, touches=touches)

    def flush(self):
        self.flushes += 1


@pytest.mark.asyncio
async def test_batch_confirm_mutates_per_face_and_flushes_once():
    svc = _service()
    store = RecordingStore(svc)
    svc.store = store
    enc = np.array([1.0, 2.0])
    svc.encoding_cache["face_0"] = (enc, {}, "h0")
    svc.encoding_cache["face_1"] = (enc, {}, "h1")

    result = await svc.batch_confirm(
        confirmations=[
            {"face_id": "face_0", "person_name": "Alice", "image_path": "/a.NEF"},
            {"face_id": "face_1", "person_name": "Bob", "image_path": "/b.NEF"},
        ],
        ignores=[],
    )

    assert result["confirmed_count"] == 2
    # One mutate per confirmed face; a single durable flush for the batch.
    assert store.mutations == 2
    assert store.flushes == 1


@pytest.mark.asyncio
async def test_single_confirm_schedules_save_without_flush():
    svc = _service()
    store = RecordingStore(svc)
    svc.store = store
    enc = np.array([3.0, 4.0])
    svc.encoding_cache["face_0"] = (enc, {"x": 0, "y": 0, "width": 1, "height": 1}, "h")

    out = await svc.confirm_identity("face_0", "Alice", "/a.NEF")

    assert out["encodings_count"] == 1
    # A per-face confirm mutates (scheduling the store's debounced save) but
    # never flushes — the old debounced cadence is preserved.
    assert store.mutations == 1
    assert store.flushes == 0


# --------------------------------------------------------------------------
# 7. Version gate on the detection-cache write
# --------------------------------------------------------------------------
# The entry-time version check/clear/repin and the exit-time cache write in
# detect_faces straddle awaits, and _cache_db_version is process-wide: without
# a per-call gate, a detect whose compute overlaps a confirm could write its
# pre-mutation (stale) result under the NEW pin and serve it until the next
# version move. detect_faces therefore captures store.version right before the
# matching compute and skips the cache write if the version advanced.


def _write_probe_jpg(tmp_path):
    from PIL import Image
    img_path = tmp_path / "probe.jpg"
    Image.new("RGB", (32, 32), color=(128, 128, 128)).save(img_path, "JPEG")
    return img_path


def _detect_backend(svc, mutate_during_compute):
    """A backend whose detect_faces optionally mutates the store mid-compute.

    The mutation fires inside the detection executor call — after detect_faces
    captured version_at_compute, before the cache write — reproducing a confirm
    landing while another detect is computing.
    """
    class Backend(FakeBackend):
        def detect_faces(self, rgb, model=None, upsample=0):
            if mutate_during_compute:
                svc.store.mutate(lambda known, ignored, hardneg, processed: None)
            return [], []

    return Backend()


@pytest.mark.asyncio
async def test_detect_skips_cache_write_when_version_advances_mid_compute(tmp_path, monkeypatch):
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = _service()
    svc.backend = _detect_backend(svc, mutate_during_compute=True)
    img = _write_probe_jpg(tmp_path)

    result = await svc.detect_faces(str(img))

    # The result is still returned to the caller...
    assert result["cached"] is False
    # ...but never cached: the store version advanced during compute, so the
    # (possibly stale) suggestions must not outlive the mutation.
    assert svc.cache == OrderedDict()


@pytest.mark.asyncio
async def test_detect_caches_result_when_version_stable(tmp_path, monkeypatch):
    monkeypatch.setattr(det_mod, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = _service()
    svc.backend = _detect_backend(svc, mutate_during_compute=False)
    img = _write_probe_jpg(tmp_path)

    result = await svc.detect_faces(str(img))

    # Control: with no mid-compute mutation the result IS cached under the
    # composite key, and a second call serves it from the cache.
    assert result["cached"] is False
    assert len(svc.cache) == 1
    again = await svc.detect_faces(str(img))
    assert again["cached"] is True


# --------------------------------------------------------------------------
# 8. Half-size RAW decode: coordinate scaling back to full resolution
# --------------------------------------------------------------------------
# On a preprocessing-cache miss, RAW files are decoded with half_size=True for
# detection (~2.7x faster demosaic). Bounding boxes must nevertheless stay in
# the FULL-resolution space the frontend displays: _detect_and_match_faces
# folds the decode's coord_scale into its bounding-box scale factor.


class _LocatingBackend(FakeBackend):
    """Backend reporting one fixed face location in the supplied image."""

    def detect_faces(self, rgb, model=None, upsample=0):
        # (top, right, bottom, left) in the supplied rgb's pixel space.
        return [(10, 40, 30, 20)], [np.array([1.0, 2.0])]


def test_coord_scale_folds_into_bounding_box():
    svc = _service()
    svc.backend = _LocatingBackend()
    rgb = np.zeros((100, 100, 3), dtype=np.uint8)

    faces_full, meta_full = svc._detect_and_match_faces(rgb, 4500, None, coord_scale=1.0)
    faces_half, meta_half = svc._detect_and_match_faces(rgb, 4500, None, coord_scale=2.0)

    bb_full = faces_full[0]["bounding_box"]
    bb_half = faces_half[0]["bounding_box"]
    # Same detected location, but the half-decode result is mapped back to
    # full-resolution space: every coordinate doubles.
    assert bb_full == {"x": 20, "y": 10, "width": 20, "height": 20}
    assert bb_half == {"x": 40, "y": 20, "width": 40, "height": 40}
    # Metadata reports the full-resolution original size and the half label.
    assert meta_full["original_size"] == (100, 100)
    assert meta_half["original_size"] == (200, 200)
    assert meta_half["scale_label"] == "half"


def test_load_image_for_detection_standard_format_scale_one(tmp_path):
    from PIL import Image
    p = tmp_path / "img.jpg"
    Image.new("RGB", (32, 24), color=(10, 20, 30)).save(p, "JPEG")

    svc = _service()
    rgb, coord_scale = svc._load_image_for_detection(p)

    assert coord_scale == 1.0
    assert rgb.shape == (24, 32, 3)


def test_load_image_for_detection_portrait_raw_orientation_invariant(tmp_path, monkeypatch):
    """coord_scale must be orientation-invariant for rotated (portrait) RAWs.

    raw.sizes reports PRE-flip sensor dimensions while postprocess() output is
    POST-flip: for a 90°-rotated NEF, sizes.height (short sensor side, e.g.
    5520) pairs with a TALL output (4140 high), so height/height would give
    ~1.33 instead of the true 2.0. The long-side ratio is flip-proof.
    """
    import api.services.detection_service as det_mod

    class FakeSizes:
        # Landscape sensor 8280x5520, camera held in portrait (flip=6).
        height = 5520
        width = 8280

    class FakeRaw:
        sizes = FakeSizes()

        def postprocess(self, half_size=False):
            assert half_size is True
            # Post-flip half-size output: portrait 4140 high x 2760 wide.
            return np.zeros((4140, 2760, 3), dtype=np.uint8)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    class FakeRawpy:
        @staticmethod
        def imread(path):
            return FakeRaw()

    class FailingCache:
        # Force the cache-miss branch.
        def compute_file_hash(self, p):
            raise RuntimeError("no cache")

    monkeypatch.setattr(det_mod, "rawpy", FakeRawpy)
    monkeypatch.setattr(det_mod, "get_preprocessing_cache", lambda: FailingCache())

    svc = _service()
    p = tmp_path / "portrait.nef"
    p.write_bytes(b"fake")

    rgb, coord_scale = svc._load_image_for_detection(p)

    assert rgb.shape == (4140, 2760, 3)
    # Long-side ratio: 8280 / 4140 == 2.0 exactly (height/height would be
    # 5520/4140 ≈ 1.33 — the portrait bug this pins).
    assert coord_scale == 2.0
