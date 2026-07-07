"""The lazy service getters must construct exactly one instance under races.

First calls can arrive concurrently from worker threads (e.g. preprocessing's
ThreadPoolExecutor reaching get_detection_service() via the module-level
helpers). An unguarded check-then-set would let several threads observe None
and construct several instances — for DetectionService that means multiple
InsightFace loads and split caches. The getters use double-checked locking;
these tests race N threads against each getter with construction patched to
something slow and counting, and assert exactly one construction.
"""

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

CASES = [
    ("api.services.detection_service", "DetectionService",
     "_detection_service", "get_detection_service"),
    ("api.services.statistics_service", "StatisticsService",
     "_statistics_service", "get_statistics_service"),
    ("api.services.player_count_service", "PlayerCountService",
     "_player_count_service", "get_player_count_service"),
    ("api.services.culling_service", "CullingService",
     "_culling_service", "get_culling_service"),
    ("api.services.rename_nef_service", "RenameNefService",
     "_rename_nef_service", "get_rename_nef_service"),
    ("api.services.import_service", "ImportService",
     "_import_service", "get_import_service"),
    ("api.services.management_service", "ManagementService",
     "_management_service", "get_management_service"),
]


class _SlowCountingFactory:
    """Stand-in construction: slow enough to widen the race window, counting."""

    def __init__(self):
        self.count = 0
        self._count_lock = threading.Lock()

    def __call__(self):
        with self._count_lock:
            self.count += 1
        # Widen the check-then-set window: an unguarded getter would let every
        # racing thread pass the None check before any assignment lands.
        import time
        time.sleep(0.05)
        return object()


@pytest.mark.parametrize("mod_name,cls_name,var_name,getter_name", CASES)
def test_racing_first_calls_construct_exactly_once(
    mod_name, cls_name, var_name, getter_name, monkeypatch
):
    import importlib

    mod = importlib.import_module(mod_name)
    factory = _SlowCountingFactory()
    monkeypatch.setattr(mod, cls_name, factory)
    monkeypatch.setattr(mod, var_name, None)
    getter = getattr(mod, getter_name)

    n_threads = 8
    barrier = threading.Barrier(n_threads)

    def race():
        barrier.wait()  # release all threads into the getter at once
        return getter()

    with ThreadPoolExecutor(max_workers=n_threads) as pool:
        results = [f.result() for f in [pool.submit(race) for _ in range(n_threads)]]

    assert factory.count == 1, f"{getter_name} constructed {factory.count} instances"
    assert all(r is results[0] for r in results), "getter returned different instances"
