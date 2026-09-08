"""Per-flow migration tests: each rename/move/trash flow writes journal rows
with the right ``tool``/``op`` via core.fs_ops.

The journal is redirected under ``tmp_path`` for *every* test by the autouse
``_redirect_rename_journal`` fixture in ``conftest.py`` (it patches
``fs_ops.journal_path``), so no test can touch the developer's real journal. The
``journal`` fixture below just names that same path for reading the rows back.
"""

import json
from pathlib import Path

import pytest


@pytest.fixture
def journal(tmp_path):
    # Same path the autouse conftest fixture redirects fs_ops.journal_path to.
    return tmp_path / "rename_journal.jsonl"


def test_autouse_fixture_keeps_journal_off_real_data_dir(tmp_path, monkeypatch):
    # A migrated flow run WITHOUT an explicit journal-redirect fixture must not
    # write under the XDG data dir — the autouse conftest fixture guarantees the
    # row lands under the test's tmp_path instead.
    import api.services.culling_service as cs
    import core.fs_ops as fs_ops
    from api.services.culling_service import CullingService

    fake_home = tmp_path / "xdg"
    monkeypatch.setenv("XDG_DATA_HOME", str(fake_home))
    monkeypatch.setenv("HOME", str(fake_home))

    trash = tmp_path / "trash"
    trash.mkdir()
    monkeypatch.setattr(cs, "TRASH_DIR", trash)
    monkeypatch.setattr(cs, "MANIFEST_PATH", trash / "manifest.jsonl")

    img = tmp_path / "pic.jpg"
    img.write_bytes(b"jpg")
    CullingService().trash([str(img)])

    # The row went to the redirected journal, and the XDG-derived faceid dir is
    # untouched (never even created).
    assert fs_ops.journal_path() == tmp_path / "rename_journal.jsonl"
    assert _rows(fs_ops.journal_path())  # a trash row was written there
    assert not (fake_home / "faceid" / "rename_journal.jsonl").exists()


def _rows(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


# ----- rename_service.execute_rename -----------------------------------------


def test_rename_service_journals_moves(journal, tmp_path, monkeypatch):
    from api.services.rename_service import RenameService

    img = tmp_path / "IMG_0001.NEF"
    img.write_bytes(b"raw")
    (tmp_path / "IMG_0001.xmp").write_text("side")

    svc = RenameService()
    # Canned preview so the test drives only the execute/move + journal path.
    monkeypatch.setattr(
        svc,
        "preview_rename",
        lambda *a, **k: {
            "items": [
                {
                    "original_path": str(img),
                    "new_name": "250101_120000_Anna.NEF",
                    "status": "ok",
                    "sidecars": [str(tmp_path / "IMG_0001.xmp")],
                }
            ],
            "name_map": {},
        },
    )
    monkeypatch.setattr(svc, "_update_database_paths", lambda renamed: 0)

    result = svc.execute_rename([str(img)])

    assert len(result["renamed"]) == 1
    dst = tmp_path / "250101_120000_Anna.NEF"
    assert dst.exists()
    assert (tmp_path / "250101_120000_Anna.xmp").read_text() == "side"

    rows = _rows(journal)
    # One row for the main, listing the sidecar that moved with it.
    assert len(rows) == 1
    assert rows[0]["tool"] == "rename"
    assert rows[0]["op"] == "rename"
    assert rows[0]["src"] == str(img)
    assert rows[0]["dst"] == str(dst)
    assert rows[0]["sidecars"] == [
        {"src": str(tmp_path / "IMG_0001.xmp"), "dst": str(tmp_path / "250101_120000_Anna.xmp")}
    ]


def test_rename_service_toctou_guard_skips_occupied_target(journal, tmp_path, monkeypatch):
    from api.services.rename_service import RenameService

    img = tmp_path / "IMG_0001.NEF"
    img.write_bytes(b"raw")
    occupied = tmp_path / "250101_120000.NEF"
    occupied.write_bytes(b"KEEP")  # target already taken (preview was stale)

    svc = RenameService()
    monkeypatch.setattr(
        svc,
        "preview_rename",
        lambda *a, **k: {
            "items": [
                {
                    "original_path": str(img),
                    "new_name": "250101_120000.NEF",
                    "status": "ok",
                    "sidecars": [],
                }
            ],
            "name_map": {},
        },
    )
    monkeypatch.setattr(svc, "_update_database_paths", lambda renamed: 0)

    result = svc.execute_rename([str(img)])

    # Never overwrites: the occupied target survives, the source is untouched,
    # the collision is reported as an error, and nothing is journaled.
    assert result["renamed"] == []
    assert len(result["errors"]) == 1
    assert img.read_bytes() == b"raw"
    assert occupied.read_bytes() == b"KEEP"
    assert _rows(journal) == []


# ----- rename_nef_service.execute --------------------------------------------


@pytest.mark.asyncio
async def test_rename_nef_execute_journals(journal, tmp_path, monkeypatch):
    from api.services import rename_nef_service
    from api.services.rename_nef_service import RenameNefService

    (tmp_path / "a.NEF").write_bytes(b"A")
    exif = {"a.NEF": ("250101_120000", 0)}

    def fake(chunk):
        out = [(exif[p.name][0], exif[p.name][1], p) for p in chunk if p.name in exif]
        out.sort(key=lambda e: (e[0], e[1], str(e[2])))
        return out

    monkeypatch.setattr(rename_nef_service, "get_exif_data", fake)
    svc = RenameNefService()
    await svc.execute(roots=[str(tmp_path)])

    rows = _rows(journal)
    assert len(rows) == 1
    assert rows[0]["tool"] == "rename-nef"
    assert rows[0]["op"] == "rename"
    assert rows[0]["dst"] == str(tmp_path / "250101_120000.NEF")


# ----- rename_nef_service.restore_names_execute ------------------------------


@pytest.mark.asyncio
async def test_restore_names_execute_journals(journal, tmp_path):
    import hashlib

    from api.services.rename_nef_service import RenameNefService

    (tmp_path / "260713_110145.NEF").write_bytes(b"A")
    h = hashlib.sha1(b"A").hexdigest()

    svc = RenameNefService()
    svc._read_hash_to_name = lambda: {h: "260713_110145_Elis.NEF"}
    svc._sync_processed_names = lambda m: len(m)

    await svc.restore_names_execute(roots=[str(tmp_path)])

    rows = _rows(journal)
    assert len(rows) == 1
    assert rows[0]["tool"] == "restore-names"
    assert rows[0]["op"] == "rename"
    assert rows[0]["dst"] == str(tmp_path / "260713_110145_Elis.NEF")


# ----- import_service.run_import ---------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("mode,expected_op", [("move", "move"), ("copy", "copy")])
async def test_import_journals_transfers(journal, tmp_path, monkeypatch, mode, expected_op):
    from api.services import import_service
    from api.services.import_service import ImportService

    async def _noop(event, payload):
        pass

    monkeypatch.setattr(import_service, "broadcast_event", _noop)

    src = tmp_path / "card"
    src.mkdir()
    (src / "DSC0001.NEF").write_bytes(b"raw-1")
    (src / "DSC0002.NEF").write_bytes(b"raw-2")
    dest = tmp_path / "dest"

    await ImportService().run_import(
        volume_mount=str(src), destination=str(dest), mode=mode, eject=False
    )

    rows = _rows(journal)
    assert len(rows) == 2
    assert all(r["tool"] == "import" for r in rows)
    assert all(r["op"] == expected_op for r in rows)
    assert {Path(r["dst"]).name for r in rows} == {"DSC0001.NEF", "DSC0002.NEF"}
    # No sidecars in this batch → every row carries an empty list.
    assert all(r["sidecars"] == [] for r in rows)


@pytest.mark.asyncio
async def test_import_journals_transferred_sidecar(journal, tmp_path, monkeypatch):
    from api.services import import_service
    from api.services.import_service import ImportService

    async def _noop(event, payload):
        pass

    monkeypatch.setattr(import_service, "broadcast_event", _noop)

    src = tmp_path / "card"
    src.mkdir()
    (src / "DSC0001.NEF").write_bytes(b"raw-1")
    (src / "DSC0001.xmp").write_text("side")  # sidecar rides along
    dest = tmp_path / "dest"

    await ImportService().run_import(
        volume_mount=str(src), destination=str(dest), mode="copy", eject=False
    )

    rows = _rows(journal)
    assert len(rows) == 1
    assert rows[0]["dst"] == str(dest / "DSC0001.NEF")
    # The row lists the sidecar that actually transferred.
    assert rows[0]["sidecars"] == [
        {"src": str(src / "DSC0001.xmp"), "dst": str(dest / "DSC0001.xmp")}
    ]


# ----- culling_service: rename / trash / restore -----------------------------


def test_culling_rename_journals(journal, tmp_path):
    from api.services.culling_service import CullingService

    img = tmp_path / "260626_191003_Milian,_Valter.jpg"
    img.write_bytes(b"jpg")

    sidecar = tmp_path / "260626_191003_Milian,_Valter.xmp"
    sidecar.write_text("side")

    CullingService().rename(str(img), "260626_191003_Milian.jpg")

    rows = _rows(journal)
    assert len(rows) == 1
    assert rows[0]["tool"] == "culling"
    assert rows[0]["op"] == "rename"
    assert rows[0]["src"] == str(img)
    assert rows[0]["dst"] == str(tmp_path / "260626_191003_Milian.jpg")
    # The renamed sidecar rides in the row.
    assert rows[0]["sidecars"] == [
        {"src": str(sidecar), "dst": str(tmp_path / "260626_191003_Milian.xmp")}
    ]


def _culling_svc(cs, CullingService, tmp_path, monkeypatch):
    trash = tmp_path / "trash"
    trash.mkdir()
    monkeypatch.setattr(cs, "TRASH_DIR", trash)
    monkeypatch.setattr(cs, "MANIFEST_PATH", trash / "manifest.jsonl")
    return CullingService(), trash


def test_culling_trash_and_restore_journal(journal, tmp_path, monkeypatch):
    import api.services.culling_service as cs
    from api.services.culling_service import CullingService

    svc, _trash = _culling_svc(cs, CullingService, tmp_path, monkeypatch)
    img = tmp_path / "pic.jpg"
    img.write_bytes(b"jpg")

    tid = svc.trash([str(img)])["trashed"][0]["id"]
    svc.restore([tid])

    rows = _rows(journal)
    ops = [r["op"] for r in rows]
    assert ops == ["trash", "restore"]
    assert all(r["tool"] == "culling" for r in rows)
    # Trash: original -> trash store. Restore: trash store -> back to original.
    assert rows[0]["src"] == str(img)
    assert rows[1]["dst"] == str(img)
    # No sidecar → empty list on both rows.
    assert rows[0]["sidecars"] == [] and rows[1]["sidecars"] == []


def test_culling_trash_restore_journal_with_sidecar(journal, tmp_path, monkeypatch):
    import api.services.culling_service as cs
    from api.services.culling_service import CullingService

    svc, trash = _culling_svc(cs, CullingService, tmp_path, monkeypatch)
    img = tmp_path / "260626_191003_Milian.jpg"
    img.write_bytes(b"jpg")
    (tmp_path / "260626_191003_Milian.xmp").write_text("side")

    tid = svc.trash([str(img)])["trashed"][0]["id"]
    trash_rows = _rows(journal)
    # Trash row lists the sidecar moved into the trash store.
    assert len(trash_rows[0]["sidecars"]) == 1
    assert trash_rows[0]["sidecars"][0]["src"] == str(tmp_path / "260626_191003_Milian.xmp")
    assert trash_rows[0]["sidecars"][0]["dst"].startswith(str(trash))

    svc.restore([tid])
    restore_row = _rows(journal)[1]
    # Restore row lists the sidecar coming back out to its original name.
    assert len(restore_row["sidecars"]) == 1
    assert restore_row["sidecars"][0]["dst"] == str(tmp_path / "260626_191003_Milian.xmp")
    assert restore_row["sidecars"][0]["src"].startswith(str(trash))


def test_culling_restore_journals_main_even_when_sidecar_fails(journal, tmp_path, monkeypatch):
    # Mirror of the "don't overpromise" invariant: a sidecar that can't come back
    # AFTER the main image was already restored must not swallow the row — the
    # completed main restore is journaled with only the sidecars that landed.
    import api.services.culling_service as cs
    from api.services.culling_service import CullingService

    svc, trash = _culling_svc(cs, CullingService, tmp_path, monkeypatch)
    img = tmp_path / "260626_191003_Milian.jpg"
    img.write_bytes(b"jpg")
    (tmp_path / "260626_191003_Milian.xmp").write_text("side")

    tid = svc.trash([str(img)])["trashed"][0]["id"]
    # Lose the stored sidecar so its restore raises (main image still comes back).
    sc_stored = svc._load_manifest()[0]["sidecars"][0]["stored_name"]
    (trash / sc_stored).unlink()

    result = svc.restore([tid])

    # Main restored + reported. The failed sidecar's stored file is GONE (we
    # deleted it), so there is nothing left to keep → the entry is fully dropped
    # and no partial leftover is reported.
    assert result["restored"] and not result["errors"]
    assert result["partial"] == []
    assert img.exists()
    assert svc._load_manifest() == []
    # Row carries the main delta with an empty sidecars list (none landed).
    restore_rows = [r for r in _rows(journal) if r["op"] == "restore"]
    assert len(restore_rows) == 1
    assert restore_rows[0]["dst"] == str(img)
    assert restore_rows[0]["sidecars"] == []


def test_culling_restore_keeps_orphaned_sidecar_as_recoverable_entry(
    journal, tmp_path, monkeypatch
):
    # P3: when the main image restores but a sidecar restore fails while its
    # stored file REMAINS in the trash, a sidecar-only leftover survives as a
    # NEW trash entry (own id) that is reported in `partial`, so the UI keeps it
    # visible; it is separately restorable + purgeable.
    import api.services.culling_service as cs
    from api.services.culling_service import CullingService

    svc, trash = _culling_svc(cs, CullingService, tmp_path, monkeypatch)
    img = tmp_path / "260626_191003_Milian.jpg"
    img.write_bytes(b"jpg")
    (tmp_path / "260626_191003_Milian.xmp").write_text("side")

    tid = svc.trash([str(img)])["trashed"][0]["id"]
    sc_stored = svc._load_manifest()[0]["sidecars"][0]["stored_name"]

    # Sidecar restore fails but its stored file stays in the trash (locked, not
    # missing) — patch _restore_one to raise only for the sidecar.
    real = svc._restore_one

    def flaky(original_path, stored_name):
        if stored_name == sc_stored:
            raise OSError("locked")
        return real(original_path, stored_name)

    monkeypatch.setattr(svc, "_restore_one", flaky)

    result = svc.restore([tid])

    assert img.exists()
    # The original id is reported restored; the leftover is reported in `partial`
    # under a NEW id (so a UI that drops restored ids doesn't hide it).
    assert [r["id"] for r in result["restored"]] == [tid]
    assert not result["errors"]
    assert len(result["partial"]) == 1
    leftover = result["partial"][0]
    new_id = leftover["id"]
    assert new_id != tid
    assert leftover["stored_name"] == sc_stored
    assert leftover["basename"] == "260626_191003_Milian.xmp"
    assert leftover["sidecars"] == []

    # Manifest holds exactly the leftover (new id), stored file intact + listed.
    left = svc._load_manifest()
    assert len(left) == 1
    assert left[0]["id"] == new_id
    assert (trash / sc_stored).exists()
    assert any(it["id"] == new_id for it in svc.list_trash()["items"])

    # And it is purgeable under its new id.
    svc.empty([new_id])
    assert not (trash / sc_stored).exists()
    assert svc._load_manifest() == []
