"""YOLO-face detector adapter for the benchmark harness (onnxruntime only).

A ``Detector`` (see ``base.py``) backed by a YOLOv8-face ONNX model that emits
five facial landmarks per face — the landmarks ``align_112`` (insightface
``norm_crop``) needs, in the same order SCRFD uses (left eye, right eye, nose,
left-mouth, right-mouth). This lets the harness compare YOLO-family detection
against SCRFD (buffalo_l) on the exact same DB ground truth.

**No torch / ultralytics runtime dependency.** Only ``onnxruntime`` + ``cv2`` +
``numpy`` are imported (lazily). The ONNX model is produced offline (see
``download.py``); this module just runs and decodes it.

Three ONNX output layouts are supported and auto-detected:

* **raw YOLOv8-pose head** ``(1, 4 + nc + 3K, N)`` — box ``(cx, cy, w, h)`` +
  per-class scores + ``K`` landmarks ``(x, y, visibility)`` over ``N`` anchor
  points, *before* NMS. The adapter applies confidence filtering and NMS.
* **NMS-baked pose head** ``(1, M, 6 + 3K)`` — one row per kept detection
  ``[x1, y1, x2, y2, score, class, (x, y, vis) * K]`` (ultralytics ``nms=True``
  export). NMS is already applied; the adapter only confidence-filters.
* **NMS-baked detection head** ``(1, M, 6)`` — the ``K = 0`` special case of the
  above: ``[x1, y1, x2, y2, score, class]`` with **no landmarks**. The
  akanametov *large* face variants (``yolov8l-face`` / ``yolov12l-face``) ship
  as plain detectors, not pose models, so they carry no 5-point head. The
  adapter still decodes their boxes (all this comparison's detection-recall
  metrics need) and emits ``NaN`` landmarks — usable for the detection A/B but
  not for the alignment/recognition path (which requires the 5 points).

All layouts carry coordinates in the letterboxed input space; the adapter maps
them back to original-image pixels. The pure pieces (``letterbox``,
``decode_raw``, ``decode_nms_baked``, ``nms_baked_kpt_count``, ``nms``) are
import-light and unit-tested against synthetic tensors without onnxruntime or a
real model.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .. import config as _cfg
from .base import Face

# Downloaded ONNX weights live under the gitignored data dir.
MODELS_DIR = _cfg.DATA_DIR / "models"

# Default landmark count for face models (WIDERFACE 5-point).
NUM_KPTS = 5
DEFAULT_INPUT_SIZE = 640
DEFAULT_CONF_THRESH = 0.5
DEFAULT_IOU_THRESH = 0.45
DEFAULT_MODEL_NAME = "yolov8n-face"


# ---------------------------------------------------------------------------
# preprocessing
# ---------------------------------------------------------------------------
def letterbox(
    img_bgr: np.ndarray, new_size: int = DEFAULT_INPUT_SIZE, color: int = 114
) -> tuple[np.ndarray, float, int, int]:
    """Resize ``img_bgr`` into a ``new_size`` square, preserving aspect ratio.

    Returns ``(canvas, ratio, pad_left, pad_top)`` where ``ratio`` is the single
    scale applied and ``(pad_left, pad_top)`` the top-left offset of the resized
    image inside the padded square — everything :func:`unmap_points` needs to go
    back to original coordinates.
    """
    import cv2

    h, w = img_bgr.shape[:2]
    ratio = min(new_size / h, new_size / w)
    nh, nw = int(round(h * ratio)), int(round(w * ratio))
    resized = cv2.resize(img_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((new_size, new_size, 3), color, dtype=img_bgr.dtype)
    top = (new_size - nh) // 2
    left = (new_size - nw) // 2
    canvas[top : top + nh, left : left + nw] = resized
    return canvas, ratio, left, top


def preprocess(canvas_bgr: np.ndarray) -> np.ndarray:
    """BGR letterboxed square -> ``(1, 3, S, S)`` float32 RGB blob in ``[0, 1]``.

    Matches ultralytics preprocessing (RGB, ``/255``, no mean subtraction).
    """
    import cv2

    rgb = cv2.cvtColor(canvas_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    return np.ascontiguousarray(rgb.transpose(2, 0, 1)[None])


# ---------------------------------------------------------------------------
# decoding
# ---------------------------------------------------------------------------
def cxcywh_to_xyxy(boxes: np.ndarray) -> np.ndarray:
    """Convert ``(n, 4)`` ``(cx, cy, w, h)`` boxes to ``(n, 4)`` ``(x1, y1, x2, y2)``."""
    boxes = np.asarray(boxes, dtype=np.float32)
    xy = np.empty_like(boxes)
    xy[:, 0] = boxes[:, 0] - boxes[:, 2] / 2.0
    xy[:, 1] = boxes[:, 1] - boxes[:, 3] / 2.0
    xy[:, 2] = boxes[:, 0] + boxes[:, 2] / 2.0
    xy[:, 3] = boxes[:, 1] + boxes[:, 3] / 2.0
    return xy


def is_nms_baked(output: np.ndarray, num_kpts: int = NUM_KPTS) -> bool:
    """True if ``output`` is a per-detection NMS-baked head ``(1, M, 6 + 3K)``."""
    arr = np.asarray(output)
    return arr.ndim == 3 and arr.shape[-1] == 6 + 3 * num_kpts


def nms_baked_kpt_count(output: np.ndarray) -> int | None:
    """Landmark count ``K`` for an NMS-baked head ``(1, M, 6 + 3K)``, else ``None``.

    A per-detection head packs six box/score/class columns plus ``3K`` landmark
    columns, so a trailing width of ``6 + 3K`` uniquely identifies ``K``. ``K = 0``
    is a **landmark-less detector** (``(1, M, 6)`` — the akanametov *large* face
    variants, which are plain detect models, not pose models). Returns ``None``
    for any shape that is not a valid NMS-baked head (e.g. the raw pose head,
    ``(1, 4 + nc + 3K, N)``, whose ``N`` anchor axis is last and huge), which the
    caller routes to :func:`decode_raw` instead.

    The NMS-baked head carries one row per detection (``M``, typically padded to
    a few hundred) and a small feature width in the last axis, so ``M >= C``; the
    raw head is the transpose (small feature axis, thousands of anchors last), so
    ``C > M``. That rows-dominate check keeps a raw head's anchor count from
    masquerading as a huge landmark count.
    """
    arr = np.asarray(output)
    if arr.ndim != 3:
        return None
    rows, cols = arr.shape[1], arr.shape[2]
    extra = cols - 6
    if extra < 0 or extra % 3 != 0 or rows < cols:
        return None
    return extra // 3


def decode_raw(
    output: np.ndarray, conf_thresh: float, num_kpts: int = NUM_KPTS
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Decode a raw YOLOv8-pose head ``(1, 4 + nc + 3K, N)`` (pre-NMS).

    Returns ``(xyxy, scores, kps)`` in letterboxed-input coordinates, where
    ``kps`` is ``(n, K, 2)`` (visibility dropped). Rows below ``conf_thresh`` are
    filtered out. ``nc`` (class count) is inferred from the channel dimension.
    """
    arr = np.asarray(output, dtype=np.float32)
    if arr.ndim == 3:
        arr = arr[0]
    channels = arr.shape[0]
    nc = channels - 4 - 3 * num_kpts
    if nc < 1:
        raise ValueError(f"raw head has {channels} channels; expected >= {4 + 1 + 3 * num_kpts}")
    p = arr.T  # (N, channels)
    boxes = p[:, 0:4]
    scores = p[:, 4 : 4 + nc].max(axis=1)
    kps_start = 4 + nc
    kps = p[:, kps_start : kps_start + 3 * num_kpts].reshape(-1, num_kpts, 3)

    keep = scores >= conf_thresh
    xyxy = cxcywh_to_xyxy(boxes[keep])
    return xyxy, scores[keep].astype(np.float32), kps[keep, :, :2].astype(np.float32)


def decode_nms_baked(
    output: np.ndarray, conf_thresh: float, num_kpts: int = NUM_KPTS
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Decode an NMS-baked head ``(1, M, 6 + 3K)`` (rows already NMS'd).

    Row layout: ``[x1, y1, x2, y2, score, class, (x, y, vis) * K]``. Returns
    ``(xyxy, scores, kps)`` in letterboxed-input coordinates; ``kps`` is
    ``(n, K, 2)`` (``K`` may be 0 for a landmark-less detection head). Zero-padding
    rows (score 0) fall below ``conf_thresh``.
    """
    arr = np.asarray(output, dtype=np.float32)
    if arr.ndim == 3:
        arr = arr[0]
    scores = arr[:, 4]
    keep = scores >= conf_thresh
    kept = arr[keep]
    xyxy = kept[:, 0:4]
    # reshape(-1, 0, 3) can't infer the row count when K == 0, so build the empty
    # landmark array explicitly for a landmark-less detection head.
    if num_kpts == 0:
        kps = np.empty((kept.shape[0], 0, 2), dtype=np.float32)
    else:
        kps = kept[:, 6 : 6 + 3 * num_kpts].reshape(-1, num_kpts, 3)[:, :, :2]
    return xyxy.astype(np.float32), scores[keep].astype(np.float32), kps.astype(np.float32)


def nms(boxes_xyxy: np.ndarray, scores: np.ndarray, iou_thresh: float) -> list[int]:
    """Greedy non-maximum suppression. Returns kept indices (highest score first)."""
    boxes = np.asarray(boxes_xyxy, dtype=np.float32)
    scores = np.asarray(scores, dtype=np.float32)
    if boxes.shape[0] == 0:
        return []
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1]

    keep: list[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(x1[i], x1[rest])
        yy1 = np.maximum(y1[i], y1[rest])
        xx2 = np.minimum(x2[i], x2[rest])
        yy2 = np.minimum(y2[i], y2[rest])
        iw = np.maximum(0.0, xx2 - xx1)
        ih = np.maximum(0.0, yy2 - yy1)
        inter = iw * ih
        union = areas[i] + areas[rest] - inter
        iou = np.where(union > 0, inter / union, 0.0)
        order = rest[iou <= iou_thresh]
    return keep


def unmap_points(pts: np.ndarray, ratio: float, pad_left: int, pad_top: int) -> np.ndarray:
    """Map points from letterboxed-input space back to original-image pixels."""
    out = np.asarray(pts, dtype=np.float32).copy()
    out[..., 0] = (out[..., 0] - pad_left) / ratio
    out[..., 1] = (out[..., 1] - pad_top) / ratio
    return out


# ---------------------------------------------------------------------------
# detector
# ---------------------------------------------------------------------------
def default_model_path(model_name: str = DEFAULT_MODEL_NAME) -> Path:
    """Where ``download.py`` places the ONNX for ``model_name``.

    Mirrors ``download.local_path``'s ``_data/models/<name>/<file>`` layout
    without importing the CLI module (this module stays import-light).
    """
    return MODELS_DIR / model_name / f"{model_name}.onnx"


class YoloFaceDetector:
    """YOLOv8-face ONNX detector emitting canonical ``Face`` records.

    Args:
        model_path: path to the ONNX file. Defaults to the ``download.py``
            location for ``model_name``.
        model_name: logical model name; also the detection-cache column key
            (``.name``), so a new model never collides with buffalo's cache.
        input_size: square network input (letterbox target). Larger values find
            smaller faces at higher cost.
        conf_thresh / iou_thresh: confidence floor and NMS IoU (NMS applies only
            to raw-head models; NMS-baked models are only confidence-filtered).
        providers: onnxruntime execution providers (default CPU for determinism).
    """

    def __init__(
        self,
        model_path: str | Path | None = None,
        *,
        model_name: str = DEFAULT_MODEL_NAME,
        input_size: int = DEFAULT_INPUT_SIZE,
        conf_thresh: float = DEFAULT_CONF_THRESH,
        iou_thresh: float = DEFAULT_IOU_THRESH,
        num_kpts: int = NUM_KPTS,
        providers: list[str] | None = None,
    ) -> None:
        self.model_path = Path(model_path) if model_path else default_model_path(model_name)
        self.name = model_name
        self.input_size = int(input_size)
        self.conf_thresh = float(conf_thresh)
        self.iou_thresh = float(iou_thresh)
        self.num_kpts = int(num_kpts)
        self._providers = providers or ["CPUExecutionProvider"]
        self._session = None
        self._input_name = None

    def _ensure_session(self):
        if self._session is None:
            import onnxruntime as ort

            if not self.model_path.exists():
                raise FileNotFoundError(
                    f"YOLO-face model not found at {self.model_path}. "
                    f"Run: python -m benchmarks.models.download {self.name}"
                )
            self._session = ort.InferenceSession(str(self.model_path), providers=self._providers)
            self._input_name = self._session.get_inputs()[0].name
        return self._session

    def detect(self, img_bgr: np.ndarray) -> list[Face]:
        session = self._ensure_session()
        canvas, ratio, pad_left, pad_top = letterbox(img_bgr, self.input_size)
        blob = preprocess(canvas)
        output = session.run(None, {self._input_name: blob})[0]

        baked_kpts = nms_baked_kpt_count(output)
        if baked_kpts is not None:
            # NMS already applied; decode however many landmarks the head carries
            # (``baked_kpts`` may be 0 for the landmark-less large detectors).
            xyxy, scores, kps = decode_nms_baked(output, self.conf_thresh, baked_kpts)
            n_kpts = baked_kpts
        else:
            xyxy, scores, kps = decode_raw(output, self.conf_thresh, self.num_kpts)
            keep = nms(xyxy, scores, self.iou_thresh)
            xyxy, scores, kps = xyxy[keep], scores[keep], kps[keep]
            n_kpts = self.num_kpts

        boxes_orig = unmap_points(xyxy.reshape(-1, 2, 2), ratio, pad_left, pad_top)
        kps_orig = unmap_points(kps, ratio, pad_left, pad_top)
        # A landmark-less detector (K < 5) still yields boxes for the detection
        # A/B; its Face landmarks are NaN so a downstream alignment attempt fails
        # loudly rather than silently aligning on garbage.
        nan_kps = np.full((NUM_KPTS, 2), np.nan, dtype=np.float32)

        faces: list[Face] = []
        for i in range(xyxy.shape[0]):
            kp = kps_orig[i, :NUM_KPTS] if n_kpts >= NUM_KPTS else nan_kps
            faces.append(
                Face(
                    bbox=boxes_orig[i].reshape(4),
                    kps=kp,
                    score=float(scores[i]),
                )
            )
        return faces
