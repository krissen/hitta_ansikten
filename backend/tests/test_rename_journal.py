"""Per-flow migration tests: each rename/move/trash flow writes journal rows
with the right ``tool``/``op`` via core.fs_ops.

The journal is redirected under ``tmp_path`` (monkeypatching ``core.db.BASE_DIR``,
mirroring ``test_culling_retention``'s dir redirection) so no real ~/.local
writes happen and the rows can be read back.
"""

import json

import pytest


@pytest.fixture
def journal(tmp_path, monkeypatch):
    import core.db as db
    monkeypatch.setattr(db, "BASE_DIR", tmp_path)
    return tmp_path / "rename_journal.jsonl"


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
    monkeypatch.setattr(svc, "preview_rename", lambda *a, **k: {
        "items": [{
            "original_path": str(img),
            "new_name": "250101_120000_Anna.NEF",
            "status": "ok",
            "sidecars": [str(tmp_path / "IMG_0001.xmp")],
        }],
        "name_map": {},
    })
    monkeypatch.setattr(svc, "_update_database_paths", lambda renamed: 0)

    result = svc.execute_rename([str(img)])

    assert len(result["renamed"]) == 1
    dst = tmp_path / "250101_120000_Anna.NEF"
    assert dst.exists()
    assert (tmp_path / "250101_120000_Anna.xmp").read_text() == "side"

    rows = _rows(journal)
    # Only the main file is journaled; the sidecar follows deterministically.
    assert len(rows) == 1
    assert rows[0]["tool"] == "rename"
    assert rows[0]["op"] == "rename"
    assert rows[0]["src"] == str(img)
    assert rows[0]["dst"] == str(dst)


def test_rename_service_toctou_guard_skips_occupied_target(journal, tmp_path, monkeypatch):
    from api.services.rename_service import RenameService

    img = tmp_path / "IMG_0001.NEF"
    img.write_bytes(b"raw")
    occupied = tmp_path / "250101_120000.NEF"
    occupied.write_bytes(b"KEEP")  # target already taken (preview was stale)

    svc = RenameService()
    monkeypatch.setattr(svc, "preview_rename", lambda *a, **k: {
        "items": [{
            "original_path": str(img),
            "new_name": "250101_120000.NEF",
            "status": "ok",
            "sidecars": [],
        }],
        "name_map": {},
    })
    monkeypatch.setattr(svc, "_update_database_paths", lambda renamed: 0)

    result = svc.execute_rename([str(img)])

    # Never overwrites: the occupied target survives, the source is untouched,
    # the collision is reported as an error, and nothing is journaled.
    assert result["renamed"] == []
    assert len(result["errors"]) == 1
    assert img.read_bytes() == b"raw"
    assert occupied.read_bytes() == b"KEEP"
    assert _rows(journal) == []
