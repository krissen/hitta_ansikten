"""Three-level on-disk cache for the benchmark harness (all under ``_data/``).

Levels, each keyed so that adding a model or a detector recomputes only the new
column and reruns stay cheap:

1. **Source index** — ``_data/source_index.json`` (owned by ``resolver.py`` /
   B1): SHA1 -> current path. Re-exported here for convenience.
2. **Detections** — ``_data/detections/<image_hash>.<detector_name>.npz`` holding
   ``bboxes`` ``(n,4)``, ``kps`` ``(n,5,2)`` and ``scores`` ``(n,)``. One file per
   (image, detector); a new detector writes a new file, never touching existing.
3. **Embeddings** — ``_data/emb/<model_name>/<face_id>.npy`` (one L2-normalized
   vector per face). ``face_id`` is the DB entry's ``encoding_hash`` for
   DB-matched faces, else a deterministic hash of ``image_hash`` + bbox, so the
   same face gets the same id across runs and across models. A new model writes
   into its own subdirectory only.

Everything here is pure filesystem I/O — no insightface, no DB. Safe to import
and unit-test without heavy deps.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config as cfg

DETECTIONS_DIR = cfg.DATA_DIR / "detections"
EMB_DIR = cfg.DATA_DIR / "emb"


def _sanitize(name: str) -> str:
    """Make a model/detector name safe as a filename component."""
    return "".join(c if (c.isalnum() or c in "-_.") else "_" for c in name)


# -- level 3 keying ---------------------------------------------------------
def deterministic_face_id(image_hash: str, bbox_xyxy) -> str:
    """Stable face id for a face with no DB ``encoding_hash``.

    Derived from the source-image hash plus the (rounded) bbox so the same
    detection maps to the same id across reruns.
    """
    x1, y1, x2, y2 = (round(float(v), 1) for v in bbox_xyxy)
    key = f"{image_hash}:{x1}:{y1}:{x2}:{y2}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


# -- level 2: detections ----------------------------------------------------
@dataclass
class DetectionRecord:
    """Cached detector output for one image."""

    bboxes: np.ndarray  # (n, 4) xyxy
    kps: np.ndarray  # (n, 5, 2)
    scores: np.ndarray  # (n,)

    def __len__(self) -> int:
        return int(self.bboxes.shape[0])


def detections_path(image_hash: str, detector_name: str) -> Path:
    return DETECTIONS_DIR / f"{image_hash}.{_sanitize(detector_name)}.npz"


def save_detections(image_hash: str, detector_name: str, faces) -> Path:
    """Persist a list of ``models.Face`` for one (image, detector)."""
    DETECTIONS_DIR.mkdir(parents=True, exist_ok=True)
    if faces:
        bboxes = np.stack([np.asarray(f.bbox, dtype=np.float32) for f in faces])
        kps = np.stack([np.asarray(f.kps, dtype=np.float32) for f in faces])
        scores = np.asarray([float(f.score) for f in faces], dtype=np.float32)
    else:
        bboxes = np.empty((0, 4), dtype=np.float32)
        kps = np.empty((0, 5, 2), dtype=np.float32)
        scores = np.empty((0,), dtype=np.float32)
    path = detections_path(image_hash, detector_name)
    tmp = path.with_suffix(path.suffix + ".tmp")
    # np.savez appends ".npz" to a str/Path target; write via a handle so the
    # temp filename is used verbatim, then atomically replace.
    with open(tmp, "wb") as fh:
        np.savez(fh, bboxes=bboxes, kps=kps, scores=scores)
    tmp.replace(path)
    return path


def load_detections(image_hash: str, detector_name: str) -> DetectionRecord | None:
    path = detections_path(image_hash, detector_name)
    if not path.exists():
        return None
    with np.load(path) as data:
        return DetectionRecord(bboxes=data["bboxes"], kps=data["kps"], scores=data["scores"])


def get_or_compute_detections(
    image_hash: str, detector, img_bgr, force: bool = False
) -> DetectionRecord:
    """Return cached detections or run ``detector.detect`` and cache them."""
    if not force:
        cached = load_detections(image_hash, detector.name)
        if cached is not None:
            return cached
    faces = detector.detect(img_bgr)
    save_detections(image_hash, detector.name, faces)
    return load_detections(image_hash, detector.name)  # normalized round-trip


# -- level 3: embeddings ----------------------------------------------------
def emb_path(model_name: str, face_id: str) -> Path:
    return EMB_DIR / _sanitize(model_name) / f"{face_id}.npy"


def save_emb(model_name: str, face_id: str, vector: np.ndarray) -> Path:
    path = emb_path(model_name, face_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".npy.tmp")
    # np.save appends ".npy" to a str/Path target; write via a handle instead.
    with open(tmp, "wb") as fh:
        np.save(fh, np.asarray(vector, dtype=np.float32))
    tmp.replace(path)
    return path


def load_emb(model_name: str, face_id: str) -> np.ndarray | None:
    path = emb_path(model_name, face_id)
    if not path.exists():
        return None
    return np.load(path)


def get_or_compute_emb(
    model_name: str,
    face_id: str,
    compute,
    force: bool = False,
) -> np.ndarray:
    """Return the cached embedding for ``face_id`` or compute+cache via ``compute()``."""
    if not force:
        cached = load_emb(model_name, face_id)
        if cached is not None:
            return cached
    vector = compute()
    save_emb(model_name, face_id, vector)
    return np.asarray(vector, dtype=np.float32)
