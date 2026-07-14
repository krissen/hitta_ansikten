"""Tests for core.fs_ops: safe move primitives + the append-only journal."""

import json
from datetime import datetime

import pytest

from core import fs_ops


@pytest.fixture
def journal(tmp_path, monkeypatch):
    """Redirect the journal under tmp_path via core.db.BASE_DIR; return its path."""
    import core.db as db
    monkeypatch.setattr(db, "BASE_DIR", tmp_path)
    return tmp_path / "rename_journal.jsonl"


def _rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _find_sidecars(src, exts):
    """Minimal find_sidecars: same-stem files with one of the given extensions."""
    ext_lower = {e.lower() for e in exts}
    return [
        p for p in src.parent.iterdir()
        if p.is_file() and p.stem == src.stem and p.suffix.lstrip(".").lower() in ext_lower
    ]


# ----- journal ---------------------------------------------------------------

def test_record_writes_row(journal):
    fs_ops.record(op="rename", tool="test", batch_id="b1", src="/a.NEF", dst="/b.NEF")
    rows = _rows(journal)
    assert len(rows) == 1
    row = rows[0]
    assert row["op"] == "rename"
    assert row["tool"] == "test"
    assert row["batch_id"] == "b1"
    assert row["src"] == "/a.NEF"
    assert row["dst"] == "/b.NEF"
    assert "ts" in row


def test_record_ts_is_tz_aware_utc(journal):
    fs_ops.record(op="rename", tool="t", batch_id="b", src="/1", dst="/2")
    ts = _rows(journal)[0]["ts"]
    parsed = datetime.fromisoformat(ts)
    assert parsed.tzinfo is not None  # tz-aware, not naive
    assert parsed.utcoffset().total_seconds() == 0  # UTC
    assert ts.endswith("+00:00")


def test_record_is_append_only(journal):
    fs_ops.record(op="rename", tool="t", batch_id="b", src="/1", dst="/2")
    fs_ops.record(op="move", tool="t", batch_id="b", src="/3", dst="/4")
    rows = _rows(journal)
    assert [r["op"] for r in rows] == ["rename", "move"]


def test_record_never_raises_on_error(monkeypatch):
    # An unwritable journal path must not propagate — the fs op it describes has
    # already happened and must not be undone by a logging failure.
    monkeypatch.setattr(fs_ops, "journal_path", lambda: (_ for _ in ()).throw(OSError("boom")))
    fs_ops.record(op="rename", tool="t", batch_id="b", src="/1", dst="/2")  # no raise


def test_record_absolutises_relative_paths(journal, tmp_path, monkeypatch):
    # A relative path (as the CLI passes from its cwd) is stored absolute so undo
    # can replay it from any directory.
    monkeypatch.chdir(tmp_path)
    fs_ops.record(op="rename", tool="rename-nef-cli", batch_id="b", src="a.NEF", dst="b.NEF")
    row = _rows(journal)[0]
    assert row["src"] == str(tmp_path / "a.NEF")
    assert row["dst"] == str(tmp_path / "b.NEF")


def test_record_does_not_resolve_symlinks(journal, tmp_path):
    # os.path.abspath must NOT follow symlinks (unlike Path.resolve): the project
    # uses symlinks actively and the journal should record the user's path.
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "link"
    link.symlink_to(real)
    fs_ops.record(op="rename", tool="t", batch_id="b",
                  src=link / "a.NEF", dst=link / "b.NEF")
    row = _rows(journal)[0]
    # The symlinked path is preserved verbatim, not rewritten to .../real/...
    assert row["src"] == str(link / "a.NEF")
    assert "real" not in row["src"]


# ----- rename_with_sidecars (atomic unit) ------------------------------------

def test_rename_with_sidecars_moves_and_journals(journal, tmp_path):
    img = tmp_path / "a.jpg"
    img.write_bytes(b"img")
    sc = tmp_path / "a.xmp"
    sc.write_text("side")
    dst = tmp_path / "b.jpg"

    moved = fs_ops.rename_with_sidecars(
        img, dst, [(sc, tmp_path / "b.xmp")], tool="culling")

    assert (img, dst) in moved
    assert dst.exists() and not img.exists()
    assert (tmp_path / "b.xmp").read_text() == "side"
    # Only the main file is journaled.
    rows = _rows(journal)
    assert len(rows) == 1
    assert rows[0]["src"] == str(img) and rows[0]["dst"] == str(dst)


def test_rename_with_sidecars_never_overwrites(journal, tmp_path):
    a = tmp_path / "a.jpg"
    a.write_bytes(b"a")
    b = tmp_path / "b.jpg"
    b.write_bytes(b"b")

    with pytest.raises(FileExistsError):
        fs_ops.rename_with_sidecars(a, b, tool="culling")

    assert a.read_bytes() == b"a"
    assert b.read_bytes() == b"b"
    assert not journal.exists()  # nothing moved → nothing journaled


def test_rename_with_sidecars_rolls_back_on_sidecar_failure(journal, tmp_path, monkeypatch):
    img = tmp_path / "a.jpg"
    img.write_bytes(b"a")
    sc = tmp_path / "a.xmp"
    sc.write_text("side")

    real = fs_ops.safe_swap_rename
    calls = {"n": 0}

    def flaky(src, dst):
        calls["n"] += 1
        if calls["n"] == 2:  # fail on the sidecar move (main already moved)
            raise OSError("locked")
        return real(src, dst)

    monkeypatch.setattr(fs_ops, "safe_swap_rename", flaky)

    with pytest.raises(OSError):
        fs_ops.rename_with_sidecars(
            img, tmp_path / "b.jpg", [(sc, tmp_path / "b.xmp")], tool="culling")

    # Rolled back: originals restored, no partial b.* and nothing journaled.
    assert img.exists()
    assert sc.read_text() == "side"
    assert not (tmp_path / "b.jpg").exists()
    assert not journal.exists()


def test_rename_with_sidecars_case_only(journal, tmp_path):
    img = tmp_path / "anna.jpg"
    img.write_bytes(b"a")
    fs_ops.rename_with_sidecars(img, tmp_path / "Anna.jpg", tool="culling")
    assert (tmp_path / "Anna.jpg").exists()


# ----- two_pass_rename -------------------------------------------------------

def test_two_pass_renames_and_journals_mains(journal, tmp_path):
    a = tmp_path / "a.NEF"
    a.write_bytes(b"A")
    b = tmp_path / "b.NEF"
    b.write_bytes(b"B")

    res = fs_ops.two_pass_rename(
        [(a, tmp_path / "1.NEF"), (b, tmp_path / "2.NEF")], tool="rename-nef")

    assert {r["to"] for r in res["renamed"]} == {"1.NEF", "2.NEF"}
    assert res["skipped"] == [] and res["errors"] == []
    assert (tmp_path / "1.NEF").read_bytes() == b"A"
    rows = _rows(journal)
    assert {r["dst"] for r in rows} == {str(tmp_path / "1.NEF"), str(tmp_path / "2.NEF")}
    assert all(r["tool"] == "rename-nef" for r in rows)


def test_two_pass_preserves_stale_temp_from_crashed_batch(journal, tmp_path):
    # A leftover temp from an earlier interrupted batch must survive: the per-batch
    # uuid keeps this run's temp names distinct, so pass 1 never renames onto it.
    a = tmp_path / "a.NEF"
    a.write_bytes(b"A")
    stale = tmp_path / ".rename_tmp_12345_0.NEF"  # plausible leftover name
    stale.write_bytes(b"STALE")

    res = fs_ops.two_pass_rename([(a, tmp_path / "1.NEF")], tool="rename-nef")

    assert res["errors"] == []
    assert (tmp_path / "1.NEF").read_bytes() == b"A"
    assert stale.read_bytes() == b"STALE"  # untouched


def test_two_pass_refuses_occupied_temp_name(journal, tmp_path, monkeypatch):
    # Force the (astronomically unlikely) case where the generated temp name
    # already exists: the guard must skip the file with an error, not clobber it.
    monkeypatch.setattr(fs_ops.os, "getpid", lambda: 999)

    class _FixedUUID:
        hex = "deadbeef"

    monkeypatch.setattr(fs_ops.uuid, "uuid4", lambda: _FixedUUID())

    a = tmp_path / "a.NEF"
    a.write_bytes(b"A")
    # The exact temp name two_pass_rename will generate for the first main entry.
    occupied = tmp_path / ".rename_tmp_999_deadbeef_0.NEF"
    occupied.write_bytes(b"OCCUPIED")

    res = fs_ops.two_pass_rename([(a, tmp_path / "1.NEF")], tool="rename-nef")

    assert res["renamed"] == []
    assert len(res["errors"]) == 1
    assert "temp-namn upptaget" in res["errors"][0]["error"]
    assert a.read_bytes() == b"A"  # source untouched
    assert occupied.read_bytes() == b"OCCUPIED"  # stale temp untouched
    assert not journal.exists()


def test_two_pass_swaps_via_temp(journal, tmp_path):
    # a -> b and b -> c: b is both a source and (nothing's) target here, but the
    # temp indirection is what lets cyclic/shifting batches resolve. Verify a
    # straightforward shift where dst equals another source's name.
    a = tmp_path / "a.NEF"
    a.write_bytes(b"A")
    b = tmp_path / "b.NEF"
    b.write_bytes(b"B")

    res = fs_ops.two_pass_rename(
        [(a, tmp_path / "b.NEF"), (b, tmp_path / "c.NEF")], tool="rename-nef")

    assert res["errors"] == []
    assert (tmp_path / "b.NEF").read_bytes() == b"A"
    assert (tmp_path / "c.NEF").read_bytes() == b"B"


def test_two_pass_never_overwrites_existing_target(journal, tmp_path):
    a = tmp_path / "a.NEF"
    a.write_bytes(b"A")
    occupied = tmp_path / "b.NEF"
    occupied.write_bytes(b"KEEP")

    res = fs_ops.two_pass_rename([(a, occupied)], tool="rename-nef")

    # Skipped, original restored, target untouched, nothing journaled.
    assert res["renamed"] == []
    assert len(res["skipped"]) == 1
    assert a.read_bytes() == b"A"
    assert occupied.read_bytes() == b"KEEP"
    assert not journal.exists()


def test_two_pass_carries_sidecars(journal, tmp_path):
    a = tmp_path / "a.NEF"
    a.write_bytes(b"A")
    (tmp_path / "a.xmp").write_text("side")

    res = fs_ops.two_pass_rename(
        [(a, tmp_path / "1.NEF")], tool="rename-nef",
        sidecar_exts=["xmp"], find_sidecars=_find_sidecars)

    assert {r["to"] for r in res["renamed"]} == {"1.NEF", "1.xmp"}
    assert (tmp_path / "1.xmp").read_text() == "side"
    # Sidecar is not journaled — only the main file.
    rows = _rows(journal)
    assert [r["dst"] for r in rows] == [str(tmp_path / "1.NEF")]


def test_two_pass_sidecar_restored_when_main_target_taken(journal, tmp_path):
    # Main dst occupied, sidecar dst free: the sidecar must NOT be placed at the
    # new stem — it follows the main and is restored alongside it.
    a = tmp_path / "a.NEF"
    a.write_bytes(b"A")
    (tmp_path / "a.xmp").write_text("side")
    occupied = tmp_path / "1.NEF"
    occupied.write_bytes(b"KEEP")  # main target taken; 1.xmp is free

    res = fs_ops.two_pass_rename(
        [(a, tmp_path / "1.NEF")], tool="rename-nef",
        sidecar_exts=["xmp"], find_sidecars=_find_sidecars)

    assert res["renamed"] == []
    assert len(res["skipped"]) == 1
    # Both main and sidecar restored to their originals; no orphan at 1.xmp.
    assert a.read_bytes() == b"A"
    assert (tmp_path / "a.xmp").read_text() == "side"
    assert not (tmp_path / "1.xmp").exists()
    assert occupied.read_bytes() == b"KEEP"
    assert not journal.exists()


def test_two_pass_sidecar_target_taken_keeps_main(journal, tmp_path):
    # Sidecar dst occupied, main dst free: the main is renamed + journaled and
    # only the sidecar is skipped (a sidecar collision never fells its main).
    a = tmp_path / "a.NEF"
    a.write_bytes(b"A")
    (tmp_path / "a.xmp").write_text("side")
    occupied = tmp_path / "1.xmp"
    occupied.write_text("KEEP")  # sidecar target taken; 1.NEF is free

    res = fs_ops.two_pass_rename(
        [(a, tmp_path / "1.NEF")], tool="rename-nef",
        sidecar_exts=["xmp"], find_sidecars=_find_sidecars)

    assert {r["to"] for r in res["renamed"]} == {"1.NEF"}
    assert (tmp_path / "1.NEF").read_bytes() == b"A"
    # Sidecar skipped and restored; the occupying 1.xmp untouched.
    assert len(res["skipped"]) == 1
    assert (tmp_path / "a.xmp").read_text() == "side"
    assert occupied.read_text() == "KEEP"
    # Only the main file is journaled.
    rows = _rows(journal)
    assert [r["dst"] for r in rows] == [str(tmp_path / "1.NEF")]


# ----- import target resolution ----------------------------------------------

def test_resolve_import_target_free_name(tmp_path):
    src = tmp_path / "DSC0001.NEF"
    src.write_bytes(b"raw")
    dest = tmp_path / "dest"
    dest.mkdir()
    assert fs_ops.resolve_import_target(dest, "DSC0001.NEF", src) == dest / "DSC0001.NEF"


def test_resolve_import_target_skips_byte_identical(tmp_path):
    src = tmp_path / "DSC0001.NEF"
    src.write_bytes(b"raw")
    dest = tmp_path / "dest"
    dest.mkdir()
    (dest / "DSC0001.NEF").write_bytes(b"raw")  # identical copy present
    assert fs_ops.resolve_import_target(dest, "DSC0001.NEF", src) is None


def test_resolve_import_target_disambiguates_distinct(tmp_path):
    src = tmp_path / "DSC0001.NEF"
    src.write_bytes(b"raw-new")
    dest = tmp_path / "dest"
    dest.mkdir()
    (dest / "DSC0001.NEF").write_bytes(b"raw-old")  # different content, same name
    assert fs_ops.resolve_import_target(dest, "DSC0001.NEF", src) == dest / "DSC0001-1.NEF"


def test_resolve_import_target_skips_identical_variant(tmp_path):
    src = tmp_path / "DSC0001.NEF"
    src.write_bytes(b"raw-new")
    dest = tmp_path / "dest"
    dest.mkdir()
    (dest / "DSC0001.NEF").write_bytes(b"raw-old")
    (dest / "DSC0001-1.NEF").write_bytes(b"raw-new")  # identical to src at a variant
    assert fs_ops.resolve_import_target(dest, "DSC0001.NEF", src) is None
