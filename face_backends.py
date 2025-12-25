"""
Face recognition backend abstraction layer.

Provides pluggable backends for face detection and recognition.
Supports both dlib (via face_recognition) and InsightFace.
"""

from abc import ABC, abstractmethod
from typing import Tuple, List, Optional
import numpy as np
import logging


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
    def detect_faces(self, rgb_image: np.ndarray, model: str, upsample: int) -> Tuple[List, List[np.ndarray]]:
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

    def __init__(self):
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

    def detect_faces(self, rgb_image: np.ndarray, model: str, upsample: int) -> Tuple[List, List[np.ndarray]]:
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

    def __init__(self, model_name: str = 'buffalo_l', ctx_id: int = -1):
        """
        Initialize InsightFace backend.

        Args:
            model_name: Model to use ('buffalo_l', 'buffalo_s', 'buffalo_m', etc.)
            ctx_id: -1 for CPU, 0+ for GPU device ID
        """
        try:
            import insightface
            from insightface.app import FaceAnalysis

            logging.info(f"[InsightFaceBackend] Initializing with model={model_name}, ctx_id={ctx_id}")

            self.app = FaceAnalysis(
                name=model_name,
                allowed_modules=['detection', 'recognition']
            )
            self.app.prepare(ctx_id=ctx_id)
            self.model_name = model_name
            self.ctx_id = ctx_id

            logging.info(f"[InsightFaceBackend] Initialized successfully")

        except ImportError as e:
            logging.error(f"[InsightFaceBackend] Failed to import insightface: {e}")
            logging.error("Install with: pip install insightface onnxruntime")
            raise
        except Exception as e:
            logging.error(f"[InsightFaceBackend] Failed to initialize: {e}")
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

    def detect_faces(self, rgb_image: np.ndarray, model: str, upsample: int) -> Tuple[List, List[np.ndarray]]:
        """
        Detect faces using InsightFace's RetinaFace detector.

        Args:
            rgb_image: RGB image array
            model: 'hog' or 'cnn' (mapped to detection size)
            upsample: Ignored for InsightFace (uses det_size instead)

        Returns:
            (face_locations, face_encodings)
        """
        # InsightFace expects BGR
        bgr_image = rgb_image[:, :, ::-1].copy()

        # Map model hint to detection size
        # 'cnn' -> larger det_size for better accuracy
        # 'hog' -> smaller det_size for speed
        det_size = (640, 640) if model == 'cnn' else (512, 512)

        try:
            # Detect faces
            faces = self.app.get(bgr_image, det_size=det_size)
        except Exception as e:
            logging.error(f"[InsightFaceBackend] Face detection failed: {e}")
            # Return empty results on error
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
            L2-normalized encoding
        """
        norm = np.linalg.norm(encoding)
        if norm > 0:
            return encoding / norm
        return encoding

    def get_model_info(self) -> dict:
        """Return InsightFace model metadata."""
        return {
            "backend": "insightface",
            "model": self.model_name,
            "encoding_dim": 512,
            "distance_metric": "cosine",
            "ctx_id": self.ctx_id
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
    backend_type = backend_config.get('type', 'dlib')

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
            return backend_class(
                model_name=settings.get('model_name', 'buffalo_l'),
                ctx_id=settings.get('ctx_id', -1)
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


def get_available_backends() -> List[str]:
    """
    Returns list of available backend names.

    Returns:
        List of backend identifiers
    """
    return list(_backend_registry.keys())
