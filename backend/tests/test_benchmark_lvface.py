"""Tests for the LVFace recognition adapter and its download registry.

These never hit the network and never load the real (hundreds-of-MB) LVFace
weights. Instead a *tiny real ONNX* head is authored on the fly with
``onnx.helper`` (input NCHW ``3x112x112`` -> a deterministic linear embedding),
which is enough to exercise the adapter's preprocessing, shape, normalization
and batch logic through a genuine ``onnxruntime`` session.

The parity test is the important one: it feeds the *same* aligned crop through
(a) the adapter and (b) a verbatim port of the upstream reference preprocessing
(``bytedance/LVFace`` ``inference_onnx.py``) into the *same* ONNX session, and
asserts cosine ``> 0.999``. Since both share identical weights, that gates the
preprocessing contract (channel order, mean/scale, layout) against the
reference — the one thing that can silently corrupt embeddings.

The integration test that loads real weights is skipped unless they are present.
"""

from __future__ import annotations

import importlib.util

import numpy as np
import pytest

pytest.importorskip("onnx")
pytest.importorskip("onnxruntime")

from benchmarks.models import download
from benchmarks.models.lvface import LVFaceRecognition

HAS_ORT = importlib.util.find_spec("onnxruntime") is not None


# ---------------------------------------------------------------------------
# tiny real ONNX head (Flatten -> MatMul with a fixed deterministic weight)
# ---------------------------------------------------------------------------
def _build_fake_onnx(path, *, dim: int = 8, batch="N") -> str:
    """Author a minimal but real ONNX recognition head at ``path``.

    ``batch`` is the input's batch-dim: ``"N"`` (dynamic) or an int (static).
    The head is ``Flatten -> MatMul(W)`` with a deterministic ``W`` so the same
    input always yields the same embedding, across the adapter and the reference.
    """
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
    graph = helper.make_graph([flatten, matmul], "lvface_fake", [inp], [out], [w_init])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    onnx.save(model, str(path))
    return str(path)


@pytest.fixture
def fake_onnx(tmp_path):
    return _build_fake_onnx(tmp_path / "fake_lvface.onnx", dim=8, batch="N")


def _crop(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(112, 112, 3), dtype=np.uint8)


# ---------------------------------------------------------------------------
# preprocessing
# ---------------------------------------------------------------------------
def test_preprocess_channel_order_and_norm():
    # A crop where B/G/R are distinct constants lets us assert the BGR->RGB swap.
    crop = np.zeros((112, 112, 3), dtype=np.uint8)
    crop[..., 0] = 0  # B
    crop[..., 1] = 128  # G
    crop[..., 2] = 255  # R
    t = LVFaceRecognition._preprocess(crop)
    assert t.shape == (3, 112, 112)
    assert t.dtype == np.float32
    # channel 0 after RGB conversion is the original R plane (255) -> +1.0
    assert np.allclose(t[0], (255 - 127.5) / 127.5)
    assert np.allclose(t[1], (128 - 127.5) / 127.5)
    assert np.allclose(t[2], (0 - 127.5) / 127.5)


def test_preprocess_rejects_bad_shape():
    with pytest.raises(ValueError):
        LVFaceRecognition._preprocess(np.zeros((112, 112), dtype=np.uint8))


# ---------------------------------------------------------------------------
# embed / shape / normalization
# ---------------------------------------------------------------------------
def test_embed_shape_and_normalized(fake_onnx):
    rec = LVFaceRecognition(model_path=fake_onnx, auto_download=False)
    vec = rec.embed(_crop(1))
    assert vec.shape == (8,)  # dim picked up from the ONNX
    assert rec.dim == 8
    assert np.isclose(np.linalg.norm(vec), 1.0, atol=1e-5)


def test_embed_batch_matches_singles(fake_onnx):
    rec = LVFaceRecognition(model_path=fake_onnx, auto_download=False)
    crops = [_crop(i) for i in range(5)]
    batch = rec.embed_batch(crops)
    assert batch.shape == (5, 8)
    for i, c in enumerate(crops):
        assert np.allclose(batch[i], rec.embed(c), atol=1e-5)
    assert rec.embed_batch([]).shape == (0, 8)


def test_static_batch_padding(tmp_path):
    """A fixed-batch ONNX still handles a non-multiple crop count correctly."""
    static = _build_fake_onnx(tmp_path / "static.onnx", dim=8, batch=4)
    dynamic = _build_fake_onnx(tmp_path / "dyn.onnx", dim=8, batch="N")
    rs = LVFaceRecognition(model_path=static, auto_download=False)
    rd = LVFaceRecognition(model_path=dynamic, auto_download=False)
    assert rs._ensure_session() is not None and rs._static_batch == 4
    crops = [_crop(i) for i in range(6)]  # 6 is not a multiple of 4
    out = rs.embed_batch(crops)
    assert out.shape == (6, 8)
    # padding must not perturb the real rows -> identical to the dynamic model.
    assert np.allclose(out, rd.embed_batch(crops), atol=1e-5)


# ---------------------------------------------------------------------------
# parity gate: adapter vs verbatim reference preprocessing, same ONNX weights
# ---------------------------------------------------------------------------
def _reference_embed(session, in_name, out_name, crop):
    """Verbatim port of LVFace inference_onnx.py preprocessing + L2-norm."""
    import cv2

    from benchmarks.models.base import l2_normalize

    img_resized = cv2.resize(crop, (112, 112))
    img_rgb = cv2.cvtColor(img_resized, cv2.COLOR_BGR2RGB)
    img_t = np.transpose(img_rgb, (2, 0, 1))
    img_n = (((img_t / 255.0) - 0.5) / 0.5).astype(np.float32)[np.newaxis, ...]
    raw = session.run([out_name], {in_name: img_n})[0].ravel()
    return l2_normalize(np.asarray(raw, dtype=np.float32))


def test_parity_with_reference_pipeline(fake_onnx):
    pytest.importorskip("cv2")
    import onnxruntime as ort

    rec = LVFaceRecognition(model_path=fake_onnx, auto_download=False)
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
# download registry (no network)
# ---------------------------------------------------------------------------
def test_known_models_registry():
    assert "lvface_base" in download.KNOWN_MODELS
    spec = download.KNOWN_MODELS["lvface_base"]
    assert spec.license == "MIT"
    assert spec.dim == 512
    assert spec.sha256 and len(spec.sha256) == 64
    assert download.local_path(spec).name.endswith(".onnx")


def test_manifest_entry_shape():
    spec = download.KNOWN_MODELS["lvface_tiny"]
    entry = download.manifest_entry(spec)
    for key in ("source_url", "sha256", "license", "dim", "preprocessing", "local_path"):
        assert key in entry
    assert entry["source_url"].startswith("https://huggingface.co/")


def test_unknown_variant_rejected():
    with pytest.raises(ValueError):
        LVFaceRecognition("lvface_nope", auto_download=False)


# ---------------------------------------------------------------------------
# integration (real weights, only if downloaded)
# ---------------------------------------------------------------------------
@pytest.mark.skipif(not HAS_ORT, reason="onnxruntime not installed")
def test_real_lvface_base_if_present():
    spec = download.KNOWN_MODELS["lvface_base"]
    path = download.local_path(spec)
    if not path.exists():
        pytest.skip("LVFace base weights not downloaded")
    rec = LVFaceRecognition("lvface_base", auto_download=False)
    vec = rec.embed(np.zeros((112, 112, 3), dtype=np.uint8))
    assert vec.shape == (512,)
    assert np.isclose(np.linalg.norm(vec), 1.0, atol=1e-4)
