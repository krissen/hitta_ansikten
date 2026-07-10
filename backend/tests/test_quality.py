"""Tests for the enrollment-quality gate scoring (core.quality).

Covers the variance-of-Laplacian sharpness on synthetic sharp vs blurred
crops, the all-must-pass gate decision (including None-signal skipping and the
disabled state), and config plumbing.
"""

import numpy as np
import pytest

from core.quality import (
    DEFAULT_MIN_CONFIDENCE,
    GateConfig,
    QualitySignals,
    crop_sharpness,
    evaluate,
    gate_faces_enabled,
    variance_of_laplacian,
)

cv2 = pytest.importorskip("cv2")


def _sharp_crop(size=112, seed=0):
    """A high-frequency (sharp) RGB crop: random noise has a large Laplacian var."""
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(size, size, 3), dtype=np.uint8)


def _flat_crop(size=112, value=127):
    """A perfectly flat crop: Laplacian variance is ~0."""
    return np.full((size, size, 3), value, dtype=np.uint8)


# --------------------------------------------------------------------------
# Sharpness (variance of Laplacian)
# --------------------------------------------------------------------------

def test_sharp_crop_has_higher_sharpness_than_blurred():
    sharp = _sharp_crop()
    blurred = cv2.GaussianBlur(sharp, (0, 0), sigmaX=6)
    assert crop_sharpness(sharp) > crop_sharpness(blurred)


def test_flat_crop_has_near_zero_sharpness():
    assert crop_sharpness(_flat_crop()) < 1.0


def test_variance_of_laplacian_matches_benchmark_formula():
    gray = cv2.cvtColor(_sharp_crop(), cv2.COLOR_RGB2GRAY)
    assert variance_of_laplacian(gray) == pytest.approx(
        float(cv2.Laplacian(gray, cv2.CV_64F).var())
    )


def test_crop_sharpness_none_for_degenerate_crops():
    assert crop_sharpness(np.zeros((0, 0, 3), dtype=np.uint8)) is None
    assert crop_sharpness(np.zeros((1, 1, 3), dtype=np.uint8)) is None
    assert crop_sharpness(None) is None


# --------------------------------------------------------------------------
# Gate decision (all-must-pass)
# --------------------------------------------------------------------------

def _cfg(**kw):
    base = dict(enabled=True, min_confidence=0.60, min_crop_px=60, min_sharpness=15.0)
    base.update(kw)
    return GateConfig(**base)


def test_good_face_passes():
    r = evaluate(QualitySignals(det_score=0.85, crop_px=200, sharpness=400.0), _cfg())
    assert r.passed and r.failures == []
    assert r.note_sv() is None


def test_low_confidence_gates_and_lists_component():
    r = evaluate(QualitySignals(det_score=0.50, crop_px=200, sharpness=400.0), _cfg())
    assert not r.passed
    assert r.failures == ["det_score"]
    assert "detektionssäkerhet" in r.note_sv()


def test_small_crop_gates():
    r = evaluate(QualitySignals(det_score=0.85, crop_px=30, sharpness=400.0), _cfg())
    assert not r.passed and r.failures == ["crop_px"]


def test_flat_crop_gates_on_sharpness():
    r = evaluate(QualitySignals(det_score=0.85, crop_px=200, sharpness=2.0), _cfg())
    assert not r.passed and r.failures == ["sharpness"]


def test_all_must_pass_reports_every_failing_component():
    r = evaluate(QualitySignals(det_score=0.1, crop_px=10, sharpness=1.0), _cfg())
    assert not r.passed
    assert set(r.failures) == {"det_score", "crop_px", "sharpness"}


def test_none_signals_are_skipped_never_gate():
    # Manual/backend-less face: all signals absent -> passes.
    r = evaluate(QualitySignals(), _cfg())
    assert r.passed and r.failures == []


def test_none_confidence_does_not_gate_but_other_signals_still_apply():
    r = evaluate(QualitySignals(det_score=None, crop_px=30, sharpness=400.0), _cfg())
    assert not r.passed and r.failures == ["crop_px"]


def test_disabled_gate_passes_everything():
    r = evaluate(QualitySignals(det_score=0.0, crop_px=1, sharpness=0.0),
                 _cfg(enabled=False))
    assert r.passed and r.failures == []


# --------------------------------------------------------------------------
# Config plumbing
# --------------------------------------------------------------------------

def test_gateconfig_defaults_when_key_absent():
    cfg = GateConfig.from_config({})
    assert cfg.enabled is True
    assert cfg.min_confidence == DEFAULT_MIN_CONFIDENCE
    assert cfg.min_crop_px == 60
    assert cfg.min_sharpness == 15.0


def test_gateconfig_reads_overrides():
    cfg = GateConfig.from_config({
        "enrollment_quality": {
            "enabled": False, "min_confidence": 0.7,
            "min_crop_px": 100, "min_sharpness": 25,
        }
    })
    assert cfg.enabled is False
    assert cfg.min_confidence == 0.7
    assert cfg.min_crop_px == 100
    assert cfg.min_sharpness == 25.0


def test_gate_faces_enabled_helper():
    assert gate_faces_enabled({}) is True
    assert gate_faces_enabled({"enrollment_quality": {"enabled": False}}) is False


def test_default_config_carries_enrollment_quality_block():
    from core.config import DEFAULT_CONFIG

    block = DEFAULT_CONFIG["enrollment_quality"]
    assert block["enabled"] is True
    assert block["min_confidence"] == 0.60
