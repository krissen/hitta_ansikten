"""LVFace recognition adapter (ByteDance, ICCV 2025) via onnxruntime.

LVFace is a Vision-Transformer face-recognition head published under MIT at
Hugging Face ``bytedance-research/LVFace`` (variants Tiny/Small/Base/Large).
This adapter runs the ONNX head **directly** on the benchmark's canonical
aligned crop, so LVFace and buffalo_l consume the exact same 112x112 BGR crop
(``models.align.align_112``) and their embeddings are comparable.

Preprocessing is verified against the official reference
(github.com/bytedance/LVFace ``inference_onnx.py``, MIT):

* input a 112x112 face crop,
* convert **BGR -> RGB** (our canonical crop is BGR, insightface's order),
* transpose to **CHW**, add a batch axis -> NCHW,
* normalize ``((x/255) - 0.5) / 0.5`` == ``(x - 127.5) / 127.5`` -> ``[-1, 1]``,
* cast to float32.

The ONNX emits a **raw** (un-normalized) 512-d embedding; the reference does the
L2-normalization only at cosine-similarity time. To match the benchmark's
``RecognitionModel`` contract (embeddings are pre-normalized) we L2-normalize the
raw output here — cosine similarity is invariant to that, so parity with the
reference holds (see ``tests`` / the PR's parity check).

onnxruntime is imported lazily so importing this module never requires it; only
*instantiating* the adapter loads the runtime and the weights.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .base import RecognitionModelBase, l2_normalize

# Reuse the download registry as the single source of truth for variant paths.
from .download import KNOWN_MODELS, download_model, local_path

DEFAULT_VARIANT = "lvface_base"

# ImageNet-style [-1, 1] normalization used by LVFace (== insightface's
# 127.5 mean / (1/127.5) scale, but applied after an explicit BGR->RGB swap).
_MEAN = 127.5
_STD = 127.5


class LVFaceRecognition(RecognitionModelBase):
    """LVFace ONNX recognition head over a canonical 112x112 BGR crop.

    Args:
        variant: a key in :data:`benchmarks.models.download.KNOWN_MODELS`
            (``lvface_tiny`` / ``lvface_small`` / ``lvface_base`` /
            ``lvface_large``). Ignored if ``model_path`` is given.
        model_path: explicit path to an LVFace ``.onnx`` file (overrides
            ``variant`` lookup); useful for tests with a tiny fake model.
        name: the model name used for cache keying and reports. Defaults to the
            variant name so each variant caches into its own ``_data/emb/`` dir.
        auto_download: if True (default) and the variant's weights are absent,
            fetch them via the download tool. Set False for offline/test use.
        providers: onnxruntime execution providers (default CPU).
    """

    def __init__(
        self,
        variant: str = DEFAULT_VARIANT,
        *,
        model_path: str | Path | None = None,
        name: str | None = None,
        auto_download: bool = True,
        providers: list[str] | None = None,
    ) -> None:
        self.variant = variant
        self.dim = 512
        self._providers = providers or ["CPUExecutionProvider"]
        self._session = None
        self._input_name = None
        self._output_name = None
        self._static_batch: int | None = None

        if model_path is not None:
            self._model_path = Path(model_path)
            self.name = name or Path(model_path).stem
        else:
            if variant not in KNOWN_MODELS:
                raise ValueError(
                    f"Unknown LVFace variant {variant!r}; "
                    f"known: {list(KNOWN_MODELS)}"
                )
            spec = KNOWN_MODELS[variant]
            self.dim = spec.dim
            self.name = name or variant
            self._model_path = local_path(spec)
            self._auto_download = auto_download

    # -- lazy session -------------------------------------------------------
    def _ensure_session(self):
        if self._session is not None:
            return self._session

        path = self._model_path
        if not path.exists():
            spec = KNOWN_MODELS.get(self.variant)
            if spec is not None and getattr(self, "_auto_download", False):
                path = download_model(spec)
            else:
                raise FileNotFoundError(
                    f"LVFace weights not found at {path}. Download with:\n"
                    f"  python -m benchmarks.models.download {self.variant}"
                )

        import onnxruntime as ort

        sess = ort.InferenceSession(str(path), providers=self._providers)
        self._input_name = sess.get_inputs()[0].name
        out = sess.get_outputs()[0]
        self._output_name = out.name
        # Trust the ONNX's declared embedding dim when it is static.
        if len(out.shape) == 2 and isinstance(out.shape[1], int):
            self.dim = int(out.shape[1])
        # Detect a fixed (non-dynamic) batch dimension so embed_batch can honor it.
        in_shape = sess.get_inputs()[0].shape
        if in_shape and isinstance(in_shape[0], int):
            self._static_batch = int(in_shape[0])
        self._session = sess
        return sess

    # -- preprocessing ------------------------------------------------------
    @staticmethod
    def _preprocess(aligned_bgr_112: np.ndarray) -> np.ndarray:
        """One 112x112 BGR crop -> ``(3, 112, 112)`` float32 NCHW-ready tensor.

        Mirrors LVFace's ``inference_onnx.py`` exactly (minus the redundant
        resize: the canonical crop is already 112x112).
        """
        img = np.asarray(aligned_bgr_112)
        if img.ndim != 3 or img.shape[2] != 3:
            raise ValueError(f"expected HxWx3 BGR crop, got shape {img.shape}")
        # BGR -> RGB (reverse the channel axis; no cv2 dependency needed).
        rgb = img[:, :, ::-1]
        chw = np.transpose(rgb, (2, 0, 1)).astype(np.float32)
        return (chw - _MEAN) / _STD

    def _run(self, batch: np.ndarray) -> np.ndarray:
        """Run the session on an ``(n, 3, 112, 112)`` tensor -> ``(n, dim)`` raw."""
        sess = self._ensure_session()
        out = sess.run([self._output_name], {self._input_name: batch})[0]
        return np.asarray(out, dtype=np.float32).reshape(batch.shape[0], -1)

    # -- RecognitionModel API ----------------------------------------------
    def embed(self, aligned_bgr_112: np.ndarray) -> np.ndarray:
        tensor = self._preprocess(aligned_bgr_112)[np.newaxis, ...]
        raw = self._run(tensor)[0]
        return l2_normalize(raw)

    def embed_batch(self, aligned_bgr_112_list: list[np.ndarray]) -> np.ndarray:
        if not aligned_bgr_112_list:
            return np.empty((0, self.dim), dtype=np.float32)
        self._ensure_session()
        tensors = np.stack([self._preprocess(a) for a in aligned_bgr_112_list])

        # If the ONNX pins a static batch size, chunk to it; otherwise run the
        # whole stack in one dynamic-batch call.
        if self._static_batch and self._static_batch > 0:
            rows = []
            for start in range(0, len(tensors), self._static_batch):
                chunk = tensors[start:start + self._static_batch]
                if len(chunk) < self._static_batch:
                    pad = self._static_batch - len(chunk)
                    chunk = np.concatenate(
                        [chunk, np.zeros((pad, *chunk.shape[1:]), dtype=np.float32)]
                    )
                    out = self._run(chunk)[: self._static_batch - pad]
                else:
                    out = self._run(chunk)
                rows.append(out)
            raw = np.concatenate(rows, axis=0)
        else:
            raw = self._run(tensors)

        return np.stack([l2_normalize(row) for row in raw]).astype(np.float32)
