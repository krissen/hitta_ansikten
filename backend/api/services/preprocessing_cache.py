"""
Preprocessing Cache Manager

Hash-based cache for preprocessed data:
- NEF → JPG conversions
- Face detection results
- Face thumbnails

Features:
- SHA1 hash-based file identification
- LRU eviction when cache exceeds max size
- JSON index for fast lookups
- Atomic writes to prevent corruption
"""

import hashlib
import json
import logging
import os
import threading
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from core.db import get_file_hash

logger = logging.getLogger(__name__)


@dataclass
class CacheEntry:
    """Metadata for a cached item."""

    file_hash: str
    original_path: str
    created_at: str
    last_accessed: str
    size_bytes: int
    nef_jpg_path: str | None = None
    faces_json_path: str | None = None
    thumbnails: list[str] | None = None
    grid_thumb_path: str | None = None


class PreprocessingCache:
    """
    Manages preprocessing cache with LRU eviction.

    Directory structure:
    ~/.cache/ansikten/
    ├── index.json           # Cache index with metadata
    ├── nef/                  # Converted JPGs
    │   └── {hash}.jpg
    ├── faces/                # Face detection results
    │   └── {hash}.json
    ├── thumbs/               # Face thumbnails
    │   └── {hash}/
    │       └── face_{n}.jpg
    └── grid/                 # Whole-frame overview thumbnails
        └── {grid_key}.jpg
    """

    DEFAULT_CACHE_DIR = Path.home() / ".cache" / "ansikten"
    DEFAULT_MAX_SIZE_MB = 1024  # 1 GB
    INDEX_SAVE_INTERVAL = 5.0  # Seconds between index saves
    PROCESSING_TIMEOUT = 20.0  # Seconds to wait for another thread
    MAX_RETRIES = 3  # Max retry attempts if processing fails

    def __init__(self, cache_dir: Path | None = None, max_size_mb: int = DEFAULT_MAX_SIZE_MB):
        self.cache_dir = Path(cache_dir) if cache_dir else self.DEFAULT_CACHE_DIR
        self.max_size_bytes = max_size_mb * 1024 * 1024
        self.index_path = self.cache_dir / "index.json"

        # Subdirectories
        self.nef_dir = self.cache_dir / "nef"
        self.faces_dir = self.cache_dir / "faces"
        self.thumbs_dir = self.cache_dir / "thumbs"
        self.grid_dir = self.cache_dir / "grid"

        # Index buffering state
        self._index_dirty = False
        self._last_save_time = 0.0

        # Priority hashes (files in queue that should be evicted last)
        self.priority_hashes: set = set()

        # Thread-safe in-progress tracking to prevent duplicate processing
        self._lock = threading.Lock()
        self._in_progress: dict[str, threading.Event] = {}

        # Ensure directories exist
        self._ensure_dirs()

        # Load or create index
        self.index: dict[str, CacheEntry] = self._load_index()

        logger.info(
            f"[PreprocessingCache] Initialized: {self.cache_dir}, "
            f"max_size={max_size_mb}MB, entries={len(self.index)}"
        )

    def _ensure_dirs(self):
        """Create cache directories if they don't exist."""
        for dir_path in [
            self.cache_dir,
            self.nef_dir,
            self.faces_dir,
            self.thumbs_dir,
            self.grid_dir,
        ]:
            dir_path.mkdir(parents=True, exist_ok=True)

    def _load_index(self) -> dict[str, CacheEntry]:
        """Load cache index from disk."""
        if not self.index_path.exists():
            return {}

        try:
            with open(self.index_path, "r") as f:
                data = json.load(f)

            # Convert dicts to CacheEntry objects
            index = {}
            for file_hash, entry_data in data.items():
                try:
                    index[file_hash] = CacheEntry(**entry_data)
                except TypeError as e:
                    logger.warning(f"[PreprocessingCache] Invalid entry {file_hash}: {e}")

            return index
        except (json.JSONDecodeError, IOError) as e:
            logger.error(f"[PreprocessingCache] Failed to load index: {e}")
            return {}

    def _save_index(self, force: bool = False):
        """
        Save cache index to disk atomically.

        Uses buffering to avoid excessive disk writes:
        - Marks index as dirty
        - Only writes if force=True or enough time has passed since last save
        """
        self._index_dirty = True
        now = time.time()

        # Skip if not forced and saved recently
        if not force and (now - self._last_save_time) < self.INDEX_SAVE_INTERVAL:
            return

        try:
            # Write to temp file first
            temp_path = self.index_path.with_suffix(".tmp")
            with open(temp_path, "w") as f:
                data = {k: asdict(v) for k, v in self.index.items()}
                json.dump(data, f, indent=2)

            # Atomic rename
            temp_path.replace(self.index_path)
            self._index_dirty = False
            self._last_save_time = now
            logger.debug("[PreprocessingCache] Index saved to disk")
        except IOError as e:
            logger.error(f"[PreprocessingCache] Failed to save index: {e}")

    def flush(self):
        """Force save the index if dirty."""
        if self._index_dirty:
            self._save_index(force=True)

    @contextmanager
    def processing_slot(self, file_hash: str, operation: str = "processing"):
        """
        Context manager for exclusive processing of a file hash.

        If another thread is already processing this hash, waits for it to complete
        and then checks if the result is cached (avoiding duplicate work).

        Uses timestamp-based stale detection: only considers a slot "stuck" if it's
        been running for > 2x PROCESSING_TIMEOUT (to avoid killing slow but valid work).

        Yields: (should_process, attempt) tuple
          - should_process: True if this thread should do the work, False if cached
          - attempt: Current attempt number (1-based, for retry logic)
        """
        attempt = 0
        STALE_THRESHOLD = self.PROCESSING_TIMEOUT * 2  # Consider stale after 2x timeout

        while attempt < self.MAX_RETRIES:
            attempt += 1

            with self._lock:
                if file_hash in self._in_progress:
                    event, start_time = self._in_progress[file_hash]
                else:
                    # Store (event, start_time) tuple
                    self._in_progress[file_hash] = (threading.Event(), time.time())
                    event = None
                    start_time = None

            if event:
                logger.debug(f"[PreprocessingCache] Waiting for {operation} on {file_hash[:8]}...")
                completed = event.wait(timeout=self.PROCESSING_TIMEOUT)

                if not completed:
                    # Check if the slot is truly stale (running > 2x timeout)
                    elapsed = time.time() - start_time
                    if elapsed > STALE_THRESHOLD:
                        logger.warning(
                            f"[PreprocessingCache] Stale slot for {file_hash[:8]} "
                            f"(running {elapsed:.1f}s), cleaning up (attempt {attempt})"
                        )
                        with self._lock:
                            current = self._in_progress.get(file_hash)
                            if current and current[0] is event:
                                del self._in_progress[file_hash]
                    else:
                        logger.debug(
                            f"[PreprocessingCache] Timeout for {file_hash[:8]} but not stale "
                            f"({elapsed:.1f}s < {STALE_THRESHOLD:.1f}s), waiting more"
                        )
                    continue

                yield (False, attempt)
                return

            try:
                yield (True, attempt)
                return
            finally:
                with self._lock:
                    if file_hash in self._in_progress:
                        self._in_progress[file_hash][0].set()
                        del self._in_progress[file_hash]

        logger.error(
            f"[PreprocessingCache] Max retries ({self.MAX_RETRIES}) exceeded for {file_hash[:8]}"
        )
        yield (False, attempt)

    @staticmethod
    def compute_file_hash(file_path: str) -> str | None:
        """Compute SHA1 hash of file content (delegates to core.db)."""
        return get_file_hash(file_path)

    @staticmethod
    def compute_grid_key(file_path: str, size: int) -> str:
        """
        Cheap cache key for an overview thumbnail.

        Unlike compute_file_hash (which reads the whole file to SHA1 its
        content), this keys on: absolute path, file mtime (ns), file size
        (bytes), and the requested thumbnail size (px) — all from a single
        os.stat, no file read. Filling a grid means keying hundreds of files
        per view, so we avoid reading every file. An in-place re-export changes
        the mtime, so the key changes and a fresh thumbnail is generated
        automatically.
        """
        st = os.stat(file_path)
        raw = f"{os.path.abspath(file_path)}|{st.st_mtime_ns}|{st.st_size}|{size}"
        return "grid_" + hashlib.sha1(raw.encode("utf-8")).hexdigest()

    def has_grid_thumb(self, grid_key: str) -> bool:
        """Check if an overview thumbnail exists in cache."""
        entry = self.index.get(grid_key)
        if entry and entry.grid_thumb_path:
            return Path(entry.grid_thumb_path).exists()
        return False

    def get_grid_thumb(self, grid_key: str) -> str | None:
        """Get path to a cached overview thumbnail."""
        entry = self.get_entry(grid_key)
        if entry and entry.grid_thumb_path and Path(entry.grid_thumb_path).exists():
            return entry.grid_thumb_path
        return None

    def store_grid_thumb(self, grid_key: str, original_path: str, jpg_data: bytes) -> str:
        """Store an overview thumbnail in cache."""
        jpg_path = self.grid_dir / f"{grid_key}.jpg"

        with open(jpg_path, "wb") as f:
            f.write(jpg_data)

        self._update_entry(grid_key, original_path, grid_thumb_path=str(jpg_path))
        self._enforce_size_limit()

        logger.debug(f"[PreprocessingCache] Stored grid thumbnail: {grid_key}")
        return str(jpg_path)

    def get_entry(self, file_hash: str) -> CacheEntry | None:
        """Get cache entry by file hash, updating last_accessed."""
        entry = self.index.get(file_hash)
        if entry:
            entry.last_accessed = datetime.now().astimezone().isoformat()
            self._save_index()  # Buffered - won't write every time
        return entry

    def has_nef_conversion(self, file_hash: str) -> bool:
        """Check if NEF conversion exists in cache."""
        entry = self.index.get(file_hash)
        if entry and entry.nef_jpg_path:
            return Path(entry.nef_jpg_path).exists()
        return False

    def get_nef_conversion(self, file_hash: str) -> str | None:
        """Get path to cached NEF conversion."""
        entry = self.get_entry(file_hash)
        if entry and entry.nef_jpg_path and Path(entry.nef_jpg_path).exists():
            return entry.nef_jpg_path
        return None

    def store_nef_conversion(self, file_hash: str, original_path: str, jpg_data: bytes) -> str:
        """Store NEF conversion in cache."""
        jpg_path = self.nef_dir / f"{file_hash}.jpg"

        with open(jpg_path, "wb") as f:
            f.write(jpg_data)

        self._update_entry(file_hash, original_path, nef_jpg_path=str(jpg_path))
        self._enforce_size_limit()

        logger.debug(f"[PreprocessingCache] Stored NEF conversion: {file_hash}")
        return str(jpg_path)

    def has_face_detection(self, file_hash: str) -> bool:
        """Check if face detection results exist in cache."""
        entry = self.index.get(file_hash)
        if entry and entry.faces_json_path:
            return Path(entry.faces_json_path).exists()
        return False

    def get_face_detection(self, file_hash: str) -> dict | None:
        """Get cached face detection results."""
        entry = self.get_entry(file_hash)
        if entry and entry.faces_json_path and Path(entry.faces_json_path).exists():
            with open(entry.faces_json_path, "r") as f:
                return json.load(f)
        return None

    def store_face_detection(self, file_hash: str, original_path: str, faces_data: dict) -> str:
        """Store face detection results in cache."""
        json_path = self.faces_dir / f"{file_hash}.json"

        with open(json_path, "w") as f:
            json.dump(faces_data, f)

        self._update_entry(file_hash, original_path, faces_json_path=str(json_path))
        self._enforce_size_limit()

        logger.debug(f"[PreprocessingCache] Stored face detection: {file_hash}")
        return str(json_path)

    def has_thumbnails(self, file_hash: str) -> bool:
        """Check if thumbnails exist in cache."""
        entry = self.index.get(file_hash)
        if entry and entry.thumbnails:
            return all(Path(p).exists() for p in entry.thumbnails)
        return False

    def get_thumbnails(self, file_hash: str) -> list[str] | None:
        """Get cached thumbnail paths."""
        entry = self.get_entry(file_hash)
        if entry and entry.thumbnails:
            existing = [p for p in entry.thumbnails if Path(p).exists()]
            if existing:
                return existing
        return None

    def store_thumbnails(
        self, file_hash: str, original_path: str, thumbnails: list[bytes]
    ) -> list[str]:
        """Store face thumbnails in cache."""
        thumb_dir = self.thumbs_dir / file_hash
        thumb_dir.mkdir(parents=True, exist_ok=True)

        paths = []
        for i, thumb_data in enumerate(thumbnails):
            thumb_path = thumb_dir / f"face_{i}.jpg"
            with open(thumb_path, "wb") as f:
                f.write(thumb_data)
            paths.append(str(thumb_path))

        self._update_entry(file_hash, original_path, thumbnails=paths)
        self._enforce_size_limit()

        logger.debug(f"[PreprocessingCache] Stored {len(paths)} thumbnails: {file_hash}")
        return paths

    def _update_entry(self, file_hash: str, original_path: str, **kwargs):
        """Update or create cache entry."""
        # Local wall clock with offset: _enforce_size_limit sorts entries by
        # last_accessed as a *string*, and index.json on existing installs holds
        # naive local timestamps. Keeping the wall-clock digits (rather than
        # switching to UTC) keeps old and new entries ordered against each other.
        now = datetime.now().astimezone().isoformat()

        if file_hash in self.index:
            entry = self.index[file_hash]
            entry.last_accessed = now
            for key, value in kwargs.items():
                if value is not None:
                    setattr(entry, key, value)
        else:
            entry = CacheEntry(
                file_hash=file_hash,
                original_path=original_path,
                created_at=now,
                last_accessed=now,
                size_bytes=0,
                **kwargs,
            )
            self.index[file_hash] = entry

        # Update size
        entry.size_bytes = self._compute_entry_size(entry)
        self._save_index()

    def _compute_entry_size(self, entry: CacheEntry) -> int:
        """Compute total size of cached files for an entry."""
        total = 0

        if entry.nef_jpg_path and Path(entry.nef_jpg_path).exists():
            total += Path(entry.nef_jpg_path).stat().st_size

        if entry.faces_json_path and Path(entry.faces_json_path).exists():
            total += Path(entry.faces_json_path).stat().st_size

        if entry.thumbnails:
            for path in entry.thumbnails:
                if Path(path).exists():
                    total += Path(path).stat().st_size

        if entry.grid_thumb_path and Path(entry.grid_thumb_path).exists():
            total += Path(entry.grid_thumb_path).stat().st_size

        return total

    def get_total_size(self) -> int:
        """Get total cache size in bytes."""
        return sum(e.size_bytes for e in self.index.values())

    def get_status(self) -> dict[str, Any]:
        """Get cache status information."""
        total_size = self.get_total_size()
        return {
            "cache_dir": str(self.cache_dir),
            "total_entries": len(self.index),
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "max_size_mb": round(self.max_size_bytes / (1024 * 1024), 2),
            "usage_percent": round((total_size / self.max_size_bytes) * 100, 1)
            if self.max_size_bytes > 0
            else 0,
        }

    def set_priority_hashes(self, hashes: list[str]):
        """Set file hashes that should be evicted last (files currently in queue)."""
        self.priority_hashes = set(hashes)
        logger.debug(f"[PreprocessingCache] Priority hashes updated: {len(hashes)} files")

    def _enforce_size_limit(self):
        """Remove oldest entries if cache exceeds max size (LRU eviction)."""
        total_size = self.get_total_size()

        if total_size <= self.max_size_bytes:
            return

        # Sort: non-priority files first (by last_accessed), then priority files
        def eviction_key(item):
            file_hash, entry = item
            is_priority = file_hash in self.priority_hashes
            return (is_priority, entry.last_accessed)

        sorted_entries = sorted(self.index.items(), key=eviction_key)

        removed_count = 0
        priority_evicted = 0
        for file_hash, entry in sorted_entries:
            if total_size <= self.max_size_bytes * 0.9:
                break

            if file_hash in self.priority_hashes:
                priority_evicted += 1

            total_size -= entry.size_bytes
            self._remove_entry_files(entry)
            del self.index[file_hash]
            removed_count += 1

        if priority_evicted > 0:
            logger.warning(
                f"[PreprocessingCache] Had to evict {priority_evicted} priority files - consider increasing cache size"
            )
        if removed_count > 0:
            logger.info(f"[PreprocessingCache] LRU eviction: removed {removed_count} entries")
            self._save_index(force=True)

    def _remove_entry_files(self, entry: CacheEntry):
        """Remove all files associated with a cache entry."""
        if entry.nef_jpg_path:
            try:
                Path(entry.nef_jpg_path).unlink(missing_ok=True)
            except OSError:
                pass

        if entry.faces_json_path:
            try:
                Path(entry.faces_json_path).unlink(missing_ok=True)
            except OSError:
                pass

        if entry.thumbnails:
            for path in entry.thumbnails:
                try:
                    Path(path).unlink(missing_ok=True)
                except OSError:
                    pass

            # Remove thumbnail directory if empty
            if entry.thumbnails:
                thumb_dir = Path(entry.thumbnails[0]).parent
                try:
                    thumb_dir.rmdir()
                except OSError:
                    pass

        if entry.grid_thumb_path:
            try:
                Path(entry.grid_thumb_path).unlink(missing_ok=True)
            except OSError:
                pass

    def remove_entry(self, file_hash: str) -> bool:
        """Remove a specific cache entry."""
        entry = self.index.get(file_hash)
        if not entry:
            return False

        self._remove_entry_files(entry)
        del self.index[file_hash]
        self._save_index(force=True)  # Force save after explicit removal

        logger.debug(f"[PreprocessingCache] Removed entry: {file_hash}")
        return True

    def clear(self):
        """Clear all cache entries."""
        for entry in self.index.values():
            self._remove_entry_files(entry)

        self.index = {}
        self._save_index(force=True)  # Force save after clear

        logger.info("[PreprocessingCache] Cache cleared")

    def set_max_size(self, max_size_mb: int):
        """Update max cache size and enforce limit."""
        self.max_size_bytes = max_size_mb * 1024 * 1024
        self._enforce_size_limit()
        logger.info(f"[PreprocessingCache] Max size updated to {max_size_mb}MB")


# Singleton instance
_cache_instance: PreprocessingCache | None = None


def get_cache(
    cache_dir: Path | None = None, max_size_mb: int = PreprocessingCache.DEFAULT_MAX_SIZE_MB
) -> PreprocessingCache:
    """Get or create the singleton cache instance."""
    global _cache_instance

    if _cache_instance is None:
        _cache_instance = PreprocessingCache(cache_dir, max_size_mb)

    return _cache_instance


def reset_cache():
    """Reset the singleton cache instance (for testing)."""
    global _cache_instance
    _cache_instance = None
