"""
Database Management Service

Provides database management operations for the workspace.
Ports functionality from scripts/archive/hantera_ansikten.py to API-friendly format.
"""

import fnmatch
import hashlib
import json
import logging
import sys
import threading
from pathlib import Path
from typing import Any

import numpy as np

# Add parent directory to path to import CLI modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from api.services.db_store import get_db_store
from faceid_db import BASE_DIR

# Persisted set of confirmed-distinct name-pairs (e.g. identical twins): people
# the duplicate scanner must never suggest merging. Each pair is stored as a
# sorted 2-list. Module-level so tests can monkeypatch the path.
DISTINCT_PAIRS_PATH = BASE_DIR / "distinct_pairs.json"

# Head-to-head 1-NN separability at/above which a centroid-close pair is treated
# as "likely distinct" (different people who merely look alike), not a duplicate.
SEPARABILITY_CUTOFF = 0.9

# Cap on encodings per person fed to the separability check, so a person with
# very many photos can't blow up the dense (nA+nB)^2 distance matrix. A strided
# sample is representative enough for a leave-one-out separability estimate.
MAX_SEPARABILITY_SAMPLES = 200

logger = logging.getLogger(__name__)


def _count_encodings_by_backend(encodings: list) -> dict[str, int]:
    """
    Count encodings grouped by backend.

    Args:
        encodings: List of encoding entries (dicts or numpy arrays)

    Returns:
        Dict mapping backend name to count, e.g. {"insightface": 5, "dlib": 3}
    """
    counts = {}
    for entry in encodings:
        if isinstance(entry, dict):
            backend = entry.get("backend", "dlib")
        else:
            # Legacy numpy array - assume dlib
            backend = "dlib"
        counts[backend] = counts.get(backend, 0) + 1
    return counts


def _filter_encodings_by_backend(encodings: list, backend: str | None) -> list:
    """
    Filter encodings to only include those from specified backend.

    Args:
        encodings: List of encoding entries
        backend: Backend name to filter by, or None to include all

    Returns:
        Filtered list of encodings
    """
    if backend is None:
        return encodings

    filtered = []
    for entry in encodings:
        if isinstance(entry, dict):
            entry_backend = entry.get("backend", "dlib")
        else:
            entry_backend = "dlib"

        if entry_backend == backend:
            filtered.append(entry)

    return filtered


def _usable_unit_vectors(encodings: list, backend_filter: str | None) -> list[np.ndarray]:
    """L2-normalized encoding vectors of one backend, for cosine comparison.

    Skips manual faces (``encoding is None``), other-backend entries, non-1D and
    mismatched-shape (the first usable shape wins) and zero-norm vectors.
    """
    vecs: list[np.ndarray] = []
    dim: int | None = None
    for e in encodings:
        if not isinstance(e, dict):
            continue
        if backend_filter and e.get("backend", "dlib") != backend_filter:
            continue
        enc = e.get("encoding")
        if enc is None:
            continue
        arr = np.asarray(enc, dtype=float)
        if arr.ndim != 1:
            continue
        if dim is None:
            dim = arr.shape[0]
        elif arr.shape[0] != dim:
            continue
        norm = np.linalg.norm(arr)
        if norm < 1e-6:
            continue
        vecs.append(arr / norm)
    return vecs


def _centroid_from_vecs(vecs: list[np.ndarray]) -> np.ndarray | None:
    """Unit-sphere centroid of pre-normalized vectors, or None if empty/degenerate."""
    if not vecs:
        return None
    centroid = np.mean(np.stack(vecs), axis=0)
    cnorm = np.linalg.norm(centroid)
    if cnorm < 1e-6:
        return None
    return centroid / cnorm


def _person_centroid(
    encodings: list, backend_filter: str | None
) -> tuple[np.ndarray, int] | None:
    """Unit-sphere centroid of a person's encodings + the count used, or None.

    Mirrors RefinementService's centroid. See `_usable_unit_vectors` for which
    entries are skipped. Returns None when no usable encoding remains.
    """
    vecs = _usable_unit_vectors(encodings, backend_filter)
    centroid = _centroid_from_vecs(vecs)
    if centroid is None:
        return None
    return centroid, len(vecs)


def _strided_sample(vecs: list[np.ndarray], cap: int) -> list[np.ndarray]:
    """At most `cap` evenly-spaced items from `vecs` (all of them if already ≤ cap)."""
    if len(vecs) <= cap:
        return vecs
    idx = np.linspace(0, len(vecs) - 1, cap).astype(int)
    return [vecs[i] for i in idx]


def _pair_separability(
    vecs_a: list[np.ndarray], vecs_b: list[np.ndarray]
) -> tuple[float, float] | None:
    """Head-to-head separability of two people's encodings (1-NN leave-one-out).

    Combines both label sets and, for each vector, checks whether its nearest
    other vector (cosine) shares its label. Returns ``(accuracy, margin)`` where
    accuracy is the **balanced** 1-NN LOO accuracy — the mean of the two
    per-person recalls — in [0,1] (≈1.0 = cleanly separable → different people
    who look alike; ≈0.5 = indistinguishable → likely the same person). Using
    balanced accuracy (not the pooled rate) keeps a large class from dominating:
    a true duplicate where one name has many photos and the other has 2 would
    otherwise score high and be mis-flagged as distinct. margin = mean nearest
    cross-set distance − mean nearest within-set distance (>0 when separable).
    Returns None when either set has <2 usable vectors or shapes mismatch.
    """
    if len(vecs_a) < 2 or len(vecs_b) < 2:
        return None
    a = np.stack(_strided_sample(vecs_a, MAX_SEPARABILITY_SAMPLES))
    b = np.stack(_strided_sample(vecs_b, MAX_SEPARABILITY_SAMPLES))
    if a.shape[1] != b.shape[1]:
        return None

    allv = np.vstack([a, b])
    labels = np.array([0] * len(a) + [1] * len(b))
    dist = 1.0 - (allv @ allv.T)
    np.fill_diagonal(dist, np.inf)  # exclude self from nearest-neighbour

    nn = np.argmin(dist, axis=1)
    correct = labels[nn] == labels
    recall_a = float(np.mean(correct[labels == 0]))
    recall_b = float(np.mean(correct[labels == 1]))
    accuracy = 0.5 * (recall_a + recall_b)

    same = labels[:, None] == labels[None, :]
    within = np.where(same, dist, np.inf).min(axis=1)
    cross = np.where(~same, dist, np.inf).min(axis=1)
    margin = float(np.mean(cross) - np.mean(within))

    return round(accuracy, 4), round(margin, 4)


def _encoding_hash(entry: dict) -> str | None:
    """The entry's encoding_hash, computed from the encoding if absent."""
    h = entry.get("encoding_hash")
    if h:
        return h
    enc = entry.get("encoding")
    arr = getattr(enc, "tobytes", None)
    if arr is not None:
        try:
            return hashlib.sha1(enc.tobytes()).hexdigest()
        except (AttributeError, ValueError):
            return None
    return None


def _redundant_indices(encodings: list, threshold: float, backend_filter: str | None) -> set:
    """Indices of redundant encodings to remove, keeping one per group.

    An encoding is redundant if it is an exact duplicate (same `encoding_hash`)
    of an already-kept one, or — when `threshold > 0` — within `threshold` cosine
    distance of a kept representative (near-duplicate). Manual faces
    (`encoding is None`), other-backend and unusable entries are always kept.
    """
    remove: set = set()
    seen_hashes: set = set()
    reps: list[np.ndarray] = []  # kept unit vectors, for near-dup comparison
    for i, e in enumerate(encodings):
        if not isinstance(e, dict):
            continue
        if backend_filter and e.get("backend", "dlib") != backend_filter:
            continue
        if e.get("encoding") is None:  # manual face — never redundant
            continue
        h = _encoding_hash(e)
        if h and h in seen_hashes:
            remove.add(i)
            continue
        unit = None
        if threshold > 0:
            arr = np.asarray(e["encoding"], dtype=float)
            if arr.ndim == 1:
                norm = np.linalg.norm(arr)
                if norm >= 1e-6:
                    unit = arr / norm
            if unit is not None and any(
                rv.shape == unit.shape and (1.0 - float(np.dot(rv, unit))) <= threshold
                for rv in reps
            ):
                remove.add(i)
                continue
        if h:
            seen_hashes.add(h)
        if unit is not None:
            reps.append(unit)
    return remove


def _load_distinct_pairs() -> set:
    """Load the confirmed-distinct name-pairs as a set of sorted 2-tuples."""
    if not DISTINCT_PAIRS_PATH.exists():
        return set()
    try:
        with open(DISTINCT_PAIRS_PATH, "r") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        logger.warning("[ManagementService] Could not read %s", DISTINCT_PAIRS_PATH)
        return set()
    if not isinstance(data, list):
        # A scalar/null/object (corrupt or hand-edited) — fall back to empty.
        logger.warning("[ManagementService] %s is not a list; ignoring", DISTINCT_PAIRS_PATH)
        return set()
    return {
        tuple(sorted(p))
        for p in data
        if isinstance(p, list) and len(p) == 2 and all(isinstance(x, str) for x in p)
    }


def _save_distinct_pairs(pairs: set) -> None:
    """Persist the confirmed-distinct name-pairs (atomic write)."""
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DISTINCT_PAIRS_PATH.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump([list(p) for p in sorted(pairs)], f, ensure_ascii=False, indent=2)
    tmp.replace(DISTINCT_PAIRS_PATH)


def _rename_in_distinct_pairs(old: str, new: str) -> None:
    """Rewrite `old` → `new` in the registry so an exclusion survives a rename."""
    pairs = _load_distinct_pairs()
    if not any(old in p for p in pairs):
        return
    updated = set()
    for a, b in pairs:
        a2 = new if a == old else a
        b2 = new if b == old else b
        if a2 != b2:  # a rename that collapses a pair onto one name drops it
            updated.add(tuple(sorted((a2, b2))))
    _save_distinct_pairs(updated)


def _drop_from_distinct_pairs(*names: str) -> None:
    """Drop any registry pair that references a removed name (delete / merged-away)."""
    gone = set(names)
    pairs = _load_distinct_pairs()
    kept = {p for p in pairs if not (gone & set(p))}
    if len(kept) != len(pairs):
        _save_distinct_pairs(kept)


def _reconcile_distinct_pairs(valid_names: set) -> set:
    """Drop registry pairs referencing a name that no longer exists, and persist.

    Self-heals against *any* person-removal path (delete, move-to-ignore, undo,
    purge-to-empty) so a stale exclusion can't silently suppress a real duplicate
    if the name is later recreated. Returns the reconciled set.
    """
    pairs = _load_distinct_pairs()
    kept = {p for p in pairs if p[0] in valid_names and p[1] in valid_names}
    if len(kept) != len(pairs):
        _save_distinct_pairs(kept)
    return kept


class ManagementService:
    """Service for database management operations"""

    def __init__(self):
        # All reads/mutations go through the process-wide FaceDBStore, which is
        # the single authority for the in-memory face DB (freshness by file
        # fingerprint, coalesced saves). No per-service copies, lock or TTL.
        self.store = get_db_store()

    async def get_database_state(self) -> dict[str, Any]:
        """
        Get current database state with per-backend encoding counts.

        Returns dict with:
        - people: List of {name, encoding_count, encodings_by_backend}
        - ignored_count: Total ignored encodings
        - ignored_by_backend: Dict of backend -> count
        - hard_negatives_count: Number of hard negative examples
        - processed_files_count: Number of processed files
        - backends_in_use: List of backend names with data
        """
        def build(known, ignored, hardneg, processed):
            all_backends = set()
            people = []
            for name, encodings in sorted(known.items()):
                by_backend = _count_encodings_by_backend(encodings)
                all_backends.update(by_backend.keys())
                people.append({
                    "name": name,
                    "encoding_count": len(encodings),
                    "encodings_by_backend": by_backend
                })

            ignored_by_backend = _count_encodings_by_backend(ignored)
            all_backends.update(ignored_by_backend.keys())

            return {
                "people": people,
                "ignored_count": len(ignored),
                "ignored_by_backend": ignored_by_backend,
                "hard_negatives_count": sum(len(v) for v in hardneg.values()),
                "processed_files_count": len(processed),
                "backends_in_use": sorted(all_backends),
            }

        return self.store.read(build)

    async def rename_person(self, old_name: str, new_name: str) -> dict[str, Any]:
        """
        Rename person in database

        Args:
        - old_name: Current person name
        - new_name: New person name

        Raises:
        - ValueError if old_name doesn't exist or new_name already exists
        """
        def do(known, ignored, hardneg, processed):
            if old_name not in known:
                raise ValueError(f"Person '{old_name}' not found")
            if new_name in known:
                raise ValueError(f"Person '{new_name}' already exists (use merge instead)")
            # Rename by moving encodings
            known[new_name] = known.pop(old_name)

        self.store.mutate(do, touches={"known"})
        self.store.flush()  # user-confirmed rename → persist synchronously
        _rename_in_distinct_pairs(old_name, new_name)

        logger.info(f"[ManagementService] Renamed '{old_name}' to '{new_name}'")

        return {
            "status": "success",
            "message": f"Renamed '{old_name}' to '{new_name}'",
            "new_state": await self.get_database_state(),
        }

    async def merge_people(
        self,
        source_names: list[str],
        target_name: str,
        backend_filter: str | None = None
    ) -> dict[str, Any]:
        """
        Merge multiple people into target name.

        Args:
        - source_names: List of person names to merge
        - target_name: Result name (can be one of source_names or new name)
        - backend_filter: Deprecated. Only InsightFace is supported now.

        Source people are deleted after merge. Deduplicates by encoding_hash.
        """
        def do(known, ignored, hardneg, processed):
            for name in source_names:
                if name not in known:
                    raise ValueError(f"Person '{name}' not found")

            encodings = []
            backends_involved = set()

            if target_name in known:
                target_encodings = known[target_name]
                if backend_filter:
                    target_encodings = _filter_encodings_by_backend(target_encodings, backend_filter)
                encodings.extend(target_encodings)
                backends_involved.update(_count_encodings_by_backend(target_encodings).keys())

            for name in source_names:
                if name in known:
                    source_encodings = known[name]
                    if backend_filter:
                        source_encodings = _filter_encodings_by_backend(source_encodings, backend_filter)
                    encodings.extend(source_encodings)
                    backends_involved.update(_count_encodings_by_backend(source_encodings).keys())

            seen = set()
            encodings_unique = []

            for enc in encodings:
                enc_hash = None
                if isinstance(enc, dict):
                    enc_hash = enc.get('encoding_hash')
                    # If encoding_hash missing, compute from encoding array
                    if not enc_hash and 'encoding' in enc:
                        try:
                            encoding_arr = enc['encoding']
                            if hasattr(encoding_arr, 'tobytes'):
                                enc_hash = hashlib.sha1(encoding_arr.tobytes()).hexdigest()
                        except (AttributeError, ValueError):
                            pass
                else:
                    try:
                        enc_hash = hashlib.sha1(enc.tobytes()).hexdigest()
                    except (AttributeError, ValueError):
                        pass

                if enc_hash and enc_hash in seen:
                    continue

                if enc_hash:
                    seen.add(enc_hash)
                encodings_unique.append(enc)

            if backend_filter:
                existing_other_backend = _filter_encodings_by_backend(
                    known.get(target_name, []),
                    None
                )
                existing_other_backend = [
                    e for e in existing_other_backend
                    if (e.get("backend", "dlib") if isinstance(e, dict) else "dlib") != backend_filter
                ]
                encodings_unique = existing_other_backend + encodings_unique

            known[target_name] = encodings_unique

            for name in source_names:
                if name != target_name and name in known:
                    del known[name]

            return encodings_unique, backends_involved

        encodings_unique, backends_involved = self.store.mutate(do, touches={"known"})
        self.store.flush()  # user-confirmed merge → persist synchronously
        # A source merged into the target is asserted to BE the target, so any
        # "distinct from X" exclusion it anchored transfers to the target (a
        # pair that collapses onto one name is dropped by the rewrite).
        for name in source_names:
            if name != target_name:
                _rename_in_distinct_pairs(name, target_name)

        final_by_backend = _count_encodings_by_backend(encodings_unique)
        warning = None
        if len(backends_involved) > 1:
            warning = f"Merged encodings from multiple backends: {', '.join(sorted(backends_involved))}"

        logger.info(f"[ManagementService] Merged {source_names} into '{target_name}' ({len(encodings_unique)} unique encodings)")

        return {
            "status": "success",
            "message": f"Merged {len(source_names)} people into '{target_name}' ({len(encodings_unique)} unique encodings)",
            "warning": warning,
            "encodings_by_backend": final_by_backend,
            "new_state": await self.get_database_state(),
        }

    async def find_duplicate_people(
        self, threshold: float, backend_filter: str | None = "insightface"
    ) -> dict[str, Any]:
        """Find pairs of distinctly-named people whose faces look like the same person.

        Computes a unit-sphere centroid per person and returns the name-pairs
        whose centroid cosine distance is ``<= threshold`` — likely the same
        person stored under two names, candidates for a merge. People with no
        usable encoding (e.g. only manual faces) are skipped. Pairs are sorted
        closest-first.
        """
        # The store reloads on any external file change, so a read() already
        # sees ground truth (no stale TTL cache). reconcile persists a pruned
        # registry against those live names. Iterating/aggregating under the
        # store lock via read() keeps the scan consistent with any concurrent
        # mutation.
        def scan(known, ignored, hardneg, processed):
            # Self-heal stale exclusions (names removed by any path) before use.
            distinct = _reconcile_distinct_pairs(set(known.keys()))
            vecs_by_name: dict[str, list[np.ndarray]] = {}
            centroids: dict[str, np.ndarray] = {}
            counts: dict[str, int] = {}
            for name, encodings in known.items():
                vecs = _usable_unit_vectors(encodings, backend_filter)
                centroid = _centroid_from_vecs(vecs)
                if centroid is None:
                    continue
                vecs_by_name[name] = vecs
                centroids[name] = centroid
                counts[name] = len(vecs)

            names = sorted(centroids)
            pairs: list[dict[str, Any]] = []
            excluded = 0
            for i in range(len(names)):
                a = names[i]
                for j in range(i + 1, len(names)):
                    b = names[j]  # a < b lexically, matching the sorted registry key
                    if centroids[a].shape != centroids[b].shape:
                        continue
                    distance = float(1.0 - np.dot(centroids[a], centroids[b]))
                    if distance > threshold:
                        continue
                    if (a, b) in distinct:
                        excluded += 1
                        continue
                    # Head-to-head: a centroid-close pair that is cleanly separable on
                    # their confirmed photos is likely two people who look alike, not a
                    # duplicate. None when either side has too few photos to tell.
                    sep = _pair_separability(vecs_by_name[a], vecs_by_name[b])
                    separability = sep[0] if sep else None
                    margin = sep[1] if sep else None
                    pairs.append({
                        "name_a": a,
                        "name_b": b,
                        "distance": round(distance, 4),
                        "count_a": counts[a],
                        "count_b": counts[b],
                        "separability": separability,
                        "margin": margin,
                        "likely_distinct": separability is not None and separability >= SEPARABILITY_CUTOFF,
                    })

            # True merge candidates first (closest first); separable "look-alike"
            # pairs sink to the bottom.
            pairs.sort(key=lambda p: (p["likely_distinct"], p["distance"], p["name_a"], p["name_b"]))

            logger.info(
                f"[ManagementService] Duplicate scan: {len(pairs)} pair(s) "
                f"<= {threshold} across {len(names)} people ({excluded} excluded as distinct)"
            )
            return {
                "pairs": pairs,
                "threshold": threshold,
                "people_compared": len(names),
            }

        return self.store.read(scan)

    async def add_distinct_pair(self, name_a: str, name_b: str) -> dict[str, Any]:
        """Record a confirmed-distinct name-pair so the scanner stops suggesting it."""
        a, b = name_a.strip(), name_b.strip()
        if not a or not b or a == b:
            raise ValueError("A distinct pair needs two different names")
        # Both must currently exist — otherwise a stale row or API typo could
        # persist a phantom exclusion that later hides a real duplicate candidate.
        # The store reloads on external change, so this lookup sees ground truth.
        missing = self.store.read(
            lambda known, ignored, hardneg, processed: [n for n in (a, b) if n not in known]
        )
        if missing:
            raise ValueError(f"Unknown person(s): {', '.join(missing)}")
        pairs = _load_distinct_pairs()
        pairs.add(tuple(sorted((a, b))))
        _save_distinct_pairs(pairs)
        logger.info(f"[ManagementService] Marked '{a}' / '{b}' as distinct (not a duplicate)")
        return {"status": "success", "count": len(pairs)}

    async def remove_distinct_pair(self, name_a: str, name_b: str) -> dict[str, Any]:
        """Drop a confirmed-distinct pair (undo) so it can be suggested again."""
        pair = tuple(sorted((name_a.strip(), name_b.strip())))
        pairs = _load_distinct_pairs()
        pairs.discard(pair)
        _save_distinct_pairs(pairs)
        return {"status": "success", "count": len(pairs)}

    async def list_distinct_pairs(self) -> dict[str, Any]:
        """List the confirmed-distinct name-pairs, sorted (stale names pruned)."""
        # prune persists → reconcile against the store's live (ground-truth) names.
        valid_names = self.store.read(
            lambda known, ignored, hardneg, processed: set(known.keys())
        )
        pairs = sorted(_reconcile_distinct_pairs(valid_names))
        return {
            "pairs": [{"name_a": a, "name_b": b} for a, b in pairs],
            "count": len(pairs),
        }

    async def find_redundant_encodings(
        self, threshold: float = 0.0, backend_filter: str | None = "insightface"
    ) -> dict[str, Any]:
        """Per-person count of redundant encodings (exact, plus near at threshold>0).

        Lists only people that have redundancy. `threshold` is a cosine distance;
        `0.0` removes only exact (byte-identical) duplicates. Manual faces are
        never counted. This is the preview for `dedup_people`.
        """
        def scan(known, ignored, hardneg, processed):
            people = []
            total_redundant = 0
            for name, encodings in sorted(known.items()):
                redundant = len(_redundant_indices(encodings, threshold, backend_filter))
                if redundant:
                    people.append({
                        "name": name,
                        "total": len(encodings),
                        "redundant": redundant,
                        "kept": len(encodings) - redundant,
                    })
                    total_redundant += redundant
            return {"people": people, "threshold": threshold, "total_redundant": total_redundant}

        return self.store.read(scan)

    async def dedup_people(
        self,
        names: list[str],
        threshold: float = 0.0,
        backend_filter: str | None = "insightface",
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Remove redundant encodings from the named people, keeping one per group."""
        def plan(known, apply_changes):
            removed_per_person: dict[str, int] = {}
            total = 0
            for name in names:
                if name not in known:
                    continue
                encs = known[name]
                remove = _redundant_indices(encs, threshold, backend_filter)
                if not remove:
                    continue
                removed_per_person[name] = len(remove)
                total += len(remove)
                if apply_changes:
                    known[name] = [e for i, e in enumerate(encs) if i not in remove]
            return removed_per_person, total

        # Plan under read() first so a zero-removal confirm schedules no save —
        # preserves the old `if total and not dry_run: save()` no-op guard
        # (mirrors undo_file's read-only pre-check).
        removed_per_person, total = self.store.read(
            lambda known, ignored, hardneg, processed: plan(known, False)
        )
        if total and not dry_run:
            removed_per_person, total = self.store.mutate(
                lambda known, ignored, hardneg, processed: plan(known, True),
                touches={"known"},
            )
            self.store.flush()  # user-confirmed dedup → persist synchronously

        logger.info(
            f"[ManagementService] Dedup removed {total} redundant encoding(s) "
            f"from {len(removed_per_person)} people (dry_run={dry_run})"
        )
        return {
            "status": "success",
            "message": f"Removed {total} redundant encoding(s) from {len(removed_per_person)} people",
            "removed_per_person": removed_per_person,
            "total_removed": total,
            "new_state": await self.get_database_state(),
        }

    async def delete_person(self, name: str) -> dict[str, Any]:
        """
        Delete person from database

        Args:
        - name: Person name to delete

        Raises:
        - ValueError if person doesn't exist
        """
        def do(known, ignored, hardneg, processed):
            if name not in known:
                raise ValueError(f"Person '{name}' not found")
            encoding_count = len(known[name])
            del known[name]
            return encoding_count

        encoding_count = self.store.mutate(do, touches={"known"})
        self.store.flush()  # user-confirmed delete → persist synchronously
        _drop_from_distinct_pairs(name)

        logger.info(f"[ManagementService] Deleted '{name}' ({encoding_count} encodings)")

        return {
            "status": "success",
            "message": f"Deleted '{name}' ({encoding_count} encodings)",
            "new_state": await self.get_database_state(),
        }

    async def move_to_ignore(
        self,
        name: str,
        backend_filter: str | None = None
    ) -> dict[str, Any]:
        """
        Move person's encodings to ignored list.

        Args:
        - name: Person name to move to ignored
        - backend_filter: If set, only move encodings from this backend
        """
        def do(known, ignored, hardneg, processed):
            if name not in known:
                raise ValueError(f"Person '{name}' not found")

            all_encodings = known[name]
            to_move = _filter_encodings_by_backend(all_encodings, backend_filter)

            if not to_move:
                backend_desc = backend_filter or "any backend"
                raise ValueError(f"No encodings for '{name}' from {backend_desc}")

            ignored.extend(to_move)

            removed = False
            if backend_filter:
                remaining = [e for e in all_encodings if e not in to_move]
                if remaining:
                    known[name] = remaining
                else:
                    del known[name]
                    removed = True
            else:
                del known[name]
                removed = True

            return to_move, removed

        to_move, removed = self.store.mutate(do, touches={"known", "ignored"})
        self.store.flush()  # user-confirmed move → persist synchronously
        if removed:
            # Clear exclusions at removal time, so a later recreated name can't
            # inherit a stale "distinct" pair (existence-reconcile alone misses
            # the remove-then-recreate-before-scan case).
            _drop_from_distinct_pairs(name)

        moved_by_backend = _count_encodings_by_backend(to_move)
        logger.info(f"[ManagementService] Moved '{name}' to ignored ({len(to_move)} encodings)")

        return {
            "status": "success",
            "message": f"Moved {len(to_move)} encodings from '{name}' to ignored",
            "moved_by_backend": moved_by_backend,
            "new_state": await self.get_database_state(),
        }

    async def move_from_ignore(
        self,
        count: int,
        target_name: str,
        backend_filter: str | None = None
    ) -> dict[str, Any]:
        """
        Move encodings from ignored list to person.

        Args:
        - count: Number of encodings to move (or -1 for all matching)
        - target_name: Person name to receive encodings
        - backend_filter: If set, only move encodings from this backend
        """
        def do(known, ignored, hardneg, processed):
            available = _filter_encodings_by_backend(ignored, backend_filter)

            n = len(available) if count == -1 else count

            if n < 1:
                raise ValueError("Count must be at least 1 (or -1 for all)")

            if n > len(available):
                backend_desc = backend_filter or "any backend"
                raise ValueError(f"Only {len(available)} ignored encodings available from {backend_desc}")

            to_move = available[:n]
            to_move_set = set(id(e) for e in to_move)
            # In-place edit: rebinding a local wouldn't reach the store's list.
            ignored[:] = [e for e in ignored if id(e) not in to_move_set]

            if target_name not in known:
                known[target_name] = []
            known[target_name].extend(to_move)

            return to_move, n

        to_move, count = self.store.mutate(do, touches={"known", "ignored"})
        self.store.flush()  # user-confirmed move → persist synchronously

        moved_by_backend = _count_encodings_by_backend(to_move)
        logger.info(f"[ManagementService] Moved {count} encodings from ignored to '{target_name}'")

        return {
            "status": "success",
            "message": f"Moved {count} encodings from ignored to '{target_name}'",
            "moved_by_backend": moved_by_backend,
            "new_state": await self.get_database_state(),
        }

    async def undo_file(self, filename_pattern: str) -> dict[str, Any]:
        """
        Undo processing for file(s) matching pattern

        Args:
        - filename_pattern: Exact filename or glob pattern (e.g., "2024*.NEF")

        Returns information about how many encodings were removed.
        Supports glob patterns via fnmatch.

        Uses file hash to identify and remove exact encodings added by the file,
        avoiding issues with list ordering.
        """
        def _matches(processed):
            return [
                pf
                for pf in processed
                if fnmatch.fnmatch((pf["name"] if isinstance(pf, dict) else pf), filename_pattern)
            ]

        # Cheap read-only pre-check so a no-match call doesn't schedule a save.
        has_match = self.store.read(
            lambda known, ignored, hardneg, processed: bool(_matches(processed))
        )
        if not has_match:
            return {
                "status": "success",
                "message": f"No files match pattern '{filename_pattern}'",
                "new_state": await self.get_database_state(),
            }

        def do(known, ignored, hardneg, processed):
            matched_files = _matches(processed)

            # Build set of file hashes to remove
            file_hashes_to_remove = set()
            for pf in matched_files:
                if isinstance(pf, dict) and pf.get("hash"):
                    file_hashes_to_remove.add(pf["hash"])

            names_to_remove = set(
                pf["name"] if isinstance(pf, dict) else pf for pf in matched_files
            )

            # Remove from processed files (in-place so the store's list is edited)
            processed[:] = [
                pf
                for pf in processed
                if (pf["name"] if isinstance(pf, dict) else pf) not in names_to_remove
            ]

            removed_total = 0

            # Remove encodings by file hash (preferred method - exact match)
            emptied: list[str] = []
            if file_hashes_to_remove:
                # Remove from known_faces
                for kf_name in list(known.keys()):
                    original_count = len(known[kf_name])
                    known[kf_name] = [
                        enc for enc in known[kf_name]
                        if not (isinstance(enc, dict) and enc.get("hash") in file_hashes_to_remove)
                    ]
                    removed_total += original_count - len(known[kf_name])
                    # Clean up empty entries
                    if not known[kf_name]:
                        del known[kf_name]
                        emptied.append(kf_name)

                # Remove from ignored_faces (in-place)
                original_ignored = len(ignored)
                ignored[:] = [
                    enc for enc in ignored
                    if not (isinstance(enc, dict) and enc.get("hash") in file_hashes_to_remove)
                ]
                removed_total += original_ignored - len(ignored)

            return matched_files, removed_total, emptied

        matched_files, removed_total, emptied = self.store.mutate(
            do, touches={"known", "ignored", "processed"}
        )
        self.store.flush()  # user-confirmed undo → persist synchronously
        if emptied:
            _drop_from_distinct_pairs(*emptied)

        logger.info(f"[ManagementService] Undid {len(matched_files)} files, removed {removed_total} encodings")

        return {
            "status": "success",
            "message": f"Undid {len(matched_files)} files, removed {removed_total} encodings",
            "files_undone": [pf["name"] if isinstance(pf, dict) else pf for pf in matched_files],
            "new_state": await self.get_database_state(),
        }

    async def purge_encodings(
        self,
        name: str,
        count: int,
        backend_filter: str | None = None
    ) -> dict[str, Any]:
        """
        Remove last X encodings from person or ignore list.

        Args:
        - name: Person name or "ignore"
        - count: Number of encodings to remove from end
        - backend_filter: If set, only purge encodings from this backend
        """
        def do(known, ignored, hardneg, processed):
            if count < 1:
                raise ValueError("Count must be at least 1")

            if name == "ignore":
                if backend_filter:
                    matching_indices = [
                        i for i, e in enumerate(ignored)
                        if (e.get("backend", "dlib") if isinstance(e, dict) else "dlib") == backend_filter
                    ]
                    if count > len(matching_indices):
                        raise ValueError(f"Only {len(matching_indices)} ignored encodings from {backend_filter}")
                    to_remove = set(matching_indices[-count:])
                    purged_by_backend = {backend_filter: count}
                else:
                    if count > len(ignored):
                        raise ValueError(f"Only {len(ignored)} ignored encodings available")
                    to_remove = set(range(len(ignored) - count, len(ignored)))
                    purged_by_backend = _count_encodings_by_backend(ignored[-count:])

                ignored[:] = [e for i, e in enumerate(ignored) if i not in to_remove]
                return "ignore", purged_by_backend, False

            elif name in known:
                encodings = known[name]

                if backend_filter:
                    matching_indices = [
                        i for i, e in enumerate(encodings)
                        if (e.get("backend", "dlib") if isinstance(e, dict) else "dlib") == backend_filter
                    ]
                    if count > len(matching_indices):
                        raise ValueError(f"Only {len(matching_indices)} encodings from {backend_filter} for '{name}'")
                    to_remove = set(matching_indices[-count:])
                    purged_by_backend = {backend_filter: count}
                else:
                    if count > len(encodings):
                        raise ValueError(f"Only {len(encodings)} encodings available for '{name}'")
                    to_remove = set(range(len(encodings) - count, len(encodings)))
                    purged_by_backend = _count_encodings_by_backend(encodings[-count:])

                known[name] = [e for i, e in enumerate(encodings) if i not in to_remove]
                # Purging to an empty list leaves a face-less person whose name could
                # later be reused for someone else; caller drops their exclusions so a
                # stale pair can't hide a real duplicate. (An empty list is distinct
                # from a manual-only person, who still has entries.)
                return "person", purged_by_backend, (not known[name])

            else:
                raise ValueError(f"Person '{name}' not found")

        kind, purged_by_backend, emptied = self.store.mutate(do, touches={"known", "ignored"})
        self.store.flush()  # user-confirmed purge → persist synchronously

        if kind == "ignore":
            logger.info(f"[ManagementService] Purged {count} encodings from ignored")
            return {
                "status": "success",
                "message": f"Purged {count} encodings from ignored",
                "purged_by_backend": purged_by_backend,
                "new_state": await self.get_database_state(),
            }

        if emptied:
            _drop_from_distinct_pairs(name)

        logger.info(f"[ManagementService] Purged {count} encodings from '{name}'")
        return {
            "status": "success",
            "message": f"Purged {count} encodings from '{name}'",
            "purged_by_backend": purged_by_backend,
            "new_state": await self.get_database_state(),
        }

    async def get_recent_files(self, n: int = 10) -> list[dict[str, str]]:
        """
        Get last N processed files

        Args:
        - n: Number of files to return (default 10)

        Returns list of {name, hash} dicts
        """
        recent = self.store.read(
            lambda known, ignored, hardneg, processed: list(reversed(processed[-n:]))
        )

        # Ensure each entry is a dict
        result = []
        for entry in recent:
            if isinstance(entry, dict):
                result.append({"name": entry.get("name", ""), "hash": entry.get("hash", "")})
            else:
                # Legacy format: just filename string
                result.append({"name": entry, "hash": ""})

        return result


# Lazy singleton (double-checked locking — first calls may race in from
# worker threads; an unguarded check-then-set could construct two instances)
_management_service = None
_management_service_lock = threading.Lock()

def get_management_service():
    global _management_service
    if _management_service is None:
        with _management_service_lock:
            if _management_service is None:
                _management_service = ManagementService()
    return _management_service

class _ManagementServiceProxy:
    def __getattr__(self, name):
        return getattr(get_management_service(), name)

management_service = _ManagementServiceProxy()
