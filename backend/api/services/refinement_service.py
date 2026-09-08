"""
Encoding Refinement Service

Provides statistical filtering operations to refine face encodings.
Only InsightFace encodings are supported - dlib encodings are deprecated and will be removed.
"""

import logging
import sys
from pathlib import Path
from typing import Any

import numpy as np

# Add parent directory to path to import CLI modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from api.services.db_store import get_db_store

logger = logging.getLogger(__name__)

# Default thresholds for InsightFace (cosine distance)
DEFAULT_CLUSTER_DIST = 0.35
DEFAULT_STD_THRESHOLD = 2.0
DEFAULT_MAHALANOBIS_THRESHOLD = 3.0
DEFAULT_MIN_ENCODINGS = 8
DEFAULT_CLUSTER_MIN = 6

# InsightFace encoding shape
INSIGHTFACE_SHAPE = (512,)


def _is_insightface_entry(entry) -> bool:
    """Check if entry is an InsightFace encoding."""
    if isinstance(entry, dict):
        backend = entry.get("backend", "dlib")
        if backend == "insightface":
            return True
        # Check shape for ambiguous entries
        encoding = entry.get("encoding")
        if isinstance(encoding, np.ndarray) and encoding.shape == INSIGHTFACE_SHAPE:
            return True
        return False
    elif isinstance(entry, np.ndarray):
        # Legacy numpy array - check shape
        return entry.shape == INSIGHTFACE_SHAPE
    return False


def _get_encoding(entry) -> np.ndarray | None:
    """Extract numpy encoding from entry."""
    if isinstance(entry, dict) and "encoding" in entry:
        enc = entry["encoding"]
        if isinstance(enc, np.ndarray):
            return enc
    elif isinstance(entry, np.ndarray):
        return entry
    return None


def _compute_distances_to_centroid(encodings: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """
    Compute cosine distances from each encoding to the centroid.

    The centroid is projected back onto the unit sphere for proper
    cosine distance calculation with L2-normalized embeddings.

    Args:
        encodings: Non-empty list of InsightFace encoding vectors (512-dim, L2-normalized)

    Returns:
        (centroid, distances) tuple

    Raises:
        ValueError: If encodings list is empty
    """
    if not encodings:
        raise ValueError("_compute_distances_to_centroid requires a non-empty encodings list")

    arr = np.stack(encodings)
    centroid = np.mean(arr, axis=0)

    # Project centroid back onto unit sphere
    centroid_norm = np.linalg.norm(centroid)
    if centroid_norm > 1e-6:
        centroid = centroid / centroid_norm

    # Cosine distance: 1 - dot(a, b) where both are L2-normalized
    similarities = np.dot(arr, centroid)
    distances = 1.0 - similarities

    return centroid, distances


def _std_outlier_filter(
    encodings: list[np.ndarray], std_threshold: float = DEFAULT_STD_THRESHOLD
) -> tuple[np.ndarray, np.ndarray]:
    """
    Filter encodings by standard deviation from centroid.

    Returns mask (True=keep) and distances array.
    When std is near zero (all distances identical), keeps all encodings.
    """
    _, dists = _compute_distances_to_centroid(encodings)
    std = np.std(dists)

    # Handle degenerate case: if all distances are (nearly) identical,
    # standard deviation is zero and no meaningful outlier filtering
    # can be performed. In this case, keep all encodings.
    if std < 1e-8:
        return np.ones_like(dists, dtype=bool), dists

    mean = np.mean(dists)
    mask = np.abs(dists - mean) < std_threshold * std
    return mask, dists


def _cluster_filter(
    encodings: list[np.ndarray],
    cluster_dist: float = DEFAULT_CLUSTER_DIST,
    cluster_min: int = DEFAULT_CLUSTER_MIN,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Keep only encodings within cluster_dist from centroid.

    If too few encodings would remain, keeps all.
    Returns mask (True=keep) and distances array.
    """
    _, dists = _compute_distances_to_centroid(encodings)
    inlier_mask = dists < cluster_dist

    if np.count_nonzero(inlier_mask) >= cluster_min:
        return inlier_mask, dists
    else:
        # Too few would remain - don't filter
        return np.ones_like(inlier_mask, dtype=bool), dists


def _mahalanobis_outlier_filter(
    encodings: list[np.ndarray], threshold: float = DEFAULT_MAHALANOBIS_THRESHOLD
) -> tuple[np.ndarray, np.ndarray, bool]:
    """
    Filter encodings using Mahalanobis distance.

    Mahalanobis distance accounts for covariance between dimensions,
    making it better at detecting multivariate outliers in high-dimensional
    embedding spaces.

    Args:
        encodings: List of encoding vectors
        threshold: Maximum Mahalanobis distance to keep

    Returns:
        (mask, distances, fell_back_to_std)
        - mask: boolean array (True=keep)
        - distances: distance array
        - fell_back_to_std: True if fallback to std filter was used
    """
    arr = np.stack(encodings)
    n_samples, n_features = arr.shape

    # Need more samples than features for stable covariance
    if n_samples <= n_features:
        logger.warning(
            f"Mahalanobis: Not enough samples ({n_samples}) for {n_features} features. "
            f"Falling back to std filter."
        )
        mask, distances = _std_outlier_filter(encodings, DEFAULT_STD_THRESHOLD)
        return mask, distances, True  # fell_back_to_std = True

    mean = np.mean(arr, axis=0)

    # Compute covariance matrix with regularization
    cov = np.cov(arr.T)
    # Regularization to avoid singular matrix
    cov += np.eye(n_features) * 1e-6

    # Invert covariance matrix
    try:
        cov_inv = np.linalg.inv(cov)
    except np.linalg.LinAlgError:
        logger.warning("Mahalanobis: Singular covariance matrix. Using pseudo-inverse.")
        cov_inv = np.linalg.pinv(cov)

    # Compute Mahalanobis distances
    diff = arr - mean
    # Efficient computation: d = sqrt(diff @ cov_inv @ diff.T diagonal)
    distances = np.sqrt(np.sum(diff @ cov_inv * diff, axis=1))

    mask = distances < threshold
    return mask, distances, False  # fell_back_to_std = False


def _compute_stats(distances: np.ndarray) -> dict[str, float]:
    """Compute statistics for distance array."""
    return {
        "min_dist": float(np.min(distances)),
        "max_dist": float(np.max(distances)),
        "mean_dist": float(np.mean(distances)),
        "std_dist": float(np.std(distances)),
    }


class RefinementService:
    """Service for encoding refinement operations."""

    def __init__(self):
        # All reads/mutations go through the process-wide FaceDBStore — the
        # single authority for the in-memory face DB. A direct save_database
        # here would clobber the store's state, so refinement never touches the
        # data layer directly anymore. No per-service copies, lock or TTL.
        self.store = get_db_store()

    def _get_insightface_encodings(self, entries: list) -> list[tuple[int, np.ndarray]]:
        """
        Extract InsightFace encodings with their original indices.

        Returns list of (original_index, encoding) tuples.
        Skips dlib encodings.
        """
        result = []
        for i, entry in enumerate(entries):
            if _is_insightface_entry(entry):
                encoding = _get_encoding(entry)
                if encoding is not None:
                    result.append((i, encoding))
        return result

    async def remove_dlib_encodings(self, dry_run: bool = False) -> dict[str, Any]:
        """
        Remove ALL dlib encodings from the database.

        dlib backend is deprecated. Only InsightFace is supported.

        Args:
            dry_run: If True, don't save changes

        Returns:
            Results with counts per person
        """

        def compute(known, apply_changes):
            removed_by_person = {}
            total_removed = 0
            for name, entries in list(known.items()):
                if not entries:
                    continue
                # Keep only InsightFace encodings
                insightface_entries = [e for e in entries if _is_insightface_entry(e)]
                removed_count = len(entries) - len(insightface_entries)
                if removed_count > 0:
                    removed_by_person[name] = removed_count
                    total_removed += removed_count
                    if apply_changes:
                        known[name] = insightface_entries
            return removed_by_person, total_removed

        # Plan under read() first so a no-op (or dry-run) schedules no save.
        removed_by_person, total_removed = self.store.read(
            lambda known, ignored, hardneg, processed: compute(known, False)
        )
        if not dry_run and total_removed > 0:
            removed_by_person, total_removed = self.store.mutate(
                lambda known, ignored, hardneg, processed: compute(known, True),
                touches={"known"},
            )
            self.store.flush()  # admin action → persist synchronously

        return {
            "status": "success",
            "dry_run": dry_run,
            "total_removed": total_removed,
            "by_person": removed_by_person,
            "people_affected": len(removed_by_person),
        }

    async def preview(
        self,
        person: str | None = None,
        mode: str = "std",
        std_threshold: float = DEFAULT_STD_THRESHOLD,
        cluster_dist: float = DEFAULT_CLUSTER_DIST,
        cluster_min: int = DEFAULT_CLUSTER_MIN,
        mahalanobis_threshold: float = DEFAULT_MAHALANOBIS_THRESHOLD,
        min_encodings: int = DEFAULT_MIN_ENCODINGS,
    ) -> dict[str, Any]:
        """
        Preview what encodings would be removed.

        Only processes InsightFace encodings. dlib encodings are ignored.

        Args:
            person: Person name, or None for all people
            mode: 'std', 'cluster', 'mahalanobis', or 'shape'
            std_threshold: Standard deviations for outlier detection
            cluster_dist: Max distance from centroid
            cluster_min: Minimum cluster size
            mahalanobis_threshold: Mahalanobis distance threshold
            min_encodings: Skip filtering if fewer encodings

        Returns:
            Preview results with per-person breakdown and statistics
        """

        # Read-only scan under the store lock (consistent with any concurrent
        # mutation), mirroring ManagementService.find_duplicate_people.
        def scan(known, ignored, hardneg, processed):
            preview_results = []
            total_remove = 0
            affected_people = 0

            # Determine which people to process
            if person and person != "*":
                people_to_check = {person: known.get(person, [])}
            else:
                people_to_check = known

            for name, entries in people_to_check.items():
                if not entries:
                    continue

                # Get only InsightFace encodings
                indexed_encodings = self._get_insightface_encodings(entries)

                if not indexed_encodings:
                    continue

                # For shape mode, don't apply min_encodings filter to match repair_shapes behavior
                if mode != "shape" and len(indexed_encodings) < min_encodings:
                    continue

                indices = [ie[0] for ie in indexed_encodings]
                encodings = [ie[1] for ie in indexed_encodings]

                if mode == "shape":
                    # Shape repair: find encodings with non-majority shape
                    shapes = [enc.shape for enc in encodings]
                    shape_counts = {}
                    for s in shapes:
                        shape_counts[s] = shape_counts.get(s, 0) + 1
                    if not shape_counts:
                        continue
                    common_shape = max(shape_counts, key=shape_counts.get)
                    mask = np.array([enc.shape == common_shape for enc in encodings])
                    distances = np.zeros(len(encodings))  # No distances for shape mode
                    reason = "shape_mismatch"
                elif mode == "cluster":
                    mask, distances = _cluster_filter(encodings, cluster_dist, cluster_min)
                    reason = "cluster_outlier"
                elif mode == "mahalanobis":
                    mask, distances, fell_back = _mahalanobis_outlier_filter(
                        encodings, mahalanobis_threshold
                    )
                    reason = "std_outlier" if fell_back else "mahalanobis_outlier"
                else:  # std
                    mask, distances = _std_outlier_filter(encodings, std_threshold)
                    reason = "std_outlier"
                    fell_back = False

                remove_count = np.count_nonzero(~mask)
                if remove_count > 0:
                    affected_people += 1
                    remove_indices = [indices[i] for i in range(len(mask)) if not mask[i]]
                    result_entry = {
                        "person": name,
                        "total": len(encodings),
                        "keep": int(np.count_nonzero(mask)),
                        "remove": remove_count,
                        "remove_indices": remove_indices,
                        "reason": reason,
                        "stats": _compute_stats(distances)
                        if len(distances) > 0 and distances.any()
                        else None,
                    }
                    if mode == "mahalanobis" and fell_back:
                        result_entry["fallback"] = True
                    preview_results.append(result_entry)
                    total_remove += remove_count

            # Build warnings list
            warnings = []
            if mode == "mahalanobis":
                fallback_count = sum(1 for r in preview_results if r.get("fallback"))
                if fallback_count > 0:
                    warnings.append(
                        f"Mahalanobis kräver >512 encodings per person. "
                        f"{fallback_count} person(er) använder std-filter istället."
                    )

            return {
                "preview": preview_results,
                "summary": {
                    "total_people": len(people_to_check),
                    "affected_people": affected_people,
                    "total_remove": total_remove,
                },
                "warnings": warnings,
            }

        return self.store.read(scan)

    async def apply(
        self,
        mode: str = "std",
        persons: list[str] | None = None,
        std_threshold: float = DEFAULT_STD_THRESHOLD,
        cluster_dist: float = DEFAULT_CLUSTER_DIST,
        cluster_min: int = DEFAULT_CLUSTER_MIN,
        mahalanobis_threshold: float = DEFAULT_MAHALANOBIS_THRESHOLD,
        min_encodings: int = DEFAULT_MIN_ENCODINGS,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """
        Apply filtering to remove outlier encodings.

        Only processes InsightFace encodings.

        Args:
            mode: 'std', 'cluster', or 'mahalanobis'
            persons: List of person names, or None for all
            std_threshold: Standard deviations for outlier detection
            cluster_dist: Max distance from centroid
            cluster_min: Minimum cluster size
            mahalanobis_threshold: Mahalanobis distance threshold
            min_encodings: Skip filtering if fewer encodings
            dry_run: If True, don't save changes

        Returns:
            Results with counts of removed encodings
        """

        def compute(known, apply_changes):
            removed_by_person = {}
            total_removed = 0

            # Determine which people to process
            if persons:
                people_to_process = {name: known.get(name, []) for name in persons}
            else:
                people_to_process = dict(known)

            for name, entries in people_to_process.items():
                if not entries:
                    continue

                # Get only InsightFace encodings
                indexed_encodings = self._get_insightface_encodings(entries)

                if len(indexed_encodings) < min_encodings:
                    continue

                indices = [ie[0] for ie in indexed_encodings]
                encodings = [ie[1] for ie in indexed_encodings]

                if mode == "cluster":
                    mask, _ = _cluster_filter(encodings, cluster_dist, cluster_min)
                elif mode == "mahalanobis":
                    mask, _, _ = _mahalanobis_outlier_filter(encodings, mahalanobis_threshold)
                else:  # std
                    mask, _ = _std_outlier_filter(encodings, std_threshold)

                # Track which indices to remove
                indices_to_remove = set()
                for i, keep in enumerate(mask):
                    if not keep:
                        indices_to_remove.add(indices[i])

                if indices_to_remove:
                    removed_count = len(indices_to_remove)
                    removed_by_person[name] = removed_count
                    total_removed += removed_count

                    if apply_changes:
                        # Keep only non-removed entries
                        known[name] = [
                            e for i, e in enumerate(entries) if i not in indices_to_remove
                        ]
            return removed_by_person, total_removed

        # Plan under read() first so a no-op (or dry-run) schedules no save.
        removed_by_person, total_removed = self.store.read(
            lambda known, ignored, hardneg, processed: compute(known, False)
        )
        if not dry_run and total_removed > 0:
            removed_by_person, total_removed = self.store.mutate(
                lambda known, ignored, hardneg, processed: compute(known, True),
                touches={"known"},
            )
            self.store.flush()  # admin action → persist synchronously

        return {
            "status": "success",
            "dry_run": dry_run,
            "removed": total_removed,
            "by_person": removed_by_person,
        }

    async def repair_shapes(
        self, persons: list[str] | None = None, dry_run: bool = False
    ) -> dict[str, Any]:
        """
        Repair inconsistent encoding shapes.

        For each person, finds the most common shape and removes
        encodings with different shapes. Only processes InsightFace encodings.

        Args:
            persons: List of person names, or None for all
            dry_run: If True, don't save changes

        Returns:
            Results with details of what was repaired
        """

        def compute(known, apply_changes):
            repaired = []
            total_removed = 0

            # Determine which people to process
            if persons:
                people_to_process = {name: known.get(name, []) for name in persons}
            else:
                people_to_process = dict(known)

            for name, entries in people_to_process.items():
                if not entries:
                    continue

                # Get InsightFace encodings only
                indexed_encodings = self._get_insightface_encodings(entries)

                if not indexed_encodings:
                    continue

                # Extract shapes for all valid encodings
                shapes_with_index = [(i, enc.shape) for i, enc in indexed_encodings]

                # Find most common shape
                shape_counts = {}
                for _, shape in shapes_with_index:
                    shape_counts[shape] = shape_counts.get(shape, 0) + 1

                common_shape = max(shape_counts, key=shape_counts.get)

                # Find indices with non-common shape
                bad_indices = {i for i, shape in shapes_with_index if shape != common_shape}

                if bad_indices:
                    removed_shapes = list(
                        {shape for i, shape in shapes_with_index if i in bad_indices}
                    )
                    repaired.append(
                        {
                            "person": name,
                            "removed": len(bad_indices),
                            "total": len(entries),
                            "kept_shape": list(common_shape),
                            "removed_shapes": [list(s) for s in removed_shapes],
                        }
                    )
                    total_removed += len(bad_indices)

                    if apply_changes:
                        known[name] = [e for i, e in enumerate(entries) if i not in bad_indices]
            return repaired, total_removed

        # Plan under read() first so a no-op (or dry-run) schedules no save.
        repaired, total_removed = self.store.read(
            lambda known, ignored, hardneg, processed: compute(known, False)
        )
        if not dry_run and total_removed > 0:
            repaired, total_removed = self.store.mutate(
                lambda known, ignored, hardneg, processed: compute(known, True),
                touches={"known"},
            )
            self.store.flush()  # admin action → persist synchronously

        return {
            "status": "success",
            "dry_run": dry_run,
            "total_removed": total_removed,
            "repaired": repaired,
        }


# Lazy singleton
_refinement_service = None


def get_refinement_service():
    global _refinement_service
    if _refinement_service is None:
        _refinement_service = RefinementService()
    return _refinement_service


class _RefinementServiceProxy:
    def __getattr__(self, name):
        return getattr(get_refinement_service(), name)


refinement_service = _RefinementServiceProxy()
