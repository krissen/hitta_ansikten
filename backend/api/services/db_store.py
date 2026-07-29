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
- ``mutate(fn, touches=...)`` runs ``fn`` under the store lock, bumps the
  version, marks the collections named in ``touches`` dirty, and schedules a
  leading-coalesce save: the write fires 500 ms after the FIRST mutation of a
  burst and is NOT re-armed by later mutations (matching detection_service's
  ``_schedule_save`` semantics today), so sustained mutation still gets a
  durable save roughly every 500 ms. Dirty flags accumulate across coalesced
  mutations; the debounced save writes only the dirty union
  (``core.db.save_database(only=...)``) then clears the flags — so a confirm
  no longer rewrites all four files. ``touches=None`` (default) is conservative
  (all four). Only the written files' fingerprints are re-recorded post-save.
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
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from core import db

logger = logging.getLogger(__name__)

# Coalesce window for rapid mutations. Leading semantics: the save fires this
# long after the FIRST mutation of a burst and is not re-armed by later ones —
# matching detection_service's current _schedule_save behavior (bounded
# staleness of ~500 ms under sustained mutation).
SAVE_DEBOUNCE_SECONDS = 0.5

# Per-file external-change fingerprint: (st_mtime_ns, st_size), or None when
# the file is absent. Size catches same-mtime rewrites of different length.
Fingerprint = tuple[int, int] | None


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
        # Per-collection dirty flags: the set of collection keys
        # ({'known','ignored','hardneg','processed'}) mutated since the last
        # save. A save writes exactly this union and then clears it. Empty set
        # == clean (the old boolean ``_dirty`` is now ``bool(_dirty)``).
        self._dirty: set[str] = set()
        self._save_timer: threading.Timer | None = None

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
        # Keys match the collection names used by dirty flags / ``touches`` and
        # ``core.db.save_database(only=...)`` — {'known','ignored','hardneg',
        # 'processed'} — so fingerprints and dirty sets share one vocabulary.
        return {
            "known": db.ENCODING_PATH,
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

    def _record_fingerprints(self, only: set[str] | None = None) -> None:
        """Snapshot on-disk fingerprints as the store's known-good baseline.

        ``only`` restricts the update to the named collections (after a partial
        save, only the files we just wrote have changed on disk — the rest keep
        their previously recorded fingerprints, which still match disk). ``None``
        records all four (full load / full save).
        """
        current = self._current_fingerprints()
        if only is None:
            self._fingerprints = current
        else:
            for key in only:
                self._fingerprints[key] = current[key]

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
    ], touches: set[str] | None = None) -> Any:
        """Apply a mutation to the live collections under the store lock.

        ``fn`` is called as ``fn(known_faces, ignored_faces, hard_negatives,
        processed_files)`` and may return a value, which is passed through to
        the caller. After ``fn`` runs, the version is bumped, the collections
        named in ``touches`` are marked dirty, and a save is scheduled with
        leading coalesce: the timer is armed only if none is pending, so the
        write lands 500 ms after the FIRST mutation of a burst (matching
        detection_service today) and sustained mutation still saves roughly
        every 500 ms.

        ``touches`` declares which collections ``fn`` writes — a subset of
        ``{'known', 'ignored', 'hardneg', 'processed'}``. ``None`` (default) is
        the conservative choice: mark all four dirty (never loses a write).
        Dirty flags accumulate across coalesced mutations, so a burst that
        touches ``{'known'}`` then ``{'processed'}`` saves exactly those two
        files. **Under-declaring ``touches`` loses writes** (a mutated but
        undeclared collection is never persisted) — declare accurately, and
        over-declare when unsure.

        The lock is reentrant, so ``fn`` may call ``snapshot()`` internally.
        """
        if touches is None:
            dirty = set(db.DB_COLLECTIONS)
        else:
            unknown = set(touches) - db.DB_COLLECTIONS
            if unknown:
                raise ValueError(f"mutate: unknown collections in touches={sorted(unknown)}")
            dirty = set(touches)
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
            self._dirty |= dirty
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
        """Write the dirty collections now and record their post-save fingerprints.

        Caller holds the lock. Only the collections marked dirty since the last
        save are rewritten (via ``core.db.save_database(only=...)``); untouched
        files keep their mtime/size. Recording our own post-save fingerprints
        for exactly those files prevents the next ``snapshot()`` from mistaking
        our write for an external change, while the untouched files' recorded
        fingerprints still match disk.

        Atomicity: the dirty set is snapshotted and the save runs entirely
        under the store lock, and ``mutate()`` also takes the lock — so no
        mutation can land between snapshotting the dirty set and clearing it.
        The flags are cleared only after a successful save; if the save raises,
        they remain set and a later save retries (no lost write).
        """
        if not self._dirty:
            return
        to_write = frozenset(self._dirty)
        db.save_database(
            self._known_faces,
            self._ignored_faces,
            self._hard_negatives,
            self._processed_files,
            only=to_write,
        )
        self._record_fingerprints(only=set(to_write))
        self._dirty -= to_write
        logger.debug(
            "[FaceDBStore] Saved database (version=%d, wrote=%s)",
            self._version,
            sorted(to_write),
        )


# --- Singleton access (lazy; no module-level construction) ---------------

_store: FaceDBStore | None = None
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
