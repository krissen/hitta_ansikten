"""Canonical face alignment for the benchmark harness.

Every recognition model consumes the *same* aligned crop so embeddings are
comparable across models and against the stored database vectors. Alignment is
insightface's ``norm_crop`` (ArcFace 5-point similarity transform to a fixed
112x112 template) — the exact transform the app used when it produced the
encodings in ``encodings.pkl``.

insightface is imported lazily so this module (and the protocols in ``base``)
stay importable in environments without it; only calling :func:`align_112`
requires the package.
"""

from __future__ import annotations

import numpy as np

ALIGNED_SIZE = 112


def align_112(img_bgr: np.ndarray, kps: np.ndarray) -> np.ndarray:
    """Align a face to a 112x112 BGR crop via insightface's ``norm_crop``.

    Args:
        img_bgr: full image in BGR order (as insightface expects).
        kps: ``(5, 2)`` landmark array in SCRFD order.

    Returns:
        A ``(112, 112, 3)`` uint8 BGR crop ready for a recognition head's
        preprocessing (which itself handles the BGR->RGB swap and scaling).
    """
    from insightface.utils import face_align

    kps = np.asarray(kps, dtype=np.float32).reshape(5, 2)
    return face_align.norm_crop(img_bgr, landmark=kps, image_size=ALIGNED_SIZE)
