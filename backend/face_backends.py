"""
Face recognition backend abstraction layer.

Provides pluggable backends for face detection and recognition.
Supports both dlib (via face_recognition) and InsightFace.
"""

import logging
from abc import ABC, abstractmethod

import numpy as np

# Constants
EPSILON_NORM = 1e-6  # Small value to avoid division by zero in normalization


def normalize_det_size(value) -> tuple[int, int]:
    """Normalize a det_size config value to a (width, height) tuple.

    Accepts a single int (interpreted as a square N×N), or a [w, h] / (w, h)
    pair. Returns a tuple of two ints. Raises ValueError on other shapes so
    misconfigurations surface at backend construction rather than silently.
    """
    if isinstance(value, bool):
        # bool is an int subclass; reject it explicitly to avoid True -> (1, 1).
        raise ValueError(f"det_size must be an int or [w, h] pair (got {value!r})")
    if isinstance(value, int):
        return (value, value)
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return (int(value[0]), int(value[1]))
    raise ValueError(f"det_size must be an int or [w, h] pair (got {value!r})")


class FaceBackend(ABC):
    """Abstract interface for face detection and recognition backends."""

    @property
    @abstractmethod
    def backend_name(self) -> str:
        """Returns backend identifier (e.g., 'dlib', 'insightface')."""
        pass

    @property
    @abstractmethod
    def encoding_dim(self) -> int:
        """Returns dimensionality of face encodings."""
        pass

    @property
    @abstractmethod
    def distance_metric(self) -> str:
        """Returns 'euclidean' or 'cosine'."""
        pass

    @abstractmethod
    def detect_faces(self, rgb_image: np.ndarray, model: str, upsample: int) -> tuple[list, list[np.ndarray]]:
        """
        Detect faces in image.

        Args:
            rgb_image: RGB numpy array
            model: Detection model ('hog', 'cnn', etc.)
            upsample: Upsampling factor for detection

        Returns:
            (face_locations, face_encodings)
            face_locations: List of (top, right, bottom, left) tuples
            face_encodings: List of encoding vectors
        """
        pass

    @abstractmethod
    def compute_distance(self, encoding1: np.ndarray, encoding2: np.ndarray) -> float:
        """Compute distance between two encodings."""
        pass

    @abstractmethod
    def compute_distances(self, encodings: np.ndarray, target_encoding: np.ndarray) -> np.ndarray:
        """
        Vectorized distance computation.

        Args:
            encodings: Array of shape (n, encoding_dim)
            target_encoding: Single encoding of shape (encoding_dim,)

        Returns:
            Array of distances of shape (n,)
        """
        pass

    def normalize_encoding(self, encoding: np.ndarray) -> np.ndarray:
        """
        Normalize encoding if needed (e.g., L2 normalization for cosine similarity).

        Args:
            encoding: Face encoding vector

        Returns:
            Normalized encoding
        """
        return encoding

    @abstractmethod
    def get_model_info(self) -> dict:
        """Returns metadata about loaded models."""
        pass


class DlibBackend(FaceBackend):
    """Backend using dlib via face_recognition library."""

    def __init__(self) -> None:
        """Initialize dlib backend."""
        try:
            import face_recognition
            self._fr = face_recognition
            logging.info("[DlibBackend] Initialized successfully")
        except ImportError as e:
            logging.error(f"[DlibBackend] Failed to import face_recognition: {e}")
            raise

    @property
    def backend_name(self) -> str:
        return "dlib"

    @property
    def encoding_dim(self) -> int:
        return 128

    @property
    def distance_metric(self) -> str:
        return "euclidean"

    def detect_faces(self, rgb_image: np.ndarray, model: str, upsample: int) -> tuple[list, list[np.ndarray]]:
        """
        Detect faces using dlib's HOG or CNN detector.

        Args:
            rgb_image: RGB image array
            model: 'hog' (fast, CPU) or 'cnn' (accurate, GPU)
            upsample: Number of times to upsample image before detection

        Returns:
            (face_locations, face_encodings)
        """
        # Detect face locations
        face_locations = self._fr.face_locations(
            rgb_image,
            model=model,
            number_of_times_to_upsample=upsample
        )

        # Sort by left edge (x-coordinate) for consistency
        face_locations = sorted(face_locations, key=lambda loc: loc[3])

        # Generate encodings
        face_encodings = self._fr.face_encodings(rgb_image, face_locations)

        return face_locations, face_encodings

    def compute_distance(self, encoding1: np.ndarray, encoding2: np.ndarray) -> float:
        """Compute Euclidean distance between two encodings."""
        return float(np.linalg.norm(encoding1 - encoding2))

    def compute_distances(self, encodings: np.ndarray, target_encoding: np.ndarray) -> np.ndarray:
        """Vectorized Euclidean distance computation."""
        return self._fr.face_distance(encodings, target_encoding)

    def get_model_info(self) -> dict:
        """Return dlib model metadata."""
        return {
            "backend": "dlib",
            "encoding_dim": 128,
            "distance_metric": "euclidean",
            "model": "dlib_face_recognition_resnet_model_v1"
        }


class InsightFaceBackend(FaceBackend):
    """Backend using InsightFace library."""

    def __init__(self, model_name: str = 'buffalo_l', ctx_id: int = -1, det_size: tuple[int, int] = (640, 640)) -> None:
        """
        Initialize InsightFace backend.

        Args:
            model_name: Model to use ('buffalo_l', 'buffalo_s', 'buffalo_m', etc.)
            ctx_id: -1 for CPU, 0+ for GPU device ID
            det_size: Detection size (width, height) tuple, e.g. (640, 640)
        """
        # Validate parameters
        if not isinstance(ctx_id, int) or ctx_id < -1:
            raise ValueError(f"ctx_id must be >= -1 (got {ctx_id})")
        if not isinstance(det_size, (tuple, list)) or len(det_size) != 2:
            raise ValueError(f"det_size must be a tuple/list of 2 integers (got {det_size})")
        if not all(isinstance(x, int) and x > 0 for x in det_size):
            raise ValueError(f"det_size dimensions must be positive integers (got {det_size})")

        # Import standard library modules and initialize buffers BEFORE try block
        # so they're guaranteed available in exception handlers
        import os
        import warnings
        from contextlib import redirect_stderr, redirect_stdout
        from io import StringIO

        stdout_buffer = StringIO()
        stderr_buffer = StringIO()

        try:
            # Suppress verbose ONNX runtime messages (must be set before importing)
            # Only set if not already configured by user
            os.environ.setdefault('ORT_LOGGING_LEVEL', '3')  # 3 = ERROR, 2 = WARNING, 1 = INFO, 0 = VERBOSE

            # Suppress Python logging from onnxruntime (without overriding user configuration)
            import logging as base_logging
            ort_logger = base_logging.getLogger('onnxruntime')
            # Only adjust level if logger has not been explicitly configured
            if not ort_logger.handlers and ort_logger.level == base_logging.NOTSET:
                ort_logger.setLevel(base_logging.ERROR)

            # Suppress FutureWarning from skimage (used by InsightFace)
            warnings.filterwarnings('ignore', category=FutureWarning, module='insightface')

            # Suppress CUDA provider warning on systems without GPU
            warnings.filterwarnings('ignore', message='.*CUDAExecutionProvider.*')

            logging.info(f"[InsightFaceBackend] Initializing with model={model_name}, ctx_id={ctx_id}, det_size={det_size}")

            # Determine optimal providers for this platform
            # On macOS: CoreML > CPU, on others: CPU only (CUDA handled by ctx_id)
            import platform
            if platform.system() == 'Darwin':  # macOS
                providers = ['CoreMLExecutionProvider', 'CPUExecutionProvider']
            else:
                providers = ['CPUExecutionProvider']

            # Suppress verbose output during InsightFace initialization
            # ONNX prints directly to stdout/stderr from C++ layer
            with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
                from insightface.app import FaceAnalysis

                self.app = FaceAnalysis(
                    name=model_name,
                    allowed_modules=['detection', 'recognition'],
                    providers=providers
                )
                self.app.prepare(ctx_id=ctx_id, det_size=det_size)

            self.model_name = model_name
            self.ctx_id = ctx_id
            self.det_size = det_size

            logging.info(f"[InsightFaceBackend] Initialized successfully with providers: {providers}")

        except ImportError as e:
            # Dump captured output to help diagnose import failures
            if stderr_buffer.getvalue():
                logging.error(f"[InsightFaceBackend] Captured stderr:\n{stderr_buffer.getvalue()}")
            if stdout_buffer.getvalue():
                logging.error(f"[InsightFaceBackend] Captured stdout:\n{stdout_buffer.getvalue()}")
            logging.error(f"[InsightFaceBackend] Failed to import insightface: {e}", exc_info=True)
            logging.error("Install with: pip install insightface onnxruntime")
            raise
        except Exception as e:
            # Dump captured output to help diagnose initialization failures
            if stderr_buffer.getvalue():
                logging.error(f"[InsightFaceBackend] Captured stderr:\n{stderr_buffer.getvalue()}")
            if stdout_buffer.getvalue():
                logging.error(f"[InsightFaceBackend] Captured stdout:\n{stdout_buffer.getvalue()}")
            logging.error(f"[InsightFaceBackend] Failed to initialize: {e}", exc_info=True)
            raise

    @property
    def backend_name(self) -> str:
        return "insightface"

    @property
    def encoding_dim(self) -> int:
        return 512  # buffalo models use 512-dim embeddings

    @property
    def distance_metric(self) -> str:
        return "cosine"

    def detect_faces(self, rgb_image: np.ndarray, model: str, upsample: int) -> tuple[list, list[np.ndarray]]:
        """
        Detect faces using InsightFace's RetinaFace detector.

        Args:
            rgb_image: RGB image array
            model: 'hog' or 'cnn' (ignored for InsightFace, uses det_size from __init__)
            upsample: Ignored for InsightFace (uses det_size from __init__)

        Returns:
            (face_locations, face_encodings)
        """
        # InsightFace expects BGR
        bgr_image = rgb_image[:, :, ::-1].copy()

        try:
            # Detect faces using det_size set during prepare()
            faces = self.app.get(bgr_image)
        except Exception as e:
            # Re-raise critical system-level exceptions
            if isinstance(e, (MemoryError, KeyboardInterrupt, SystemExit)):
                raise
            # Return empty results for recoverable errors
            logging.error(f"[InsightFaceBackend] Face detection failed: {e}")
            return [], []

        # Convert to dlib-compatible format
        locations = []
        encodings = []

        for face in faces:
            # InsightFace bbox is [x1, y1, x2, y2]
            # dlib format is (top, right, bottom, left)
            bbox = face.bbox.astype(int)
            location = (bbox[1], bbox[2], bbox[3], bbox[0])  # top, right, bottom, left
            locations.append(location)

            # Use normalized embedding (already L2-normalized by InsightFace)
            embedding = face.normed_embedding
            encodings.append(embedding)

        # Sort by left edge for consistency
        if locations:
            sorted_pairs = sorted(zip(locations, encodings), key=lambda p: p[0][3])
            locations, encodings = zip(*sorted_pairs)
            locations = list(locations)
            encodings = list(encodings)

        return locations, encodings

    def compute_distance(self, encoding1: np.ndarray, encoding2: np.ndarray) -> float:
        """
        Compute cosine distance between two encodings.

        Cosine distance = 1 - cosine similarity
        Both encodings should be L2-normalized.
        """
        similarity = float(np.dot(encoding1, encoding2))
        return 1.0 - similarity

    def compute_distances(self, encodings: np.ndarray, target_encoding: np.ndarray) -> np.ndarray:
        """
        Vectorized cosine distance computation.

        Args:
            encodings: Array of shape (n, 512)
            target_encoding: Single encoding of shape (512,)

        Returns:
            Array of cosine distances of shape (n,)
        """
        # Vectorized dot product for cosine similarity
        similarities = np.dot(encodings, target_encoding)
        # Convert to cosine distance
        return 1.0 - similarities

    def normalize_encoding(self, encoding: np.ndarray) -> np.ndarray:
        """
        L2 normalize encoding for cosine similarity.

        Args:
            encoding: Face encoding vector

        Returns:
            L2-normalized encoding (or original if norm is zero)
        """
        norm = np.linalg.norm(encoding)
        if norm > EPSILON_NORM:  # Avoid division by very small numbers
            return encoding / norm
        # Return zero vector as-is (edge case: all-zero encoding)
        logging.warning("[InsightFaceBackend] Encoding has zero norm, returning as-is")
        return encoding

    def get_model_info(self) -> dict:
        """Return InsightFace model metadata."""
        return {
            "backend": "insightface",
            "model": self.model_name,
            "encoding_dim": 512,
            "distance_metric": "cosine",
            "ctx_id": self.ctx_id,
            "det_size": self.det_size
        }


# Backend registry for factory pattern
_backend_registry = {
    'dlib': DlibBackend,
    'insightface': InsightFaceBackend
}


def create_backend(config: dict) -> FaceBackend:
    """
    Factory function to create backend instance from config.

    Args:
        config: Full config dict with 'backend' section

    Returns:
        Initialized FaceBackend instance

    Raises:
        ValueError: If backend type is unknown
        ImportError: If backend dependencies are missing
    """
    backend_config = config.get('backend', {})
    backend_type = backend_config.get('type', 'insightface')

    # dlib is deprecated - force insightface
    if backend_type == 'dlib':
        logging.warning(
            "[DEPRECATED] dlib backend is no longer supported. "
            "Using insightface instead. Please update your config.json."
        )
        backend_type = 'insightface'

    if backend_type not in _backend_registry:
        available = list(_backend_registry.keys())
        raise ValueError(
            f"Unknown backend: '{backend_type}'. "
            f"Available backends: {available}"
        )

    backend_class = _backend_registry[backend_type]

    # Pass backend-specific configuration
    try:
        if backend_type == 'dlib':
            return backend_class()

        elif backend_type == 'insightface':
            settings = backend_config.get('insightface', {})
            det_size = normalize_det_size(settings.get('det_size', [640, 640]))
            return backend_class(
                model_name=settings.get('model_name', 'buffalo_l'),
                ctx_id=settings.get('ctx_id', -1),
                det_size=det_size
            )

        # Default: try to instantiate with no args
        return backend_class()

    except ImportError as e:
        logging.error(f"Failed to create {backend_type} backend: {e}")
        logging.error("Make sure required dependencies are installed:")
        if backend_type == 'dlib':
            logging.error("  pip install face_recognition")
        elif backend_type == 'insightface':
            logging.error("  pip install insightface onnxruntime")
        raise
    except Exception as e:
        logging.error(f"Failed to initialize {backend_type} backend: {e}")
        raise


def get_available_backends() -> list[str]:
    """
    Returns list of available backend names.

    Returns:
        List of backend identifiers
    """
    return list(_backend_registry.keys())
