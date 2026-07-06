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
  file's fingerprint — ``(st_mtime_ns, st_size)`` — differs from what the
  store recorded. It returns the LIVE collection objects (no deep copy — same
  as today), so callers must mutate them ONLY through ``mutate()``, never
  directly on the snapshot. Accepted residual false-negative: an external
  write that preserves BOTH mtime_ns and size (same-length rewrite plus an
  ``os.utime`` restore) is not detected until the next genuine fingerprint
  change or ``mutate()``.
- ``mutate(fn)`` runs ``fn`` under the store lock, bumps the version, and
  schedules a leading-coalesce save: the write fires 500 ms after the FIRST
  mutation of a burst and is NOT re-armed by later mutations (matching
  detection_service's ``_schedule_save`` semantics today), so sustained
  mutation still gets a durable save roughly every 500 ms.
- ``read(fn)`` runs a read-only ``fn`` under the store lock (after the same
  freshness check as ``snapshot()``) — the safe primitive for iterating or
  aggregating over the live collections while other threads may mutate.
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

# Coalesce window for rapid mutations. Leading semantics: the save fires this
# long after the FIRST mutation of a burst and is not re-armed by later ones —
# matching detection_service's current _schedule_save behavior (bounded
# staleness of ~500 ms under sustained mutation).
SAVE_DEBOUNCE_SECONDS = 0.5

# Per-file external-change fingerprint: (st_mtime_ns, st_size), or None when
# the file is absent. Size catches same-mtime rewrites of different length.
Fingerprint = Optional[tuple[int, int]]


@dataclass(frozen=True)
class DBSnapshot:
    """A view of the four DB collections plus the store version.

    The collections are the store's LIVE objects (not copies). Cheap
    point-reads (key lookup, ``len``) are fine, but iterating or aggregating
    over them while another thread runs ``mutate()`` can raise
    ``RuntimeError`` (size changed during iteration) — use
    ``FaceDBStore.read()`` for that, or compare ``version`` before/after.
    Never mutate them directly — go through ``FaceDBStore.mutate``.
    """

    known_faces: dict[str, list[dict[str, Any]]]
    ignored_faces: list[dict[str, Any]]
    hard_negatives: dict[str, list[dict[str, Any]]]
    processed_files: list[dict[str, Any]]
    version: int


class FaceDBStore:
    """Single process-wide, freshness-aware face database repository.

    Thread-safe via a reentrant lock (``RLock``) — services call from
    executor threads, and ``mutate`` may internally call ``snapshot``.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._version = 0
        self._dirty = False
        self._save_timer: Optional[threading.Timer] = None

        # Recorded fingerprint per backing file; None => file absent at record time.
        self._fingerprints: dict[str, Fingerprint] = {}

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

    def _current_fingerprints(self) -> dict[str, Fingerprint]:
        """Cheap stat of the four backing files; missing file => None.

        Fingerprint is ``(st_mtime_ns, st_size)``. Residual false-negative
        (accepted): a rewrite that preserves both mtime_ns and size is missed.
        """
        fingerprints: dict[str, Fingerprint] = {}
        for key, path in self._paths().items():
            try:
                st = path.stat()
                fingerprints[key] = (st.st_mtime_ns, st.st_size)
            except (FileNotFoundError, OSError):
                fingerprints[key] = None
        return fingerprints

    def _record_fingerprints(self) -> None:
        """Snapshot the on-disk fingerprints as the store's known-good baseline."""
        self._fingerprints = self._current_fingerprints()

    def _load_locked(self) -> None:
        """Load all collections from disk and record fingerprints. Holds lock."""
        (
            self._known_faces,
            self._ignored_faces,
            self._hard_negatives,
            self._processed_files,
        ) = db.load_database()
        self._record_fingerprints()
        self._loaded = True

    def _refresh_locked(self) -> None:
        """Load on first use, or reload if a backing file changed. Holds lock."""
        if not self._loaded:
            self._load_locked()
            self._version += 1
        elif self._current_fingerprints() != self._fingerprints:
            logger.debug("[FaceDBStore] External change detected — reloading")
            self._load_locked()
            self._version += 1

    # ----- public API ---------------------------------------------------

    def snapshot(self) -> DBSnapshot:
        """Return a view of the DB, reloading on external change.

        Cheap-stats the four files; if any fingerprint ``(st_mtime_ns,
        st_size)`` differs from the recorded baseline (or the store hasn't
        loaded yet), reloads via ``core.db.load_database`` and bumps the
        version. The returned collections are the store's LIVE objects —
        mutate only via ``mutate()``; iterate/aggregate via ``read()`` (see
        ``DBSnapshot`` for the read contract).
        """
        with self._lock:
            self._refresh_locked()
            return DBSnapshot(
                known_faces=self._known_faces,
                ignored_faces=self._ignored_faces,
                hard_negatives=self._hard_negatives,
                processed_files=self._processed_files,
                version=self._version,
            )

    def read(self, fn: Callable[
        [dict[str, Any], list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        Any,
    ]) -> Any:
        """Run a read-only ``fn`` over the live collections under the lock.

        ``fn`` is called as ``fn(known_faces, ignored_faces, hard_negatives,
        processed_files)`` after the same freshness check as ``snapshot()``;
        its return value is passed through. Because the lock is held, ``fn``
        may safely iterate/aggregate without racing a concurrent ``mutate()``
        on another thread. ``fn`` must not mutate — use ``mutate()`` for that.
        The lock is reentrant, so ``fn`` may call ``snapshot()`` internally.
        """
        with self._lock:
            self._refresh_locked()
            return fn(
                self._known_faces,
                self._ignored_faces,
                self._hard_negatives,
                self._processed_files,
            )

    def mutate(self, fn: Callable[
        [dict[str, Any], list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        Any,
    ]) -> Any:
        """Apply a mutation to the live collections under the store lock.

        ``fn`` is called as ``fn(known_faces, ignored_faces, hard_negatives,
        processed_files)`` and may return a value, which is passed through to
        the caller. After ``fn`` runs, the version is bumped, the store is
        marked dirty, and a save is scheduled with leading coalesce: the timer
        is armed only if none is pending, so the write lands 500 ms after the
        FIRST mutation of a burst (matching detection_service today) and
        sustained mutation still saves roughly every 500 ms.

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
        """Arm the coalesce timer if none is pending. Caller holds the lock.

        Leading coalesce: later mutations within the window do NOT re-arm the
        timer, so the save fires a bounded 500 ms after the first mutation of
        a burst (never starved by sustained mutation).
        """
        if self._save_timer is not None:
            return  # A save is already scheduled — coalesce into it.
        self._save_timer = threading.Timer(SAVE_DEBOUNCE_SECONDS, self._debounced_save)
        self._save_timer.daemon = True
        self._save_timer.start()

    def _debounced_save(self) -> None:
        """Timer callback: save if still dirty."""
        with self._lock:
            self._save_timer = None
            self._save_now_locked()

    def _save_now_locked(self) -> None:
        """Write all four files now if dirty and record post-save fingerprints.

        Caller holds the lock. Recording our own post-save fingerprints
        prevents the next ``snapshot()`` from mistaking our write for an
        external change. Note: dirty-flag granularity (per-file) is deferred
        to E1 — for now a save always writes all four files (via
        ``core.db.save_database``).
        """
        if not self._dirty:
            return
        db.save_database(
            self._known_faces,
            self._ignored_faces,
            self._hard_negatives,
            self._processed_files,
        )
        self._record_fingerprints()
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
