"""
Detection Service

Wraps existing face detection logic from the Ansikten CLI.
"""

import asyncio
import hashlib
import logging
import os
import sys
import threading
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
from core.db import BASE_DIR, get_file_hash
from core.files import RAW_EXTENSIONS
from core.matching import _get_backend_thresholds
from face_backends import create_backend

from .db_store import get_db_store
from .management_service import DISTINCT_PAIRS_PATH, _load_distinct_pairs
from .matching_index import MatchingIndex
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
        logger.info(
            f"[DetectionService] Initialized backend: {self.backend.backend_name} "
            f"(detection strategy: {self._detection_strategy_token()})"
        )

        # All reads/mutations of the face DB go through the process-wide
        # FaceDBStore — the single in-memory authority (freshness by file
        # fingerprint, leading-coalesce debounced saves). No per-service copies
        # of the collections and no own save machinery.
        self.store = get_db_store()

        # Version-invalidated matching index: precompiled per-backend candidate
        # matrices, rebuilt only when the store version moves. The matching
        # helpers consume it instead of restacking matrices per detected face.
        self._matching_index = MatchingIndex(self.store, self.backend.backend_name)

        # LRU caches using OrderedDict (move_to_end on access, popitem(last=False) to evict)
        # Detection results cache (keyed by file hash + registry version)
        self.cache: OrderedDict[str, Dict[str, Any]] = OrderedDict()

        # Store version the detection (match-result) cache was populated at. The
        # cache holds match SUGGESTIONS that depend on DB contents; when the
        # store version moves (a confirm/ignore here or an external reload), the
        # cache is invalidated on the next detect so stale suggestions can't leak.
        self._cache_db_version = self.store.version

        # Face encoding cache (keyed by face_id) — stores (encoding, bbox, file_hash)
        self.encoding_cache: OrderedDict[str, Tuple[np.ndarray, Dict[str, int], Optional[str]]] = OrderedDict()

        # Image cache (keyed by image path) — stores (rgb_array, timestamp)
        self.image_cache: OrderedDict[str, Tuple[np.ndarray, float]] = OrderedDict()
        self.image_cache_ttl = 1800  # 30 minutes

    @staticmethod
    def _lru_put(cache: OrderedDict, key, value, max_size: int):
        """Insert into an OrderedDict with LRU eviction."""
        if key in cache:
            cache.move_to_end(key)
        cache[key] = value
        while len(cache) > max_size:
            cache.popitem(last=False)

    def reload_database(self) -> Dict[str, Any]:
        """
        Reload face database from disk (via the store) and clear local caches.

        The FaceDBStore reloads its collections from disk on the next read/mutate
        whenever a backing file's fingerprint changed (e.g. an external edit by
        scripts/archive/hantera_ansikten.py), so this endpoint no longer loads
        the DB itself. It clears the detection/encoding/image caches — which hold
        match SUGGESTIONS computed from the old DB — and re-pins the cache to the
        current store version. ``store.read`` triggers the freshness check.

        Returns:
            Status info with counts
        """
        logger.info("[DetectionService] Reloading database (clearing caches)...")

        # Clear caches to ensure fresh results
        old_cache_size = len(self.cache)
        self.cache.clear()
        self.encoding_cache.clear()
        self.image_cache.clear()

        # read() runs the store's freshness check (reloading on external change)
        # and reports the live counts under the lock.
        people_count, ignored_count = self.store.read(
            lambda known, ignored, hardneg, processed: (len(known), len(ignored))
        )
        # Re-pin the match-result cache to the (possibly bumped) store version.
        self._cache_db_version = self.store.version

        logger.info(f"[DetectionService] Database reloaded: {people_count} people, {ignored_count} ignored faces")
        logger.info(f"[DetectionService] Cleared {old_cache_size} cached detection results")

        return {
            "status": "success",
            "people_count": people_count,
            "ignored_count": ignored_count,
            "cache_cleared": old_cache_size
        }

    def _get_file_hash(self, path: Path) -> str | None:
        """Compute SHA1 hash of file (delegates to the canonical core.db impl)."""
        return get_file_hash(path)

    def _load_image(self, image_path: Path) -> np.ndarray:
        """Load image as RGB array (supports NEF and standard formats)

        For RAW formats, checks preprocessing cache first for cached JPG.
        """
        ext = image_path.suffix.lower()

        # RAW formats handled by rawpy/libraw (canonical set in core.files).
        if ext in RAW_EXTENSIONS:  # RAW formats
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

    def _load_image_for_detection(self, image_path: Path) -> Tuple[np.ndarray, float]:
        """Load pixels for DETECTION, allowing a fast half-size RAW decode.

        Returns ``(rgb, coord_scale)`` where ``coord_scale`` maps ``rgb``'s
        pixel space back to the full-resolution space the frontend displays
        (the preprocessed full-res JPG). For cached JPGs and standard formats
        the scale is 1.0. On a RAW cache miss the file is decoded with
        ``half_size=True`` (~2.7x faster demosaic); detection quality is
        equivalent (measured IoU 0.976-0.993, embedding cosine similarity
        0.966-0.994 on real NEFs) because detection downscales to <=4500 px
        anyway, and the returned ``coord_scale`` lets the caller keep bounding
        boxes in full-resolution space. Display/thumbnail paths must NOT use
        this method — they need full-resolution pixels.
        """
        ext = image_path.suffix.lower()
        if ext in RAW_EXTENSIONS:
            try:
                cache = get_preprocessing_cache()
                file_hash = cache.compute_file_hash(str(image_path))
                cached_jpg = cache.get_nef_conversion(file_hash)
                if cached_jpg and os.path.exists(cached_jpg):
                    logger.info(f"[DetectionService] Using cached JPG for: {image_path.name}")
                    img = ImageOps.exif_transpose(Image.open(cached_jpg))
                    return np.array(img.convert('RGB')), 1.0
            except Exception as e:
                logger.debug(f"[DetectionService] Cache lookup failed, falling back to rawpy: {e}")

            logger.debug(f"[DetectionService] Loading RAW at half size for detection: {image_path}")
            with rawpy.imread(str(image_path)) as raw:
                full_long_side = max(raw.sizes.height, raw.sizes.width)
                rgb = raw.postprocess(half_size=True)
            # libraw's half_size halves each dimension; derive the exact factor
            # from the sensor dimensions rather than assuming 2.0. Compare the
            # LONG sides: raw.sizes reports pre-flip sensor dimensions while
            # rgb is post-flip output, so height/height would mix axes for a
            # 90°-rotated (portrait) NEF and yield ~1.33 instead of 2.0 —
            # max/max is orientation-invariant (Nagelfar #154 issue-001).
            coord_scale = full_long_side / max(rgb.shape[0], rgb.shape[1])
            return rgb, coord_scale
        return self._load_image(image_path), 1.0

    def _detect_and_match_faces(self, rgb: np.ndarray, max_dimension: int = 4500, file_hash: Optional[str] = None, coord_scale: float = 1.0) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Detect faces and match against database. Returns (faces, detection_meta).

        ``coord_scale`` maps the supplied ``rgb``'s pixel space back to the
        full-resolution space the frontend displays (e.g. 2.0 when the RAW was
        decoded with ``half_size=True``). It is folded into the bounding-box
        scale factor so every consumer — API results, the encoding cache, and
        DB writes — keeps receiving full-resolution coordinates.
        """
        import cv2

        # Resize if needed (optimize performance)
        height, width = rgb.shape[:2]
        if max(height, width) > max_dimension:
            scale = max_dimension / max(height, width)
            new_width = int(width * scale)
            new_height = int(height * scale)
            rgb_resized = cv2.resize(rgb, (new_width, new_height), interpolation=cv2.INTER_AREA)
            scale_factor = (1 / scale) * coord_scale
            detection_px = max(new_width, new_height)
            scale_label = "mid"  # Scaled to ~4500px, matching CLI "mid" level
        else:
            rgb_resized = rgb
            scale_factor = coord_scale
            detection_px = max(width, height)
            scale_label = "full" if coord_scale == 1.0 else "half"

        # Build detection metadata (original_size in full-resolution space)
        detection_meta = {
            "scale_label": scale_label,
            "scale_px": detection_px,
            "original_size": (int(width * coord_scale), int(height * coord_scale)),
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

    def _get_matching_index(self) -> MatchingIndex:
        """Return the matching index, building it lazily.

        Constructed in ``__init__`` for the production service, but tests
        instantiate via ``__new__`` (no ``__init__``) and set ``store``/
        ``backend`` by hand — build on first use so those paths work too.
        """
        idx = getattr(self, "_matching_index", None)
        if idx is None:
            idx = MatchingIndex(self.store, self.backend.backend_name)
            self._matching_index = idx
        return idx

    def _hard_negative_threshold(self) -> float:
        """Distance below which a probe counts as one of a person's hard
        negatives. Single source of truth shared with the CLI's ``best_matches``
        (``backend_thresholds.<backend>.hard_negative_distance``)."""
        thresholds = _get_backend_thresholds(self.config, self.backend)
        return thresholds.get("hard_negative_distance", 0.45)

    def _is_hard_negative(
        self, name: str, encoding: np.ndarray, threshold: float
    ) -> bool:
        """True when the probe is closer than ``threshold`` to any of ``name``'s
        hard negatives — i.e. the user explicitly rejected this identity for a
        face like this, so it must not be suggested. Mirrors the CLI's per-person
        skip in ``core.matching.best_matches``."""
        hardneg = self._get_matching_index().hardneg_matrix(name)
        if hardneg is None:
            return False
        neg_distances = self.backend.compute_distances(hardneg, encoding)
        return float(np.min(neg_distances)) < threshold

    def _match_encoding(self, encoding: np.ndarray) -> Tuple[Optional[str], Optional[float]]:
        """Match encoding against known faces database"""
        # Precompiled per-person matrices from the version-invalidated index
        # (rebuilt only when the DB changes); distance computation runs here.
        hard_neg_thr = self._hard_negative_threshold()
        best_name = None
        best_distance = None
        for name, matrix in self._get_matching_index().known_lenient_items():
            # Skip a person the user has explicitly rejected for a face like this.
            if self._is_hard_negative(name, encoding, hard_neg_thr):
                continue
            distances = self.backend.compute_distances(matrix, encoding)
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

    def _detection_strategy_token(self) -> str:
        """Detection-strategy token for the cache key.

        Encodes the parameters that change detection *results* (not just the
        matching step): the effective det_size and a tiling flag. Format:
        ``d{W}x{H}+t{0|1}`` — e.g. ``d1280x1280+t0``. Tiling is off (``t0``)
        until PR 4b enables it; keeping the placeholder here lets that change
        extend the token without another key-format change. Backends without a
        det_size (e.g. dlib) yield ``d0x0+t0``.
        """
        det_size = getattr(self.backend, "det_size", None)
        if isinstance(det_size, (list, tuple)) and len(det_size) == 2:
            w, h = int(det_size[0]), int(det_size[1])
        else:
            w = h = 0
        tiling = 0  # placeholder; PR 4b will drive this from config
        return f"d{w}x{h}+t{tiling}"

    def _detection_cache_key(self, file_hash: str) -> str:
        """Detection-cache key: file hash + registry version + strategy token.

        Format: ``{file_hash}@{distinct_pairs_version}#{strategy_token}``.
        Single source of truth so reads and writes can't drift apart, and so a
        det_size / tiling change can't serve stale detections from another
        strategy. See ``_detection_strategy_token`` for the token format."""
        return (
            f"{file_hash}@{self._distinct_pairs_version()}"
            f"#{self._detection_strategy_token()}"
        )

    def _cached_detection_meta(self, file_hash: Optional[str]) -> Tuple[Dict[str, Any], float]:
        """(detection_meta, processing_time_ms) from the detection cache, or ({}, 0)."""
        if file_hash:
            cached = self.cache.get(self._detection_cache_key(file_hash))
            if cached:
                return cached.get("detection_meta", {}), cached.get("processing_time_ms", 0)
        return {}, 0

    def _person_match_encodings(self, name: str) -> List[np.ndarray]:
        """Usable encodings for `name` for the active backend (mirrors _match_encoding)."""
        return self._get_matching_index().person_lenient_rows(name)

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
        # Precompiled stacked matrix from the index (preserves the original
        # filtered order, so the returned argmin index is unchanged).
        encodings_matrix = self._get_matching_index().ignored_matrix()
        if encodings_matrix is None:
            return None, None

        distances = self.backend.compute_distances(encodings_matrix, encoding)
        min_distance = float(np.min(distances))
        return int(np.argmin(distances)), min_distance

    def _determine_match_case(
        self,
        name_dist: Optional[float],
        ignore_dist: Optional[float]
    ) -> str:
        """
        Determine match case based on distances (like legacy script).

        Returns one of: 'name', 'ign', 'uncertain_name', 'uncertain_ign', 'unknown'
        """
        # Thresholds come from the single source of truth shared with the CLI
        # (backend_thresholds.<backend>), so both code paths match at the same
        # backend-appropriate distances. A name is auto-filled only below
        # match_threshold; faces in the uncertain band [match_threshold,
        # match_threshold + ...) are left "unknown" here but still surface the
        # nearest person via match_alternatives (see _match_encoding_alternatives).
        thresholds = _get_backend_thresholds(self.config, self.backend)
        name_thr = thresholds.get("match_threshold", 0.4)
        ignore_thr = thresholds.get("ignore_distance", 0.35)
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

        # Precompiled per-person matrices from the index. Alternatives filter
        # strictly on an explicit backend key (no dlib default) and 1-D
        # encodings — the index's "strict" set mirrors exactly that.
        candidates = self._get_matching_index().known_strict_items()
        hard_neg_thr = self._hard_negative_threshold()

        # Match against known faces
        for name, encodings_matrix in candidates:
            # Drop a person the user explicitly rejected for a face like this, so
            # they are never offered as a candidate (and never enter the twin
            # tie-break). Explicit rejection beats the suggestion heuristics.
            if self._is_hard_negative(name, encoding, hard_neg_thr):
                continue
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

        # Match SUGGESTIONS in the detection cache depend on the DB contents, so
        # invalidate them when the store version moved since the cache was last
        # pinned (a confirm/ignore here, or an external reload picked up by the
        # store's freshness check). The registry version is folded into the key
        # for twin-pair edits; this covers plain known_faces/ignored changes.
        db_version = self.store.version
        if db_version != self._cache_db_version:
            self.cache.clear()
            self._cache_db_version = db_version

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

        # Load image in thread pool. Detection may decode RAW at half size on
        # a preprocessing-cache miss; coord_scale maps boxes back to full-res.
        rgb, coord_scale = await loop.run_in_executor(
            _executor, self._load_image_for_detection, path
        )

        # Capture the DB version the matching pass computes against. The
        # entry-time check/clear above and the cache write below straddle
        # awaits, and _cache_db_version is process-wide — a concurrent detect
        # interleaving with a confirm could otherwise write a pre-mutation
        # result under the new pin and serve it stale until the next version
        # move. Gating the write on this captured value closes that window.
        version_at_compute = self.store.version

        # Detect and match faces in thread pool
        faces, detection_meta = await loop.run_in_executor(
            _executor, self._detect_and_match_faces, rgb, 4500, file_hash, coord_scale
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

        # Cache result with LRU eviction (keyed by file hash + registry
        # version) — but only if the DB did not move under us mid-compute;
        # a possibly-stale suggestion must not outlive the version bump.
        if self.store.version == version_at_compute:
            self._lru_put(self.cache, cache_key, result, MAX_DETECTION_CACHE)
        else:
            logger.debug(
                "[DetectionService] DB version advanced during detection — "
                "skipping cache write for %s", image_path,
            )
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

            def add_manual(known, ignored, hardneg, processed):
                if person_name not in known:
                    known[person_name] = []
                known[person_name].append(entry)
                return len(known[person_name])

            # store.mutate schedules the debounced save (leading-coalesce),
            # matching the old per-face _schedule_save cadence — no flush.
            count = self.store.mutate(add_manual, touches={"known"})
            logger.info(f"[DetectionService] Saved manual face for {person_name} (total: {count})")

            return {
                "status": "success",
                "person_name": person_name,
                "encodings_count": count
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

        hard_neg_entry = None
        if suggested_name and suggested_name != person_name:
            hard_neg_entry = {
                "encoding": encoding,
                "file": str(image_path),
                "hash": file_hash,
                "backend": self.backend.backend_name,
                "backend_version": backend_info.get("version", "unknown"),
                "created_at": datetime.now().isoformat(),
                "encoding_hash": encoding_hash
            }

        def add_known(known, ignored, hardneg, processed):
            if person_name not in known:
                known[person_name] = []
            known[person_name].append(entry)
            if hard_neg_entry is not None:
                if suggested_name not in hardneg:
                    hardneg[suggested_name] = []
                hardneg[suggested_name].append(hard_neg_entry)
            return len(known[person_name])

        # store.mutate schedules the debounced save (leading-coalesce) — the old
        # per-face _schedule_save cadence; no synchronous flush here.
        # Touches known always; hardneg only when the user corrected a suggestion.
        touches = {"known"} | ({"hardneg"} if hard_neg_entry is not None else set())
        count = self.store.mutate(add_known, touches=touches)
        if hard_neg_entry is not None:
            logger.info(f"[DetectionService] Added hard negative for {suggested_name} (corrected to {person_name})")

        logger.info(f"[DetectionService] Saved encoding for {person_name} (total: {count})")

        return {
            "status": "success",
            "person_name": person_name,
            "encodings_count": count
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
            ignored_count = self.store.read(
                lambda known, ignored, hardneg, processed: len(ignored)
            )
            return {
                "status": "success",
                "ignored_count": ignored_count
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

        def add_ignored(known, ignored, hardneg, processed):
            ignored.append(entry)
            return len(ignored)

        # store.mutate schedules the debounced save (leading-coalesce).
        ignored_count = self.store.mutate(add_ignored, touches={"ignored"})

        logger.info(f"[DetectionService] Added face to ignored list (total: {ignored_count})")

        return {
            "status": "success",
            "ignored_count": ignored_count
        }

    def _confirm_identity_nosave(
        self,
        face_id: str,
        person_name: str,
        image_path: str,
        suggested_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Confirm one face through the store (no explicit flush). Returns result dict.

        Mutations go through ``store.mutate`` (which schedules the debounced
        save); ``batch_confirm`` calls ``store.flush`` once at the end for
        immediate batch durability.
        """
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
            def add_manual(known, ignored, hardneg, processed):
                if person_name not in known:
                    known[person_name] = []
                known[person_name].append(entry)
                return len(known[person_name])

            count = self.store.mutate(add_manual, touches={"known"})
            return {"status": "success", "person_name": person_name,
                    "encodings_count": count}

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

        hard_neg_entry = None
        if suggested_name and suggested_name != person_name:
            hard_neg_entry = {
                "encoding": encoding,
                "file": str(image_path),
                "hash": file_hash,
                "backend": self.backend.backend_name,
                "backend_version": backend_info.get("version", "unknown"),
                "created_at": datetime.now().isoformat(),
                "encoding_hash": encoding_hash
            }

        def add_known(known, ignored, hardneg, processed):
            if person_name not in known:
                known[person_name] = []
            known[person_name].append(entry)
            if hard_neg_entry is not None:
                if suggested_name not in hardneg:
                    hardneg[suggested_name] = []
                hardneg[suggested_name].append(hard_neg_entry)
            return len(known[person_name])

        # Touches known always; hardneg only when the user corrected a suggestion.
        touches = {"known"} | ({"hardneg"} if hard_neg_entry is not None else set())
        count = self.store.mutate(add_known, touches=touches)
        return {"status": "success", "person_name": person_name,
                "encodings_count": count}

    def _ignore_face_nosave(self, face_id: str, image_path: str) -> Dict[str, Any]:
        """In-memory ignore, scheduling the store's debounced save. Returns result dict."""
        if face_id.startswith("manual_"):
            ignored_count = self.store.read(
                lambda known, ignored, hardneg, processed: len(ignored)
            )
            return {"status": "success", "ignored_count": ignored_count}

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

        def add_ignored(known, ignored, hardneg, processed):
            ignored.append(entry)
            return len(ignored)

        ignored_count = self.store.mutate(add_ignored, touches={"ignored"})
        return {"status": "success", "ignored_count": ignored_count}

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

        # Single durable save for the entire batch (equivalent to the old
        # _flush_save): cancel the pending debounce and write now.
        await asyncio.get_event_loop().run_in_executor(_executor, self.store.flush)

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

        def add_processed(known, ignored, hardneg, processed):
            # Re-check under the lock, then append in place (never rebind).
            if entry not in processed:
                processed.append(entry)
                return True
            return False

        added = self.store.mutate(add_processed, touches={"processed"}) if self.store.read(
            lambda known, ignored, hardneg, processed: entry not in processed
        ) else False
        if added:
            # Immediate durable save — the review is finalized.
            await asyncio.get_event_loop().run_in_executor(_executor, self.store.flush)
            logger.info(f"[DetectionService] Added {file_name} to processed_files")

        # Invalidate statistics cache so dashboard picks up new data
        try:
            from .statistics_service import get_statistics_service
            get_statistics_service().invalidate_cache()
        except Exception:
            pass  # Non-critical

        return {
            "status": "success",
            "message": f"Review logged for {len(labels)} faces",
            "labels_count": len(labels)
        }


# Lazy singleton — construction is deferred so importing this module has no
# side effects (no InsightFace load, no real data-dir access at import time).
# Double-checked locking: first calls can race in from worker threads (e.g.
# preprocessing's ThreadPoolExecutor via the module-level helpers below), and
# an unguarded check-then-set could construct several instances (multiple
# InsightFace loads, split caches).
_detection_service = None
_detection_service_lock = threading.Lock()


def get_detection_service() -> DetectionService:
    """Return the process-wide DetectionService, constructing it on first use."""
    global _detection_service
    if _detection_service is None:
        with _detection_service_lock:
            if _detection_service is None:
                _detection_service = DetectionService()
    return _detection_service


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
        rgb = get_detection_service()._load_image(path)

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
    rgb = get_detection_service()._load_image(path)
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
    detection_model = get_detection_service().config.get('detection_model', 'hog')
    face_locations, face_encodings = get_detection_service().backend.detect_faces(
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
    rgb = get_detection_service()._load_image(path)
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
