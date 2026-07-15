"""processed_files name history (``previous_names``).

Every write path that overwrites a processed_files entry's ``name`` must first
preserve the old value in an append-only ``previous_names`` log. Two paths do
this: ``RenameService._update_database_paths`` (forward rename + undo) and
``RenameNefService._sync_processed_names`` (restore-names). These tests cover
the shared helper plus a rename→undo round-trip through the real DB store.
"""

import json

from core.naming import record_previous_name

# ----- helper: record_previous_name ------------------------------------------

class TestRecordPreviousName:
    def test_creates_list_on_first_overwrite(self):
        entry = {"name": "old.NEF", "hash": "h1"}
        record_previous_name(entry, entry["name"])
        assert entry["previous_names"] == ["old.NEF"]

    def test_appends_in_chronological_order(self):
        entry = {"name": "b.NEF", "hash": "h1", "previous_names": ["a.NEF"]}
        record_previous_name(entry, entry["name"])
        assert entry["previous_names"] == ["a.NEF", "b.NEF"]

    def test_idempotent_rewrite_does_not_duplicate(self):
        entry = {"name": "a.NEF", "hash": "h1", "previous_names": ["a.NEF"]}
        record_previous_name(entry, "a.NEF")
        assert entry["previous_names"] == ["a.NEF"]

    def test_falsy_old_name_is_ignored(self):
        entry = {"name": "a.NEF", "hash": "h1"}
        record_previous_name(entry, "")
        assert "previous_names" not in entry

    def test_non_list_field_is_replaced(self):
        entry = {"name": "b.NEF", "hash": "h1", "previous_names": "corrupt"}
        record_previous_name(entry, "b.NEF")
        assert entry["previous_names"] == ["b.NEF"]


# ----- DB-store integration --------------------------------------------------

def _redirect_db(monkeypatch, tmp_path, processed):
    """Bind core.db paths + a fresh FaceDBStore, seeding processed_files.jsonl."""
    import faceid_db
    from api.services import db_store as db_store_mod

    base = tmp_path / "faceid"
    base.mkdir(exist_ok=True)
    for attr, fname in [
        ("BASE_DIR", None), ("ENCODING_PATH", "encodings.pkl"),
        ("IGNORED_PATH", "ignored.pkl"), ("HARDNEG_PATH", "hardneg.pkl"),
        ("PROCESSED_PATH", "processed_files.jsonl"),
        ("ATTEMPT_LOG_PATH", "attempt_stats.jsonl"), ("LOGGING_PATH", "ansikten.log"),
    ]:
        monkeypatch.setattr(faceid_db, attr, base if fname is None else base / fname)
    (base / "processed_files.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in processed), encoding="utf-8"
    )
    monkeypatch.setattr(db_store_mod, "_store", None)  # fresh process-wide store


def _processed_now(tmp_path):
    from api.services.db_store import get_db_store
    get_db_store().flush()
    path = tmp_path / "faceid" / "processed_files.jsonl"
    return [json.loads(ln) for ln in path.read_text().splitlines() if ln.strip()]


def test_forward_rename_records_previous_name(monkeypatch, tmp_path):
    from api.services.rename_service import RenameService

    _redirect_db(monkeypatch, tmp_path, [{"name": "250101_120000.NEF", "hash": "h1"}])
    svc = RenameService()
    n = svc._update_database_paths(
        [{"original": "/photos/250101_120000.NEF",
          "new": "/photos/250101_120000_Anna.NEF"}],
        match="basename",
    )
    assert n == 1
    row = _processed_now(tmp_path)[0]
    assert row["name"] == "250101_120000_Anna.NEF"
    assert row["previous_names"] == ["250101_120000.NEF"]


def test_restore_names_records_previous_name(monkeypatch, tmp_path):
    from api.services.rename_nef_service import RenameNefService

    _redirect_db(monkeypatch, tmp_path, [{"name": "wrongname.NEF", "hash": "h1"}])
    n = RenameNefService._sync_processed_names({"h1": "250101_120000_Anna.NEF"})
    assert n == 1
    row = _processed_now(tmp_path)[0]
    assert row["name"] == "250101_120000_Anna.NEF"
    assert row["previous_names"] == ["wrongname.NEF"]


def test_rename_then_undo_logs_both_names_in_order(monkeypatch, tmp_path):
    """Undo goes through the same write path, so the reverted name is appended
    too — the history is a log, not a stack."""
    from api.services.rename_service import RenameService

    _redirect_db(monkeypatch, tmp_path, [{"name": "250101_120000.NEF", "hash": "h1"}])
    svc = RenameService()

    # Forward rename: bare -> named.
    svc._update_database_paths(
        [{"original": "/photos/250101_120000.NEF",
          "new": "/photos/250101_120000_Anna.NEF"}],
        match="basename",
    )
    # Undo: named -> bare, via fullpath match (how undo calls it). The DB entry
    # is a bare basename, so it is matched and rewritten by basename.
    svc._update_database_paths(
        [{"original": "/photos/250101_120000_Anna.NEF",
          "new": "/photos/250101_120000.NEF"}],
        match="fullpath",
    )

    row = _processed_now(tmp_path)[0]
    assert row["name"] == "250101_120000.NEF"
    assert row["previous_names"] == ["250101_120000.NEF", "250101_120000_Anna.NEF"]


def test_no_history_when_name_unchanged(monkeypatch, tmp_path):
    """A matched entry whose value does not actually change grows no history."""
    from api.services.rename_service import RenameService

    _redirect_db(monkeypatch, tmp_path, [{"name": "a.NEF", "hash": "h1"}])
    svc = RenameService()
    # rename_map maps a.NEF -> a.NEF (basename identical, same parent): matched
    # but no real change.
    svc._update_database_paths(
        [{"original": "/photos/a.NEF", "new": "/photos/a.NEF"}],
        match="basename",
    )
    row = _processed_now(tmp_path)[0]
    assert "previous_names" not in row
