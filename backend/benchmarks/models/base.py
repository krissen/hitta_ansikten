"""Light model abstractions for the benchmark harness.

These are deliberately **not** the app's ``FaceBackend`` ABC. They are minimal,
dependency-free protocols so the benchmark can drive several detectors and
recognition heads (buffalo_l today, others later) through one interface, and so
unit tests can substitute fakes without importing insightface.

Two roles:

* ``Detector`` — turns a BGR image into a list of ``Face`` (bbox + 5-point
  landmarks + score). All detectors emit the same ``Face`` shape so alignment
  is model-agnostic.
* ``RecognitionModel`` — turns a *pre-aligned* 112x112 BGR crop into an
  L2-normalized embedding. Batch encoding has a default loop implementation via
  ``RecognitionModelBase``; adapters may override it for throughput.

Alignment (the bridge between the two) lives in ``benchmarks.models.align`` so
every recognition model consumes the exact same canonical crop.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import numpy as np


@dataclass
class Face:
    """One detected face in image pixel coordinates.

    Attributes:
        bbox: ``(4,)`` float array, ``[x1, y1, x2, y2]`` (xyxy).
        kps: ``(5, 2)`` float array of the five landmarks
            (left eye, right eye, nose, left mouth, right mouth) in the order
            insightface's SCRFD emits them — the order ``norm_crop`` expects.
        score: detector confidence in ``[0, 1]``.
    """

    bbox: np.ndarray
    kps: np.ndarray
    score: float

    def __post_init__(self) -> None:
        self.bbox = np.asarray(self.bbox, dtype=np.float32).reshape(4)
        self.kps = np.asarray(self.kps, dtype=np.float32).reshape(5, 2)
        self.score = float(self.score)

    @property
    def bbox_xyxy(self) -> tuple[float, float, float, float]:
        x1, y1, x2, y2 = (float(v) for v in self.bbox)
        return x1, y1, x2, y2


@runtime_checkable
class Detector(Protocol):
    """A face detector emitting canonical ``Face`` records."""

    name: str

    def detect(self, img_bgr: np.ndarray) -> list[Face]:
        """Detect faces in a full-resolution BGR image."""
        ...


@runtime_checkable
class RecognitionModel(Protocol):
    """A recognition head embedding a pre-aligned 112x112 BGR crop."""

    name: str
    dim: int

    def embed(self, aligned_bgr_112: np.ndarray) -> np.ndarray:
        """Return the L2-normalized ``(dim,)`` embedding of one aligned crop."""
        ...

    def embed_batch(self, aligned_bgr_112_list: list[np.ndarray]) -> np.ndarray:
        """Return an ``(n, dim)`` array of L2-normalized embeddings."""
        ...


def l2_normalize(vec: np.ndarray, eps: float = 1e-10) -> np.ndarray:
    """L2-normalize a vector, leaving an all-zero vector unchanged."""
    vec = np.asarray(vec, dtype=np.float32).ravel()
    norm = float(np.linalg.norm(vec))
    if norm <= eps:
        return vec
    return vec / norm


class RecognitionModelBase(ABC):
    """Convenience base providing a default ``embed_batch`` loop.

    Concrete recognition adapters implement :meth:`embed` (single crop) and get
    a correct — if unoptimized — :meth:`embed_batch` for free. Adapters with a
    genuinely batched backend (e.g. a single ONNX call over many crops) should
    override :meth:`embed_batch`.
    """

    name: str = "base"
    dim: int = 0

    @abstractmethod
    def embed(self, aligned_bgr_112: np.ndarray) -> np.ndarray:  # pragma: no cover
        ...

    def embed_batch(self, aligned_bgr_112_list: list[np.ndarray]) -> np.ndarray:
        if not aligned_bgr_112_list:
            return np.empty((0, self.dim), dtype=np.float32)
        out = np.stack([self.embed(a) for a in aligned_bgr_112_list])
        return out.astype(np.float32)
