"""
matching.py - Face matching utilities for Ansikten CLI

Contains:
- Backend threshold management
- Encoding validation
- Database filtering by backend
- Face matching (best_matches, best_matches_filtered)
- Match status and label generation
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import numpy as np
from numpy.typing import NDArray

if TYPE_CHECKING:
    from face_backends import FaceBackend

logger = logging.getLogger(__name__)

# Type aliases
EncodingEntry = dict[str, Any] | NDArray[np.float64]
KnownFacesDB = dict[str, list[EncodingEntry]]
IgnoredFacesDB = list[EncodingEntry]
HardNegativesDB = dict[str, list[EncodingEntry]]
FilteredKnownDB = dict[str, NDArray[np.float64]]
FilteredIgnoredDB = NDArray[np.float64] | None
FilteredHardNegsDB = dict[str, NDArray[np.float64]]
ThresholdsDict = dict[str, float]
ConfigDict = dict[str, Any]
MatchResult = tuple[tuple[str | None, float | None], tuple[int | None, float | None]]
MatchStatusResult = tuple[str, str]


# Canonical, metric-appropriate default thresholds. These are the single source
# of truth for match/ignore/hard-negative distances when no backend-specific
# block is configured. Legacy top-level flat keys
# (match_threshold/ignore_distance/hard_negative_distance) are euclidean-era
# (dlib) values and are deliberately NOT consulted here — InsightFace uses cosine
# distance, so a stale flat key like match_threshold=0.6 would match at cosine
# similarity 0.4 (extremely loose). Legacy flat keys are honored only via the
# one-time config migration in core/config.py, which rewrites them into a
# backend_thresholds block with correct-metric values.
COSINE_DEFAULT_THRESHOLDS: ThresholdsDict = {
    'match_threshold': 0.45,
    'ignore_distance': 0.35,
    'hard_negative_distance': 0.32,
}
EUCLIDEAN_DEFAULT_THRESHOLDS: ThresholdsDict = {
    'match_threshold': 0.6,
    'ignore_distance': 0.5,
    'hard_negative_distance': 0.45,
}


def _get_backend_thresholds(config: ConfigDict, backend: FaceBackend) -> ThresholdsDict:
    """
    Get appropriate match/ignore/hard-negative thresholds for the active backend.

    ``backend_thresholds.<backend_name>`` is the single source of truth. When a
    block is configured for the backend it is returned verbatim; otherwise
    canonical defaults are chosen by the backend's distance metric (cosine vs
    euclidean). Top-level flat threshold keys are never consulted — they are
    wrong-metric legacy values (see module-level constants and the config
    migration).

    Args:
        config: Full config dict
        backend: FaceBackend instance

    Returns:
        Dict with 'match_threshold', 'ignore_distance', 'hard_negative_distance'
    """
    backend_thresholds = config.get('backend_thresholds', {})
    backend_specific = backend_thresholds.get(backend.backend_name)
    if backend_specific is not None:
        return backend_specific

    # No backend-specific block: fall back to canonical defaults for the
    # backend's distance metric. Flat top-level keys are intentionally ignored.
    distance_metric = getattr(backend, 'distance_metric', 'euclidean')
    is_cosine = isinstance(distance_metric, str) and 'cos' in distance_metric.lower()

    if config.get('threshold_mode') == 'manual':
        logger.warning(
            f"Manual threshold mode: no thresholds configured for backend "
            f"'{backend.backend_name}'; falling back to canonical "
            f"{'cosine' if is_cosine else 'euclidean'} defaults."
        )

    return dict(COSINE_DEFAULT_THRESHOLDS if is_cosine else EUCLIDEAN_DEFAULT_THRESHOLDS)


def validate_encoding_dimension(
    encoding: NDArray[np.float64] | None, backend: FaceBackend, context: str = ""
) -> bool:
    """
    Validate that encoding dimension matches backend's expected dimension.

    Args:
        encoding: Numpy array encoding to validate
        backend: FaceBackend instance
        context: Optional context string for logging (e.g., "known_faces:PersonName")

    Returns:
        True if valid, False if dimension mismatch
    """
    if encoding is None:
        return False

    if not hasattr(encoding, '__len__'):
        logger.warning(f"[VALIDATION] Invalid encoding type {type(encoding).__name__} {context}")
        return False

    expected_dim = backend.encoding_dim
    actual_dim = len(encoding)

    if actual_dim != expected_dim:
        logger.warning(
            f"[VALIDATION] Encoding dimension mismatch for {backend.backend_name} backend: "
            f"expected {expected_dim}, got {actual_dim} {context}"
        )
        return False

    return True


def filter_database_by_backend(
    known_faces: KnownFacesDB,
    ignored_faces: IgnoredFacesDB,
    hard_negatives: HardNegativesDB,
    backend: FaceBackend,
) -> tuple[FilteredKnownDB, FilteredIgnoredDB, FilteredHardNegsDB]:
    """
    Pre-filter all database structures by backend for efficient batch processing.

    This optimization reduces redundant filtering when processing multiple faces
    from the same image. Call once per image, then reuse filtered results.

    Args:
        known_faces: Dict of {name: [encoding_entries]}
        ignored_faces: List of encoding entries
        hard_negatives: Dict of {name: [hard_negative_entries]}
        backend: FaceBackend instance

    Returns:
        Tuple of (filtered_known, filtered_ignored, filtered_hard_negs)
        where encodings are pre-filtered and validated for the backend
    """
    # Filter known_faces
    filtered_known = {}
    for name, entries in known_faces.items():
        encs = []
        for entry in entries:
            if isinstance(entry, dict):
                entry_enc = entry.get("encoding")
                entry_backend = entry.get("backend", "dlib")
            else:
                entry_enc = entry
                entry_backend = "dlib"

            if (
                entry_enc is not None
                and entry_backend == backend.backend_name
                and isinstance(entry_enc, np.ndarray)
                and validate_encoding_dimension(entry_enc, backend, f"known_faces:{name}")
            ):
                encs.append(entry_enc)

        if encs:
            filtered_known[name] = np.array(encs)

    # Filter ignored_faces
    filtered_ignored = []
    for entry in ignored_faces:
        if isinstance(entry, dict):
            entry_enc = entry.get("encoding")
            entry_backend = entry.get("backend", "dlib")
        else:
            entry_enc = entry
            entry_backend = "dlib"

        if (
            entry_enc is not None
            and entry_backend == backend.backend_name
            and isinstance(entry_enc, np.ndarray)
            and validate_encoding_dimension(entry_enc, backend, "ignored_faces")
        ):
            filtered_ignored.append(entry_enc)

    filtered_ignored = np.array(filtered_ignored) if filtered_ignored else None

    # Filter hard_negatives
    filtered_hard_negs = {}
    for name, entries in hard_negatives.items():
        negs = []
        for entry in entries:
            if isinstance(entry, dict):
                entry_enc = entry.get("encoding")
                entry_backend = entry.get("backend", "dlib")
            else:
                entry_enc = entry
                entry_backend = "dlib"

            if (
                entry_enc is not None
                and entry_backend == backend.backend_name
                and isinstance(entry_enc, np.ndarray)
                and validate_encoding_dimension(entry_enc, backend, f"hard_negatives:{name}")
            ):
                negs.append(entry_enc)

        if negs:
            filtered_hard_negs[name] = np.array(negs)

    return filtered_known, filtered_ignored, filtered_hard_negs


def best_matches_filtered(
    encoding: NDArray[np.float64],
    filtered_known: FilteredKnownDB,
    filtered_ignored: FilteredIgnoredDB,
    filtered_hard_negs: FilteredHardNegsDB,
    config: ConfigDict,
    backend: FaceBackend,
) -> MatchResult:
    """
    Find best matching person using pre-filtered encodings (optimized version).

    This is an optimized version of best_matches() that accepts pre-filtered
    numpy arrays instead of raw database structures. Use filter_database_by_backend()
    to prepare the inputs. This avoids redundant filtering when processing
    multiple faces from the same image.

    Args:
        encoding: Face encoding to match
        filtered_known: Dict of {name: np.array of encodings} (pre-filtered)
        filtered_ignored: np.array of ignored encodings or None (pre-filtered)
        filtered_hard_negs: Dict of {name: np.array of hard negs} (pre-filtered)
        config: Config dict
        backend: FaceBackend instance

    Returns:
        (best_name, best_name_dist), (best_ignore_idx, best_ignore_dist)
    """
    best_name = None
    best_name_dist = None
    best_ignore_idx = None
    best_ignore_dist = None

    # Get backend-appropriate thresholds
    thresholds = _get_backend_thresholds(config, backend)
    hard_negative_thr = thresholds.get('hard_negative_distance', 0.45)

    # Match against known faces
    for name, encs_array in filtered_known.items():
        # Check hard negatives for this person
        is_hard_negative = False
        if filtered_hard_negs and name in filtered_hard_negs:
            neg_dists = backend.compute_distances(filtered_hard_negs[name], encoding)
            if np.min(neg_dists) < hard_negative_thr:
                is_hard_negative = True

        if is_hard_negative:
            continue  # Skip this person

        # Compute distances using backend
        dists = backend.compute_distances(encs_array, encoding)
        min_dist = np.min(dists)

        if best_name_dist is None or min_dist < best_name_dist:
            best_name_dist = min_dist
            best_name = name

    # Match against ignored faces
    if filtered_ignored is not None and len(filtered_ignored) > 0:
        dists = backend.compute_distances(filtered_ignored, encoding)
        min_dist = np.min(dists)
        best_ignore_dist = min_dist
        best_ignore_idx = int(np.argmin(dists))
    else:
        best_ignore_dist = None
        best_ignore_idx = None

    return (best_name, best_name_dist), (best_ignore_idx, best_ignore_dist)


def best_matches(
    encoding: NDArray[np.float64],
    known_faces: KnownFacesDB,
    ignored_faces: IgnoredFacesDB,
    hard_negatives: HardNegativesDB,
    config: ConfigDict,
    backend: FaceBackend,
) -> MatchResult:
    """
    Find best matching person and ignore candidate using backend.

    Args:
        encoding: Face encoding to match
        known_faces: Dict of {name: [encoding_entries]}
        ignored_faces: List of ignored encoding entries
        hard_negatives: Dict of {name: [hard_negative_entries]}
        config: Config dict
        backend: FaceBackend instance

    Returns:
        (best_name, best_name_dist), (best_ignore_idx, best_ignore_dist)
    """
    best_name = None
    best_name_dist = None
    best_ignore_idx = None
    best_ignore_dist = None

    # Get backend-appropriate thresholds
    thresholds = _get_backend_thresholds(config, backend)
    hard_negative_thr = thresholds.get('hard_negative_distance', 0.45)

    # Match against known faces (with backend filtering)
    for name, entries in known_faces.items():
        # Filter encodings by backend
        encs = []
        for entry in entries:
            if isinstance(entry, dict):
                entry_enc = entry.get("encoding")
                entry_backend = entry.get("backend", "dlib")
            else:
                # Legacy numpy array
                entry_enc = entry
                entry_backend = "dlib"

            # Only match against same backend with correct dimensions
            if (
                entry_enc is not None
                and entry_backend == backend.backend_name
                and isinstance(entry_enc, np.ndarray)
                and validate_encoding_dimension(entry_enc, backend, f"known_faces:{name}")
            ):
                encs.append(entry_enc)

        if not encs:
            continue  # No encodings for this backend

        # Check hard negatives (same backend filtering)
        hard_negs = []
        if hard_negatives and name in hard_negatives:
            for neg in hard_negatives[name]:
                if isinstance(neg, dict):
                    neg_enc = neg.get("encoding")
                    neg_backend = neg.get("backend", "dlib")
                else:
                    neg_enc = neg
                    neg_backend = "dlib"

                if (
                    neg_enc is not None
                    and neg_backend == backend.backend_name
                    and isinstance(neg_enc, np.ndarray)
                    and validate_encoding_dimension(neg_enc, backend, f"hard_negatives:{name}")
                ):
                    hard_negs.append(neg_enc)

        # Check if encoding matches hard negatives
        is_hard_negative = False
        if hard_negs:
            neg_dists = backend.compute_distances(np.array(hard_negs), encoding)
            if np.min(neg_dists) < hard_negative_thr:
                is_hard_negative = True

        if is_hard_negative:
            continue  # Skip this person

        # Compute distances using backend
        dists = backend.compute_distances(np.array(encs), encoding)
        min_dist = np.min(dists)

        if best_name_dist is None or min_dist < best_name_dist:
            best_name_dist = min_dist
            best_name = name

    # Match against ignored faces (with backend filtering)
    ignored_encs = []
    for entry in ignored_faces:
        if isinstance(entry, dict):
            entry_enc = entry.get("encoding")
            entry_backend = entry.get("backend", "dlib")
        else:
            entry_enc = entry
            entry_backend = "dlib"

        if (
            entry_enc is not None
            and entry_backend == backend.backend_name
            and isinstance(entry_enc, np.ndarray)
            and validate_encoding_dimension(entry_enc, backend, "ignored_faces")
        ):
            ignored_encs.append(entry_enc)

    if ignored_encs:
        dists = backend.compute_distances(np.array(ignored_encs), encoding)
        min_dist = np.min(dists)
        best_ignore_dist = min_dist
        best_ignore_idx = int(np.argmin(dists))
    else:
        best_ignore_dist = None
        best_ignore_idx = None

    return (best_name, best_name_dist), (best_ignore_idx, best_ignore_dist)


def get_face_match_status(
    i: int,
    best_name: str | None,
    best_name_dist: float | None,
    name_conf: int | None,
    best_ignore: int | None,
    best_ignore_dist: float | None,
    ign_conf: int | None,
    config: ConfigDict,
    backend: FaceBackend,
) -> MatchStatusResult:
    """
    Determine face match status and generate label.

    Args:
        i: Face index (0-based)
        best_name: Best matching person name or None
        best_name_dist: Distance to best name match
        name_conf: Confidence for name match (0-100)
        best_ignore: Best ignore index or None
        best_ignore_dist: Distance to best ignore match
        ign_conf: Confidence for ignore match (0-100)
        config: Config dict
        backend: FaceBackend instance for threshold selection

    Returns:
        Tuple of (label_string, status_code)
        Status codes: "unknown", "uncertain_name", "uncertain_ign", "name", "ign"
    """
    thresholds = _get_backend_thresholds(config, backend)
    name_thr = thresholds.get("match_threshold", 0.6)
    ignore_thr = thresholds.get("ignore_distance", 0.5)
    margin = config.get("prefer_name_margin", 0.10)
    min_conf = config.get("min_confidence", 0.4)

    # Confidence-filter
    if (
        (name_conf is not None and name_conf / 100 < min_conf) and
        (ign_conf is not None and ign_conf / 100 < min_conf)
    ):
        return "#%d\nOkänt" % (i + 1), "unknown"

    # Osäker mellan namn och ignore
    if (
        best_name is not None and best_name_dist is not None and best_name_dist < name_thr and
        best_ignore_dist is not None and best_ignore_dist < ignore_thr and
        abs(best_name_dist - best_ignore_dist) < margin
    ):
        if best_name_dist < best_ignore_dist:
            return f"#%d\n{best_name} / ign" % (i + 1), "uncertain_name"
        else:
            return f"#%d\nign / {best_name}" % (i + 1), "uncertain_ign"

    # Namn vinner klart
    elif (
        best_name is not None and best_name_dist is not None and best_name_dist < name_thr and
        (best_ignore_dist is None or best_name_dist < best_ignore_dist - margin)
    ):
        return f"#%d\n{best_name}" % (i + 1), "name"

    # Ign vinner klart
    elif (
        best_ignore_dist is not None and best_ignore_dist < ignore_thr and
        (best_name_dist is None or best_ignore_dist < best_name_dist - margin)
    ):
        return "#%d\nign" % (i + 1), "ign"

    # Ingen tillräckligt nära
    else:
        return "#%d\nOkänt" % (i + 1), "unknown"


def get_match_label(
    i: int,
    best_name: str | None,
    best_name_dist: float | None,
    name_conf: int | None,
    best_ignore: int | None,
    best_ignore_dist: float | None,
    ign_conf: int | None,
    config: ConfigDict,
    backend: FaceBackend,
) -> MatchStatusResult:
    """
    Wrapper for get_face_match_status - generates match label.

    Returns:
        Tuple of (label_string, status_code)
    """
    return get_face_match_status(
        i,
        best_name,
        best_name_dist,
        name_conf,
        best_ignore,
        best_ignore_dist,
        ign_conf,
        config,
        backend
    )


def label_preview_for_encodings(
    face_encodings: list[NDArray[np.float64]],
    known_faces: KnownFacesDB,
    ignored_faces: IgnoredFacesDB,
    hard_negatives: HardNegativesDB,
    config: ConfigDict,
    backend: FaceBackend,
) -> list[str]:
    """
    Label face encodings with matches. Uses optimized filtering for batch processing.

    Args:
        face_encodings: List of face encoding arrays
        known_faces: Dict of {name: [encoding_entries]}
        ignored_faces: List of ignored encoding entries
        hard_negatives: Dict of {name: [hard_negative_entries]}
        config: Config dict
        backend: FaceBackend instance

    Returns:
        List of label strings for each face
    """
    # Pre-filter database once for all faces (optimization for multiple faces)
    filtered_known, filtered_ignored, filtered_hard_negs = filter_database_by_backend(
        known_faces, ignored_faces, hard_negatives, backend
    )

    labels = []
    for i, encoding in enumerate(face_encodings):
        # Use optimized filtered matching
        (best_name, best_name_dist), (best_ignore, best_ignore_dist) = best_matches_filtered(
            encoding, filtered_known, filtered_ignored, filtered_hard_negs, config, backend
        )
        name_conf = int((1 - best_name_dist) * 100) if best_name_dist is not None else None
        ign_conf = int((1 - best_ignore_dist) * 100) if best_ignore_dist is not None else None
        label, _ = get_match_label(
            i,
            best_name,
            best_name_dist,
            name_conf,
            best_ignore,
            best_ignore_dist,
            ign_conf,
            config,
            backend
        )
        labels.append(label)
    return labels
