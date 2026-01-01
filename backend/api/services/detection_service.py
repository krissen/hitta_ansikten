"""
Detection Service

Wraps existing face detection logic from hitta_ansikten.
"""

import logging
import os
import sys
import time
import hashlib
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
from datetime import datetime

# Add parent directory to path to import hitta_ansikten modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from face_backends import create_backend
from faceid_db import load_database, save_database, get_file_hash, BASE_DIR
from hitta_ansikten import load_config, log_attempt_stats
import face_recognition
import rawpy
from PIL import Image
import numpy as np

from .preprocessing_cache import get_cache as get_preprocessing_cache

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
        """Compute SHA1 hash of file using chunked reading"""
        sha1 = hashlib.sha1()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b''):
                sha1.update(chunk)
        return sha1.hexdigest()

    def _load_image(self, image_path: Path) -> np.ndarray:
        """Load image as RGB array (supports NEF and standard formats)

        For RAW formats, checks preprocessing cache first for cached JPG.
        """
        ext = image_path.suffix.lower()

        if ext in ['.nef', '.cr2', '.arw']:  # RAW formats
            # Check preprocessing cache for converted JPG
            try:
                cache = get_preprocessing_cache()
                file_hash = cache.compute_file_hash(str(image_path))
                cached_jpg = cache.get_nef_conversion(file_hash)

                if cached_jpg and os.path.exists(cached_jpg):
                    logger.info(f"[DetectionService] Using cached JPG for: {image_path.name}")
                    img = Image.open(cached_jpg)
                    return np.array(img.convert('RGB'))
            except Exception as e:
                logger.debug(f"[DetectionService] Cache lookup failed, falling back to rawpy: {e}")

            # No cache hit - process RAW directly
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

            # Match against ignored faces
            _, ignore_distance = self._match_ignored(encoding)

            # Determine match case (name, ign, uncertain_name, uncertain_ign, unknown)
            match_case = self._determine_match_case(best_distance, ignore_distance)

            # Get match alternatives (top-N)
            match_alternatives = self._match_encoding_alternatives(encoding, top_n=9)

            # Generate stable face ID using SHA1 (deterministic across runs)
            # Use 16 hex chars for lower collision probability
            encoding_hash = hashlib.sha1(encoding.tobytes()).hexdigest()[:16]
            face_id = f"face_{i}_{encoding_hash}"

            # Cache encoding for later confirm/ignore operations
            self.encoding_cache[face_id] = (encoding, bbox)

            # Calculate ignore confidence
            ignore_confidence = None
            if ignore_distance is not None:
                ignore_confidence = max(0, min(100, int((1.0 - ignore_distance) * 100)))

            results.append({
                "face_id": face_id,
                "bounding_box": bbox,
                "confidence": float(1.0 - best_distance) if best_distance is not None else 0.0,
                "person_name": best_match,
                "match_distance": float(best_distance) if best_distance is not None else None,
                "is_confirmed": False,  # Always False for new detections
                # New fields for ignore-awareness and alternatives
                "match_case": match_case,
                "ignore_distance": float(ignore_distance) if ignore_distance is not None else None,
                "ignore_confidence": ignore_confidence,
                "match_alternatives": match_alternatives
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

    def _match_ignored(self, encoding: np.ndarray) -> Tuple[Optional[int], Optional[float]]:
        """Match encoding against ignored faces database"""
        best_idx = None
        best_distance = None

        # Collect encodings from ignored_faces that match our backend
        ignored_encodings = []
        for entry in self.ignored_faces:
            if isinstance(entry, dict):
                enc = entry.get("encoding")
                backend = entry.get("backend", "dlib")
            else:
                enc = entry
                backend = "dlib"

            if enc is not None and backend == self.backend.backend_name:
                ignored_encodings.append(enc)

        if ignored_encodings:
            distances = self.backend.compute_distances(np.array(ignored_encodings), encoding)
            min_distance = float(np.min(distances))
            best_distance = min_distance
            best_idx = int(np.argmin(distances))

        return best_idx, best_distance

    def _determine_match_case(
        self,
        name_dist: Optional[float],
        ignore_dist: Optional[float]
    ) -> str:
        """
        Determine match case based on distances (like legacy script).

        Returns one of: 'name', 'ign', 'uncertain_name', 'uncertain_ign', 'unknown'
        """
        # Get thresholds from config
        name_thr = self.config.get("match_threshold", 0.54)
        ignore_thr = self.config.get("ignore_distance", 0.48)
        margin = self.config.get("prefer_name_margin", 0.15)

        has_name = name_dist is not None and name_dist < name_thr
        has_ignore = ignore_dist is not None and ignore_dist < ignore_thr

        if not has_name and not has_ignore:
            return "unknown"

        if has_name and has_ignore:
            # Both match - check if close enough to be uncertain
            if abs(name_dist - ignore_dist) < margin:
                return "uncertain_name" if name_dist < ignore_dist else "uncertain_ign"

        if has_name and (not has_ignore or name_dist < ignore_dist - margin):
            return "name"

        if has_ignore and (not has_name or ignore_dist < name_dist - margin):
            return "ign"

        return "unknown"

    def _match_encoding_alternatives(
        self,
        encoding: np.ndarray,
        top_n: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Return top-N match alternatives sorted by distance.

        Includes both known faces and ignored faces (marked as 'ign').
        """
        all_matches = []

        # Match against known faces
        for name, entries in self.known_faces.items():
            # Filter by backend
            person_encodings = [
                e["encoding"] for e in entries
                if isinstance(e, dict) and e.get("backend") == self.backend.backend_name
            ]
            if not person_encodings:
                continue

            distances = self.backend.compute_distances(np.array(person_encodings), encoding)
            min_distance = float(np.min(distances))

            # Convert distance to confidence (0-100)
            confidence = max(0, min(100, int((1.0 - min_distance) * 100)))

            all_matches.append({
                "name": name,
                "distance": min_distance,
                "confidence": confidence,
                "is_ignored": False
            })

        # Match against ignored faces (single "ign" entry with best distance)
        ignore_idx, ignore_dist = self._match_ignored(encoding)
        if ignore_dist is not None:
            ignore_confidence = max(0, min(100, int((1.0 - ignore_dist) * 100)))
            all_matches.append({
                "name": "ign",
                "distance": ignore_dist,
                "confidence": ignore_confidence,
                "is_ignored": True
            })

        # Sort by distance and return top N
        all_matches.sort(key=lambda x: x["distance"])
        return all_matches[:top_n]

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
            "cached": False,
            "file_hash": file_hash  # Include hash for reuse in mark-review-complete
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

        # Handle manual faces (no encoding to save, just return success)
        # Manual faces are included in mark_review_complete for rename functionality
        if face_id.startswith("manual_"):
            logger.info(f"[DetectionService] Manual face confirmed: {person_name} (no encoding to save)")
            return {
                "status": "success",
                "person_name": person_name,
                "encodings_count": 0  # No encoding saved for manual faces
            }

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

        # Handle manual faces (no encoding to add to ignored list)
        # Manual faces are included in mark_review_complete for rename functionality
        if face_id.startswith("manual_"):
            logger.info(f"[DetectionService] Manual face ignored (no encoding to save)")
            return {
                "status": "success",
                "ignored_count": len(self.ignored_faces)  # Return current count unchanged
            }

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

    async def mark_review_complete(
        self,
        image_path: str,
        reviewed_faces: List[Dict[str, Any]],
        file_hash: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Log completed review to attempt_stats.jsonl for rename functionality.

        Args:
            image_path: Path to the reviewed image
            reviewed_faces: List of reviewed face data with:
                - face_index: Detection order (0-based)
                - face_id: Face identifier
                - person_name: Confirmed name (None if ignored)
                - is_ignored: Whether face was ignored
            file_hash: Optional pre-computed hash (avoids re-reading file)

        Returns:
            Success status
        """
        logger.info(f"[DetectionService] Marking review complete for {image_path}")

        # Use provided hash or compute if needed
        if file_hash is None:
            path = Path(image_path)
            file_hash = get_file_hash(path) if path.exists() else None
        else:
            logger.debug(f"[DetectionService] Using provided file_hash: {file_hash[:8]}...")

        # Build labels in expected format: "#1\nPersonName" or "#1\nignorerad"
        labels = []
        for face in sorted(reviewed_faces, key=lambda f: f.get('face_index', 0)):
            face_index = face.get('face_index', 0)
            if face.get('is_ignored'):
                label = f"#{face_index + 1}\nignorerad"
            elif face.get('person_name'):
                label = f"#{face_index + 1}\n{face['person_name']}"
            else:
                # Skip faces without name and not ignored
                continue
            labels.append({
                "label": label,
                "face_id": face.get('face_id', '')
            })

        # Build attempt info (simplified for API usage)
        attempts = [{
            "resolution": "api",
            "face_count": len(reviewed_faces),
            "source": "bildvisare"
        }]

        # Log to attempt_stats.jsonl
        log_attempt_stats(
            image_path=image_path,
            attempts=attempts,
            used_attempt_idx=0,
            base_dir=BASE_DIR,
            review_results=["ok"],
            labels_per_attempt=[labels],
            file_hash=file_hash
        )

        logger.info(f"[DetectionService] Logged {len(labels)} face labels to attempt_stats.jsonl")

        return {
            "status": "success",
            "message": f"Review logged for {len(labels)} faces",
            "labels_count": len(labels)
        }


# Singleton instance
detection_service = DetectionService()


# ============================================================================
# Module-level helper functions for preprocessing
# ============================================================================

def convert_nef_to_jpg(nef_path: str, output_path: str = None) -> Optional[str]:
    """
    Convert NEF (or other RAW) file to JPG.

    Args:
        nef_path: Path to NEF file
        output_path: Optional output path. If None, creates temp file.

    Returns:
        Path to JPG file, or None if conversion failed
    """
    import tempfile
    import io

    path = Path(nef_path)
    if not path.exists():
        logger.error(f"[convert_nef_to_jpg] File not found: {nef_path}")
        return None

    try:
        # Load RAW image
        rgb = detection_service._load_image(path)

        # Convert to PIL Image
        img = Image.fromarray(rgb)

        # Determine output path
        if output_path is None:
            fd, output_path = tempfile.mkstemp(suffix='.jpg', prefix='nef_')
            os.close(fd)

        # Save as JPG (high quality)
        img.save(output_path, format='JPEG', quality=95)
        logger.info(f"[convert_nef_to_jpg] Converted {path.name} -> {output_path}")

        return output_path
    except Exception as e:
        logger.error(f"[convert_nef_to_jpg] Failed to convert {nef_path}: {e}")
        return None


def detect_faces_in_image(image_path: str, include_encodings: bool = False) -> Dict[str, Any]:
    """
    Detect faces in an image without database matching.

    Args:
        image_path: Path to image file
        include_encodings: Whether to include face encodings in result

    Returns:
        Dict with faces list and image dimensions
    """
    import cv2

    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    # Load image
    rgb = detection_service._load_image(path)
    height, width = rgb.shape[:2]

    # Resize for detection if needed
    max_dimension = 4500
    if max(height, width) > max_dimension:
        scale = max_dimension / max(height, width)
        new_width = int(width * scale)
        new_height = int(height * scale)
        rgb_resized = cv2.resize(rgb, (new_width, new_height), interpolation=cv2.INTER_AREA)
        scale_factor = 1 / scale
    else:
        rgb_resized = rgb
        scale_factor = 1.0

    # Detect faces
    detection_model = detection_service.config.get('detection_model', 'hog')
    face_locations, face_encodings = detection_service.backend.detect_faces(
        rgb_resized,
        model=detection_model,
        upsample=0
    )

    faces = []
    for i, (location, encoding) in enumerate(zip(face_locations, face_encodings)):
        top, right, bottom, left = location

        # Generate stable face ID using SHA1 (deterministic across runs)
        # Use 16 hex chars for lower collision probability
        encoding_hash = hashlib.sha1(encoding.tobytes()).hexdigest()[:16]
        face_data = {
            'face_id': f"face_{i}_{encoding_hash}",
            'bounding_box': {
                'x': int(left * scale_factor),
                'y': int(top * scale_factor),
                'width': int((right - left) * scale_factor),
                'height': int((bottom - top) * scale_factor)
            },
            'confidence': 1.0  # Detection confidence (placeholder)
        }

        if include_encodings:
            face_data['encoding'] = encoding.tolist()

        faces.append(face_data)

    logger.info(f"[detect_faces_in_image] Detected {len(faces)} faces in {path.name}")

    return {
        'faces': faces,
        'image_width': width,
        'image_height': height
    }


def generate_face_thumbnails(image_path: str, faces: List[Dict], size: int = 150) -> List[bytes]:
    """
    Generate thumbnails for detected faces.

    Args:
        image_path: Path to source image
        faces: List of face dicts with 'bounding_box' keys
        size: Thumbnail size (default 150x150)

    Returns:
        List of JPEG thumbnail bytes
    """
    import io

    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    # Load image once
    rgb = detection_service._load_image(path)
    img_height, img_width = rgb.shape[:2]

    thumbnails = []
    for face in faces:
        bbox = face.get('bounding_box', {})
        x = bbox.get('x', 0)
        y = bbox.get('y', 0)
        width = bbox.get('width', 100)
        height = bbox.get('height', 100)

        # Handle out-of-bounds with padding
        src_x1 = max(0, x)
        src_y1 = max(0, y)
        src_x2 = min(img_width, x + width)
        src_y2 = min(img_height, y + height)

        dst_x1 = src_x1 - x
        dst_y1 = src_y1 - y
        dst_x2 = dst_x1 + (src_x2 - src_x1)
        dst_y2 = dst_y1 + (src_y2 - src_y1)

        # Create canvas and copy valid region
        cropped = np.zeros((height, width, 3), dtype=np.uint8)
        if src_x2 > src_x1 and src_y2 > src_y1:
            cropped[dst_y1:dst_y2, dst_x1:dst_x2] = rgb[src_y1:src_y2, src_x1:src_x2]

        # Convert to PIL, resize, and encode
        img = Image.fromarray(cropped)
        img.thumbnail((size, size), Image.Resampling.LANCZOS)

        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=85)
        buffer.seek(0)
        thumbnails.append(buffer.read())

    logger.info(f"[generate_face_thumbnails] Generated {len(thumbnails)} thumbnails")
    return thumbnails
