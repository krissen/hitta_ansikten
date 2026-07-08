"""AdaFace IR-101 recognition adapter via onnxruntime.

AdaFace (Kim et al., CVPR 2022, "AdaFace: Quality Adaptive Margin for Face
Recognition") is the quality-adaptive-margin recognition head that the OODFace
study ranks strongest on hard / low-quality faces (blur, small faces) — the
failure modes this app cares about most. The published weights are PyTorch
checkpoints (MIT, ``github.com/mk-minchul/AdaFace``); there is no official ONNX.
This adapter runs an ONNX **exported from the IR-101 WebFace12M checkpoint**
(see ``export_adaface.py``) directly on the benchmark's canonical aligned crop,
so AdaFace, LVFace and buffalo_l all consume the exact same 112x112 BGR crop
(``models.align.align_112``) and their embeddings are comparable.

Preprocessing is verified against the official reference (AdaFace ``inference.py``
``to_input``, MIT):

    def to_input(pil_rgb_image):
        np_img = np.array(pil_rgb_image)          # PIL RGB -> HxWx3 RGB
        brg_img = ((np_img[:, :, ::-1] / 255.) - 0.5) / 0.5   # RGB -> BGR, [-1,1]
        tensor = torch.tensor([brg_img.transpose(2, 0, 1)]).float()  # NCHW
        return tensor

The reference starts from a **PIL RGB** image and reverses the channel axis to
feed the network **BGR**. Our canonical crop is *already* BGR (insightface's
``norm_crop`` order), so the correct port applies **no channel swap** — it
normalizes the BGR crop in place. This is the one detail that silently tanks
AdaFace's score if gotten wrong (swapping to RGB feeds the net mirrored channels
and produces a false "AdaFace is worse" conclusion); it is the opposite of the
LVFace adapter, which *does* swap BGR->RGB. The parity test pins this exactly.

The IR-101 backbone L2-normalizes its embedding internally (``output = x/‖x‖``),
so the exported ONNX already emits a unit vector; we L2-normalize again to honor
the ``RecognitionModel`` contract (idempotent, cosine-invariant).

onnxruntime is imported lazily so importing this module never requires it; only
*instantiating* the adapter loads the runtime and the weights.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .. import config as cfg
from .base import RecognitionModelBase, l2_normalize

DEFAULT_VARIANT = "adaface_ir101"

# AdaFace's [-1, 1] normalization applied directly to the BGR crop (no swap).
# ((x / 255) - 0.5) / 0.5  ==  (x - 127.5) / 127.5
_MEAN = 127.5
_STD = 127.5


def default_model_path(variant: str = DEFAULT_VARIANT) -> Path:
    """Where the locally-exported AdaFace ONNX lives (``_data/models/...``)."""
    return cfg.DATA_DIR / "models" / variant / f"{variant}.onnx"


class AdaFaceRecognition(RecognitionModelBase):
    """AdaFace IR-101 ONNX recognition head over a canonical 112x112 BGR crop.

    Unlike LVFace, AdaFace ships no official ONNX; the weights must first be
    exported from the PyTorch checkpoint on a networked machine::

        python -m benchmarks.models.export_adaface

    Args:
        variant: model key (only ``adaface_ir101`` today); selects the default
            local ONNX path. Ignored if ``model_path`` is given.
        model_path: explicit path to an AdaFace ``.onnx`` file (overrides the
            variant path); useful for tests with a tiny fake model.
        name: model name used for cache keying / reports (defaults to variant).
        providers: onnxruntime execution providers (default CPU).
    """

    def __init__(
        self,
        variant: str = DEFAULT_VARIANT,
        *,
        model_path: str | Path | None = None,
        name: str | None = None,
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
            self._model_path = default_model_path(variant)
            self.name = name or variant

    # -- lazy session -------------------------------------------------------
    def _ensure_session(self):
        if self._session is not None:
            return self._session

        path = self._model_path
        if not path.exists():
            raise FileNotFoundError(
                f"AdaFace ONNX not found at {path}. AdaFace ships no official "
                f"ONNX; export it from the checkpoint on a networked machine:\n"
                f"  python -m benchmarks.models.export_adaface"
            )

        import onnxruntime as ort

        sess = ort.InferenceSession(str(path), providers=self._providers)
        self._input_name = sess.get_inputs()[0].name
        out = sess.get_outputs()[0]
        self._output_name = out.name
        if len(out.shape) == 2 and isinstance(out.shape[1], int):
            self.dim = int(out.shape[1])
        in_shape = sess.get_inputs()[0].shape
        if in_shape and isinstance(in_shape[0], int):
            self._static_batch = int(in_shape[0])
        self._session = sess
        return sess

    # -- preprocessing ------------------------------------------------------
    @staticmethod
    def _preprocess(aligned_bgr_112: np.ndarray) -> np.ndarray:
        """One 112x112 BGR crop -> ``(3, 112, 112)`` float32 NCHW-ready tensor.

        Mirrors AdaFace's ``to_input`` for a crop that is *already* BGR: no
        channel swap, transpose to CHW, normalize ``(x - 127.5) / 127.5``.
        """
        img = np.asarray(aligned_bgr_112)
        if img.ndim != 3 or img.shape[2] != 3:
            raise ValueError(f"expected HxWx3 BGR crop, got shape {img.shape}")
        # No BGR->RGB swap: AdaFace's net consumes BGR (see module docstring).
        chw = np.transpose(img, (2, 0, 1)).astype(np.float32)
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

        # If the ONNX pins a static batch size, chunk to it (padding the tail);
        # otherwise run the whole stack in one dynamic-batch call.
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
