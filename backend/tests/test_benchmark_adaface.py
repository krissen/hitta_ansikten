"""Tests for the AdaFace IR-101 recognition adapter.

Like the LVFace tests, these never hit the network and never load the real
(hundreds-of-MB) AdaFace weights. A *tiny real ONNX* head is authored on the fly
with ``onnx.helper`` (input NCHW ``3x112x112`` -> a deterministic linear
embedding) — enough to exercise the adapter's preprocessing, shape, batch and
normalization logic through a genuine ``onnxruntime`` session.

The parity test is the important one, and it pins the detail AdaFace is famous
for: the network consumes **BGR** (its ``to_input`` starts from a PIL *RGB*
image and reverses the channel axis to BGR before normalizing). Our canonical
crop is *already* BGR, so the correct adapter applies **no** channel swap — the
opposite of LVFace. The parity test feeds the same crop through (a) the adapter
and (b) a verbatim port of AdaFace's ``to_input`` (fed the RGB view of the crop,
so its own RGB->BGR reversal reconstructs our BGR) into the *same* ONNX session,
and asserts cosine > 0.999. A stray BGR->RGB swap in the adapter would break it.

The integration test that loads a real exported ONNX is skipped unless present.
"""

from __future__ import annotations

import importlib.util

import numpy as np
import pytest

pytest.importorskip("onnx")
pytest.importorskip("onnxruntime")

from benchmarks.models.adaface import AdaFaceRecognition, default_model_path

HAS_ORT = importlib.util.find_spec("onnxruntime") is not None


# ---------------------------------------------------------------------------
# tiny real ONNX head (Flatten -> MatMul with a fixed deterministic weight)
# ---------------------------------------------------------------------------
def _build_fake_onnx(path, *, dim: int = 8, batch="N") -> str:
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    feat = 3 * 112 * 112
    rng = np.random.default_rng(0)
    W = rng.standard_normal((feat, dim)).astype(np.float32)

    inp = helper.make_tensor_value_info("input", TensorProto.FLOAT, [batch, 3, 112, 112])
    out = helper.make_tensor_value_info("embedding", TensorProto.FLOAT, [batch, dim])
    w_init = numpy_helper.from_array(W, name="W")

    flatten = helper.make_node("Flatten", ["input"], ["flat"], axis=1)
    matmul = helper.make_node("MatMul", ["flat", "W"], ["embedding"])
    graph = helper.make_graph([flatten, matmul], "adaface_fake", [inp], [out], [w_init])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    onnx.save(model, str(path))
    return str(path)


@pytest.fixture
def fake_onnx(tmp_path):
    return _build_fake_onnx(tmp_path / "fake_adaface.onnx", dim=8, batch="N")


def _crop(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(112, 112, 3), dtype=np.uint8)


# ---------------------------------------------------------------------------
# preprocessing: NO channel swap (BGR stays BGR), [-1,1] normalization
# ---------------------------------------------------------------------------
def test_preprocess_no_swap_and_norm():
    # Distinct constant B/G/R planes let us assert the channels are NOT swapped.
    crop = np.zeros((112, 112, 3), dtype=np.uint8)
    crop[..., 0] = 0  # B
    crop[..., 1] = 128  # G
    crop[..., 2] = 255  # R
    t = AdaFaceRecognition._preprocess(crop)
    assert t.shape == (3, 112, 112)
    assert t.dtype == np.float32
    # channel 0 must remain the original B plane (0) -> -1.0 (no BGR->RGB swap)
    assert np.allclose(t[0], (0 - 127.5) / 127.5)
    assert np.allclose(t[1], (128 - 127.5) / 127.5)
    assert np.allclose(t[2], (255 - 127.5) / 127.5)


def test_preprocess_rejects_bad_shape():
    with pytest.raises(ValueError):
        AdaFaceRecognition._preprocess(np.zeros((112, 112), dtype=np.uint8))


# ---------------------------------------------------------------------------
# embed / shape / normalization
# ---------------------------------------------------------------------------
def test_embed_shape_and_normalized(fake_onnx):
    rec = AdaFaceRecognition(model_path=fake_onnx)
    vec = rec.embed(_crop(1))
    assert vec.shape == (8,)
    assert rec.dim == 8
    assert np.isclose(np.linalg.norm(vec), 1.0, atol=1e-5)


def test_embed_batch_matches_singles(fake_onnx):
    rec = AdaFaceRecognition(model_path=fake_onnx)
    crops = [_crop(i) for i in range(5)]
    batch = rec.embed_batch(crops)
    assert batch.shape == (5, 8)
    for i, c in enumerate(crops):
        assert np.allclose(batch[i], rec.embed(c), atol=1e-5)
    assert rec.embed_batch([]).shape == (0, 8)


def test_static_batch_padding(tmp_path):
    static = _build_fake_onnx(tmp_path / "static.onnx", dim=8, batch=4)
    dynamic = _build_fake_onnx(tmp_path / "dyn.onnx", dim=8, batch="N")
    rs = AdaFaceRecognition(model_path=static)
    rd = AdaFaceRecognition(model_path=dynamic)
    assert rs._ensure_session() is not None and rs._static_batch == 4
    crops = [_crop(i) for i in range(6)]  # 6 is not a multiple of 4
    out = rs.embed_batch(crops)
    assert out.shape == (6, 8)
    assert np.allclose(out, rd.embed_batch(crops), atol=1e-5)


# ---------------------------------------------------------------------------
# parity gate: adapter vs verbatim AdaFace to_input, same ONNX weights
# ---------------------------------------------------------------------------
def _reference_embed(session, in_name, out_name, bgr_crop):
    """Verbatim port of AdaFace ``inference.py`` ``to_input`` + L2-norm.

    ``to_input`` expects a PIL *RGB* image and reverses to BGR internally. We
    build that RGB view from our BGR crop so the round trip reconstructs the
    original BGR — matching what the adapter feeds the net.
    """
    from benchmarks.models.base import l2_normalize

    rgb = np.ascontiguousarray(bgr_crop[:, :, ::-1])  # BGR -> RGB (the "PIL" image)
    np_img = np.array(rgb)
    brg_img = ((np_img[:, :, ::-1] / 255.0) - 0.5) / 0.5  # to_input: RGB->BGR, [-1,1]
    tensor = np.asarray([brg_img.transpose(2, 0, 1)], dtype=np.float32)
    raw = session.run([out_name], {in_name: tensor})[0].ravel()
    return l2_normalize(np.asarray(raw, dtype=np.float32))


def test_parity_with_reference_pipeline(fake_onnx):
    import onnxruntime as ort

    rec = AdaFaceRecognition(model_path=fake_onnx)
    sess = ort.InferenceSession(fake_onnx, providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name

    for seed in range(4):
        crop = _crop(seed)
        ours = rec.embed(crop)
        ref = _reference_embed(sess, in_name, out_name, crop)
        cos = float(np.dot(ours, ref))
        assert cos > 0.999, f"preprocessing parity broken (cos={cos:.6f})"


# ---------------------------------------------------------------------------
# manifest + path
# ---------------------------------------------------------------------------
def test_default_model_path():
    p = default_model_path()
    assert p.name == "adaface_ir101.onnx"
    assert "models" in p.parts


def test_manifest_has_adaface_entry():
    import json

    from benchmarks.models import download

    manifest = json.loads(download.MANIFEST_PATH.read_text())
    entry = manifest["models"]["adaface_ir101"]
    assert entry["license"] == "MIT"
    assert entry["dim"] == 512
    assert entry["onnx_opset"] == 17
    assert "BGR (no swap)" in entry["preprocessing"]


def test_missing_weights_error_is_helpful(tmp_path):
    rec = AdaFaceRecognition(model_path=tmp_path / "nope.onnx")
    with pytest.raises(FileNotFoundError, match="export_adaface"):
        rec._ensure_session()


# ---------------------------------------------------------------------------
# vendored architecture (torch is export-time only; skip if absent)
# ---------------------------------------------------------------------------
def test_vendored_ir101_builds_and_shapes():
    pytest.importorskip("torch")
    import torch

    from benchmarks.models import _adaface_ir101_net as net

    model = net.build_model("ir_101")
    model.eval()
    with torch.no_grad():
        out, norm = model(torch.randn(2, 3, 112, 112))
    assert out.shape == (2, 512)
    assert norm.shape == (2, 1)
    # backbone L2-normalizes its embedding internally.
    assert torch.allclose(out.norm(dim=1), torch.ones(2), atol=1e-4)


# ---------------------------------------------------------------------------
# integration (real exported ONNX, only if present)
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not HAS_ORT, reason="onnxruntime not installed")
def test_real_adaface_if_present():
    path = default_model_path()
    if not path.exists():
        pytest.skip("AdaFace ONNX not exported (run benchmarks.models.export_adaface)")
    rec = AdaFaceRecognition()
    vec = rec.embed(np.zeros((112, 112, 3), dtype=np.uint8))
    assert vec.shape == (512,)
    assert np.isclose(np.linalg.norm(vec), 1.0, atol=1e-4)
