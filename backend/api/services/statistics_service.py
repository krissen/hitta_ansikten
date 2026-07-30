"""
Statistics Service

Provides statistics and analytics data for the workspace dashboard.
Ports functionality from scripts/archive/analysera_ansikten.py to API-friendly format.
"""

import asyncio
import logging
import sys
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

# Add parent directory to path to import CLI modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from api.services.db_store import get_db_store
from faceid_db import (
    LOGGING_PATH,
    extract_face_labels,
    get_file_hash,
    load_attempt_log,
)

logger = logging.getLogger(__name__)


class StatisticsService:
    """Service for generating statistics and analytics.

    DB-derived figures (per-name face counts, processed-file totals) are read
    through the shared :class:`FaceDBStore` — the single in-memory authority —
    instead of re-loading the pickle per request.
    """

    def __init__(self):
        # DB reads go through the process-wide FaceDBStore (freshness by file
        # fingerprint, no per-service pickle load).
        self.store = get_db_store()
        # Computed-summary cache keyed by the store's version AND bounded by a
        # TTL. The store version invalidates the cache the instant the DB
        # mutates; the TTL is a safety net for the parts of the summary that
        # come from data sources NOT in the store — the attempt log
        # (attempt_stats.jsonl) and the app log (ansikten.log) — which change
        # on disk without bumping the store version.
        self.cache: dict[str, Any] = {}
        self.cache_meta: dict[str, tuple[int, float]] = {}  # key -> (version, ts)
        self.cache_ttl = 30.0  # TTL safety net for non-store (attempt-log) data

    def _get_cached(self, key: str) -> Any | None:
        """Return the cached value if the store is unchanged and within TTL."""
        meta = self.cache_meta.get(key)
        if meta is None:
            return None
        version, ts = meta
        # DB mutated since we cached → instant invalidation.
        if version != self.store.version:
            return None
        # Bound staleness of attempt-log/app-log-derived fields (not in store).
        if (time.time() - ts) >= self.cache_ttl:
            return None
        return self.cache.get(key)

    def _set_cached(self, key: str, value: Any, version: int | None = None):
        """Cache a value tagged with a store version and timestamp.

        ``version`` must be the store version captured WHEN the data was read
        (pre-await). Tagging with the version at set-time would mask a
        ``mutate()`` that interleaved during the awaits between read and
        cache-set — the stale summary would then be served until the TTL
        expires instead of being recomputed on the next request.
        """
        if version is None:
            version = self.store.version
        self.cache[key] = value
        self.cache_meta[key] = (version, time.time())

    def invalidate_cache(self):
        """Invalidate all cached data. Call after review completion."""
        self.cache.clear()
        self.cache_meta.clear()
        logger.info("[StatisticsService] Cache invalidated")

    def count_faces_per_name(self, known_faces: dict = None) -> dict[str, int]:
        """Count number of face encodings per person.

        When ``known_faces`` is not supplied, the counts are computed under the
        store lock so the aggregation can't race a concurrent mutation.
        """
        if known_faces is None:
            return self.store.read(
                lambda known, ignored, hardneg, processed: {
                    name: len(entries) for name, entries in known.items()
                }
            )
        return {name: len(entries) for name, entries in known_faces.items()}

    def calc_ignored_fraction(self, stats: list[dict]) -> tuple[int, int, float]:
        """Calculate fraction of faces that were ignored"""
        total = 0
        ignored = 0

        for entry in stats:
            used = entry.get("used_attempt")
            labels_per_attempt = entry.get("labels_per_attempt")

            if used is not None and labels_per_attempt and used < len(labels_per_attempt):
                for label in labels_per_attempt[used]:
                    if isinstance(label, dict):
                        label = label.get("label", "")
                    total += 1
                    if label.strip().lower().endswith("ignorerad") or label.strip().lower() == "ign":
                        ignored += 1

        frac = (ignored / total) if total else 0
        return ignored, total, frac

    async def get_attempt_stats(self, stats: list[dict] = None) -> list[dict[str, Any]]:
        """
        Calculate attempt statistics table

        Returns list of dicts with:
        - backend: Backend name (dlib, insightface)
        - upsample: Upsample factor (dlib only)
        - scale_label: Scale label (downsample, midsample, fullres)
        - scale_px: Scale pixel size
        - used_count: Number of times this attempt was used
        - total_count: Total number of attempts
        - hit_rate: Percentage of times used vs total
        - avg_faces: Average faces found
        - avg_time: Average processing time
        """
        if stats is None:
            stats = load_attempt_log(all_files=False)

        attempt_info = defaultdict(
            lambda: {"used": 0, "faces": 0, "time": 0.0, "total": 0}
        )

        for entry in stats:
            attempts = entry.get("attempts", [])
            used = entry.get("used_attempt")

            # Count all attempts (skip entries without real detection info)
            for att in attempts:
                backend = att.get("backend", att.get("model", ""))
                # Skip if no real backend info
                if not backend or backend == "unknown":
                    continue

                key = (
                    backend,
                    att.get("upsample"),
                    att.get("scale_label"),
                    att.get("scale_px"),
                )
                attempt_info[key]["total"] += 1

            # Count used attempts
            if used is not None and attempts and used < len(attempts):
                setting = attempts[used]
                backend = setting.get("backend", setting.get("model", ""))
                # Skip if no real backend info
                if not backend or backend == "unknown":
                    continue

                key = (
                    backend,
                    setting.get("upsample"),
                    setting.get("scale_label"),
                    setting.get("scale_px"),
                )
                attempt_info[key]["used"] += 1
                attempt_info[key]["faces"] += setting.get("face_count", 0)
                attempt_info[key]["time"] += setting.get("time_seconds", 0.0)

        # Convert to list of dicts
        result = []
        for key, info in attempt_info.items():
            backend, upsample, scale_label, scale_px = key
            n_used = info["used"]
            n_total = info["total"]
            mean_faces = info["faces"] / n_used if n_used else 0
            mean_time = info["time"] / n_used if n_used else 0
            hit_rate = 100 * n_used / n_total if n_total else 0

            result.append({
                "backend": backend,
                "upsample": upsample,
                "scale_label": scale_label or "unknown",
                "scale_px": scale_px or 0,
                "used_count": n_used,
                "total_count": n_total,
                "hit_rate": round(hit_rate, 1),
                "avg_faces": round(mean_faces, 2),
                "avg_time": round(mean_time, 2),
            })

        # Sort by total_count descending
        result.sort(key=lambda x: x["total_count"], reverse=True)

        return result

    async def get_top_faces(self, stats: list[dict] = None, face_counts: dict[str, int] = None) -> dict[str, Any]:
        """
        Get top 19 faces plus ignored count

        ``face_counts`` (name -> encoding count) may be supplied by the caller
        (e.g. ``get_summary`` computes it in a single store read); when omitted
        it is read from the store here.

        Returns:
        - faces: List of {name, face_count, percentage} sorted by count (top 19)
        - total_faces: Total number of face encodings in database
        - ignored_count: Number of ignored encodings
        - ignored_total: Total faces that were ignored in processing
        - ignored_fraction: Fraction of faces ignored (0.0-1.0)
        """
        if face_counts is None:
            # store.read is a sync lock-taking call (first use may load the
            # pickle) — run it in a worker thread to keep the loop free.
            face_counts = await asyncio.to_thread(self.count_faces_per_name)

        if stats is None:
            stats = load_attempt_log(all_files=False)

        ignored_count, ignored_total, ignored_frac = self.calc_ignored_fraction(stats)

        # Calculate total faces for percentage
        total_faces = sum(face_counts.values())

        # Get top 19 faces with percentage
        top_faces = sorted(face_counts.items(), key=lambda x: -x[1])[:19]

        return {
            "faces": [
                {
                    "name": name,
                    "face_count": count,
                    "percentage": round(100 * count / total_faces) if total_faces > 0 else 0
                }
                for name, count in top_faces
            ],
            "total_faces": total_faces,
            "ignored_count": ignored_count,
            "ignored_total": ignored_total,
            "ignored_fraction": round(ignored_frac, 3),
        }

    async def get_recent_images(self, n: int = 3, stats: list[dict] = None) -> list[dict[str, Any]]:
        """
        Get most recent processed images with names

        Returns list of:
        - filename: Image filename
        - timestamp: Processing timestamp
        - person_names: List of person names in image
        - source: Where the review came from ('ansikten' or 'cli')
        """
        if stats is None:
            stats = load_attempt_log(all_files=False)

        # Sort by timestamp, get last n
        last = sorted(stats, key=lambda x: x.get("timestamp", ""), reverse=True)[:n]

        result = []
        for entry in last:
            fname = Path(entry.get("filename", "")).name
            timestamp = entry.get("timestamp", "")
            used = entry.get("used_attempt")
            labels_per_attempt = entry.get("labels_per_attempt")
            attempts = entry.get("attempts", [])

            source = "cli"
            if used is not None and attempts and used < len(attempts):
                att = attempts[used]
                # "bildvisare" kept for backward compatibility with legacy data
                if att.get("source") in ("ansikten", "bildvisare") or att.get("resolution") == "api":
                    source = "ansikten"

            if used is not None and labels_per_attempt and used < len(labels_per_attempt):
                names = extract_face_labels(labels_per_attempt[used])
            else:
                names = []

            result.append({
                "filename": fname,
                "timestamp": timestamp,
                "person_names": names,
                "source": source,
            })

        return result

    async def get_recent_logs(self, n: int = 3) -> list[dict[str, str]]:
        """
        Get last n lines from log file

        Returns list of:
        - level: Log level (info/warning/error)
        - message: Log message
        - timestamp: When logged
        """
        try:
            with open(LOGGING_PATH, "r") as f:
                lines = f.readlines()[-n:]

            result = []
            for line in lines:
                line = line.strip()
                if not line:
                    continue

                # Parse log line format (simple heuristic)
                level = "info"
                if "ERROR" in line or "Error" in line:
                    level = "error"
                elif "WARN" in line or "Warning" in line:
                    level = "warning"

                # Extract timestamp if present (format: YYYY-MM-DD HH:MM:SS)
                timestamp = ""
                if line[:10].count("-") == 2:  # Looks like a date
                    timestamp = line[:19]  # "YYYY-MM-DD HH:MM:SS"
                    message = line[20:] if len(line) > 20 else line
                else:
                    message = line

                result.append({
                    "level": level,
                    "message": message,
                    "timestamp": timestamp,
                })

            return result

        except Exception as e:  # noqa: BLE001 - the log viewer renders the failure as its single entry; it must never itself raise while showing errors
            logger.error(f"[StatisticsService] Failed to read log file: {e}")
            return [{"level": "error", "message": f"Could not read log file: {e}", "timestamp": ""}]

    async def get_file_stats(self, filenames: list[str] = None, filepaths: list[str] = None) -> dict[str, dict[str, Any]]:
        """
        Get face detection stats for specific files.
        
        Supports two lookup methods:
        - filepaths: Computes hash from file content (survives renames)
        - filenames: Falls back to name-based lookup

        Args:
            filenames: List of filenames (just the name, not path)
            filepaths: List of full file paths (preferred - uses hash lookup)

        Returns:
            Dict mapping filename -> {face_count, persons}
        """
        filenames = filenames or []
        filepaths = filepaths or []
        
        if not filenames and not filepaths:
            return {}

        stats = load_attempt_log(all_files=False)
        
        result = {}

        hash_to_entry = {}
        filename_to_entry = {}
        for entry in stats:
            fname = Path(entry.get("filename", "")).name
            file_hash = entry.get("file_hash")
            filename_to_entry[fname] = entry
            if file_hash:
                hash_to_entry[file_hash] = entry

        def extract_stats(entry):
            used = entry.get("used_attempt")
            attempts = entry.get("attempts", [])
            labels_per_attempt = entry.get("labels_per_attempt")

            face_count = 0
            if used is not None and attempts and used < len(attempts):
                face_count = attempts[used].get("face_count", 0)

            persons = []
            if used is not None and labels_per_attempt and used < len(labels_per_attempt):
                persons = extract_face_labels(labels_per_attempt[used])

            return {"face_count": face_count, "persons": persons}

        # Build name_to_hash mapping first (needed for fallback). Computed under
        # the store lock so it's consistent with any concurrent mutation.
        def _build_name_to_hash(known, ignored, hardneg, processed):
            mapping = {}
            for pf in processed:
                if isinstance(pf, dict):
                    name = pf.get("name", "")
                    file_hash = pf.get("hash")
                    if name and file_hash:
                        mapping[name] = file_hash
            return mapping

        # store.read is a sync lock-taking call (first use may load the
        # pickle) — run it in a worker thread to keep the loop free.
        name_to_hash = await asyncio.to_thread(self.store.read, _build_name_to_hash)

        for fpath in filepaths:
            p = Path(fpath)
            fname = p.name
            if p.exists():
                # Hashing a (possibly large) NEF is blocking I/O — keep it off
                # the event loop.
                file_hash = await asyncio.to_thread(get_file_hash, str(p))
                if file_hash and file_hash in hash_to_entry:
                    result[fname] = extract_stats(hash_to_entry[file_hash])
                    logger.debug(f"[get_file_stats] {fname}: hash match")
                elif file_hash:
                    logger.debug(f"[get_file_stats] {fname}: hash {file_hash[:8]} not found")
            else:
                # File doesn't exist - try fallback via name_to_hash
                if fname in name_to_hash:
                    file_hash = name_to_hash[fname]
                    if file_hash in hash_to_entry:
                        result[fname] = extract_stats(hash_to_entry[file_hash])
                        logger.debug(f"[get_file_stats] {fname}: fallback via name_to_hash")
                        continue
                logger.debug(f"[get_file_stats] {fname}: file not found at {fpath}, no fallback")

        for fname in filenames:
            if fname in result:
                continue
            if fname in filename_to_entry:
                result[fname] = extract_stats(filename_to_entry[fname])
            elif fname in name_to_hash:
                file_hash = name_to_hash[fname]
                if file_hash in hash_to_entry:
                    result[fname] = extract_stats(hash_to_entry[file_hash])

        total = len(filenames) + len(filepaths)
        logger.info(f"[Statistics] Returning stats for {len(result)}/{total} files")
        return result

    async def get_summary(self) -> dict[str, Any]:
        """
        Get complete statistics summary

        Combines all statistics into one response. The result is cached keyed by
        the FaceDBStore version (instant invalidation on any DB mutation) and
        bounded by ``cache_ttl`` as a safety net for the attempt-log/app-log
        parts, which live outside the store. So a second request while nothing
        has changed is served straight from the version-keyed cache.
        """
        cached = self._get_cached("summary")
        if cached is not None:
            return cached

        # DB-derived figures in ONE consistent store read (under the lock);
        # the per-request full pickle load is gone. The store version is
        # captured INSIDE the read (the store lock is reentrant), atomically
        # with the data — the cache below is tagged with this value so a
        # mutate() interleaving during the awaits is not masked. The read
        # itself runs in a worker thread: store.read is a sync lock-taking
        # call (first use may load the pickle) and must not block the loop.
        def _collect(known, ignored, hardneg, processed):
            return (
                {name: len(entries) for name, entries in known.items()},
                len(processed),
                self.store.version,
            )

        face_counts, total_files_processed, version_at_read = (
            await asyncio.to_thread(self.store.read, _collect)
        )
        stats = load_attempt_log(all_files=False)

        attempt_stats = await self.get_attempt_stats(stats)
        top_faces = await self.get_top_faces(stats, face_counts)
        recent_images = await self.get_recent_images(n=3, stats=stats)
        recent_logs = await self.get_recent_logs(n=3)

        summary = {
            "attempt_stats": attempt_stats,
            "top_faces": top_faces["faces"],
            "ignored_count": top_faces["ignored_count"],
            "ignored_total": top_faces["ignored_total"],
            "ignored_fraction": top_faces["ignored_fraction"],
            "recent_images": recent_images,
            "recent_logs": recent_logs,
            "total_files_processed": total_files_processed,
        }

        # Cache result, tagged with the version captured at the store read so
        # a DB mutation during the awaits above invalidates it immediately.
        self._set_cached("summary", summary, version=version_at_read)

        return summary


# Lazy singleton — construction is deferred so importing this module has no
# side effects at import time.
_statistics_service = None
_statistics_service_lock = threading.Lock()


def get_statistics_service() -> StatisticsService:
    """Return the process-wide StatisticsService, constructing it on first use."""
    global _statistics_service
    if _statistics_service is None:
        with _statistics_service_lock:
            if _statistics_service is None:
                _statistics_service = StatisticsService()
    return _statistics_service
