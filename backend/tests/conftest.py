"""Shared pytest helpers for the backend test suite."""


class InMemoryDBStore:
    """A FaceDBStore stand-in backed by a service's live in-memory collections.

    ManagementService now routes every read/mutation through a FaceDBStore
    (``read``/``mutate``/``flush``). Tests that keep their known_faces dict
    authoritative in memory (never touching disk) attach one of these to
    ``svc.store`` instead of the real store. It reads the service's own
    attributes *at call time*, so a test can reassign ``svc.known_faces = {...}``
    between calls and the next read/mutate sees the new object. Production code
    mutates the collections in place (``d[k] = ...``, ``lst[:] = ...``,
    ``del d[k]``), so those edits reflect back onto the service's attributes.
    ``flush`` is a no-op (nothing is persisted). ``version`` is a monotonic int
    bumped by every ``mutate`` — DetectionService reads it to invalidate its
    match-result cache when the DB changes (mirrors the real store's version).
    """

    def __init__(self, svc):
        self._svc = svc
        self._version = 0

    def _collections(self):
        return (
            self._svc.known_faces,
            self._svc.ignored_faces,
            self._svc.hard_negatives,
            self._svc.processed_files,
        )

    def read(self, fn):
        return fn(*self._collections())

    def mutate(self, fn):
        result = fn(*self._collections())
        self._version += 1
        return result

    def flush(self):
        pass

    @property
    def version(self):
        return self._version
