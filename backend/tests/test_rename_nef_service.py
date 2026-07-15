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
    renames, no_date, valid_count, named_affected = await svc._plan(_FILES, phase="preview")

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


# ----- protecting already-named files ---------------------------------------

from rename_nef import (  # noqa: E402
    _BARE_SLOT,
    compute_renames,
    is_already_named,
    timestamp_slot,
)


@pytest.mark.parametrize("name,ts,expected", [
    ("260713_110145.NEF", "260713_110145", True),           # bare timestamp
    ("260713_110145_ArvidW,_Elis.NEF", "260713_110145", True),  # _names suffix
    ("260713_112041-1.NEF", "260713_112041", True),         # -N burst
    ("260713_112041-1_Elis.NEF", "260713_112041", True),    # -N_Name
    ("260713_110145en.NEF", "260713_110145", True),         # photographer suffix (bare)
    ("260713_110145en_Anna.NEF", "260713_110145", True),    # photographer + _Name
    ("260713_112041-1en_Anna.NEF", "260713_112041", True),  # -N + photographer + _Name
    ("DSC_0001.NEF", "260713_110145", False),               # unrelated name
    ("260713_110146.NEF", "260713_110145", False),          # different timestamp
    # Negative: photographer suffix is bounded to 1-3 letters, and bare
    # digits/text without `-` must stay unprotected (renamable) as before.
    ("260713_110145abcd.NEF", "260713_110145", False),      # 4+ letters
    ("260713_110145en1.NEF", "260713_110145", False),       # letters then digit
    ("260713_1101453.NEF", "260713_110145", False),         # trailing digit, no `-`
])
def test_is_already_named(name, ts, expected):
    assert is_already_named(name, ts) is expected


def test_compute_renames_protects_named_by_default():
    # Named file shares its timestamp with a to-rename raw file.
    entries = [
        ("260713_110145", 0, Path("/p/260713_110145_ArvidW,_Elis.NEF")),
        ("260713_110200", 0, Path("/p/DSC_5.NEF")),
    ]
    renames = compute_renames(entries)
    dsts = {src.name: dst.name for src, dst, _ in renames}
    # The named file is left alone; only the raw file is renamed.
    assert dsts == {"DSC_5.NEF": "260713_110200.NEF"}


def test_compute_renames_include_named_strips_suffix():
    entries = [("260713_110145", 0, Path("/p/260713_110145_ArvidW,_Elis.NEF"))]
    renames = compute_renames(entries, include_named=True)
    dsts = {src.name: dst.name for src, dst, _ in renames}
    assert dsts == {"260713_110145_ArvidW,_Elis.NEF": "260713_110145.NEF"}


# --- reservation matrix: protected form × same-timestamp unnamed file ---------
# A protected file occupies its timestamp SLOT regardless of name suffix, so a
# same-second unnamed file is handed the next FREE slot. Slot occupancy (not the
# exact filename) is what matters: the downstream review-rename preserves the
# `ts` prefix, so an unnamed file left in a protected named file's slot could be
# named into `ts_Name.NEF` and collide with it later. Occupancy:
#   ts.NEF   and ts_Name.NEF   -> bare slot
#   ts-N.NEF and ts-N_Name.NEF -> index N

TS = "260713_112041"


@pytest.mark.parametrize("name,expected", [
    (f"{TS}.NEF", _BARE_SLOT),          # bare
    (f"{TS}_Elis.NEF", _BARE_SLOT),     # _Name → still the bare slot
    (f"{TS}en.NEF", _BARE_SLOT),        # photographer suffix → still bare
    (f"{TS}en_Anna.NEF", _BARE_SLOT),   # photographer + _Name → bare
    (f"{TS}-0.NEF", 0),                 # burst index
    (f"{TS}-3.NEF", 3),
    (f"{TS}-2_Elis.NEF", 2),            # -N_Name → index N
    (f"{TS}-1en_Anna.NEF", 1),          # -N + photographer suffix → index N
])
def test_timestamp_slot(name, expected):
    assert timestamp_slot(name, TS) == expected


def _plan(*entries):
    """compute_renames over pre-sorted (ts, subsec, path) entries → {src: dst}."""
    renames = compute_renames(list(entries))
    return {src.name: dst.name for src, dst, _ in renames}


def test_reserve_protected_bare_ts_pushes_unnamed_to_free_burst():
    # Protected bare `ts.NEF` holds the bare slot → unnamed gets the lowest free -N.
    dsts = _plan(
        (TS, 0, Path(f"/p/{TS}.NEF")),      # protected (bare)
        (TS, 1, Path("/p/DSC_9.NEF")),      # unnamed, same second
    )
    assert dsts == {"DSC_9.NEF": f"{TS}-0.NEF"}


def test_reserve_protected_burst_leaves_bare_free_for_unnamed():
    # Protected `ts-1.NEF` holds index 1, not the bare slot → unnamed takes bare.
    dsts = _plan(
        (TS, 0, Path(f"/p/{TS}-1.NEF")),    # protected (burst)
        (TS, 1, Path("/p/DSC_9.NEF")),      # unnamed
    )
    assert dsts == {"DSC_9.NEF": f"{TS}.NEF"}


def test_reserve_protected_named_holds_bare_slot():
    # `ts_Name.NEF` holds the BARE slot (slot semantics) → unnamed gets -0, NOT
    # bare `ts`, so it can never be named into a clash with `ts_Name.NEF` later.
    dsts = _plan(
        (TS, 0, Path(f"/p/{TS}_Elis.NEF")),   # protected (_Name → bare slot)
        (TS, 1, Path("/p/DSC_9.NEF")),        # unnamed
    )
    assert dsts == {"DSC_9.NEF": f"{TS}-0.NEF"}


def test_reserve_protected_burst_named_holds_index_leaves_bare_free():
    # `ts-1_Name.NEF` holds index 1, not the bare slot → unnamed takes bare `ts`.
    dsts = _plan(
        (TS, 0, Path(f"/p/{TS}-1_Elis.NEF")),  # protected (-N_Name → index 1)
        (TS, 1, Path("/p/DSC_9.NEF")),         # unnamed
    )
    assert dsts == {"DSC_9.NEF": f"{TS}.NEF"}


def test_reserve_photographer_named_holds_bare_slot():
    # `ts<xx>_Name.NEF` (photographer suffix) holds the BARE slot → unnamed -0.
    dsts = _plan(
        (TS, 0, Path(f"/p/{TS}en_Anna.NEF")),  # protected (photographer + _Name)
        (TS, 1, Path("/p/DSC_9.NEF")),         # unnamed
    )
    assert dsts == {"DSC_9.NEF": f"{TS}-0.NEF"}


def test_reserve_photographer_burst_named_holds_index():
    # `ts-N<xx>_Name.NEF` holds index N, not the bare slot → unnamed takes bare.
    dsts = _plan(
        (TS, 0, Path(f"/p/{TS}-1en_Anna.NEF")),  # protected (-N + photographer)
        (TS, 1, Path("/p/DSC_9.NEF")),           # unnamed
    )
    assert dsts == {"DSC_9.NEF": f"{TS}.NEF"}


def test_reserve_mixed_named_slots_push_unnamed_to_lowest_free():
    # Bare slot held by `ts_Elis`, index 1 held by `ts-1_Alva` → lowest free is 0.
    dsts = _plan(
        (TS, 0, Path(f"/p/{TS}_Elis.NEF")),     # bare slot
        (TS, 1, Path(f"/p/{TS}-1_Alva.NEF")),   # index 1
        (TS, 2, Path("/p/DSC_9.NEF")),          # unnamed
    )
    assert dsts == {"DSC_9.NEF": f"{TS}-0.NEF"}


def test_reserve_multiple_unnamed_skip_occupied_burst_slots():
    # Two protected burst files + two unnamed: unnamed get the next free indices.
    dsts = _plan(
        (TS, 0, Path(f"/p/{TS}-0.NEF")),   # protected
        (TS, 1, Path(f"/p/{TS}-1.NEF")),   # protected
        (TS, 2, Path("/p/DSC_A.NEF")),     # unnamed
        (TS, 3, Path("/p/DSC_B.NEF")),     # unnamed
    )
    assert dsts == {"DSC_A.NEF": f"{TS}-2.NEF", "DSC_B.NEF": f"{TS}-3.NEF"}


def test_reserve_bare_protected_with_two_unnamed():
    # Protected bare `ts.NEF` + two unnamed → both go to burst, distinct & free.
    dsts = _plan(
        (TS, 0, Path(f"/p/{TS}.NEF")),     # protected (bare)
        (TS, 1, Path("/p/DSC_A.NEF")),     # unnamed
        (TS, 2, Path("/p/DSC_B.NEF")),     # unnamed
    )
    assert dsts == {"DSC_A.NEF": f"{TS}-0.NEF", "DSC_B.NEF": f"{TS}-1.NEF"}


def test_include_named_true_ignores_reservation():
    # With include_named the protected file is renamed too (old behavior): both
    # share the timestamp, so both are burst-numbered, no reservation carve-out.
    renames = compute_renames([
        (TS, 0, Path(f"/p/{TS}-0.NEF")),
        (TS, 1, Path("/p/DSC_9.NEF")),
    ], include_named=True)
    dsts = {src.name: dst.name for src, dst, _ in renames}
    assert dsts == {"DSC_9.NEF": f"{TS}-1.NEF"}  # ts-0 is the existing file's no-op target


@pytest.mark.asyncio
async def test_preview_reports_protected_and_affected(tmp_path, monkeypatch):
    # One raw file + one already-named file, sharing no timestamp.
    (tmp_path / "raw.NEF").write_bytes(b"n")
    (tmp_path / "250101_120500_Elis.NEF").write_bytes(b"n")
    exif = {
        "raw.NEF": ("250101_120000", 0),
        "250101_120500_Elis.NEF": ("250101_120500", 0),
    }

    def fake(chunk):
        out = [(exif[p.name][0], exif[p.name][1], Path(p)) for p in chunk if p.name in exif]
        out.sort(key=lambda e: (e[0], e[1], str(e[2])))
        return out

    monkeypatch.setattr(rename_nef_service, "get_exif_data", fake)
    svc = RenameNefService()
    roots = [str(tmp_path)]

    # Default: named file protected, not in the plan.
    prev = await svc.preview(roots=roots)
    assert prev["to_rename"] == 1
    assert prev["already_named"] == 1
    assert prev["named_affected"] == 0
    assert {it["new_name"] for it in prev["items"]} == {"250101_120000.NEF"}

    # Opt in: named file is renamed too, and flagged as affected.
    prev2 = await svc.preview(roots=roots, include_named=True)
    assert prev2["to_rename"] == 2
    assert prev2["named_affected"] == 1
    assert "250101_120500.NEF" in {it["new_name"] for it in prev2["items"]}


@pytest.mark.asyncio
async def test_execute_leaves_named_file_untouched(tmp_path, monkeypatch):
    named = tmp_path / "250101_120500_Elis.NEF"
    named.write_bytes(b"n")
    (tmp_path / "raw.NEF").write_bytes(b"n")
    exif = {"raw.NEF": ("250101_120000", 0), "250101_120500_Elis.NEF": ("250101_120500", 0)}

    def fake(chunk):
        out = [(exif[p.name][0], exif[p.name][1], Path(p)) for p in chunk if p.name in exif]
        out.sort(key=lambda e: (e[0], e[1], str(e[2])))
        return out

    monkeypatch.setattr(rename_nef_service, "get_exif_data", fake)
    svc = RenameNefService()
    await svc.execute(roots=[str(tmp_path)])
    assert named.exists()  # protected file kept its name
    assert (tmp_path / "250101_120000.NEF").exists()


# ----- batch re-apply confirmed names (restore-names) -----------------------

import hashlib  # noqa: E402


def _sha1_bytes(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def _stub_db(svc, hash_to_name):
    """Point the service's DB reads at a fixed hash->name map, capture syncs."""
    synced = {}
    svc._read_hash_to_name = lambda: dict(hash_to_name)
    svc._sync_processed_names = lambda m: synced.update(m) or len(m)
    return synced


@pytest.mark.asyncio
async def test_restore_names_basic(tmp_path):
    (tmp_path / "260713_110145.NEF").write_bytes(b"A")
    (tmp_path / "260713_110145.xmp").write_bytes(b"sidecar")
    h = _sha1_bytes(b"A")

    svc = RenameNefService()
    _stub_db(svc, {h: "260713_110145_ArvidW,_Elis.NEF"})

    prev = await svc.restore_names_preview(roots=[str(tmp_path)])
    assert prev["to_restore"] == 1
    assert prev["items"][0]["new_name"] == "260713_110145_ArvidW,_Elis.NEF"

    res = await svc.restore_names_execute(roots=[str(tmp_path)])
    # Both the NEF and its .xmp sidecar are moved to the confirmed stem.
    assert {r["to"] for r in res["renamed"]} == {
        "260713_110145_ArvidW,_Elis.NEF", "260713_110145_ArvidW,_Elis.xmp",
    }
    assert (tmp_path / "260713_110145_ArvidW,_Elis.NEF").exists()
    assert (tmp_path / "260713_110145_ArvidW,_Elis.xmp").exists()


@pytest.mark.asyncio
async def test_restore_names_twin_disambiguation(tmp_path):
    # Two twins, distinct content, but the DB collapsed both onto one name.
    (tmp_path / "260713_112041.NEF").write_bytes(b"TWIN-A")
    (tmp_path / "260713_112041-1.NEF").write_bytes(b"TWIN-B")
    ha, hb = _sha1_bytes(b"TWIN-A"), _sha1_bytes(b"TWIN-B")

    svc = RenameNefService()
    synced = _stub_db(svc, {
        ha: "260713_112041_Elis.NEF",
        hb: "260713_112041_Elis.NEF",
    })

    res = await svc.restore_names_execute(roots=[str(tmp_path)])
    assert res["errors"] == []
    final = {r["to"] for r in res["renamed"]}
    # One keeps the plain name; the other is -N disambiguated. Never overwritten.
    assert final == {"260713_112041_Elis.NEF", "260713_112041-1_Elis.NEF"}
    assert (tmp_path / "260713_112041_Elis.NEF").exists()
    assert (tmp_path / "260713_112041-1_Elis.NEF").exists()
    # DB sync reflects the ACTUAL on-disk names per hash (both distinct).
    assert set(synced.values()) == final


@pytest.mark.asyncio
async def test_restore_names_already_correct_and_no_record(tmp_path):
    (tmp_path / "260713_110145_Elis.NEF").write_bytes(b"OK")   # already correct
    (tmp_path / "random.NEF").write_bytes(b"NR")               # no DB record
    h_ok = _sha1_bytes(b"OK")

    svc = RenameNefService()
    _stub_db(svc, {h_ok: "260713_110145_Elis.NEF"})

    prev = await svc.restore_names_preview(roots=[str(tmp_path)])
    assert prev["to_restore"] == 0
    assert prev["already_correct"] == 1
    assert prev["no_record"] == ["random.NEF"]
