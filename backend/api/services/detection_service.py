"""
Detection Service

Wraps existing face detection logic from hitta_ansikten.
"""

import logging
import sys
import time
import hashlib
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
from datetime import datetime

# Add parent directory to path to import hitta_ansikten modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from face_backends import create_backend
from faceid_db import load_database, save_database, get_file_hash
from hitta_ansikten import load_config
import face_recognition
import rawpy
from PIL import Image
import numpy as np

logger = logging.getLogger(__name__)

class DetectionService:
    """Face detection service wrapper"""

    def __init__(self):
        logger.info("[DetectionService] Initializing...")

        # Load configuration and database
        self.config = load_config()
        logger.info(f"[DetectionService] Loaded config: backend={self.config.get('backend', {}).get('type', 'dlib')}")

        # Initialize backend
        self.backend = create_backend(self.config)
        logger.info(f"[DetectionService] Initialized backend: {self.backend.backend_name}")

        # Load face database
        self.known_faces, self.ignored_faces, self.hard_negatives, self.processed_files = load_database()
        logger.info(f"[DetectionService] Loaded database: {len(self.known_faces)} people, {len(self.ignored_faces)} ignored faces")

        # Cache for detection results (keyed by file hash)
        self.cache: Dict[str, Dict[str, Any]] = {}

        # Cache for face encodings (keyed by face_id for confirm/ignore operations)
        self.encoding_cache: Dict[str, Tuple[np.ndarray, Dict[str, int]]] = {}

        # Cache for loaded images (keyed by image path) - for fast thumbnail generation
        # Stores (rgb_array, timestamp) tuples, expires after 300 seconds
        self.image_cache: Dict[str, Tuple[np.ndarray, float]] = {}
        self.image_cache_ttl = 300  # 5 minutes

    def reload_database(self) -> Dict[str, Any]:
        """
        Reload face database from disk

        Useful when database has been modified externally (e.g., by hantera_ansikten).
        Clears detection cache to ensure fresh results with new data.

        Returns:
            Status info with counts
        """
        logger.info("[DetectionService] Reloading database from disk...")

        # Reload database
        self.known_faces, self.ignored_faces, self.hard_negatives, self.processed_files = load_database()

        # Clear caches to ensure fresh results
        old_cache_size = len(self.cache)
        self.cache.clear()
        self.encoding_cache.clear()
        self.image_cache.clear()

        logger.info(f"[DetectionService] Database reloaded: {len(self.known_faces)} people, {len(self.ignored_faces)} ignored faces")
        logger.info(f"[DetectionService] Cleared {old_cache_size} cached detection results")

        return {
            "status": "success",
            "people_count": len(self.known_faces),
            "ignored_count": len(self.ignored_faces),
            "cache_cleared": old_cache_size
        }

    def _get_file_hash(self, path: Path) -> str:
        """Compute SHA1 hash of file"""
        with open(path, "rb") as f:
            return hashlib.sha1(f.read()).hexdigest()

    def _load_image(self, image_path: Path) -> np.ndarray:
        """Load image as RGB array (supports NEF and standard formats)"""
        ext = image_path.suffix.lower()

        if ext in ['.nef', '.cr2', '.arw']:  # RAW formats
            logger.debug(f"[DetectionService] Loading RAW image: {image_path}")
            with rawpy.imread(str(image_path)) as raw:
                rgb = raw.postprocess()
            return rgb
        else:  # Standard formats (JPG, PNG, etc.)
            logger.debug(f"[DetectionService] Loading standard image: {image_path}")
            img = Image.open(image_path)
            return np.array(img.convert('RGB'))

    def _detect_and_match_faces(self, rgb: np.ndarray, max_dimension: int = 4500) -> List[Dict[str, Any]]:
        """Detect faces and match against database"""
        import cv2

        # Resize if needed (optimize performance)
        height, width = rgb.shape[:2]
        if max(height, width) > max_dimension:
            scale = max_dimension / max(height, width)
            new_width = int(width * scale)
            new_height = int(height * scale)
            rgb_resized = cv2.resize(rgb, (new_width, new_height), interpolation=cv2.INTER_AREA)
            scale_factor = 1 / scale
        else:
            rgb_resized = rgb
            scale_factor = 1.0

        # Detect faces using configured backend
        detection_model = self.config.get('detection_model', 'hog')
        upsample = 0  # No upsampling for API (performance)

        face_locations, face_encodings = self.backend.detect_faces(
            rgb_resized,
            model=detection_model,
            upsample=upsample
        )
        logger.info(f"[DetectionService] Detected {len(face_locations)} faces")

        if not face_locations:
            return []

        # Match against database
        results = []
        for i, (encoding, location) in enumerate(zip(face_encodings, face_locations)):
            top, right, bottom, left = location

            # Scale back to original dimensions
            bbox = {
                "x": int(left * scale_factor),
                "y": int(top * scale_factor),
                "width": int((right - left) * scale_factor),
                "height": int((bottom - top) * scale_factor)
            }

            # Match against known faces
            best_match, best_distance = self._match_encoding(encoding)

            # Generate stable face ID
            face_id = f"face_{i}_{hash(tuple(encoding[:10]))}"

            # Cache encoding for later confirm/ignore operations
            self.encoding_cache[face_id] = (encoding, bbox)

            results.append({
                "face_id": face_id,
                "bounding_box": bbox,
                "confidence": float(1.0 - best_distance) if best_distance is not None else 0.0,
                "person_name": best_match,
                "match_distance": float(best_distance) if best_distance is not None else None,
                "is_confirmed": False  # Always False for new detections
            })

        return results

    def _match_encoding(self, encoding: np.ndarray) -> Tuple[Optional[str], Optional[float]]:
        """Match encoding against known faces database"""
        best_name = None
        best_distance = None

        for name, entries in self.known_faces.items():
            # Extract encodings for this person (filter by backend)
            person_encodings = []
            for entry in entries:
                if isinstance(entry, dict):
                    entry_enc = entry.get("encoding")
                    entry_backend = entry.get("backend", "dlib")
                else:
                    entry_enc = entry
                    entry_backend = "dlib"

                if entry_enc is not None and entry_backend == self.backend.backend_name:
                    person_encodings.append(entry_enc)

            if not person_encodings:
                continue

            # Compute distances
            distances = self.backend.compute_distances(np.array(person_encodings), encoding)
            min_distance = float(np.min(distances))

            if best_distance is None or min_distance < best_distance:
                best_distance = min_distance
                best_name = name

        return best_name, best_distance

    async def detect_faces(self, image_path: str, force_reprocess: bool = False) -> Dict[str, Any]:
        """
        Detect faces in an image

        Args:
            image_path: Path to image file
            force_reprocess: Force reprocessing even if cached results exist

        Returns:
            Detection results with faces, bounding boxes, and confidence scores
        """
        start_time = time.time()
        logger.info(f"[DetectionService] Detecting faces in: {image_path}")

        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        # Check cache
        file_hash = self._get_file_hash(path)
        if not force_reprocess and file_hash in self.cache:
            logger.info(f"[DetectionService] Using cached result for: {image_path}")
            cached_result = self.cache[file_hash]
            cached_result["cached"] = True
            return cached_result

        # Load image
        rgb = self._load_image(path)

        # Detect and match faces
        faces = self._detect_and_match_faces(rgb)

        # Build result
        processing_time = (time.time() - start_time) * 1000  # milliseconds
        result = {
            "faces": faces,
            "processing_time_ms": processing_time,
            "cached": False
        }

        # Cache result
        self.cache[file_hash] = result
        logger.info(f"[DetectionService] Detected {len(faces)} faces in {processing_time:.1f}ms")

        return result

    async def get_face_thumbnail(self, image_path: str, bounding_box: Dict[str, int], size: int = 150) -> bytes:
        """
        Extract face thumbnail from image

        Args:
            image_path: Path to source image
            bounding_box: Face bounding box (x, y, width, height)
            size: Thumbnail size (default 150x150)

        Returns:
            JPEG thumbnail bytes
        """
        import io
        import time

        # Check image cache first
        path = Path(image_path)
        cache_key = str(path)
        current_time = time.time()

        if cache_key in self.image_cache:
            rgb, timestamp = self.image_cache[cache_key]
            # Check if cache entry is still valid
            if current_time - timestamp < self.image_cache_ttl:
                logger.debug(f"[DetectionService] Using cached image for thumbnail: {path.name}")
            else:
                # Cache expired, remove it
                logger.debug(f"[DetectionService] Cache expired for: {path.name}")
                del self.image_cache[cache_key]
                rgb = self._load_image(path)
                self.image_cache[cache_key] = (rgb, current_time)
        else:
            # Load image and cache it
            logger.debug(f"[DetectionService] Loading and caching image for thumbnail: {path.name}")
            rgb = self._load_image(path)
            self.image_cache[cache_key] = (rgb, current_time)

        # Extract bounding box coordinates
        x = bounding_box['x']
        y = bounding_box['y']
        width = bounding_box['width']
        height = bounding_box['height']

        # Get image dimensions
        img_height, img_width = rgb.shape[:2]

        # Handle negative coordinates or out-of-bounds by padding with black
        # Calculate the valid region within the image
        src_x1 = max(0, x)
        src_y1 = max(0, y)
        src_x2 = min(img_width, x + width)
        src_y2 = min(img_height, y + height)

        # Calculate where to place in the output canvas
        dst_x1 = src_x1 - x
        dst_y1 = src_y1 - y
        dst_x2 = dst_x1 + (src_x2 - src_x1)
        dst_y2 = dst_y1 + (src_y2 - src_y1)

        # Create black canvas of requested size
        import numpy as np
        cropped = np.zeros((height, width, 3), dtype=np.uint8)

        # Copy the valid region if there's any overlap
        if src_x2 > src_x1 and src_y2 > src_y1:
            cropped[dst_y1:dst_y2, dst_x1:dst_x2] = rgb[src_y1:src_y2, src_x1:src_x2]
        else:
            logger.warning(f"[DetectionService] Bounding box completely outside image: ({x},{y},{width},{height})")

        # Convert to PIL Image
        img = Image.fromarray(cropped)

        # Resize to thumbnail size
        img.thumbnail((size, size), Image.Resampling.LANCZOS)

        # Encode as JPEG
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=85)
        buffer.seek(0)

        return buffer.read()

    async def confirm_identity(self, face_id: str, person_name: str, image_path: str) -> Dict[str, Any]:
        """
        Confirm face identity and save to database

        Args:
            face_id: Face identifier from detection
            person_name: Person name to associate with this face
            image_path: Source image path

        Returns:
            Success status
        """
        logger.info(f"[DetectionService] Confirming face {face_id} as {person_name}")

        # Get encoding from cache
        if face_id not in self.encoding_cache:
            raise ValueError(f"Face ID not found in cache: {face_id}. Detection may have expired.")

        encoding, bbox = self.encoding_cache[face_id]

        # Get file hash
        path = Path(image_path)
        file_hash = get_file_hash(path) if path.exists() else None

        # Compute encoding hash
        encoding_hash = hashlib.sha1(encoding.tobytes()).hexdigest()

        # Get backend version info
        backend_info = self.backend.get_model_info()

        # Create encoding entry
        entry = {
            "encoding": encoding,
            "file": str(image_path),
            "hash": file_hash,
            "backend": self.backend.backend_name,
            "backend_version": backend_info.get("version", "unknown"),
            "created_at": datetime.now().isoformat(),
            "encoding_hash": encoding_hash,
            "bounding_box": bbox
        }

        # Add to known_faces
        if person_name not in self.known_faces:
            self.known_faces[person_name] = []

        self.known_faces[person_name].append(entry)

        # Save database
        save_database(self.known_faces, self.ignored_faces, self.hard_negatives, self.processed_files)

        logger.info(f"[DetectionService] Saved encoding for {person_name} (total: {len(self.known_faces[person_name])})")

        return {
            "status": "success",
            "person_name": person_name,
            "encodings_count": len(self.known_faces[person_name])
        }

    async def ignore_face(self, face_id: str, image_path: str) -> Dict[str, Any]:
        """
        Mark face as ignored (add to ignored_faces database)

        Args:
            face_id: Face identifier from detection
            image_path: Source image path

        Returns:
            Success status
        """
        logger.info(f"[DetectionService] Ignoring face {face_id}")

        # Get encoding from cache
        if face_id not in self.encoding_cache:
            raise ValueError(f"Face ID not found in cache: {face_id}. Detection may have expired.")

        encoding, bbox = self.encoding_cache[face_id]

        # Get file hash
        path = Path(image_path)
        file_hash = get_file_hash(path) if path.exists() else None

        # Compute encoding hash
        encoding_hash = hashlib.sha1(encoding.tobytes()).hexdigest()

        # Get backend version info
        backend_info = self.backend.get_model_info()

        # Create encoding entry
        entry = {
            "encoding": encoding,
            "file": str(image_path),
            "hash": file_hash,
            "backend": self.backend.backend_name,
            "backend_version": backend_info.get("version", "unknown"),
            "created_at": datetime.now().isoformat(),
            "encoding_hash": encoding_hash,
            "bounding_box": bbox
        }

        # Add to ignored_faces
        self.ignored_faces.append(entry)

        # Save database
        save_database(self.known_faces, self.ignored_faces, self.hard_negatives, self.processed_files)

        logger.info(f"[DetectionService] Added face to ignored list (total: {len(self.ignored_faces)})")

        return {
            "status": "success",
            "ignored_count": len(self.ignored_faces)
        }

# Singleton instance
detection_service = DetectionService()
