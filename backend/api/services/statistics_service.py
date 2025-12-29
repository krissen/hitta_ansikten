"""
Statistics Service

Provides statistics and analytics data for the workspace dashboard.
Ports functionality from analysera_ansikten.py to API-friendly format.
"""

import json
import logging
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add parent directory to path to import CLI modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from faceid_db import (
    ATTEMPT_LOG_PATH,
    LOGGING_PATH,
    extract_face_labels,
    load_attempt_log,
    load_database,
)

logger = logging.getLogger(__name__)


class StatisticsService:
    """Service for generating statistics and analytics"""

    def __init__(self):
        # Cache for expensive calculations
        self.cache: Dict[str, Any] = {}
        self.cache_timestamps: Dict[str, float] = {}
        self.cache_ttl = 2.0  # 2 second cache TTL

    def _is_cache_valid(self, key: str) -> bool:
        """Check if cache entry is still valid"""
        if key not in self.cache_timestamps:
            return False
        return (time.time() - self.cache_timestamps[key]) < self.cache_ttl

    def _get_cached(self, key: str) -> Optional[Any]:
        """Get cached value if valid"""
        if self._is_cache_valid(key):
            return self.cache.get(key)
        return None

    def _set_cached(self, key: str, value: Any):
        """Set cached value with timestamp"""
        self.cache[key] = value
        self.cache_timestamps[key] = time.time()

    def count_faces_per_name(self) -> Dict[str, int]:
        """Count number of face encodings per person"""
        known_faces, _, _, _ = load_database()
        return {name: len(entries) for name, entries in known_faces.items()}

    def calc_ignored_fraction(self, stats: List[Dict]) -> tuple[int, int, float]:
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

    async def get_attempt_stats(self, stats: List[Dict] = None) -> List[Dict[str, Any]]:
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

            # Count all attempts
            for att in attempts:
                backend = att.get("backend", att.get("model", "unknown"))
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
                backend = setting.get("backend", setting.get("model", "unknown"))
                key = (
                    backend,
                    setting.get("upsample"),
                    setting.get("scale_label"),
                    setting.get("scale_px"),
                )
                attempt_info[key]["used"] += 1
                attempt_info[key]["faces"] += setting.get("faces_found", 0)
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

        return result

    async def get_top_faces(self, stats: List[Dict] = None) -> Dict[str, Any]:
        """
        Get top 19 faces plus ignored count

        Returns:
        - faces: List of {name, face_count} sorted by count (top 19)
        - ignored_count: Number of ignored encodings
        - ignored_total: Total faces that were ignored in processing
        - ignored_fraction: Fraction of faces ignored (0.0-1.0)
        """
        face_counts = self.count_faces_per_name()

        if stats is None:
            stats = load_attempt_log(all_files=False)

        ignored_count, ignored_total, ignored_frac = self.calc_ignored_fraction(stats)

        # Get top 19 faces
        top_faces = sorted(face_counts.items(), key=lambda x: -x[1])[:19]

        return {
            "faces": [{"name": name, "face_count": count} for name, count in top_faces],
            "ignored_count": ignored_count,
            "ignored_total": ignored_total,
            "ignored_fraction": round(ignored_frac, 3),
        }

    async def get_recent_images(self, n: int = 3) -> List[Dict[str, Any]]:
        """
        Get most recent processed images with names

        Returns list of:
        - filename: Image filename
        - timestamp: Processing timestamp
        - person_names: List of person names in image
        """
        stats = load_attempt_log(all_files=False)

        # Sort by timestamp, get last n
        last = sorted(stats, key=lambda x: x.get("timestamp", ""), reverse=True)[:n]

        result = []
        for entry in last:
            fname = Path(entry.get("filename", "")).name
            timestamp = entry.get("timestamp", "")
            used = entry.get("used_attempt")
            labels_per_attempt = entry.get("labels_per_attempt")

            if used is not None and labels_per_attempt and used < len(labels_per_attempt):
                names = extract_face_labels(labels_per_attempt[used])
            else:
                names = []

            result.append({
                "filename": fname,
                "timestamp": timestamp,
                "person_names": names,
            })

        return result

    async def get_recent_logs(self, n: int = 3) -> List[Dict[str, str]]:
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

        except Exception as e:
            logger.error(f"[StatisticsService] Failed to read log file: {e}")
            return [{"level": "error", "message": f"Could not read log file: {e}", "timestamp": ""}]

    async def get_summary(self) -> Dict[str, Any]:
        """
        Get complete statistics summary

        Combines all statistics into one response.
        Results are cached for 2 seconds to handle multiple concurrent requests.
        """
        # Check cache
        cached = self._get_cached("summary")
        if cached:
            logger.debug("[StatisticsService] Returning cached summary")
            return cached

        logger.debug("[StatisticsService] Computing fresh summary")

        # Load attempt log once
        stats = load_attempt_log(all_files=False)

        # Compute all statistics
        attempt_stats = await self.get_attempt_stats(stats)
        top_faces = await self.get_top_faces(stats)
        recent_images = await self.get_recent_images(n=3)
        recent_logs = await self.get_recent_logs(n=3)

        # Get total files processed
        _, _, _, processed_files = load_database()

        summary = {
            "attempt_stats": attempt_stats,
            "top_faces": top_faces["faces"],
            "ignored_count": top_faces["ignored_count"],
            "ignored_total": top_faces["ignored_total"],
            "ignored_fraction": top_faces["ignored_fraction"],
            "recent_images": recent_images,
            "recent_logs": recent_logs,
            "total_files_processed": len(processed_files),
        }

        # Cache result
        self._set_cached("summary", summary)

        return summary


# Singleton instance
statistics_service = StatisticsService()
