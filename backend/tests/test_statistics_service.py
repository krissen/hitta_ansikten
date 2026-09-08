"""Characterization tests for StatisticsService.

These pin the behavior of the seams after the FaceDBStore migration:

  * the shape of get_summary() for a small synthetic DB + attempt log
  * that get_summary reads DB figures via the shared store (spied through a
    call counter) and caches the computed summary keyed by the store version:
    a second call while the version is unchanged hits the cache; bumping the
    version invalidates it instantly

The DB reads are served by a fake store (so no real database is touched); the
attempt log — which is NOT in the store — is still monkeypatched on the module.
"""

import pytest

import api.services.statistics_service as stats_mod
from api.services.statistics_service import StatisticsService


def _attempt_entry(
    filename,
    names,
    face_count=2,
    timestamp="2026-07-01T10:00:00",
    backend="insightface",
    scale_label="mid",
    scale_px=4500,
):
    """A synthetic attempt-log entry as load_attempt_log would return it."""
    labels = [{"label": f"#{i + 1}\n{n}", "hash": ""} for i, n in enumerate(names)]
    return {
        "timestamp": timestamp,
        "filename": filename,
        "file_hash": "deadbeef",
        "attempts": [
            {
                "backend": backend,
                "upsample": 0,
                "scale_label": scale_label,
                "scale_px": scale_px,
                "face_count": face_count,
                "time_seconds": 1.5,
                "source": "ansikten",
            }
        ],
        "used_attempt": 0,
        "review_results": ["ok"],
        "labels_per_attempt": [labels],
    }


class _FakeStore:
    """Minimal stand-in for FaceDBStore: a bumpable version + a counting read().

    ``read(fn)`` calls ``fn(known, ignored, hard_negatives, processed)`` — the
    same contract as the real store — and tallies invocations.
    """

    def __init__(self, known, processed, counters):
        self._known = known
        self._processed = processed
        self._counters = counters
        self.version = 1

    def read(self, fn):
        self._counters["store_reads"] += 1
        return fn(self._known, [], {}, self._processed)


@pytest.fixture
def synthetic(monkeypatch):
    """Wire a fake store + load_attempt_log to synthetic data with call counters."""
    known = {
        "Alice": [{"encoding": None}, {"encoding": None}, {"encoding": None}],
        "Bob": [{"encoding": None}],
    }
    processed = [
        {"name": "260701_100000.NEF", "hash": "h1"},
        {"name": "260701_100100.NEF", "hash": "h2"},
    ]
    log = [
        _attempt_entry("260701_100000.NEF", ["Alice", "Bob"], timestamp="2026-07-01T10:00:00"),
        _attempt_entry(
            "260701_100100.NEF", ["Alice", "ignorerad"], timestamp="2026-07-01T10:01:00"
        ),
    ]
    counters = {"store_reads": 0, "load_attempt_log": 0}
    fake_store = _FakeStore(known, processed, counters)

    def fake_load_attempt_log(all_files=False):
        counters["load_attempt_log"] += 1
        return log

    monkeypatch.setattr(stats_mod, "get_db_store", lambda: fake_store)
    monkeypatch.setattr(stats_mod, "load_attempt_log", fake_load_attempt_log)
    # get_recent_logs reads LOGGING_PATH from disk; point it at a missing file
    # so it returns a graceful error entry instead of the real log.
    monkeypatch.setattr(stats_mod, "LOGGING_PATH", "/nonexistent/ansikten.log")
    return counters


# --------------------------------------------------------------------------
# 1. get_summary output shape
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_summary_shape(synthetic):
    svc = StatisticsService()
    summary = await svc.get_summary()

    assert set(summary) == {
        "attempt_stats",
        "top_faces",
        "ignored_count",
        "ignored_total",
        "ignored_fraction",
        "recent_images",
        "recent_logs",
        "total_files_processed",
    }
    # top_faces: Alice (3) before Bob (1), with percentages of 4 total encodings.
    assert summary["top_faces"] == [
        {"name": "Alice", "face_count": 3, "percentage": 75},
        {"name": "Bob", "face_count": 1, "percentage": 25},
    ]
    assert summary["total_files_processed"] == 2
    # One "ignorerad" label out of four labels across the two reviews.
    assert summary["ignored_total"] == 4
    assert summary["ignored_count"] == 1
    assert summary["ignored_fraction"] == round(1 / 4, 3)

    # attempt_stats: one bucket (single backend/scale), used twice.
    assert len(summary["attempt_stats"]) == 1
    bucket = summary["attempt_stats"][0]
    assert bucket["backend"] == "insightface"
    assert bucket["used_count"] == 2
    assert bucket["total_count"] == 2
    assert bucket["hit_rate"] == 100.0

    # recent_images: newest first, names extracted (ignorerad filtered out).
    assert [img["filename"] for img in summary["recent_images"]] == [
        "260701_100100.NEF",
        "260701_100000.NEF",
    ]
    assert summary["recent_images"][0]["person_names"] == ["Alice"]
    assert summary["recent_images"][0]["source"] == "ansikten"


# --------------------------------------------------------------------------
# 2. store-read + version-keyed cache behavior
# --------------------------------------------------------------------------
# get_summary reads DB figures via the shared store ONCE per uncached request
# (attempt-log data comes from load_attempt_log). The computed summary is
# cached keyed by the store version: a repeat call while the version is
# unchanged is served from cache; bumping the version (a DB mutation) or an
# explicit invalidate_cache() forces a recompute.


@pytest.mark.asyncio
async def test_summary_caches_by_store_version(synthetic):
    svc = StatisticsService()

    await svc.get_summary()
    assert synthetic["store_reads"] == 1
    assert synthetic["load_attempt_log"] == 1

    # Second call, store version unchanged and within TTL → served from cache.
    await svc.get_summary()
    assert synthetic["store_reads"] == 1
    assert synthetic["load_attempt_log"] == 1

    # Bumping the store version (a DB mutation) invalidates the cache instantly.
    svc.store.version += 1
    await svc.get_summary()
    assert synthetic["store_reads"] == 2
    assert synthetic["load_attempt_log"] == 2

    # Explicit invalidation also forces a recompute.
    svc.invalidate_cache()
    await svc.get_summary()
    assert synthetic["store_reads"] == 3
    assert synthetic["load_attempt_log"] == 3


@pytest.mark.asyncio
async def test_mutation_during_summary_compute_is_not_masked(synthetic, monkeypatch):
    """A mutate() interleaving between the store read and the cache-set must
    invalidate the cached summary — the cache is tagged with the version
    captured AT the read, not the (already-bumped) version at set-time."""
    svc = StatisticsService()

    # Simulate a DB mutation during get_summary's awaits: load_attempt_log runs
    # after the store read but before the cache-set — bump the version there.
    orig_load = stats_mod.load_attempt_log

    def bumping_load(all_files=False):
        svc.store.version += 1
        return orig_load(all_files=all_files)

    monkeypatch.setattr(stats_mod, "load_attempt_log", bumping_load)

    await svc.get_summary()
    assert synthetic["store_reads"] == 1

    # The cache is tagged with the pre-mutation version, so the next call must
    # recompute (a set-time tag would wrongly serve the stale summary here).
    await svc.get_summary()
    assert synthetic["store_reads"] == 2


def test_count_faces_per_name_reads_store_when_not_supplied(synthetic):
    svc = StatisticsService()
    counts = svc.count_faces_per_name()
    assert counts == {"Alice": 3, "Bob": 1}
    assert synthetic["store_reads"] == 1

    # Supplying known_faces bypasses the store read entirely.
    counts2 = svc.count_faces_per_name({"X": [1, 2]})
    assert counts2 == {"X": 2}
    assert synthetic["store_reads"] == 1  # unchanged
