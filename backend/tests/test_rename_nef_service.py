"""Tests for RenameNefService._plan chunked EXIF reading.

The service reads EXIF in EXIF_CHUNK_SIZE batches so progress can be streamed.
get_exif_data sorts each batch on its own; the -NN duplicate-timestamp suffixes
therefore depend on the *merged* list being re-sorted with the same key. This
verifies that two files sharing a timestamp but landing in different chunks get
deterministic suffixes driven by (ts, subsec, path) — not by chunk order.
"""

from pathlib import Path

import pytest

from api.services import rename_nef_service
from api.services.rename_nef_service import RenameNefService

# name -> (timestamp, subsec). a and c share a timestamp; with a chunk size of 2
# they fall in different chunks ([a, b] then [c, d]). c has the lower subsec, so
# after the merged re-sort it must win the "-0" suffix regardless of chunk order.
_EXIF = {
    "a.NEF": ("250101_120000", 5),
    "b.NEF": ("250101_120001", 0),
    "c.NEF": ("250101_120000", 1),
    "d.NEF": ("250101_120002", 0),
}
_FILES = [f"/photos/{name}" for name in _EXIF]


def _fake_get_exif_data(chunk):
    """Mimic get_exif_data: per-batch sort on (ts, subsec, str(path))."""
    entries = [(_EXIF[p.name][0], _EXIF[p.name][1], Path(p)) for p in chunk]
    entries.sort(key=lambda e: (e[0], e[1], str(e[2])))
    return entries


@pytest.mark.asyncio
async def test_plan_suffixes_deterministic_across_chunk_boundary(monkeypatch):
    # Force a and c into separate chunks.
    monkeypatch.setattr(rename_nef_service, "EXIF_CHUNK_SIZE", 2)
    monkeypatch.setattr(rename_nef_service, "get_exif_data", _fake_get_exif_data)

    svc = RenameNefService()
    renames, no_date, valid_count = await svc._plan(_FILES, phase="preview")

    new_by_original = {src.name: dst.name for src, dst, _ in renames}
    # Lower subsec (c) wins -0 even though it was read in the second chunk.
    assert new_by_original["c.NEF"] == "250101_120000-0.NEF"
    assert new_by_original["a.NEF"] == "250101_120000-1.NEF"
    assert new_by_original["b.NEF"] == "250101_120001.NEF"
    assert new_by_original["d.NEF"] == "250101_120002.NEF"
    assert no_date == []
    assert valid_count == 4


@pytest.mark.asyncio
async def test_plan_broadcasts_progress_per_chunk(monkeypatch):
    monkeypatch.setattr(rename_nef_service, "EXIF_CHUNK_SIZE", 2)
    monkeypatch.setattr(rename_nef_service, "get_exif_data", _fake_get_exif_data)

    events = []

    async def _capture(event, payload):
        events.append((event, payload))

    monkeypatch.setattr(rename_nef_service, "broadcast_event", _capture)

    svc = RenameNefService()
    await svc._plan(_FILES, phase="preview")

    # Initial 0% plus one per chunk (2 chunks of 2 over 4 files).
    assert [e[1]["percent"] for e in events] == [0, 50, 100]
    assert all(e[0] == "rename-nef-progress" for e in events)
    assert all(e[1]["phase"] == "preview" for e in events)
    assert events[-1][1] == {
        "phase": "preview", "current": 4, "total": 4, "percent": 100,
    }
