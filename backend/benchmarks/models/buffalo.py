"""insightface buffalo_l adapters: detector + recognition head.

Two thin adapters onto the ``base`` protocols:

* :class:`BuffaloDetector` — SCRFD detection via ``FaceAnalysis`` with only the
  detection module loaded, at a configurable ``det_size``.
* :class:`BuffaloRecognition` — the buffalo_l recognition head (``w600k_r50``)
  invoked **directly** on a pre-aligned 112x112 BGR crop, bypassing its internal
  detector. Preprocessing is insightface's own (``get_feat`` -> ``blobFromImages``
  with ``1/127.5`` scale, ``127.5`` mean, ``swapRB=True``); we only L2-normalize
  the raw embedding so it matches ``Face.normed_embedding`` — the vector the app
  stored in ``encodings.pkl``.

insightface is imported lazily so importing this module never requires the
package; only *instantiating* an adapter does.
"""

from __future__ import annotations

import glob
import os
from pathlib import Path

import numpy as np

from .base import Face, RecognitionModelBase, l2_normalize

DEFAULT_MODEL_NAME = "buffalo_l"
DEFAULT_DET_SIZE = (640, 640)


def normalize_det_size(det_size) -> tuple[int, int]:
    """Coerce a det_size into a validated ``(w, h)`` int tuple.

    Mirrors the app's ``det_size`` contract (see ``face_backends``): a pair of
    positive integers. A single int is broadened to a square.
    """
    if isinstance(det_size, int):
        det_size = (det_size, det_size)
    if not isinstance(det_size, (tuple, list)) or len(det_size) != 2:
        raise ValueError(f"det_size must be a 2-tuple or int (got {det_size!r})")
    w, h = int(det_size[0]), int(det_size[1])
    if w <= 0 or h <= 0:
        raise ValueError(f"det_size dimensions must be positive (got {det_size!r})")
    return (w, h)


def _buffalo_model_dir(model_name: str = DEFAULT_MODEL_NAME, root: str = "~/.insightface") -> Path:
    """Locate (downloading if needed) the buffalo model pack directory."""
    from insightface.utils import ensure_available

    return Path(ensure_available("models", model_name, root=root))


def _load_recognition_model(model_name: str = DEFAULT_MODEL_NAME):
    """Return the recognition ``ArcFaceONNX`` model from a buffalo pack."""
    from insightface import model_zoo

    model_dir = _buffalo_model_dir(model_name)
    for onnx_file in sorted(glob.glob(os.path.join(str(model_dir), "*.onnx"))):
        model = model_zoo.get_model(onnx_file)
        if model is not None and getattr(model, "taskname", None) == "recognition":
            return model
    raise RuntimeError(f"No recognition model found in {model_dir}")


class BuffaloDetector:
    """SCRFD face detector from a buffalo pack (detection module only)."""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL_NAME,
        det_size=DEFAULT_DET_SIZE,
        ctx_id: int = -1,
        det_thresh: float = 0.5,
    ) -> None:
        self.model_name = model_name
        self.det_size = normalize_det_size(det_size)
        self.ctx_id = ctx_id
        self.det_thresh = det_thresh
        self.name = model_name
        self._app = None

    def _ensure_app(self):
        if self._app is None:
            from insightface.app import FaceAnalysis

            app = FaceAnalysis(name=self.model_name, allowed_modules=["detection"])
            app.prepare(ctx_id=self.ctx_id, det_thresh=self.det_thresh, det_size=self.det_size)
            self._app = app
        return self._app

    def detect(self, img_bgr: np.ndarray) -> list[Face]:
        app = self._ensure_app()
        faces = app.get(img_bgr)
        out: list[Face] = []
        for f in faces:
            if f.kps is None:
                continue
            out.append(Face(bbox=f.bbox, kps=f.kps, score=float(f.det_score)))
        return out


class BuffaloRecognition(RecognitionModelBase):
    """buffalo_l recognition head, run directly on aligned 112x112 BGR crops."""

    def __init__(self, model_name: str = DEFAULT_MODEL_NAME, ctx_id: int = -1) -> None:
        self.name = model_name
        self.dim = 512
        self.ctx_id = ctx_id
        self._model = None

    def _ensure_model(self):
        if self._model is None:
            model = _load_recognition_model(self.name)
            model.prepare(ctx_id=self.ctx_id)
            self.dim = int(model.output_shape[1])
            self._model = model
        return self._model

    def embed(self, aligned_bgr_112: np.ndarray) -> np.ndarray:
        model = self._ensure_model()
        feat = model.get_feat(aligned_bgr_112).flatten()
        return l2_normalize(feat)

    def embed_batch(self, aligned_bgr_112_list: list[np.ndarray]) -> np.ndarray:
        if not aligned_bgr_112_list:
            return np.empty((0, self.dim), dtype=np.float32)
        model = self._ensure_model()
        # get_feat accepts a list of crops and returns one row per crop.
        feats = model.get_feat(list(aligned_bgr_112_list))
        return np.stack([l2_normalize(row) for row in feats]).astype(np.float32)
