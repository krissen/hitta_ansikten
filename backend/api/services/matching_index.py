"""Version-invalidated matching index for face detection.

DetectionService's matching helpers (``_match_encoding``, ``_match_ignored``,
``_match_encoding_alternatives``, ``_person_match_encodings``) used to rebuild
the per-backend candidate matrices from the store's collections on EVERY call —
a fresh ``np.array``/``np.vstack`` pass over every person's encodings for every
detected face. With ~100+ people that repeated O(n) Python-loop matrix
construction dominated the match cost.

``MatchingIndex`` builds those matrices ONCE per store version and reuses them
across every face of an image (and across images) until the DB actually
changes. Invalidation is tied to ``FaceDBStore.version``: the store bumps the
version on every in-app mutation, so a stale index can never outlive a
confirm/ignore. Note the accepted staleness window: the matching path reads the
version *property* (no freshness stat), so an EXTERNAL rewrite of the DB files
(e.g. the legacy CLI while the GUI is open) is not picked up until something
else calls ``store.read()``/``snapshot()`` or an in-app mutation bumps the
version. Acceptable for a single-process desktop app; documented deliberately
(Nagelfar review of PR #150, issue-001).

The index holds four structures for the service's active backend, each a
faithful precomputation of what one helper used to build inline:

* ``known_lenient`` — ``{name: matrix}`` mirroring the old ``_known_candidates``
  filter (dict entries default to the ``dlib`` backend when no ``backend`` key
  is present; raw-array entries are treated as ``dlib``). Feeds
  ``_match_encoding`` (min-over-entries, nearest person) and
  ``_person_match_encodings`` (the twin k-NN union).
* ``known_strict`` — ``[(name, matrix), ...]`` mirroring the stricter
  ``_match_encoding_alternatives`` filter (dict entries with an *explicit*
  ``backend`` key equal to the active backend, and a 1-D encoding).
* ``ignored`` — a single stacked matrix mirroring ``_ignored_matrix`` (same
  lenient backend rule, 1-D encodings, original order preserved so
  ``_match_ignored``'s argmin index stays identical).
* ``known_hardneg`` — ``{name: matrix}`` of a person's hard negatives (the
  encodings the user explicitly rejected as *not* being that person), built
  with the same lenient backend rule as ``known_lenient``. Lets the API match
  path skip a person when the probe is too close to one of their hard
  negatives — the accuracy fix that brings the GUI in line with the CLI's
  ``best_matches``. Built inside the same ``store.read`` snapshot as the other
  three so it shares the version tag (a hard-negative mutation bumps the store
  version and rebuilds all four together).

Thread-safety: matching runs in executor threads, so a rebuild is guarded by a
lock with the double-checked pattern used by the service singletons — a version
move triggers exactly one rebuild even under concurrent detects. The rebuild
runs inside ``store.read`` so the collections are snapshotted under the store
lock (one consistent pass); the resulting matrices are immutable snapshots that
in-flight matchers may keep using safely.
"""

import logging
import threading
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


class MatchingIndex:
    """Per-backend stacked candidate matrices, rebuilt lazily on version change."""

    def __init__(self, store: Any, backend_name: str) -> None:
        self._store = store
        self._backend_name = backend_name
        self._lock = threading.Lock()

        # -1 forces a build on first access (store versions start at 0).
        self._version = -1
        self._known_lenient: dict[str, np.ndarray] = {}
        self._known_strict: list[tuple[str, np.ndarray]] = []
        self._ignored: np.ndarray | None = None
        self._known_hardneg: dict[str, np.ndarray] = {}

    # ----- lazy rebuild -------------------------------------------------

    def _ensure_current(self) -> None:
        """Rebuild the matrices if the store version moved (double-checked)."""
        if self._store.version == self._version:
            return
        with self._lock:
            if self._store.version == self._version:
                return
            self._rebuild()

    def _rebuild(self) -> None:
        """Snapshot the collections under the store lock and stack matrices."""
        active = self._backend_name

        def build(known, ignored, hardneg, processed):
            # Capture the version INSIDE the read: the store's RLock is held
            # here (reentrant), so this is the exact version the snapshot
            # corresponds to — no window for a concurrent mutation to slip in
            # between the build and the version tag.
            version = self._store.version

            # Lenient known: mirrors _known_candidates / _person_match_encodings.
            known_lenient: dict[str, np.ndarray] = {}
            for name, entries in known.items():
                rows = []
                for entry in entries:
                    if isinstance(entry, dict):
                        enc = entry.get("encoding")
                        be = entry.get("backend", "dlib")
                    else:
                        enc = entry
                        be = "dlib"
                    if enc is not None and be == active:
                        rows.append(enc)
                if rows:
                    known_lenient[name] = np.array(rows)

            # Strict known: mirrors _match_encoding_alternatives (explicit
            # backend key, 1-D encodings only).
            known_strict: list[tuple[str, np.ndarray]] = []
            for name, entries in known.items():
                rows = []
                for entry in entries:
                    if isinstance(entry, dict) and entry.get("backend") == active:
                        enc = entry.get("encoding")
                        if enc is not None:
                            arr = np.asarray(enc)
                            if arr.ndim == 1:
                                rows.append(arr)
                if rows:
                    known_strict.append((name, np.vstack(rows)))

            # Ignored: mirrors _ignored_matrix (lenient rule, 1-D, original order).
            ignored_rows = []
            for entry in ignored:
                if isinstance(entry, dict):
                    enc = entry.get("encoding")
                    be = entry.get("backend", "dlib")
                else:
                    enc = entry
                    be = "dlib"
                if enc is not None and be == active:
                    arr = np.asarray(enc)
                    if arr.ndim == 1:
                        ignored_rows.append(arr)
            ignored_matrix = np.vstack(ignored_rows) if ignored_rows else None

            # Hard negatives: same lenient backend rule as known_lenient, keyed
            # by person name. These are the encodings the user rejected for that
            # person; the match path uses them to skip the person entirely.
            known_hardneg: dict[str, np.ndarray] = {}
            for name, entries in hardneg.items():
                rows = []
                for entry in entries:
                    if isinstance(entry, dict):
                        enc = entry.get("encoding")
                        be = entry.get("backend", "dlib")
                    else:
                        enc = entry
                        be = "dlib"
                    if enc is not None and be == active:
                        rows.append(enc)
                if rows:
                    known_hardneg[name] = np.array(rows)

            return version, known_lenient, known_strict, ignored_matrix, known_hardneg

        version, known_lenient, known_strict, ignored_matrix, known_hardneg = (
            self._store.read(build)
        )
        self._known_lenient = known_lenient
        self._known_strict = known_strict
        self._ignored = ignored_matrix
        self._known_hardneg = known_hardneg
        self._version = version
        logger.debug(
            "[MatchingIndex] Rebuilt at version %d: %d known (lenient), "
            "%d known (strict), %s ignored, %d with hard negatives",
            version,
            len(known_lenient),
            len(known_strict),
            0 if ignored_matrix is None else len(ignored_matrix),
            len(known_hardneg),
        )

    # ----- accessors (each ensures freshness) ---------------------------

    def known_lenient_items(self) -> list[tuple[str, np.ndarray]]:
        """`(name, matrix)` pairs for nearest-person matching (insertion order)."""
        self._ensure_current()
        return list(self._known_lenient.items())

    def known_strict_items(self) -> list[tuple[str, np.ndarray]]:
        """`(name, matrix)` pairs for the alternatives ranking."""
        self._ensure_current()
        return list(self._known_strict)

    def ignored_matrix(self) -> np.ndarray | None:
        """Stacked ignored-encoding matrix, or ``None`` when empty."""
        self._ensure_current()
        return self._ignored

    def person_lenient_rows(self, name: str) -> list[np.ndarray]:
        """Encoding rows for one person (lenient filter), or ``[]`` if absent."""
        self._ensure_current()
        matrix = self._known_lenient.get(name)
        if matrix is None:
            return []
        return list(matrix)

    def hardneg_matrix(self, name: str) -> np.ndarray | None:
        """Stacked hard-negative matrix for `name`, or ``None`` when the person
        has no hard negatives for the active backend."""
        self._ensure_current()
        return self._known_hardneg.get(name)
