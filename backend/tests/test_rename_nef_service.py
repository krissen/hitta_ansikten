"""Tests for RenameNefService._plan chunked EXIF reading.

The service reads EXIF in EXIF_CHUNK_SIZE batches so progress can be streamed.
get_exif_data sorts each batch on its own; the -NN duplicate-timestamp suffixes
therefore depend on the *merged* list being re-sorted with the same key. This
verifies that two files sharing a timestamp but landing in different chunks get
deterministic suffixes driven by (ts, subsec, path) — not by chunk order.
"""

import asyncio
import os
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


# ----- plan cache: preview → execute skips the EXIF re-read ------------------

# Real on-disk files so the (mtime_ns, size) signature can be stat'd. exiftool is
# mocked, keyed on filename; unknown names are simply skipped (as a real read
# would drop files without a CreateDate).
_CACHE_EXIF = {
    "a.NEF": ("250101_120000", 0),
    "b.NEF": ("250101_120001", 0),
    "c.NEF": ("250101_120002", 0),
}


def _make_nefs(tmp_path, names):
    for n in names:
        (tmp_path / n).write_bytes(b"nef")


def _counting_exif(calls):
    def _fake(chunk):
        calls.append(len(chunk))
        entries = [
            (_CACHE_EXIF[p.name][0], _CACHE_EXIF[p.name][1], Path(p))
            for p in chunk if p.name in _CACHE_EXIF
        ]
        entries.sort(key=lambda e: (e[0], e[1], str(e[2])))
        return entries
    return _fake


@pytest.mark.asyncio
async def test_execute_reuses_preview_plan_when_unchanged(tmp_path, monkeypatch):
    _make_nefs(tmp_path, ["a.NEF", "b.NEF"])
    calls = []
    monkeypatch.setattr(rename_nef_service, "get_exif_data", _counting_exif(calls))

    svc = RenameNefService()
    roots = [str(tmp_path)]

    prev = await svc.preview(roots=roots)
    assert prev["to_rename"] == 2
    assert len(calls) == 1  # EXIF read once, during preview

    result = await svc.execute(roots=roots)
    assert len(calls) == 1  # cache hit → no second EXIF read
    assert {r["to"] for r in result["renamed"]} == {"250101_120000.NEF", "250101_120001.NEF"}
    assert (tmp_path / "250101_120000.NEF").exists()
    # Files renamed → cache dropped so a stale signature can never match later.
    assert svc._preview_cache is None


@pytest.mark.asyncio
async def test_execute_rereads_when_mtime_changes(tmp_path, monkeypatch):
    _make_nefs(tmp_path, ["a.NEF", "b.NEF"])
    calls = []
    monkeypatch.setattr(rename_nef_service, "get_exif_data", _counting_exif(calls))

    svc = RenameNefService()
    roots = [str(tmp_path)]

    await svc.preview(roots=roots)
    assert len(calls) == 1

    # Touch one file: signature diverges → full re-read on execute.
    f = tmp_path / "a.NEF"
    st = f.stat()
    bump = st.st_mtime_ns + 5_000_000_000
    os.utime(f, ns=(bump, bump))

    await svc.execute(roots=roots)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_execute_rereads_when_file_added(tmp_path, monkeypatch):
    _make_nefs(tmp_path, ["a.NEF", "b.NEF"])
    calls = []
    monkeypatch.setattr(rename_nef_service, "get_exif_data", _counting_exif(calls))

    svc = RenameNefService()
    roots = [str(tmp_path)]

    await svc.preview(roots=roots)
    assert len(calls) == 1

    # A new file changes the resolved set (signature keys differ) → re-read.
    _make_nefs(tmp_path, ["c.NEF"])

    await svc.execute(roots=roots)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_execute_invalidates_cache_for_next_run(tmp_path, monkeypatch):
    _make_nefs(tmp_path, ["a.NEF", "b.NEF"])
    calls = []
    monkeypatch.setattr(rename_nef_service, "get_exif_data", _counting_exif(calls))

    svc = RenameNefService()
    roots = [str(tmp_path)]

    await svc.preview(roots=roots)
    await svc.execute(roots=roots)  # cache hit, then invalidated
    assert len(calls) == 1
    assert svc._preview_cache is None

    # Second execute has no cache to lean on → it must read EXIF again.
    await svc.execute(roots=roots)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_concurrent_execute_is_serialized(tmp_path, monkeypatch):
    """Two overlapping executes must not interleave at the await points.

    Without the per-service lock both calls plan the same files; the first
    renames them and the second runs its two-pass move against source paths that
    no longer exist, raising per-file errors. Serialized, the second re-plans
    after the first against the already-renamed files and is a clean no-op.
    """
    _make_nefs(tmp_path, ["a.NEF", "b.NEF"])
    calls = []
    monkeypatch.setattr(rename_nef_service, "get_exif_data", _counting_exif(calls))

    svc = RenameNefService()
    roots = [str(tmp_path)]

    r1, r2 = await asyncio.gather(svc.execute(roots=roots), svc.execute(roots=roots))

    # Neither call produced per-file errors...
    assert r1["errors"] == []
    assert r2["errors"] == []
    # ...and the rename happened exactly once (2 renamed + 0 no-op).
    assert sorted([len(r1["renamed"]), len(r2["renamed"])]) == [0, 2]
    assert (tmp_path / "250101_120000.NEF").exists()
    assert (tmp_path / "250101_120001.NEF").exists()
