"""Tests for configurable det_size plumbing.

Covers:
- ``normalize_det_size`` (int / [w,h] / invalid).
- The ``DEFAULT_CONFIG`` default (640 square).
- The backend factory passing an effective det_size through to the backend
  (with the heavy InsightFace backend replaced by a lightweight stand-in).
"""

import pytest

import face_backends
from core.config import DEFAULT_CONFIG
from face_backends import create_backend, normalize_det_size

# --------------------------------------------------------------------------
# normalize_det_size
# --------------------------------------------------------------------------

def test_normalize_single_int_is_square():
    assert normalize_det_size(1280) == (1280, 1280)


def test_normalize_list_pair():
    assert normalize_det_size([800, 600]) == (800, 600)


def test_normalize_tuple_pair():
    assert normalize_det_size((640, 640)) == (640, 640)


def test_normalize_rejects_bool():
    with pytest.raises(ValueError):
        normalize_det_size(True)


@pytest.mark.parametrize("bad", [[640], [1, 2, 3], "640", None, {}])
def test_normalize_rejects_bad_shapes(bad):
    with pytest.raises(ValueError):
        normalize_det_size(bad)


# --------------------------------------------------------------------------
# DEFAULT_CONFIG
# --------------------------------------------------------------------------

def test_default_config_det_size_is_640_square():
    # 640 pending benchmark-track (B3) ground truth: local measurement of
    # 640 vs 1280 was recall-neutral at 1.2-1.75x wall time, so the default
    # is not raised on inconclusive evidence. Raising det_size remains a
    # supported config knob.
    det_size = DEFAULT_CONFIG["backend"]["insightface"]["det_size"]
    assert normalize_det_size(det_size) == (640, 640)


# --------------------------------------------------------------------------
# Backend factory plumbing
# --------------------------------------------------------------------------

class _RecordingBackend:
    """Lightweight stand-in that records the det_size it was constructed with."""

    def __init__(self, model_name="buffalo_l", ctx_id=-1, det_size=(640, 640)):
        self.model_name = model_name
        self.ctx_id = ctx_id
        self.det_size = det_size

    @property
    def backend_name(self):
        return "insightface"


@pytest.fixture
def fake_registry(monkeypatch):
    monkeypatch.setitem(face_backends._backend_registry, "insightface", _RecordingBackend)


def test_factory_passes_configured_det_size_list(fake_registry):
    backend = create_backend({"backend": {"insightface": {"det_size": [1280, 1280]}}})
    assert backend.det_size == (1280, 1280)


def test_factory_passes_configured_det_size_int(fake_registry):
    backend = create_backend({"backend": {"insightface": {"det_size": 960}}})
    assert backend.det_size == (960, 960)


def test_factory_defaults_to_640_when_absent(fake_registry):
    # Absence of the key = default applies (no config migration).
    backend = create_backend({"backend": {"type": "insightface"}})
    assert backend.det_size == (640, 640)


def test_factory_defaults_to_640_with_empty_config(fake_registry):
    backend = create_backend({})
    assert backend.det_size == (640, 640)
