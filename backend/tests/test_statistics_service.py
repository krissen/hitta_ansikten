"""Characterization tests for StatisticsService.

These pin CURRENT behavior of the seams an upcoming refactor will touch (the
service moves onto a unified FaceDBStore):

  * the shape of get_summary() for a small synthetic DB + attempt log
  * that get_summary reads via load_database / load_attempt_log per uncached
    request (spied through a call counter)

``load_database`` and ``load_attempt_log`` are monkeypatched with synthetic
data + counters, so no real database is touched.
"""

import pytest

import api.services.statistics_service as stats_mod
from api.services.statistics_service import StatisticsService


def _attempt_entry(filename, names, face_count=2, timestamp="2026-07-01T10:00:00",
                   backend="insightface", scale_label="mid", scale_px=4500):
    """A synthetic attempt-log entry as load_attempt_log would return it."""
    labels = [{"label": f"#{i + 1}\n{n}", "hash": ""} for i, n in enumerate(names)]
    return {
        "timestamp": timestamp,
        "filename": filename,
        "file_hash": "deadbeef",
        "attempts": [{
            "backend": backend,
            "upsample": 0,
            "scale_label": scale_label,
            "scale_px": scale_px,
            "face_count": face_count,
            "time_seconds": 1.5,
            "source": "ansikten",
        }],
        "used_attempt": 0,
        "review_results": ["ok"],
        "labels_per_attempt": [labels],
    }


@pytest.fixture
def synthetic(monkeypatch):
    """Wire load_database + load_attempt_log to synthetic data with call counters."""
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
        _attempt_entry("260701_100100.NEF", ["Alice", "ignorerad"], timestamp="2026-07-01T10:01:00"),
    ]
    counters = {"load_database": 0, "load_attempt_log": 0}

    def fake_load_database():
        counters["load_database"] += 1
        return known, [], {}, processed

    def fake_load_attempt_log(all_files=False):
        counters["load_attempt_log"] += 1
        return log

    monkeypatch.setattr(stats_mod, "load_database", fake_load_database)
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
# 2. load-per-request behavior
# --------------------------------------------------------------------------
# NOTE (refactor seam): get_summary calls load_database + load_attempt_log
# ONCE per uncached request, and caches the result for `cache_ttl` seconds.
# The upcoming FaceDBStore refactor changes this loading strategy — update
# these counts intentionally when it lands.

@pytest.mark.asyncio
async def test_summary_loads_once_per_uncached_request(synthetic):
    svc = StatisticsService()

    await svc.get_summary()
    assert synthetic["load_database"] == 1
    assert synthetic["load_attempt_log"] == 1

    # Second call within TTL is served from cache — no extra loads.
    await svc.get_summary()
    assert synthetic["load_database"] == 1
    assert synthetic["load_attempt_log"] == 1

    # After invalidation, the next request reloads from source.
    svc.invalidate_cache()
    await svc.get_summary()
    assert synthetic["load_database"] == 2
    assert synthetic["load_attempt_log"] == 2


@pytest.mark.asyncio
async def test_count_faces_per_name_loads_when_not_supplied(synthetic):
    svc = StatisticsService()
    counts = svc.count_faces_per_name()
    assert counts == {"Alice": 3, "Bob": 1}
    assert synthetic["load_database"] == 1

    # Supplying known_faces bypasses the load entirely.
    counts2 = svc.count_faces_per_name({"X": [1, 2]})
    assert counts2 == {"X": 2}
    assert synthetic["load_database"] == 1  # unchanged
