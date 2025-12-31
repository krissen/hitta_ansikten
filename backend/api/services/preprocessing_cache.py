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

import os
import json
import hashlib
import shutil
import time
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class CacheEntry:
    """Metadata for a cached item."""
    file_hash: str
    original_path: str
    created_at: str
    last_accessed: str
    size_bytes: int
    nef_jpg_path: Optional[str] = None
    faces_json_path: Optional[str] = None
    thumbnails: Optional[List[str]] = None


class PreprocessingCache:
    """
    Manages preprocessing cache with LRU eviction.

    Directory structure:
    ~/.cache/bildvisare/
    ├── index.json           # Cache index with metadata
    ├── nef/                  # Converted JPGs
    │   └── {hash}.jpg
    ├── faces/                # Face detection results
    │   └── {hash}.json
    └── thumbs/               # Face thumbnails
        └── {hash}/
            └── face_{n}.jpg
    """

    DEFAULT_CACHE_DIR = Path.home() / '.cache' / 'bildvisare'
    DEFAULT_MAX_SIZE_MB = 1024  # 1 GB
    INDEX_SAVE_INTERVAL = 5.0  # Seconds between index saves

    def __init__(self, cache_dir: Optional[Path] = None, max_size_mb: int = DEFAULT_MAX_SIZE_MB):
        self.cache_dir = Path(cache_dir) if cache_dir else self.DEFAULT_CACHE_DIR
        self.max_size_bytes = max_size_mb * 1024 * 1024
        self.index_path = self.cache_dir / 'index.json'

        # Subdirectories
        self.nef_dir = self.cache_dir / 'nef'
        self.faces_dir = self.cache_dir / 'faces'
        self.thumbs_dir = self.cache_dir / 'thumbs'

        # Index buffering state
        self._index_dirty = False
        self._last_save_time = 0.0

        # Ensure directories exist
        self._ensure_dirs()

        # Load or create index
        self.index: Dict[str, CacheEntry] = self._load_index()

        logger.info(f"[PreprocessingCache] Initialized: {self.cache_dir}, "
                   f"max_size={max_size_mb}MB, entries={len(self.index)}")

    def _ensure_dirs(self):
        """Create cache directories if they don't exist."""
        for dir_path in [self.cache_dir, self.nef_dir, self.faces_dir, self.thumbs_dir]:
            dir_path.mkdir(parents=True, exist_ok=True)

    def _load_index(self) -> Dict[str, CacheEntry]:
        """Load cache index from disk."""
        if not self.index_path.exists():
            return {}

        try:
            with open(self.index_path, 'r') as f:
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
            temp_path = self.index_path.with_suffix('.tmp')
            with open(temp_path, 'w') as f:
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

    @staticmethod
    def compute_file_hash(file_path: str) -> str:
        """Compute SHA1 hash of file content."""
        sha1 = hashlib.sha1()
        with open(file_path, 'rb') as f:
            # Read in chunks to handle large files
            for chunk in iter(lambda: f.read(8192), b''):
                sha1.update(chunk)
        return sha1.hexdigest()

    def get_entry(self, file_hash: str) -> Optional[CacheEntry]:
        """Get cache entry by file hash, updating last_accessed."""
        entry = self.index.get(file_hash)
        if entry:
            entry.last_accessed = datetime.now().isoformat()
            self._save_index()  # Buffered - won't write every time
        return entry

    def has_nef_conversion(self, file_hash: str) -> bool:
        """Check if NEF conversion exists in cache."""
        entry = self.index.get(file_hash)
        if entry and entry.nef_jpg_path:
            return Path(entry.nef_jpg_path).exists()
        return False

    def get_nef_conversion(self, file_hash: str) -> Optional[str]:
        """Get path to cached NEF conversion."""
        entry = self.get_entry(file_hash)
        if entry and entry.nef_jpg_path and Path(entry.nef_jpg_path).exists():
            return entry.nef_jpg_path
        return None

    def store_nef_conversion(self, file_hash: str, original_path: str, jpg_data: bytes) -> str:
        """Store NEF conversion in cache."""
        jpg_path = self.nef_dir / f'{file_hash}.jpg'

        with open(jpg_path, 'wb') as f:
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

    def get_face_detection(self, file_hash: str) -> Optional[Dict]:
        """Get cached face detection results."""
        entry = self.get_entry(file_hash)
        if entry and entry.faces_json_path and Path(entry.faces_json_path).exists():
            with open(entry.faces_json_path, 'r') as f:
                return json.load(f)
        return None

    def store_face_detection(self, file_hash: str, original_path: str, faces_data: Dict) -> str:
        """Store face detection results in cache."""
        json_path = self.faces_dir / f'{file_hash}.json'

        with open(json_path, 'w') as f:
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

    def get_thumbnails(self, file_hash: str) -> Optional[List[str]]:
        """Get cached thumbnail paths."""
        entry = self.get_entry(file_hash)
        if entry and entry.thumbnails:
            existing = [p for p in entry.thumbnails if Path(p).exists()]
            if existing:
                return existing
        return None

    def store_thumbnails(self, file_hash: str, original_path: str, thumbnails: List[bytes]) -> List[str]:
        """Store face thumbnails in cache."""
        thumb_dir = self.thumbs_dir / file_hash
        thumb_dir.mkdir(parents=True, exist_ok=True)

        paths = []
        for i, thumb_data in enumerate(thumbnails):
            thumb_path = thumb_dir / f'face_{i}.jpg'
            with open(thumb_path, 'wb') as f:
                f.write(thumb_data)
            paths.append(str(thumb_path))

        self._update_entry(file_hash, original_path, thumbnails=paths)
        self._enforce_size_limit()

        logger.debug(f"[PreprocessingCache] Stored {len(paths)} thumbnails: {file_hash}")
        return paths

    def _update_entry(self, file_hash: str, original_path: str, **kwargs):
        """Update or create cache entry."""
        now = datetime.now().isoformat()

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
                **kwargs
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

        return total

    def get_total_size(self) -> int:
        """Get total cache size in bytes."""
        return sum(e.size_bytes for e in self.index.values())

    def get_status(self) -> Dict[str, Any]:
        """Get cache status information."""
        total_size = self.get_total_size()
        return {
            'cache_dir': str(self.cache_dir),
            'total_entries': len(self.index),
            'total_size_bytes': total_size,
            'total_size_mb': round(total_size / (1024 * 1024), 2),
            'max_size_mb': round(self.max_size_bytes / (1024 * 1024), 2),
            'usage_percent': round((total_size / self.max_size_bytes) * 100, 1) if self.max_size_bytes > 0 else 0
        }

    def _enforce_size_limit(self):
        """Remove oldest entries if cache exceeds max size (LRU eviction)."""
        total_size = self.get_total_size()

        if total_size <= self.max_size_bytes:
            return

        # Sort by last_accessed (oldest first)
        sorted_entries = sorted(
            self.index.items(),
            key=lambda x: x[1].last_accessed
        )

        removed_count = 0
        for file_hash, entry in sorted_entries:
            if total_size <= self.max_size_bytes * 0.9:  # Target 90% capacity
                break

            total_size -= entry.size_bytes
            self._remove_entry_files(entry)
            del self.index[file_hash]
            removed_count += 1

        if removed_count > 0:
            logger.info(f"[PreprocessingCache] LRU eviction: removed {removed_count} entries")
            self._save_index(force=True)  # Force save after eviction

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
_cache_instance: Optional[PreprocessingCache] = None


def get_cache(cache_dir: Optional[Path] = None, max_size_mb: int = PreprocessingCache.DEFAULT_MAX_SIZE_MB) -> PreprocessingCache:
    """Get or create the singleton cache instance."""
    global _cache_instance

    if _cache_instance is None:
        _cache_instance = PreprocessingCache(cache_dir, max_size_mb)

    return _cache_instance


def reset_cache():
    """Reset the singleton cache instance (for testing)."""
    global _cache_instance
    _cache_instance = None
