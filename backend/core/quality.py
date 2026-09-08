"""
quality.py - Face-image quality gate for enrollment.

A lightweight, proxy quality score computed from signals already available at
detection time — no extra model dependency. It exists to keep clearly-bad face
crops from being *enrolled* into the gallery (``encodings.pkl``), where a poor
embedding would poison future matching. It never touches the match path.

Signals
-------
- **det_score** — the detector's own confidence for the face box (InsightFace
  SCRFD ``det_score``). Calibration on the owner's confirmed database (2,923
  buffalo_l faces, see ``docs/dev/face-recognition-audit-2026-07.md``) showed
  this is the *only* one of the three signals that separates bad enrollments
  from good ones: ``det_score < 0.60`` gates 0.5% of enrollments, of which ~23%
  are rank-1 failures — a 23x enrichment over the 1% base rate. It is the
  load-bearing component.
- **crop_px** — the shorter side of the face box in full-resolution pixels.
  A pure degenerate-crop floor: on the confirmed set even the smallest boxes
  (~77 px) recognized fine, so the default floor sits *below* anything observed
  and only guards against future junk (a 30 px thumbnail, a bad manual box).
- **sharpness** — variance of the Laplacian of the aligned/face crop (the same
  formula the benchmark blur code uses). On the confirmed set this did NOT
  predict recognition failure (failing faces were often *sharper*), so it is
  likewise only a degenerate-crop floor for a near-flat crop, set below the
  observed minimum (~18).

The rule is **all-must-pass**: a face is gated (not enrolled) if ANY present
signal falls below its threshold. A signal that is ``None`` (e.g. det_score from
a backend that does not expose it) is skipped, never a reason to gate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

# === Default thresholds (see module docstring for calibration) ===
# det_score < 0.60 is the calibrated, load-bearing gate.
DEFAULT_MIN_CONFIDENCE = 0.60
# Shorter-box-side floor in full-res px; below the confirmed-set minimum (~77 px)
# so it gates zero historical enrollments — a degenerate-crop guard only.
DEFAULT_MIN_CROP_PX = 60
# Variance-of-Laplacian floor; below the confirmed-set minimum (~18) so it only
# catches a near-flat crop.
DEFAULT_MIN_SHARPNESS = 15.0


def variance_of_laplacian(gray: np.ndarray) -> float:
    """Blur score: variance of the Laplacian (low = blurrier).

    Same formula as ``backend/benchmarks/embeddings.py`` — kept in sync so the
    gate and the benchmark measure sharpness identically.
    """
    import cv2

    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def crop_sharpness(rgb_crop: np.ndarray) -> float | None:
    """Variance-of-Laplacian sharpness of an RGB face crop.

    Returns ``None`` for an empty/degenerate crop (nothing to measure).
    """
    if rgb_crop is None or rgb_crop.size == 0:
        return None
    if rgb_crop.shape[0] < 2 or rgb_crop.shape[1] < 2:
        return None
    import cv2

    gray = cv2.cvtColor(rgb_crop, cv2.COLOR_RGB2GRAY)
    return variance_of_laplacian(gray)


@dataclass
class QualitySignals:
    """The three proxy signals for one detected face.

    ``det_score`` and ``crop_px`` / ``sharpness`` are all optional so a face
    with a missing signal simply skips that component of the gate.
    """

    det_score: float | None = None
    crop_px: int | None = None
    sharpness: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "det_score": self.det_score,
            "crop_px": self.crop_px,
            "sharpness": self.sharpness,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> "QualitySignals":
        if not d:
            return cls()
        return cls(
            det_score=d.get("det_score"),
            crop_px=d.get("crop_px"),
            sharpness=d.get("sharpness"),
        )


@dataclass
class GateConfig:
    """Resolved enrollment-quality gate settings."""

    enabled: bool = True
    min_confidence: float = DEFAULT_MIN_CONFIDENCE
    min_crop_px: int = DEFAULT_MIN_CROP_PX
    min_sharpness: float = DEFAULT_MIN_SHARPNESS

    @classmethod
    def from_config(cls, config: dict[str, Any] | None) -> "GateConfig":
        """Build from an app config dict; absent keys fall back to defaults."""
        block = {}
        if config:
            block = config.get("enrollment_quality") or {}
        return cls(
            enabled=bool(block.get("enabled", True)),
            min_confidence=float(block.get("min_confidence", DEFAULT_MIN_CONFIDENCE)),
            min_crop_px=int(block.get("min_crop_px", DEFAULT_MIN_CROP_PX)),
            min_sharpness=float(block.get("min_sharpness", DEFAULT_MIN_SHARPNESS)),
        )


@dataclass
class GateResult:
    """Outcome of evaluating one face against the gate.

    ``passed`` is True when the face may be enrolled. ``failures`` lists the
    failing components (e.g. ``["det_score"]``) for logging / a user note.
    """

    passed: bool
    failures: list[str] = field(default_factory=list)
    signals: QualitySignals = field(default_factory=QualitySignals)

    def note_sv(self) -> str | None:
        """User-facing Swedish note explaining a gated (not-enrolled) face.

        Returns ``None`` when the face passed (nothing to explain).
        """
        if self.passed:
            return None
        reasons = {
            "det_score": "låg detektionssäkerhet",
            "crop_px": "för litet ansikte",
            "sharpness": "för suddig bild",
        }
        parts = [reasons.get(f, f) for f in self.failures]
        detail = ", ".join(parts) if parts else "låg bildkvalitet"
        return f"Namnet sparades, men ansiktet lades inte till i ansiktsbanken ({detail})."


def evaluate(signals: QualitySignals, cfg: GateConfig) -> GateResult:
    """Apply the all-must-pass gate to one face's signals.

    A signal that is ``None`` is skipped (never a reason to gate). When the gate
    is disabled every face passes.
    """
    if not cfg.enabled:
        return GateResult(passed=True, failures=[], signals=signals)

    failures: list[str] = []
    if signals.det_score is not None and signals.det_score < cfg.min_confidence:
        failures.append("det_score")
    if signals.crop_px is not None and signals.crop_px < cfg.min_crop_px:
        failures.append("crop_px")
    if signals.sharpness is not None and signals.sharpness < cfg.min_sharpness:
        failures.append("sharpness")

    return GateResult(passed=not failures, failures=failures, signals=signals)


def gate_faces_enabled(config: dict[str, Any] | None) -> bool:
    """Convenience: is the enrollment-quality gate enabled in ``config``?"""
    return GateConfig.from_config(config).enabled
