"""Process-wide face database repository (FaceDBStore).

Phase D unifies the three independent in-memory copies of the face DB
(detection_service, management_service, statistics_service) behind ONE
process-wide store. This module introduces that store; wiring the services
onto it happens in later PRs (D2-D4).

Semantics mirror today's data layer (`core.db`):

- The store holds the four collections returned by `load_database()`:
  ``known_faces`` (dict), ``ignored_faces`` (list), ``hard_negatives``
  (dict), ``processed_files`` (list).
- ``snapshot()`` cheap-stats the four backing files and reloads only when a
  file's ``st_mtime_ns`` differs from what the store recorded. It returns the
  LIVE collection objects (no deep copy — same as today), so callers must
  mutate them ONLY through ``mutate()``, never directly on the snapshot.
- ``mutate(fn)`` runs ``fn`` under the store lock, bumps the version, and
  schedules a debounced save (500 ms, matching detection_service today).
- ``flush()`` cancels any pending save and writes now if dirty — for
  endpoints that promise durability and for shutdown.

All mutating/reloading operations bump ``version`` (a monotonically
increasing int starting at 0) so callers can cheaply detect staleness.
"""

import logging
import threading
from dataclasses import dataclass
from typing import Any, Callable, Optional

from core import db

logger = logging.getLogger(__name__)

# Debounce window for coalescing rapid mutations into a single save.
# Matches detection_service's current 500 ms debounce.
SAVE_DEBOUNCE_SECONDS = 0.5


@dataclass(frozen=True)
class DBSnapshot:
    """A consistent view of the four DB collections plus the store version.

    The collections are the store's LIVE objects (not copies). Read them
    freely; never mutate them directly — go through ``FaceDBStore.mutate``.
    """

    known_faces: dict[str, list[dict[str, Any]]]
    ignored_faces: list[dict[str, Any]]
    hard_negatives: dict[str, list[dict[str, Any]]]
    processed_files: list[dict[str, Any]]
    version: int


class FaceDBStore:
    """Single process-wide, mtime-aware face database repository.

    Thread-safe via a reentrant lock (``RLock``) — services call from
    executor threads, and ``mutate`` may internally call ``snapshot``.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._version = 0
        self._dirty = False
        self._save_timer: Optional[threading.Timer] = None

        # Recorded mtime_ns per backing file; None => file absent at record time.
        self._mtimes: dict[str, Optional[int]] = {}

        # Populated on first load.
        self._known_faces: dict[str, list[dict[str, Any]]] = {}
        self._ignored_faces: list[dict[str, Any]] = []
        self._hard_negatives: dict[str, list[dict[str, Any]]] = {}
        self._processed_files: list[dict[str, Any]] = []

        self._loaded = False

    # ----- path helpers -------------------------------------------------
    # Resolved at call-time (not import-time) so tests that monkeypatch the
    # core.db path constants are respected.

    @staticmethod
    def _paths() -> dict[str, Any]:
        return {
            "encodings": db.ENCODING_PATH,
            "ignored": db.IGNORED_PATH,
            "hardneg": db.HARDNEG_PATH,
            "processed": db.PROCESSED_PATH,
        }

    def _current_mtimes(self) -> dict[str, Optional[int]]:
        """Cheap stat of the four backing files; missing file => None."""
        mtimes: dict[str, Optional[int]] = {}
        for key, path in self._paths().items():
            try:
                mtimes[key] = path.stat().st_mtime_ns
            except (FileNotFoundError, OSError):
                mtimes[key] = None
        return mtimes

    def _record_mtimes(self) -> None:
        """Snapshot the on-disk mtimes as the store's known-good baseline."""
        self._mtimes = self._current_mtimes()

    def _load_locked(self) -> None:
        """Load all collections from disk and record their mtimes. Holds lock."""
        (
            self._known_faces,
            self._ignored_faces,
            self._hard_negatives,
            self._processed_files,
        ) = db.load_database()
        self._record_mtimes()
        self._loaded = True

    # ----- public API ---------------------------------------------------

    def snapshot(self) -> DBSnapshot:
        """Return a consistent view of the DB, reloading on external change.

        Cheap-stats the four files; if any ``st_mtime_ns`` differs from the
        recorded baseline (or the store hasn't loaded yet), reloads via
        ``core.db.load_database`` and bumps the version. The returned
        collections are the store's LIVE objects — mutate only via
        ``mutate()``.
        """
        with self._lock:
            if not self._loaded:
                self._load_locked()
                self._version += 1
            elif self._current_mtimes() != self._mtimes:
                logger.debug("[FaceDBStore] External change detected — reloading")
                self._load_locked()
                self._version += 1
            return DBSnapshot(
                known_faces=self._known_faces,
                ignored_faces=self._ignored_faces,
                hard_negatives=self._hard_negatives,
                processed_files=self._processed_files,
                version=self._version,
            )

    def mutate(self, fn: Callable[
        [dict[str, Any], list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        Any,
    ]) -> Any:
        """Apply a mutation to the live collections under the store lock.

        ``fn`` is called as ``fn(known_faces, ignored_faces, hard_negatives,
        processed_files)`` and may return a value, which is passed through to
        the caller. After ``fn`` runs, the version is bumped, the store is
        marked dirty, and a debounced save (500 ms) is scheduled. Coalesces
        rapid mutations into a single write.

        The lock is reentrant, so ``fn`` may call ``snapshot()`` internally.
        """
        with self._lock:
            if not self._loaded:
                self._load_locked()
                self._version += 1
            result = fn(
                self._known_faces,
                self._ignored_faces,
                self._hard_negatives,
                self._processed_files,
            )
            self._version += 1
            self._dirty = True
            self._schedule_save_locked()
            return result

    def flush(self) -> None:
        """Cancel any pending save and write now if dirty (for durability)."""
        with self._lock:
            if self._save_timer is not None:
                self._save_timer.cancel()
                self._save_timer = None
            self._save_now_locked()

    @property
    def version(self) -> int:
        with self._lock:
            return self._version

    # ----- save machinery -----------------------------------------------

    def _schedule_save_locked(self) -> None:
        """(Re)arm the debounce timer. Caller holds the lock."""
        if self._save_timer is not None:
            self._save_timer.cancel()
        self._save_timer = threading.Timer(SAVE_DEBOUNCE_SECONDS, self._debounced_save)
        self._save_timer.daemon = True
        self._save_timer.start()

    def _debounced_save(self) -> None:
        """Timer callback: save if still dirty."""
        with self._lock:
            self._save_timer = None
            self._save_now_locked()

    def _save_now_locked(self) -> None:
        """Write all four files now if dirty and record post-save mtimes.

        Caller holds the lock. Recording our own post-save mtimes prevents the
        next ``snapshot()`` from mistaking our write for an external change.
        Note: dirty-flag granularity (per-file) is deferred to E1 — for now a
        save always writes all four files (via ``core.db.save_database``).
        """
        if not self._dirty:
            return
        db.save_database(
            self._known_faces,
            self._ignored_faces,
            self._hard_negatives,
            self._processed_files,
        )
        self._record_mtimes()
        self._dirty = False
        logger.debug("[FaceDBStore] Saved database (version=%d)", self._version)


# --- Singleton access (lazy; no module-level construction) ---------------

_store: Optional[FaceDBStore] = None
_store_lock = threading.Lock()


def get_db_store() -> FaceDBStore:
    """Return the process-wide FaceDBStore, constructing it on first use.

    Lazy (no import-time construction) — the D5 pattern. Thread-safe.
    """
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = FaceDBStore()
    return _store
