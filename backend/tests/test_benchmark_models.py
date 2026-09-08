"""Tests for the benchmark model abstractions, 3-level cache, and dataset match.

All fixtures are synthetic: a fake recognition model and fake detector, plus
fabricated bboxes/landmarks. Nothing here imports insightface or touches the
real DB or photos. The one integration test that needs insightface is guarded
by an importorskip.
"""

from __future__ import annotations

import importlib.util

import numpy as np
import pytest

from benchmarks import cache, dataset
from benchmarks.db_access import FaceRecord
from benchmarks.models.base import (
    Detector,
    Face,
    RecognitionModel,
    RecognitionModelBase,
    l2_normalize,
)

HAS_INSIGHTFACE = importlib.util.find_spec("insightface") is not None


# --------------------------------------------------------------------------
# fakes
# --------------------------------------------------------------------------
class FakeRecognition(RecognitionModelBase):
    """Deterministic fake: embeds the mean of the crop into a fixed direction."""

    name = "fake"
    dim = 4

    def embed(self, aligned_bgr_112: np.ndarray) -> np.ndarray:
        m = float(np.asarray(aligned_bgr_112).mean())
        return l2_normalize(np.array([m, 1.0, 0.0, 0.0], dtype=np.float32))


class FakeDetector:
    name = "fakedet"

    def __init__(self, faces):
        self._faces = faces

    def detect(self, img_bgr):
        return list(self._faces)


def _face(x1, y1, x2, y2, score=0.9):
    kps = np.array([[x1 + 1, y1 + 1]] * 5, dtype=np.float32)
    return Face(bbox=[x1, y1, x2, y2], kps=kps, score=score)


# --------------------------------------------------------------------------
# protocols
# --------------------------------------------------------------------------
def test_face_shapes_coerced():
    f = Face(bbox=[1, 2, 3, 4], kps=np.zeros((5, 2)), score=1)
    assert f.bbox.shape == (4,)
    assert f.kps.shape == (5, 2)
    assert f.bbox_xyxy == (1.0, 2.0, 3.0, 4.0)


def test_l2_normalize_unit_and_zero():
    v = l2_normalize(np.array([3.0, 4.0]))
    assert np.isclose(np.linalg.norm(v), 1.0)
    z = l2_normalize(np.zeros(4))
    assert np.allclose(z, 0.0)  # zero vector left untouched


def test_recognition_protocol_and_batch_default():
    m = FakeRecognition()
    assert isinstance(m, RecognitionModel)  # runtime_checkable Protocol
    crops = [np.full((112, 112, 3), v, dtype=np.uint8) for v in (10, 20, 30)]
    batch = m.embed_batch(crops)
    assert batch.shape == (3, 4)
    for i, crop in enumerate(crops):
        assert np.allclose(batch[i], m.embed(crop))
    # empty batch returns a well-shaped empty array
    assert m.embed_batch([]).shape == (0, 4)


def test_detector_protocol():
    det = FakeDetector([_face(0, 0, 10, 10)])
    assert isinstance(det, Detector)
    assert len(det.detect(np.zeros((5, 5, 3)))) == 1


# --------------------------------------------------------------------------
# cache
# --------------------------------------------------------------------------
@pytest.fixture
def tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "DETECTIONS_DIR", tmp_path / "detections")
    monkeypatch.setattr(cache, "EMB_DIR", tmp_path / "emb")
    return tmp_path


def test_deterministic_face_id_stable():
    a = cache.deterministic_face_id("abc", (1.04, 2.06, 3.0, 4.0))
    b = cache.deterministic_face_id("abc", (1.0, 2.1, 3.0, 4.0))  # rounds equal
    assert a == b
    c = cache.deterministic_face_id("abc", (9, 2, 3, 4))
    assert a != c


def test_detections_roundtrip(tmp_cache):
    faces = [_face(0, 0, 10, 10, 0.8), _face(20, 20, 40, 40, 0.95)]
    cache.save_detections("hash1", "fakedet", faces)
    rec = cache.load_detections("hash1", "fakedet")
    assert len(rec) == 2
    assert rec.bboxes.shape == (2, 4)
    assert rec.kps.shape == (2, 5, 2)
    assert np.allclose(rec.scores, [0.8, 0.95])
    # different detector name -> separate file, no cross-talk
    assert cache.load_detections("hash1", "otherdet") is None


def test_empty_detections_roundtrip(tmp_cache):
    cache.save_detections("h", "d", [])
    rec = cache.load_detections("h", "d")
    assert len(rec) == 0
    assert rec.bboxes.shape == (0, 4)


def test_get_or_compute_detections_caches(tmp_cache):
    calls = {"n": 0}

    class CountingDetector(FakeDetector):
        def detect(self, img_bgr):
            calls["n"] += 1
            return super().detect(img_bgr)

    det = CountingDetector([_face(0, 0, 10, 10)])
    img = np.zeros((5, 5, 3))
    cache.get_or_compute_detections("h", det, img)
    cache.get_or_compute_detections("h", det, img)  # served from cache
    assert calls["n"] == 1


def test_emb_roundtrip_and_columns(tmp_cache):
    cache.save_emb("modelA", "fid1", np.array([1.0, 2.0]))
    assert np.allclose(cache.load_emb("modelA", "fid1"), [1.0, 2.0])
    # a different model is a different column; adding it doesn't disturb the first
    assert cache.load_emb("modelB", "fid1") is None

    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return np.array([9.0])

    cache.get_or_compute_emb("modelB", "fid1", compute)
    cache.get_or_compute_emb("modelB", "fid1", compute)
    assert calls["n"] == 1
    assert np.allclose(cache.load_emb("modelA", "fid1"), [1.0, 2.0])


# --------------------------------------------------------------------------
# dataset matching
# --------------------------------------------------------------------------
def test_iou():
    assert dataset.iou((0, 0, 10, 10), (0, 0, 10, 10)) == pytest.approx(1.0)
    assert dataset.iou((0, 0, 10, 10), (20, 20, 30, 30)) == 0.0
    # half-overlap in x -> IoU 1/3
    assert dataset.iou((0, 0, 10, 10), (5, 0, 15, 10)) == pytest.approx(1 / 3)


def test_best_match_threshold():
    dets = np.array([[0, 0, 10, 10], [100, 100, 110, 110]], dtype=np.float32)
    idx, score = dataset.best_match((0, 0, 9, 9), dets, threshold=0.5)
    assert idx == 0 and score >= 0.5
    idx, score = dataset.best_match((0, 0, 3, 3), dets, threshold=0.5)
    assert idx is None  # overlaps box 0 but below threshold


def _rec(identity, sha1, bbox, *, enc=True):
    encoding = np.ones(4, dtype=np.float32) if enc else None
    return FaceRecord(
        identity=identity,
        recorded_file=f"{sha1}.NEF",
        basename=f"{sha1}.NEF",
        sha1=sha1,
        bbox=bbox,
        is_manual=False,
        created_at=None,
        encoding=encoding,
        encoding_hash=("h_" + identity) if enc else None,
    )


def test_bbox_xyxy_conversion():
    r = _rec("A", "s1", {"x": 10, "y": 20, "width": 30, "height": 40})
    assert r.bbox_xyxy == (10.0, 20.0, 40.0, 60.0)
    assert _rec("B", "s2", None).bbox_xyxy is None


def test_build_dataset_buckets(tmp_cache, monkeypatch):
    # image s1 present with a matching detection; image s2 present but detector
    # misses; image s3 not resolvable at all.
    records = [
        _rec("Match", "s1", {"x": 0, "y": 0, "width": 10, "height": 10}),
        _rec("Missed", "s2", {"x": 0, "y": 0, "width": 10, "height": 10}),
        _rec("Gone", "s3", {"x": 0, "y": 0, "width": 10, "height": 10}),
    ]

    class Index:
        def hash_to_paths(self):
            return {"s1": ["/fake/s1.jpg"], "s2": ["/fake/s2.jpg"]}

    # s1 -> detection overlapping the db bbox; s2 -> detection far away.
    detmap = {
        "/fake/s1.jpg": [_face(0, 0, 10, 10)],
        "/fake/s2.jpg": [_face(500, 500, 510, 510)],
    }

    class PathDetector:
        name = "pathdet"
        _current = None

        def detect(self, img_bgr):
            return detmap[self._current]

    det = PathDetector()

    def fake_load_bgr(path):
        det._current = str(path)
        return np.zeros((4, 4, 3), dtype=np.uint8)

    monkeypatch.setattr(dataset, "load_bgr", fake_load_bgr)

    rows = dataset.build_dataset(records, Index(), det)
    counts = dataset.bucket_counts(rows)
    assert counts == {dataset.MATCHED: 1, dataset.DETECTOR_MISSED: 1, dataset.UNRESOLVED: 1}
    matched = next(r for r in rows if r.bucket == dataset.MATCHED)
    assert matched.identity == "Match"
    assert matched.kps is not None
    assert matched.face_id == "h_Match"


def test_write_manifest(tmp_path):
    rows = [
        dataset.DatasetFace(
            identity="A",
            image_hash="s1",
            bucket=dataset.MATCHED,
            face_id="h_A",
            db_bbox_xyxy=[0, 0, 10, 10],
            det_bbox_xyxy=[0, 0, 10, 10],
            kps=[[1, 1]] * 5,
            score=0.9,
            iou=1.0,
            path="/x.jpg",
            is_manual=False,
            has_encoding=True,
        )
    ]
    out = dataset.write_manifest(rows, tmp_path / "dataset.jsonl")
    lines = out.read_text().strip().splitlines()
    assert len(lines) == 1
    import json

    assert json.loads(lines[0])["identity"] == "A"


# --------------------------------------------------------------------------
# integration (needs insightface + downloaded buffalo_l pack)
# --------------------------------------------------------------------------
@pytest.mark.skipif(not HAS_INSIGHTFACE, reason="insightface not installed")
def test_buffalo_recognition_dim():
    from benchmarks.models.buffalo import BuffaloRecognition

    rec = BuffaloRecognition()
    crop = np.zeros((112, 112, 3), dtype=np.uint8)
    vec = rec.embed(crop)
    assert vec.shape == (512,)
    assert np.isclose(np.linalg.norm(vec), 1.0, atol=1e-3)
