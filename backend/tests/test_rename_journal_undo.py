"""Undo of a rename batch: round-trip, partial undo, refusal, redo.

The journal is redirected under ``tmp_path`` by the autouse
``_redirect_rename_journal`` fixture in ``conftest.py``, so these tests never
touch the developer's real journal. Each test drives a *real* fs_ops move to
populate the journal, then reverses it through the undo service / helpers.
"""

import json
from pathlib import Path

import pytest

from core import fs_ops


@pytest.fixture
def journal(tmp_path):
    return tmp_path / "rename_journal.jsonl"


def _rows(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


# ----- fs_ops: read / group --------------------------------------------------

def test_group_batches_orders_and_flags_undoable(journal, tmp_path):
    # Two distinct batches: a rename (undoable) and an import copy (not).
    fs_ops.record(op="rename", tool="rename-nef", batch_id="b1",
                  src=tmp_path / "a", dst=tmp_path / "b")
    fs_ops.record(op="copy", tool="import", batch_id="b2",
                  src=tmp_path / "c", dst=tmp_path / "d")

    batches = fs_ops.group_batches(fs_ops.read_rows())
    assert [b["batch_id"] for b in batches] == ["b1", "b2"]  # chronological
    assert batches[0]["undoable"] is True and batches[0]["op"] == "rename"
    assert batches[1]["undoable"] is False and batches[1]["op"] == "copy"
    assert batches[0]["count"] == 1


def test_list_batches_undoable_filter_before_limit(journal, tmp_path):
    # An older undoable rename followed by many newer non-undoable imports must
    # not be buried past the limit: undoable_only filters BEFORE the cap.
    from api.services.undo_service import UndoService

    fs_ops.record(op="rename", tool="rename-nef", batch_id="old-rename",
                  src=tmp_path / "a", dst=tmp_path / "b")
    for i in range(5):
        fs_ops.record(op="copy", tool="import", batch_id=f"imp{i}",
                      src=tmp_path / f"s{i}", dst=tmp_path / f"d{i}")

    svc = UndoService()
    # Default (undoable_only=True) with a small limit still surfaces the rename.
    default = svc.list_batches(limit=2)
    assert [b["batch_id"] for b in default["batches"]] == ["old-rename"]
    # Listing everything is still possible, newest first, respecting the limit.
    all_batches = svc.list_batches(limit=2, undoable_only=False)
    assert [b["batch_id"] for b in all_batches["batches"]] == ["imp4", "imp3"]


def test_api_batches_undoable_only_param(journal, tmp_path):
    from fastapi.testclient import TestClient

    from api.server import app

    fs_ops.record(op="rename", tool="rename-nef", batch_id="r1",
                  src=tmp_path / "a", dst=tmp_path / "b")
    fs_ops.record(op="copy", tool="import", batch_id="c1",
                  src=tmp_path / "c", dst=tmp_path / "d")

    client = TestClient(app)
    default_ids = [b["batch_id"] for b in client.get("/api/v1/rename-journal/batches").json()["batches"]]
    assert default_ids == ["r1"]  # copy filtered out by default
    all_ids = {b["batch_id"] for b in client.get(
        "/api/v1/rename-journal/batches?undoable_only=false").json()["batches"]}
    assert all_ids == {"r1", "c1"}


# ----- round-trip: rename then undo ------------------------------------------

def test_undo_round_trip_restores_names_and_sidecars(journal, tmp_path, monkeypatch):
    from api.services.rename_service import RenameService

    img = tmp_path / "IMG_0001.NEF"
    img.write_bytes(b"raw")
    (tmp_path / "IMG_0001.xmp").write_text("side")

    svc = RenameService()
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
    svc.execute_rename([str(img)])

    dst = tmp_path / "250101_120000_Anna.NEF"
    assert dst.exists() and not img.exists()

    batch = fs_ops.group_batches(fs_ops.read_rows())[0]
    result = fs_ops.revert_batch(batch["rows"])

    # Original name + sidecar are back; the renamed target is gone.
    assert img.read_bytes() == b"raw"
    assert (tmp_path / "IMG_0001.xmp").read_text() == "side"
    assert not dst.exists()
    assert not (tmp_path / "250101_120000_Anna.xmp").exists()
    assert result["reverted"] == 2 and result["skipped"] == 0 and result["errors"] == 0
    assert {"original": str(dst), "new": str(img)} in result["reverted_mains"]


def test_undo_burst_chain_resolves_without_collision(journal, tmp_path):
    # A chain where one file's original name is another's current name — the
    # two-pass mover must resolve it. Simulate a burst renumber 1->2, 2->3.
    (tmp_path / "2.NEF").write_bytes(b"one")   # was "1", renamed to "2"
    (tmp_path / "3.NEF").write_bytes(b"two")   # was "2", renamed to "3"
    fs_ops.record(op="rename", tool="rename-nef", batch_id="chain",
                  src=tmp_path / "1.NEF", dst=tmp_path / "2.NEF")
    fs_ops.record(op="rename", tool="rename-nef", batch_id="chain",
                  src=tmp_path / "2.NEF", dst=tmp_path / "3.NEF")

    batch = fs_ops.group_batches(fs_ops.read_rows())[0]
    result = fs_ops.revert_batch(batch["rows"])

    assert result["reverted"] == 2 and result["errors"] == 0
    assert (tmp_path / "1.NEF").read_bytes() == b"one"
    assert (tmp_path / "2.NEF").read_bytes() == b"two"
    assert not (tmp_path / "3.NEF").exists()


# ----- partial undo: one file moved away -------------------------------------

def test_partial_undo_skips_missing_and_reverts_rest(journal, tmp_path):
    (tmp_path / "b1.NEF").write_bytes(b"one")
    (tmp_path / "b2.NEF").write_bytes(b"two")
    fs_ops.record(op="rename", tool="rename", batch_id="p",
                  src=tmp_path / "a1.NEF", dst=tmp_path / "b1.NEF")
    fs_ops.record(op="rename", tool="rename", batch_id="p",
                  src=tmp_path / "a2.NEF", dst=tmp_path / "b2.NEF")

    # One renamed file was moved away/deleted since the batch.
    (tmp_path / "b2.NEF").unlink()

    batch = fs_ops.group_batches(fs_ops.read_rows())[0]
    result = fs_ops.revert_batch(batch["rows"])

    assert result["reverted"] == 1 and result["skipped"] == 1
    assert (tmp_path / "a1.NEF").read_bytes() == b"one"
    assert not (tmp_path / "a2.NEF").exists()
    statuses = {r["path"]: r["status"] for r in result["results"]}
    assert statuses[str(tmp_path / "b1.NEF")] == "reverted"
    assert statuses[str(tmp_path / "b2.NEF")] == "skipped"


def test_undo_never_overwrites_occupied_original(journal, tmp_path):
    (tmp_path / "b.NEF").write_bytes(b"renamed")
    (tmp_path / "a.NEF").write_bytes(b"KEEP")  # original path now occupied
    fs_ops.record(op="rename", tool="rename", batch_id="o",
                  src=tmp_path / "a.NEF", dst=tmp_path / "b.NEF")

    batch = fs_ops.group_batches(fs_ops.read_rows())[0]
    result = fs_ops.revert_batch(batch["rows"])

    # The occupied original survives; the batch output stays put; reported skipped.
    assert (tmp_path / "a.NEF").read_bytes() == b"KEEP"
    assert (tmp_path / "b.NEF").read_bytes() == b"renamed"
    assert result["reverted"] == 0 and result["skipped"] == 1


# ----- strict units: main + sidecars are all-or-nothing ----------------------

def test_undo_strict_skips_whole_unit_when_sidecar_dst_blocked(journal, tmp_path):
    # Row renamed a.NEF/a.xmp -> b.NEF/b.xmp. An UNRELATED a.xmp now sits at the
    # sidecar's original path. All-or-nothing: the whole unit is skipped — b.NEF
    # stays put (not paired with the wrong sidecar) and the unrelated file is
    # untouched. No journal row for the skipped unit.
    (tmp_path / "b.NEF").write_bytes(b"img")
    (tmp_path / "b.xmp").write_text("real-side")
    (tmp_path / "a.xmp").write_text("UNRELATED")  # blocks the sidecar's dst
    fs_ops.record(op="rename", tool="rename", batch_id="u",
                  src=tmp_path / "a.NEF", dst=tmp_path / "b.NEF",
                  sidecars=[(tmp_path / "a.xmp", tmp_path / "b.xmp")])

    batch = fs_ops.group_batches(fs_ops.read_rows())[0]
    result = fs_ops.revert_batch(batch["rows"])

    assert result["reverted"] == 0 and result["skipped"] == 2
    assert (tmp_path / "b.NEF").read_bytes() == b"img"       # main not moved
    assert (tmp_path / "b.xmp").read_text() == "real-side"   # sidecar not moved
    assert (tmp_path / "a.xmp").read_text() == "UNRELATED"   # unrelated untouched
    assert not (tmp_path / "a.NEF").exists()
    # Only the original rename row is in the journal — no undo row was written.
    assert [b["batch_id"] for b in fs_ops.group_batches(fs_ops.read_rows())] == ["u"]


def test_undo_strict_reverts_unit_with_sidecar_grouped_row(journal, tmp_path):
    # The happy path under strict mode: main + sidecar both revert, and the undo
    # is journaled as ONE row with the sidecar nested (so redo restores both).
    (tmp_path / "b.NEF").write_bytes(b"img")
    (tmp_path / "b.xmp").write_text("side")
    fs_ops.record(op="rename", tool="rename", batch_id="u",
                  src=tmp_path / "a.NEF", dst=tmp_path / "b.NEF",
                  sidecars=[(tmp_path / "a.xmp", tmp_path / "b.xmp")])

    batch = fs_ops.group_batches(fs_ops.read_rows())[0]
    result = fs_ops.revert_batch(batch["rows"])

    assert result["reverted"] == 2 and result["skipped"] == 0
    assert (tmp_path / "a.NEF").read_bytes() == b"img"
    assert (tmp_path / "a.xmp").read_text() == "side"
    assert not (tmp_path / "b.NEF").exists() and not (tmp_path / "b.xmp").exists()
    # The undo row groups the sidecar under the main (not a separate row).
    undo_batch = fs_ops.group_batches(fs_ops.read_rows())[-1]
    assert undo_batch["tool"] == "undo" and len(undo_batch["rows"]) == 1
    assert len(undo_batch["rows"][0]["sidecars"]) == 1


# ----- undo is itself journaled and redoable ---------------------------------

def test_undo_is_journaled_and_redoable(journal, tmp_path):
    (tmp_path / "b.NEF").write_bytes(b"data")
    fs_ops.record(op="rename", tool="rename-nef", batch_id="first",
                  src=tmp_path / "a.NEF", dst=tmp_path / "b.NEF")

    first = fs_ops.group_batches(fs_ops.read_rows())[0]
    fs_ops.revert_batch(first["rows"])
    assert (tmp_path / "a.NEF").exists() and not (tmp_path / "b.NEF").exists()

    # A new 'undo' batch was journaled. Redo it -> back to the renamed state.
    batches = fs_ops.group_batches(fs_ops.read_rows())
    undo_batch = batches[-1]
    assert undo_batch["tool"] == "undo" and undo_batch["undoable"] is True
    assert undo_batch["batch_id"] != "first"

    fs_ops.revert_batch(undo_batch["rows"])
    assert (tmp_path / "b.NEF").read_bytes() == b"data"
    assert not (tmp_path / "a.NEF").exists()


# ----- service level ---------------------------------------------------------

@pytest.mark.asyncio
async def test_service_refuses_non_undoable_batch(journal, tmp_path):
    from api.services.undo_service import UndoService

    fs_ops.record(op="copy", tool="import", batch_id="cp",
                  src=tmp_path / "s", dst=tmp_path / "d")
    svc = UndoService()
    with pytest.raises(ValueError, match="kan inte ångras"):
        await svc.undo("cp", execute=False)


@pytest.mark.asyncio
async def test_service_unknown_batch_raises(journal, tmp_path):
    from api.services.undo_service import UndoService

    with pytest.raises(ValueError, match="finns inte"):
        await UndoService().undo("nope", execute=True)


@pytest.mark.asyncio
async def test_service_preview_then_execute(journal, tmp_path, monkeypatch):
    from api.services.undo_service import UndoService

    (tmp_path / "b.NEF").write_bytes(b"data")
    fs_ops.record(op="rename", tool="rename-nef", batch_id="x",
                  src=tmp_path / "a.NEF", dst=tmp_path / "b.NEF")

    # Stub the DB sync — no real face DB in this test.
    monkeypatch.setattr(UndoService, "_repair_db_paths", staticmethod(lambda mains: len(mains)))

    svc = UndoService()
    preview = await svc.undo("x", execute=False)
    assert preview["to_revert"] == 1 and preview["to_skip"] == 0
    assert preview["items"][0]["to_name"] == "a.NEF"
    # Preview must not move anything.
    assert (tmp_path / "b.NEF").exists() and not (tmp_path / "a.NEF").exists()

    result = await svc.undo("x", execute=True)
    assert result["reverted"] == 1
    assert (tmp_path / "a.NEF").exists() and not (tmp_path / "b.NEF").exists()


# ----- DB repair: known_faces AND processed_files (P1) -----------------------

@pytest.mark.asyncio
async def test_undo_repairs_known_faces_and_processed_paths(journal, tmp_path, monkeypatch):
    # Forward face-rename updates BOTH known_faces[*].file and
    # processed_files[*].name; undo must repair both, or face encodings keep
    # pointing at a renamed name that no longer exists. Round-trip through the
    # real RenameService + FaceDBStore (temp-redirected), no stubbed DB sync.
    import hashlib

    import numpy as np

    import faceid_db
    from api.services import db_store as db_store_mod
    from api.services.rename_service import RenameService
    from api.services.undo_service import UndoService

    base = tmp_path / "faceid"
    base.mkdir()
    for attr, fname in [
        ("BASE_DIR", None), ("ENCODING_PATH", "encodings.pkl"),
        ("IGNORED_PATH", "ignored.pkl"), ("HARDNEG_PATH", "hardneg.pkl"),
        ("PROCESSED_PATH", "processed_files.jsonl"),
        ("ATTEMPT_LOG_PATH", "attempt_stats.jsonl"), ("LOGGING_PATH", "ansikten.log"),
    ]:
        monkeypatch.setattr(faceid_db, attr, base if fname is None else base / fname)
    # Fresh process-wide store bound to the temp DB.
    monkeypatch.setattr(db_store_mod, "_store", None)

    img = tmp_path / "IMG_0001.NEF"
    img.write_bytes(b"raw")
    vec = np.asarray([1.0, 2.0], dtype=float)
    entry = {
        "encoding": vec, "file": str(img), "hash": "h1", "backend": "insightface",
        "backend_version": "unknown", "created_at": None,
        "encoding_hash": hashlib.sha1(vec.tobytes()).hexdigest(),
    }
    faceid_db.save_database({"Anna": [entry]}, [], {}, [{"name": str(img), "hash": "h1"}])

    # Forward rename (real _update_database_paths runs against the store).
    svc = RenameService()
    monkeypatch.setattr(svc, "preview_rename", lambda *a, **k: {
        "items": [{"original_path": str(img), "new_name": "250101_120000_Anna.NEF",
                   "status": "ok", "sidecars": []}],
        "name_map": {},
    })
    svc.execute_rename([str(img)])
    renamed = tmp_path / "250101_120000_Anna.NEF"

    def db_names():
        return db_store_mod.get_db_store().read(
            lambda known, ignored, hardneg, processed: (
                Path(known["Anna"][0]["file"]).name,
                Path(processed[0]["name"]).name,
            ))
    assert db_names() == ("250101_120000_Anna.NEF", "250101_120000_Anna.NEF")

    # Undo → BOTH collections point back at the original name.
    batch = fs_ops.group_batches(fs_ops.read_rows())[0]
    result = await UndoService().undo(batch["batch_id"], execute=True)
    assert result["reverted"] == 1
    assert img.exists() and not renamed.exists()
    assert db_names() == ("IMG_0001.NEF", "IMG_0001.NEF")


# ----- API level -------------------------------------------------------------

def test_api_batches_and_undo(journal, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from api.server import app

    (tmp_path / "b.NEF").write_bytes(b"data")
    fs_ops.record(op="rename", tool="rename-nef", batch_id="api1",
                  src=tmp_path / "a.NEF", dst=tmp_path / "b.NEF")

    from api.services.undo_service import UndoService
    monkeypatch.setattr(UndoService, "_repair_db_paths", staticmethod(lambda mains: 0))

    client = TestClient(app)
    listing = client.get("/api/v1/rename-journal/batches")
    assert listing.status_code == 200
    ids = [b["batch_id"] for b in listing.json()["batches"]]
    assert "api1" in ids

    resp = client.post("/api/v1/rename-journal/undo",
                       json={"batch_id": "api1", "execute": True})
    assert resp.status_code == 200
    assert resp.json()["reverted"] == 1
    assert (tmp_path / "a.NEF").exists()


def test_api_undo_unknown_batch_404(journal, tmp_path):
    from fastapi.testclient import TestClient

    from api.server import app

    client = TestClient(app)
    resp = client.post("/api/v1/rename-journal/undo",
                       json={"batch_id": "missing", "execute": True})
    assert resp.status_code == 404
