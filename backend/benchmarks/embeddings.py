"""Compute (and cache) recognition embeddings + blur for matched dataset faces.

Bridges the B2 dataset manifest to the B3 metric layer: for every ``matched``
face (a DB box the detector reproduced, so aligned landmarks are available)
this aligns the crop, embeds it with a recognition model (cached under
``_data/emb/<model>/``), and measures a blur score (variance of the Laplacian of
the aligned crop, cached under ``_data/blur/<detector>.json``). Source images
are decoded once per file.

The heavy dependencies (insightface alignment, cv2) are imported lazily inside
the compute path, so importing this module stays cheap and the ``EmbeddedFace``
dataclass is usable in tests without them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import cache
from . import config as cfg
from .dataset import MATCHED, DatasetFace, load_bgr

BLUR_DIR = cfg.DATA_DIR / "blur"


@dataclass
class EmbeddedFace:
    """A matched DB face with its recomputed embedding and metadata."""

    face_id: str
    identity: str
    image_hash: str
    embedding: np.ndarray
    is_manual: bool
    det_score: float | None
    bbox_area: int | None
    blur: float | None
    path: str | None


def _blur_store_path(detector_name: str) -> Path:
    return BLUR_DIR / f"{cache._sanitize(detector_name)}.json"


def _load_blur_store(detector_name: str) -> dict[str, float]:
    p = _blur_store_path(detector_name)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _save_blur_store(detector_name: str, store: dict[str, float]) -> None:
    BLUR_DIR.mkdir(parents=True, exist_ok=True)
    p = _blur_store_path(detector_name)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(store, sort_keys=True))
    tmp.replace(p)


def variance_of_laplacian(gray: np.ndarray) -> float:
    """Blur score: variance of the Laplacian (low = blurrier)."""
    import cv2

    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def compute_embeddings(
    rows: list[DatasetFace],
    recognition,
    *,
    detector_name: str,
    bbox_area_by_id: dict[str, int] | None = None,
    force: bool = False,
    progress=None,
) -> list[EmbeddedFace]:
    """Embed every matched, encodable face; attach a cached blur score.

    ``recognition`` follows the ``RecognitionModel`` protocol; ``detector_name``
    keys the blur cache (blur is a property of the aligned crop, which depends
    on the detector's landmarks, not the recognition head). ``bbox_area_by_id``
    optionally supplies DB bbox areas keyed by ``face_id``.
    """
    from .models.align import align_112

    matched = [r for r in rows if r.bucket == MATCHED and r.kps is not None]
    blur_store = _load_blur_store(detector_name)
    blur_dirty = False

    # Decode each source image once.
    by_path: dict[str, list[DatasetFace]] = {}
    for r in matched:
        by_path.setdefault(r.path, []).append(r)

    out: list[EmbeddedFace] = []
    done = 0
    for path, image_rows in by_path.items():
        img = None  # decode lazily; may be skipped entirely if all cached
        for r in image_rows:
            kps = np.asarray(r.kps, dtype=np.float32)
            aligned_holder: dict[str, np.ndarray] = {}

            def _decode():
                nonlocal img
                if img is None:
                    img = load_bgr(path)
                return img

            def _aligned():
                if "a" not in aligned_holder:
                    aligned_holder["a"] = align_112(_decode(), kps)
                return aligned_holder["a"]

            def _compute_emb():
                return recognition.embed(_aligned())

            emb = cache.get_or_compute_emb(
                recognition.name, r.face_id, _compute_emb, force=force
            )

            blur = blur_store.get(r.face_id)
            if blur is None or force:
                import cv2

                crop = _aligned()
                gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                blur = variance_of_laplacian(gray)
                blur_store[r.face_id] = blur
                blur_dirty = True

            area = None
            if bbox_area_by_id is not None:
                area = bbox_area_by_id.get(r.face_id)
            if area is None and r.db_bbox_xyxy:
                x1, y1, x2, y2 = r.db_bbox_xyxy
                area = int(abs((x2 - x1) * (y2 - y1)))

            out.append(
                EmbeddedFace(
                    face_id=r.face_id,
                    identity=r.identity,
                    image_hash=r.image_hash,
                    embedding=np.asarray(emb, dtype=np.float64).ravel(),
                    is_manual=r.is_manual,
                    det_score=r.score,
                    bbox_area=area,
                    blur=blur,
                    path=path,
                )
            )
            done += 1
            if progress is not None:
                progress(done, len(matched))

    if blur_dirty:
        _save_blur_store(detector_name, blur_store)
    return out


def stack_embeddings(faces: list[EmbeddedFace]) -> tuple[np.ndarray, list[str]]:
    """Stack ``faces`` into an ``(n, dim)`` array and a parallel label list."""
    if not faces:
        return np.empty((0, 0)), []
    E = np.stack([f.embedding for f in faces])
    labels = [f.identity for f in faces]
    return E, labels
