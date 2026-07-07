"""Shared pytest helpers for the backend test suite."""

import logging

import pytest


@pytest.fixture(autouse=True)
def _redirect_app_log(tmp_path, monkeypatch):
    """Keep the test suite from writing the real app log.

    ``core.db.LOGGING_PATH`` (``~/.local/share/faceid/ansikten.log``) is the
    canonical app log. Anything that calls ``init_logging`` or ``rotate_logs``
    would otherwise append to / rotate the developer's real log. Redirect the
    constant to a per-test tmp file everywhere it is referenced, and strip any
    root ``FileHandler`` pointing at the real log so stray ``logging`` calls
    during a test never land there.
    """
    import core.config as config_mod
    import core.db as db_mod

    real_log = str(db_mod.LOGGING_PATH)
    tmp_log = tmp_path / "ansikten.log"

    monkeypatch.setattr(db_mod, "LOGGING_PATH", tmp_log, raising=False)
    monkeypatch.setattr(config_mod, "LOGGING_PATH", tmp_log, raising=False)

    root = logging.getLogger()
    removed = [
        h for h in root.handlers
        if isinstance(h, logging.FileHandler) and h.baseFilename == real_log
    ]
    for h in removed:
        root.removeHandler(h)
    try:
        yield
    finally:
        for h in removed:
            root.addHandler(h)


@pytest.fixture(autouse=True)
def _reset_service_singletons():
    """Reset lazy service singletons between tests.

    The service modules cache a process-wide instance the first time their
    ``get_*_service()`` getter runs (e.g. via a route exercised through
    ``TestClient``). Clear those caches around each test so state (and the
    bound data dir) never carries over between tests.
    """
    modules = [
        "api.services.detection_service",
        "api.services.statistics_service",
        "api.services.player_count_service",
        "api.services.culling_service",
        "api.services.rename_nef_service",
        "api.services.import_service",
    ]
    attr_by_module = {
        "api.services.detection_service": "_detection_service",
        "api.services.statistics_service": "_statistics_service",
        "api.services.player_count_service": "_player_count_service",
        "api.services.culling_service": "_culling_service",
        "api.services.rename_nef_service": "_rename_nef_service",
        "api.services.import_service": "_import_service",
    }
    import sys

    def _clear():
        for name in modules:
            mod = sys.modules.get(name)
            if mod is not None and hasattr(mod, attr_by_module[name]):
                setattr(mod, attr_by_module[name], None)
        # Management uses the same pattern (_management_service via its proxy).
        mgmt = sys.modules.get("api.services.management_service")
        if mgmt is not None and hasattr(mgmt, "_management_service"):
            mgmt._management_service = None

    _clear()
    yield
    _clear()



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
