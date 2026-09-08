"""Tests for the enrollment-quality gate wired into the confirm flow.

A gated face is still confirmed (status success) but its encoding is withheld
from the gallery. Covers single confirm, batch confirm, the disabled state,
corrections (hard negatives still recorded), and manual faces (bypass).
"""

import numpy as np
import pytest

from api.services.detection_service import DetectionService
from core.quality import GateConfig
from tests.conftest import InMemoryDBStore


class FakeBackend:
    backend_name = "insightface"
    distance_metric = "cosine"
    det_size = (640, 640)

    def get_model_info(self):
        return {"version": "test-v1", "model": "test-model"}


def _service(config=None):
    svc = DetectionService.__new__(DetectionService)
    svc.config = config if config is not None else {}
    svc.backend = FakeBackend()
    svc.known_faces = {}
    svc.ignored_faces = []
    svc.hard_negatives = {}
    svc.processed_files = []
    svc.store = InMemoryDBStore(svc)
    from collections import OrderedDict

    svc.encoding_cache = OrderedDict()
    svc._gate_config = GateConfig.from_config(svc.config)
    return svc


_GOOD = {"det_score": 0.85, "crop_px": 200, "sharpness": 400.0}
_BAD = {"det_score": 0.40, "crop_px": 200, "sharpness": 400.0}


def _cache(svc, face_id, quality):
    svc.encoding_cache[face_id] = (
        np.array([1.0, 2.0, 3.0]),
        {"x": 0, "y": 0, "width": 200, "height": 200},
        "hash123",
        quality,
    )


# --------------------------------------------------------------------------
# Single confirm
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_good_face_is_enrolled():
    svc = _service()
    _cache(svc, "face_0", _GOOD)

    out = await svc.confirm_identity("face_0", "Alice", "/a.NEF")

    assert out["status"] == "success"
    assert out["enrolled"] is True
    assert "quality_note" not in out
    assert len(svc.known_faces["Alice"]) == 1


@pytest.mark.asyncio
async def test_bad_face_confirmed_but_not_enrolled():
    svc = _service()
    _cache(svc, "face_0", _BAD)

    out = await svc.confirm_identity("face_0", "Alice", "/a.NEF")

    # Confirmation still succeeds...
    assert out["status"] == "success"
    # ...but the encoding is withheld from the gallery.
    assert out["enrolled"] is False
    assert out["encodings_count"] == 0
    assert out["quality_note"]  # Swedish note present
    assert "Alice" not in svc.known_faces  # no empty person key created


@pytest.mark.asyncio
async def test_disabled_gate_enrolls_bad_face():
    svc = _service({"enrollment_quality": {"enabled": False}})
    _cache(svc, "face_0", _BAD)

    out = await svc.confirm_identity("face_0", "Alice", "/a.NEF")

    assert out["enrolled"] is True
    assert len(svc.known_faces["Alice"]) == 1


@pytest.mark.asyncio
async def test_gated_correction_still_records_hard_negative():
    """A gated face that corrects a suggestion: positive withheld, hard-neg kept."""
    svc = _service()
    _cache(svc, "face_0", _BAD)

    out = await svc.confirm_identity("face_0", "Bob", "/x.NEF", suggested_name="Alice")

    assert out["enrolled"] is False
    assert "Bob" not in svc.known_faces  # positive enrollment withheld
    assert len(svc.hard_negatives["Alice"]) == 1  # match-side curation untouched


# --------------------------------------------------------------------------
# Batch confirm (_confirm_identity_nosave)
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_confirm_gates_bad_enrolls_good():
    svc = _service()
    _cache(svc, "good", _GOOD)
    _cache(svc, "bad", _BAD)

    result = await svc.batch_confirm(
        confirmations=[
            {"face_id": "good", "person_name": "Alice", "image_path": "/a.NEF"},
            {"face_id": "bad", "person_name": "Bob", "image_path": "/b.NEF"},
        ],
        ignores=[],
    )

    assert result["confirmed_count"] == 2  # both confirmations succeed
    assert len(svc.known_faces["Alice"]) == 1  # good enrolled
    assert "Bob" not in svc.known_faces  # bad gated


# --------------------------------------------------------------------------
# Manual faces bypass the gate (no encoding, no crop signals)
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_manual_face_bypasses_gate(tmp_path):
    img = tmp_path / "260111_080910.NEF"
    img.write_bytes(b"nef")
    svc = _service()

    out = await svc.confirm_identity("manual_1", "Alice", str(img))

    assert out["status"] == "success"
    assert len(svc.known_faces["Alice"]) == 1
    assert svc.known_faces["Alice"][0]["encoding"] is None
