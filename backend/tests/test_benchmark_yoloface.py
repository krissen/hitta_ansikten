"""Tests for the YOLO-face detector adapter's pure decode/NMS/letterbox logic.

Synthetic tensors only — no onnxruntime, no real model, no DB. The one
integration test that needs a downloaded ONNX is guarded by a file check.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from benchmarks.models import yoloface as yf
from benchmarks.models.base import Face


# --------------------------------------------------------------------------
# letterbox
# --------------------------------------------------------------------------
def test_letterbox_landscape_geometry():
    # 200x100 (h x w) image into 640: ratio = 640/200 = 3.2, width 100*3.2=320.
    img = np.zeros((200, 100, 3), dtype=np.uint8)
    canvas, ratio, left, top = yf.letterbox(img, new_size=640)
    assert canvas.shape == (640, 640, 3)
    assert ratio == pytest.approx(3.2)
    # height fills (640), width 320 centered -> left pad 160, top pad 0.
    assert top == 0
    assert left == (640 - 320) // 2 == 160


def test_letterbox_unmap_roundtrip():
    img = np.zeros((300, 500, 3), dtype=np.uint8)
    _, ratio, left, top = yf.letterbox(img, new_size=640)
    # a point at original (250, 150) maps into letterbox space then back.
    orig = np.array([[250.0, 150.0]], dtype=np.float32)
    lb = orig.copy()
    lb[:, 0] = orig[:, 0] * ratio + left
    lb[:, 1] = orig[:, 1] * ratio + top
    back = yf.unmap_points(lb, ratio, left, top)
    assert np.allclose(back, orig, atol=1e-3)


# --------------------------------------------------------------------------
# box conversion + NMS
# --------------------------------------------------------------------------
def test_cxcywh_to_xyxy():
    boxes = np.array([[10, 20, 4, 6]], dtype=np.float32)  # center 10,20 wh 4,6
    xy = yf.cxcywh_to_xyxy(boxes)
    assert np.allclose(xy[0], [8, 17, 12, 23])


def test_nms_suppresses_overlap_keeps_distinct():
    boxes = np.array(
        [
            [0, 0, 10, 10],     # A (best)
            [1, 1, 11, 11],     # heavily overlaps A -> suppressed
            [100, 100, 110, 110],  # far away -> kept
        ],
        dtype=np.float32,
    )
    scores = np.array([0.9, 0.8, 0.7], dtype=np.float32)
    keep = yf.nms(boxes, scores, iou_thresh=0.45)
    assert keep == [0, 2]


def test_nms_empty():
    assert yf.nms(np.empty((0, 4)), np.empty((0,)), 0.5) == []


def test_nms_orders_by_score():
    boxes = np.array([[0, 0, 10, 10], [50, 50, 60, 60]], dtype=np.float32)
    scores = np.array([0.3, 0.9], dtype=np.float32)
    # non-overlapping -> both kept, highest score first
    assert yf.nms(boxes, scores, 0.45) == [1, 0]


# --------------------------------------------------------------------------
# decode: raw YOLOv8-pose head (1, 4+nc+3K, N)
# --------------------------------------------------------------------------
def _raw_column(cx, cy, w, h, score, kps_xy):
    """Build one raw-head column: [cx,cy,w,h, score, (x,y,vis)*5]."""
    col = [cx, cy, w, h, score]
    for (x, y) in kps_xy:
        col += [x, y, 1.0]
    return col


def test_decode_raw_filters_and_shapes():
    K = 5
    kps = [(i, i + 1) for i in range(K)]
    strong = _raw_column(100, 200, 40, 60, 0.9, kps)   # cx,cy,w,h
    weak = _raw_column(10, 10, 4, 4, 0.1, [(0, 0)] * K)
    # channels-first: (1, 4+1+15=20, N=2)
    arr = np.array([strong, weak], dtype=np.float32).T[None]  # (1, 20, 2)
    xyxy, scores, kout = yf.decode_raw(arr, conf_thresh=0.5, num_kpts=K)
    assert xyxy.shape == (1, 4)
    assert scores.shape == (1,) and scores[0] == pytest.approx(0.9)
    assert kout.shape == (1, K, 2)
    # cx,cy,w,h = 100,200,40,60 -> xyxy 80,170,120,230
    assert np.allclose(xyxy[0], [80, 170, 120, 230])
    assert np.allclose(kout[0], kps)


def test_decode_raw_multiclass_uses_max_class_score():
    # 2 classes: channels = 4 + 2 + 3*5 = 21
    K = 5
    col = [50, 50, 10, 10, 0.2, 0.7]  # box + 2 class scores
    for _ in range(K):
        col += [1, 2, 1.0]
    arr = np.array([col], dtype=np.float32).T[None]  # (1, 21, 1)
    xyxy, scores, kout = yf.decode_raw(arr, conf_thresh=0.5, num_kpts=K)
    assert scores[0] == pytest.approx(0.7)  # max of the two class scores
    assert kout.shape == (1, K, 2)


def test_decode_raw_rejects_too_few_channels():
    bad = np.zeros((1, 10, 3), dtype=np.float32)  # 10 < 4+1+15
    with pytest.raises(ValueError):
        yf.decode_raw(bad, conf_thresh=0.5, num_kpts=5)


# --------------------------------------------------------------------------
# decode: NMS-baked head (1, M, 6+3K)
# --------------------------------------------------------------------------
def _baked_row(x1, y1, x2, y2, score, kps_xy):
    row = [x1, y1, x2, y2, score, 0.0]  # +class
    for (x, y) in kps_xy:
        row += [x, y, 1.0]
    return row


def test_is_nms_baked_detection():
    baked = np.zeros((1, 300, 21), dtype=np.float32)
    raw = np.zeros((1, 20, 8400), dtype=np.float32)
    assert yf.is_nms_baked(baked, num_kpts=5)
    assert not yf.is_nms_baked(raw, num_kpts=5)


def test_decode_nms_baked_filters_padding():
    K = 5
    kps = [(i, i + 1) for i in range(K)]
    real = _baked_row(10, 20, 30, 50, 0.8, kps)
    pad = _baked_row(0, 0, 0, 0, 0.0, [(0, 0)] * K)  # zero-padding row
    arr = np.array([[real, pad]], dtype=np.float32)  # (1, 2, 21)
    xyxy, scores, kout = yf.decode_nms_baked(arr, conf_thresh=0.25, num_kpts=K)
    assert xyxy.shape == (1, 4)
    assert np.allclose(xyxy[0], [10, 20, 30, 50])
    assert scores[0] == pytest.approx(0.8)
    assert np.allclose(kout[0], kps)


def test_nms_baked_kpt_count_detects_layouts():
    # pose head (K=5), landmark-less detection head (K=0), and a non-match.
    assert yf.nms_baked_kpt_count(np.zeros((1, 300, 21), dtype=np.float32)) == 5
    assert yf.nms_baked_kpt_count(np.zeros((1, 300, 6), dtype=np.float32)) == 0
    assert yf.nms_baked_kpt_count(np.zeros((1, 20, 8400), dtype=np.float32)) is None
    assert yf.nms_baked_kpt_count(np.zeros((300, 6), dtype=np.float32)) is None  # not (1, M, C)


def test_decode_nms_baked_landmarkless_detection_head():
    # (1, M, 6): [x1, y1, x2, y2, score, class] — the akanametov large variants.
    real = [10.0, 20.0, 30.0, 50.0, 0.8, 0.0]
    pad = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]  # below conf floor
    arr = np.array([[real, pad]], dtype=np.float32)  # (1, 2, 6)
    xyxy, scores, kout = yf.decode_nms_baked(arr, conf_thresh=0.25, num_kpts=0)
    assert xyxy.shape == (1, 4)
    assert np.allclose(xyxy[0], [10, 20, 30, 50])
    assert scores[0] == pytest.approx(0.8)
    assert kout.shape == (1, 0, 2)  # no landmark columns


# --------------------------------------------------------------------------
# integration (needs a downloaded ONNX)
# --------------------------------------------------------------------------
def test_default_model_path_matches_download_layout():
    # _data/models/<name>/<name>.onnx — must mirror download.local_path.
    p = yf.default_model_path("yolov8n-face")
    assert p.name == "yolov8n-face.onnx"
    assert p.parent.name == "yolov8n-face"
    assert p.parent.parent.name == "models"

    from benchmarks.models.download import KNOWN_MODELS, local_path

    assert p == local_path(KNOWN_MODELS["yolov8n-face"])


@pytest.mark.skipif(
    not yf.default_model_path("yolov8n-face").exists(),
    reason="yolov8n-face.onnx not downloaded (run benchmarks.models.download)",
)
def test_detector_runs_on_synthetic_image():
    det = yf.YoloFaceDetector(model_name="yolov8n-face")
    img = np.full((480, 640, 3), 127, dtype=np.uint8)
    faces = det.detect(img)
    assert isinstance(faces, list)
    for f in faces:
        assert isinstance(f, Face)
        assert f.bbox.shape == (4,)
        assert f.kps.shape == (5, 2)


@pytest.mark.skipif(
    not yf.default_model_path("yolov8l-face").exists(),
    reason="yolov8l-face.onnx not exported (see models_manifest.json note)",
)
def test_landmarkless_detector_emits_nan_kps():
    # The large akanametov variants are plain detectors: valid boxes, NaN kps.
    det = yf.YoloFaceDetector(model_name="yolov8l-face")
    img = np.full((480, 640, 3), 127, dtype=np.uint8)
    faces = det.detect(img)
    assert isinstance(faces, list)
    for f in faces:
        assert isinstance(f, Face)
        assert f.bbox.shape == (4,)
        assert f.kps.shape == (5, 2)
        assert np.isnan(f.kps).all()  # no landmark head
