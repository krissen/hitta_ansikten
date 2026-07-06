"""
Detection Service

Wraps existing face detection logic from the Ansikten CLI.
"""

import asyncio
import hashlib
import logging
import os
import sys
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Add backend dir to path to import shared core modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import numpy as np
import rawpy
from PIL import Image, ImageOps

from core.attempts import log_attempt_stats
from core.config import load_config
from face_backends import create_backend
from faceid_db import BASE_DIR, get_file_hash, load_database, save_database

from .management_service import DISTINCT_PAIRS_PATH, _load_distinct_pairs
from .preprocessing_cache import get_cache as get_preprocessing_cache

logger = logging.getLogger(__name__)

# Thread pool for offloading blocking I/O (hash computation, image loading, face detection)
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="detection")

# Cache size limits (LRU eviction)
MAX_DETECTION_CACHE = 100
MAX_ENCODING_CACHE = 1000
MAX_IMAGE_CACHE = 10

class DetectionService:
    """Face detection service wrapper"""

    def __init__(self):
        logger.info("[DetectionService] Initializing...")

        self.config = load_config()
        logger.info(f"[DetectionService] Loaded config: backend={self.config.get('backend', {}).get('type', 'dlib')}")

        self.backend = create_backend(self.config)
        logger.info(f"[DetectionService] Initialized backend: {self.backend.backend_name}")

        # Load face database
        self.known_faces, self.ignored_faces, self.hard_negatives, self.processed_files = load_database()
        logger.info(f"[DetectionService] Loaded database: {len(self.known_faces)} people, {len(self.ignored_faces)} ignored faces")

        # LRU caches using OrderedDict (move_to_end on access, popitem(last=False) to evict)
        # Detection results cache (keyed by file hash)
        self.cache: OrderedDict[str, Dict[str, Any]] = OrderedDict()

        # Face encoding cache (keyed by face_id) — stores (encoding, bbox, file_hash)
        self.encoding_cache: OrderedDict[str, Tuple[np.ndarray, Dict[str, int], Optional[str]]] = OrderedDict()

        # Image cache (keyed by image path) — stores (rgb_array, timestamp)
        self.image_cache: OrderedDict[str, Tuple[np.ndarray, float]] = OrderedDict()
        self.image_cache_ttl = 1800  # 30 minutes

        # Debounced save state
        self._save_pending = False
        self._save_lock = asyncio.Lock()
        self._save_task: Optional[asyncio.Task] = None

    @staticmethod
    def _lru_put(cache: OrderedDict, key, value, max_size: int):
        """Insert into an OrderedDict with LRU eviction."""
        if key in cache:
            cache.move_to_end(key)
        cache[key] = value
        while len(cache) > max_size:
            cache.popitem(last=False)

    async def _schedule_save(self):
        """Debounce database saves — coalesces rapid confirm/ignore calls."""
        async with self._save_lock:
            if self._save_pending:
                return  # Already scheduled
            self._save_pending = True

        async def _do_save():
            await asyncio.sleep(0.5)  # 500 ms debounce
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                _executor,
                save_database,
                self.known_faces,
                self.ignored_faces,
                self.hard_negatives,
                self.processed_files,
            )
            async with self._save_lock:
                self._save_pending = False
            logger.debug("[DetectionService] Debounced save completed")

        self._save_task = asyncio.create_task(_do_save())

    async def _flush_save(self):
        """Force immediate save (used for final operations like mark_review_complete)."""
        # Cancel pending debounced save if any
        if self._save_task and not self._save_task.done():
            self._save_task.cancel()
            try:
                await self._save_task
            except asyncio.CancelledError:
                pass
        async with self._save_lock:
            self._save_pending = False

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            _executor,
            save_database,
            self.known_faces,
            self.ignored_faces,
            self.hard_negatives,
            self.processed_files,
        )

    def reload_database(self) -> Dict[str, Any]:
        """
        Reload face database from disk

        Useful when database has been modified externally (e.g., by scripts/archive/hantera_ansikten.py).
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

        # RAW formats handled by rawpy/libraw. Keep this aligned with the "raw"
        # extension preset (file_resolver.EXTENSION_PRESETS["raw"]) so every RAW
        # the GUI lets you pick can actually be converted/previewed.
        if ext in ['.nef', '.cr2', '.cr3', '.arw', '.dng', '.raw', '.raf', '.orf', '.rw2']:  # RAW formats
            # Check preprocessing cache for converted JPG
            try:
                cache = get_preprocessing_cache()
                file_hash = cache.compute_file_hash(str(image_path))
                cached_jpg = cache.get_nef_conversion(file_hash)

                if cached_jpg and os.path.exists(cached_jpg):
                    logger.info(f"[DetectionService] Using cached JPG for: {image_path.name}")
                    img = ImageOps.exif_transpose(Image.open(cached_jpg))
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
            # Honor EXIF orientation so detection/thumbnail coordinates match how the
            # frontend (Chromium <img>) displays the image, which auto-applies EXIF.
            # PIL does not transpose on its own; without this, phone JPEGs with an
            # orientation tag get faces detected in the un-rotated frame → misplaced
            # boxes and sideways thumbnail crops. RAW is unaffected (libraw orients).
            img = ImageOps.exif_transpose(Image.open(image_path))
            return np.array(img.convert('RGB'))

    def _detect_and_match_faces(self, rgb: np.ndarray, max_dimension: int = 4500, file_hash: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Detect faces and match against database. Returns (faces, detection_meta)."""
        import cv2

        # Resize if needed (optimize performance)
        height, width = rgb.shape[:2]
        if max(height, width) > max_dimension:
            scale = max_dimension / max(height, width)
            new_width = int(width * scale)
            new_height = int(height * scale)
            rgb_resized = cv2.resize(rgb, (new_width, new_height), interpolation=cv2.INTER_AREA)
            scale_factor = 1 / scale
            detection_px = max(new_width, new_height)
            scale_label = "mid"  # Scaled to ~4500px, matching CLI "mid" level
        else:
            rgb_resized = rgb
            scale_factor = 1.0
            detection_px = max(width, height)
            scale_label = "full"

        # Build detection metadata
        detection_meta = {
            "scale_label": scale_label,
            "scale_px": detection_px,
            "original_size": (width, height),
        }

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
            return [], detection_meta

        # Match against database
        results = []
        # Confirmed-distinct pairs (e.g. twins): load once per image for the
        # recognition tie-break below.
        distinct_pairs = _load_distinct_pairs()
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

            # Twin tie-break: when the top-2 candidates are a registered
            # confirmed-distinct pair and nearly equidistant from the probe, the
            # single-nearest matcher can pick the wrong twin. Re-decide with a
            # k-NN vote over both people's confirmed faces.
            disambiguated = None
            disamb = self._maybe_disambiguate_twins(
                encoding, match_alternatives, match_case, distinct_pairs
            )
            if disamb is not None:
                best_match, chosen_distance, match_alternatives, disambiguated = disamb
                if chosen_distance is not None:
                    best_distance = chosen_distance

            full_encoding_hash = hashlib.sha1(encoding.tobytes()).hexdigest()
            face_id = f"face_{i}_{full_encoding_hash[:16]}"

            # Cache encoding for later confirm/ignore operations (includes file_hash to avoid rehashing)
            self._lru_put(self.encoding_cache, face_id, (encoding, bbox, file_hash), MAX_ENCODING_CACHE)

            # Calculate ignore confidence
            ignore_confidence = None
            if ignore_distance is not None:
                ignore_confidence = max(0, min(100, int((1.0 - ignore_distance) * 100)))

            # Determine person_name based on match_case
            # Only suggest a name when it's clearly the best match
            if match_case in ("name", "uncertain_name"):
                suggested_name = best_match
            else:
                # For ign, uncertain_ign, unknown - don't pre-fill a name
                suggested_name = None

            results.append({
                "face_id": face_id,
                "bounding_box": bbox,
                "confidence": float(1.0 - best_distance) if best_distance is not None else 0.0,
                "person_name": suggested_name,
                "match_distance": float(best_distance) if best_distance is not None else None,
                "is_confirmed": False,
                "match_case": match_case,
                "ignore_distance": float(ignore_distance) if ignore_distance is not None else None,
                "ignore_confidence": ignore_confidence,
                "match_alternatives": match_alternatives,
                "encoding_hash": full_encoding_hash,
                "disambiguated": disambiguated
            })

        return results, detection_meta

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

    def _distinct_pairs_version(self) -> int:
        """Registry version for cache keys: the file's mtime (ns), or 0 if absent."""
        try:
            return DISTINCT_PAIRS_PATH.stat().st_mtime_ns
        except OSError:
            return 0

    def _detection_cache_key(self, file_hash: str) -> str:
        """Detection-cache key: file hash + registry version (single source of truth
        so reads and writes can't drift apart)."""
        return f"{file_hash}@{self._distinct_pairs_version()}"

    def _cached_detection_meta(self, file_hash: Optional[str]) -> Tuple[Dict[str, Any], float]:
        """(detection_meta, processing_time_ms) from the detection cache, or ({}, 0)."""
        if file_hash:
            cached = self.cache.get(self._detection_cache_key(file_hash))
            if cached:
                return cached.get("detection_meta", {}), cached.get("processing_time_ms", 0)
        return {}, 0

    def _person_match_encodings(self, name: str) -> List[np.ndarray]:
        """Usable encodings for `name` for the active backend (mirrors _match_encoding)."""
        out: List[np.ndarray] = []
        for entry in self.known_faces.get(name, []):
            if isinstance(entry, dict):
                enc = entry.get("encoding")
                be = entry.get("backend", "dlib")
            else:
                enc = entry
                be = "dlib"
            if enc is not None and be == self.backend.backend_name:
                out.append(enc)
        return out

    def _maybe_disambiguate_twins(
        self,
        encoding: np.ndarray,
        match_alternatives: List[Dict[str, Any]],
        match_case: Optional[str],
        distinct_pairs: set,
    ) -> Optional[Tuple[str, Optional[float], List[Dict[str, Any]], Dict[str, Any]]]:
        """Apply the twin tie-break to one face, if it qualifies.

        Returns ``(chosen, chosen_distance, reordered_alternatives, info)`` when
        the top-2 candidates are a registered confirmed-distinct pair, neither is
        ignored, both are plausible names and within ``twin_margin``, and the
        k-NN vote yields a winner. The chosen alternative is moved to the front of
        the returned list so the recommended option matches the decision; the rest
        keep their order. Returns ``None`` when no override applies.
        """
        if not distinct_pairs or match_case not in ("name", "uncertain_name"):
            return None
        if len(match_alternatives) < 2:
            return None
        top1, top2 = match_alternatives[0], match_alternatives[1]
        if top1.get("is_ignored") or top2.get("is_ignored"):
            return None
        pair = tuple(sorted((top1["name"], top2["name"])))
        twin_margin = self.config.get("twin_margin", 0.1)
        if pair not in distinct_pairs or (top2["distance"] - top1["distance"]) > twin_margin:
            return None

        twin_knn_k = self.config.get("twin_knn_k", 5)
        chosen = self._disambiguate_distinct_pair(
            encoding, top1["name"], top2["name"], twin_knn_k
        )
        if chosen is None:
            return None

        chosen_alt = next((a for a in match_alternatives if a["name"] == chosen), None)
        chosen_distance = None
        reordered = match_alternatives
        if chosen_alt is not None:
            chosen_distance = chosen_alt["distance"]
            reordered = [chosen_alt] + [a for a in match_alternatives if a is not chosen_alt]
        info = {
            "between": [top1["name"], top2["name"]],
            "chosen": chosen,
            "method": "knn",
            "k": min(
                twin_knn_k,
                len(self._person_match_encodings(top1["name"]))
                + len(self._person_match_encodings(top2["name"])),
            ),
        }
        return chosen, chosen_distance, reordered, info

    def _disambiguate_distinct_pair(
        self, encoding: np.ndarray, name_a: str, name_b: str, k: int
    ) -> Optional[str]:
        """Pick between two confirmed-distinct look-alikes via a k-NN vote.

        The default matcher already assigns by the single nearest encoding, so a
        plain 1-NN tie-break would just repeat it. Here we vote among the probe's
        k nearest encodings drawn from the *union* of both people's confirmed
        faces — more robust to one noisy crop. Returns the winning name, or None
        when either side has no usable encoding or the vote ties.
        """
        a_vecs = self._person_match_encodings(name_a)
        b_vecs = self._person_match_encodings(name_b)
        if not a_vecs or not b_vecs:
            return None
        allv = np.array(a_vecs + b_vecs)
        labels = np.array([0] * len(a_vecs) + [1] * len(b_vecs))
        dists = self.backend.compute_distances(allv, encoding)
        kk = min(k, len(dists))
        nearest = np.argsort(dists)[:kk]
        a_votes = int(np.sum(labels[nearest] == 0))
        b_votes = int(np.sum(labels[nearest] == 1))
        if a_votes == b_votes:
            return None
        return name_a if a_votes > b_votes else name_b

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
                # Ensure encoding is a proper numpy array
                enc_array = np.asarray(enc)
                if enc_array.ndim == 1:  # Valid 1D encoding
                    ignored_encodings.append(enc_array)

        if ignored_encodings:
            # Stack into 2D array for batch distance computation
            encodings_matrix = np.vstack(ignored_encodings)
            distances = self.backend.compute_distances(encodings_matrix, encoding)
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
            # Filter by backend and ensure proper numpy arrays
            person_encodings = []
            for e in entries:
                if isinstance(e, dict) and e.get("backend") == self.backend.backend_name:
                    enc = e.get("encoding")
                    if enc is not None:
                        enc_array = np.asarray(enc)
                        if enc_array.ndim == 1:
                            person_encodings.append(enc_array)

            if not person_encodings:
                continue

            # Stack into 2D array for batch distance computation
            encodings_matrix = np.vstack(person_encodings)
            distances = self.backend.compute_distances(encodings_matrix, encoding)
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

        # Check cache (hash computed in thread pool to avoid blocking event loop)
        loop = asyncio.get_event_loop()
        file_hash = await loop.run_in_executor(_executor, self._get_file_hash, path)
        # Fold the confirmed-distinct registry version into the cache key, so a
        # twin-pair add/remove invalidates stale suggestions for already-viewed
        # photos (matching depends on the registry, not just the file contents).
        cache_key = self._detection_cache_key(file_hash)
        if not force_reprocess and cache_key in self.cache:
            logger.info(f"[DetectionService] Using cached result for: {image_path}")
            self.cache.move_to_end(cache_key)
            cached_result = self.cache[cache_key]
            cached_result["cached"] = True
            return cached_result

        # Load image in thread pool
        rgb = await loop.run_in_executor(_executor, self._load_image, path)

        # Detect and match faces in thread pool
        faces, detection_meta = await loop.run_in_executor(
            _executor, self._detect_and_match_faces, rgb, 4500, file_hash
        )

        # Build result
        processing_time = (time.time() - start_time) * 1000  # milliseconds
        result = {
            "faces": faces,
            "processing_time_ms": processing_time,
            "cached": False,
            "file_hash": file_hash,
            "detection_meta": detection_meta
        }

        # Cache result with LRU eviction (keyed by file hash + registry version)
        self._lru_put(self.cache, cache_key, result, MAX_DETECTION_CACHE)
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

        # Check image cache first
        path = Path(image_path)
        cache_key = str(path)
        current_time = time.time()
        loop = asyncio.get_event_loop()

        if cache_key in self.image_cache:
            rgb, timestamp = self.image_cache[cache_key]
            if current_time - timestamp < self.image_cache_ttl:
                self.image_cache.move_to_end(cache_key)
                logger.debug(f"[DetectionService] Using cached image for thumbnail: {path.name}")
            else:
                logger.debug(f"[DetectionService] Cache expired for: {path.name}")
                del self.image_cache[cache_key]
                rgb = await loop.run_in_executor(_executor, self._load_image, path)
                self._lru_put(self.image_cache, cache_key, (rgb, current_time), MAX_IMAGE_CACHE)
        else:
            logger.debug(f"[DetectionService] Loading and caching image for thumbnail: {path.name}")
            rgb = await loop.run_in_executor(_executor, self._load_image, path)
            self._lru_put(self.image_cache, cache_key, (rgb, current_time), MAX_IMAGE_CACHE)

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

    async def confirm_identity(
        self, 
        face_id: str, 
        person_name: str, 
        image_path: str,
        suggested_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Confirm face identity and save to database

        Args:
            face_id: Face identifier from detection
            person_name: Person name to associate with this face
            image_path: Source image path
            suggested_name: Original suggestion (if user corrected, adds hard negative)

        Returns:
            Success status
        """
        logger.info(f"[DetectionService] Confirming face {face_id} as {person_name}")

        # Handle manual faces: save to known_faces with encoding=None for consistency
        if face_id.startswith("manual_"):
            logger.info(f"[DetectionService] Manual face confirmed: {person_name}")

            loop = asyncio.get_event_loop()
            path = Path(image_path)
            file_hash = await loop.run_in_executor(_executor, get_file_hash, path) if path.exists() else None
            backend_info = self.backend.get_model_info()

            entry = {
                "encoding": None,
                "file": str(image_path),
                "hash": file_hash,
                "backend": self.backend.backend_name,
                "backend_version": backend_info.get("version", "unknown"),
                "created_at": datetime.now().isoformat(),
                "encoding_hash": None,
                "bounding_box": None,
                "is_manual": True
            }

            if person_name not in self.known_faces:
                self.known_faces[person_name] = []
            self.known_faces[person_name].append(entry)

            await self._schedule_save()
            logger.info(f"[DetectionService] Saved manual face for {person_name} (total: {len(self.known_faces[person_name])})")

            return {
                "status": "success",
                "person_name": person_name,
                "encodings_count": len(self.known_faces[person_name])
            }

        # Get encoding + cached file_hash from cache
        if face_id not in self.encoding_cache:
            raise ValueError(f"Face ID not found in cache: {face_id}. Detection may have expired.")

        encoding, bbox, cached_hash = self.encoding_cache[face_id]
        self.encoding_cache.move_to_end(face_id)

        # Use cached hash if available, otherwise compute
        if cached_hash:
            file_hash = cached_hash
        else:
            loop = asyncio.get_event_loop()
            path = Path(image_path)
            file_hash = await loop.run_in_executor(_executor, get_file_hash, path) if path.exists() else None

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

        if suggested_name and suggested_name != person_name:
            if suggested_name not in self.hard_negatives:
                self.hard_negatives[suggested_name] = []
            hard_neg_entry = {
                "encoding": encoding,
                "file": str(image_path),
                "hash": file_hash,
                "backend": self.backend.backend_name,
                "backend_version": backend_info.get("version", "unknown"),
                "created_at": datetime.now().isoformat(),
                "encoding_hash": encoding_hash
            }
            self.hard_negatives[suggested_name].append(hard_neg_entry)
            logger.info(f"[DetectionService] Added hard negative for {suggested_name} (corrected to {person_name})")

        await self._schedule_save()

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
        if face_id.startswith("manual_"):
            logger.info("[DetectionService] Manual face ignored (no encoding to save)")
            return {
                "status": "success",
                "ignored_count": len(self.ignored_faces)
            }

        # Get encoding + cached file_hash from cache
        if face_id not in self.encoding_cache:
            raise ValueError(f"Face ID not found in cache: {face_id}. Detection may have expired.")

        encoding, bbox, cached_hash = self.encoding_cache[face_id]
        self.encoding_cache.move_to_end(face_id)

        # Use cached hash if available, otherwise compute
        if cached_hash:
            file_hash = cached_hash
        else:
            loop = asyncio.get_event_loop()
            path = Path(image_path)
            file_hash = await loop.run_in_executor(_executor, get_file_hash, path) if path.exists() else None

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

        # Debounced save
        await self._schedule_save()

        logger.info(f"[DetectionService] Added face to ignored list (total: {len(self.ignored_faces)})")

        return {
            "status": "success",
            "ignored_count": len(self.ignored_faces)
        }

    def _confirm_identity_nosave(
        self,
        face_id: str,
        person_name: str,
        image_path: str,
        suggested_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """In-memory confirm without saving to disk. Returns result dict."""
        if face_id.startswith("manual_"):
            backend_info = self.backend.get_model_info()
            # Anchor manual faces by content hash (like detected faces) so the rename
            # pipeline can recover the name by hash even after the file is renamed —
            # mirrors the single-call confirm_identity path.
            path = Path(image_path)
            file_hash = get_file_hash(path) if path.exists() else None
            entry = {
                "encoding": None,
                "file": str(image_path),
                "hash": file_hash,
                "backend": self.backend.backend_name,
                "backend_version": backend_info.get("version", "unknown"),
                "created_at": datetime.now().isoformat(),
                "encoding_hash": None,
                "bounding_box": None,
                "is_manual": True
            }
            if person_name not in self.known_faces:
                self.known_faces[person_name] = []
            self.known_faces[person_name].append(entry)
            return {"status": "success", "person_name": person_name,
                    "encodings_count": len(self.known_faces[person_name])}

        if face_id not in self.encoding_cache:
            raise ValueError(f"Face ID not found in cache: {face_id}. Detection may have expired.")

        encoding, bbox, cached_hash = self.encoding_cache[face_id]
        self.encoding_cache.move_to_end(face_id)
        file_hash = cached_hash
        encoding_hash = hashlib.sha1(encoding.tobytes()).hexdigest()
        backend_info = self.backend.get_model_info()

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

        if person_name not in self.known_faces:
            self.known_faces[person_name] = []
        self.known_faces[person_name].append(entry)

        if suggested_name and suggested_name != person_name:
            if suggested_name not in self.hard_negatives:
                self.hard_negatives[suggested_name] = []
            hard_neg_entry = {
                "encoding": encoding,
                "file": str(image_path),
                "hash": file_hash,
                "backend": self.backend.backend_name,
                "backend_version": backend_info.get("version", "unknown"),
                "created_at": datetime.now().isoformat(),
                "encoding_hash": encoding_hash
            }
            self.hard_negatives[suggested_name].append(hard_neg_entry)

        return {"status": "success", "person_name": person_name,
                "encodings_count": len(self.known_faces[person_name])}

    def _ignore_face_nosave(self, face_id: str, image_path: str) -> Dict[str, Any]:
        """In-memory ignore without saving to disk. Returns result dict."""
        if face_id.startswith("manual_"):
            return {"status": "success", "ignored_count": len(self.ignored_faces)}

        if face_id not in self.encoding_cache:
            raise ValueError(f"Face ID not found in cache: {face_id}. Detection may have expired.")

        encoding, bbox, cached_hash = self.encoding_cache[face_id]
        self.encoding_cache.move_to_end(face_id)
        file_hash = cached_hash
        encoding_hash = hashlib.sha1(encoding.tobytes()).hexdigest()
        backend_info = self.backend.get_model_info()

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
        self.ignored_faces.append(entry)
        return {"status": "success", "ignored_count": len(self.ignored_faces)}

    async def batch_confirm(
        self,
        confirmations: List[Dict[str, Any]],
        ignores: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Batch confirm/ignore faces with a single database save.

        Args:
            confirmations: List of {face_id, person_name, image_path, suggested_name?}
            ignores: List of {face_id, image_path}

        Returns:
            Summary with confirmed_count, ignored_count, errors
        """
        confirmed = 0
        ignored = 0
        errors = []

        for c in confirmations:
            try:
                self._confirm_identity_nosave(
                    c["face_id"], c["person_name"], c["image_path"],
                    c.get("suggested_name")
                )
                confirmed += 1
            except Exception as e:
                errors.append({"face_id": c["face_id"], "error": str(e)})

        for ig in ignores:
            try:
                self._ignore_face_nosave(ig["face_id"], ig["image_path"])
                ignored += 1
            except Exception as e:
                errors.append({"face_id": ig["face_id"], "error": str(e)})

        # Single save for entire batch
        await self._flush_save()

        logger.info(f"[DetectionService] Batch: confirmed={confirmed}, ignored={ignored}, errors={len(errors)}")

        return {
            "status": "success",
            "confirmed_count": confirmed,
            "ignored_count": ignored,
            "errors": errors
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

        # Use provided hash or compute in thread pool
        if file_hash is None:
            loop = asyncio.get_event_loop()
            path = Path(image_path)
            file_hash = await loop.run_in_executor(_executor, get_file_hash, path) if path.exists() else None
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
                "hash": face.get('encoding_hash', '')
            })

        # Detection metadata from the cache, keyed exactly as detect_faces stores
        # it (file hash + registry version); otherwise the logged attempt stats
        # would lose their timing / scale metadata.
        detection_meta, processing_time_ms = self._cached_detection_meta(file_hash)

        # Build attempt info with backend metadata for statistics compatibility
        backend_info = self.backend.get_model_info()
        attempts = [{
            "face_count": len(reviewed_faces),
            "source": "ansikten",
            "backend": self.backend.backend_name,
            "backend_version": backend_info.get('model', 'unknown'),
            "upsample": 0,  # API never upsamples
            "scale_label": detection_meta.get("scale_label", "api"),
            "scale_px": detection_meta.get("scale_px", 0),
            "time_seconds": round(processing_time_ms / 1000, 3),
        }]

        # Log to attempt_stats.jsonl (blocking I/O — run in thread pool)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            _executor,
            lambda: log_attempt_stats(
                image_path=image_path,
                attempts=attempts,
                used_attempt_idx=0,
                base_dir=BASE_DIR,
                review_results=["ok"],
                labels_per_attempt=[labels],
                file_hash=file_hash
            )
        )

        logger.info(f"[DetectionService] Logged {len(labels)} face labels to attempt_stats.jsonl")

        # Add to processed_files so file won't be re-processed (even if renamed)
        file_name = Path(image_path).name
        entry = {"name": file_name, "hash": file_hash}
        if entry not in self.processed_files:
            self.processed_files.append(entry)
            await self._flush_save()  # Immediate save — review is finalized
            logger.info(f"[DetectionService] Added {file_name} to processed_files")

        # Invalidate statistics cache so dashboard picks up new data
        try:
            from .statistics_service import statistics_service
            statistics_service.invalidate_cache()
        except Exception:
            pass  # Non-critical

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
