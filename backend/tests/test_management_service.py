"""Characterization tests for ManagementService.

These pin CURRENT behavior of the mutation seams an upcoming refactor will
touch (the service moves onto a unified FaceDBStore):

  * rename / merge / delete against a real temp database (asserts the
    persisted on-disk state, not just in-memory)
  * distinct-pairs registry follow-through (rename rewrites, delete drops)
  * the 2.0 s TTL reload behavior

Every faceid_db path constant is redirected to a temp dir, and the service's
own DISTINCT_PAIRS_PATH / BASE_DIR are monkeypatched, so nothing touches
~/.local/share/faceid. Latent quirks are flagged NOTE.
"""

import json

import numpy as np
import pytest

import api.services.db_store as db_store_mod
import api.services.management_service as m
import faceid_db
from api.services.management_service import ManagementService


@pytest.fixture
def db_dir(tmp_path, monkeypatch):
    """Redirect faceid_db + management_service paths into a temp dir."""
    base = tmp_path / "faceid"
    base.mkdir()
    monkeypatch.setattr(faceid_db, "BASE_DIR", base)
    monkeypatch.setattr(faceid_db, "ARCHIVE_DIR", base / "archive")
    monkeypatch.setattr(faceid_db, "ENCODING_PATH", base / "encodings.pkl")
    monkeypatch.setattr(faceid_db, "IGNORED_PATH", base / "ignored.pkl")
    monkeypatch.setattr(faceid_db, "HARDNEG_PATH", base / "hardneg.pkl")
    monkeypatch.setattr(faceid_db, "PROCESSED_PATH", base / "processed_files.jsonl")
    monkeypatch.setattr(faceid_db, "ATTEMPT_LOG_PATH", base / "attempt_stats.jsonl")
    monkeypatch.setattr(faceid_db, "LOGGING_PATH", base / "ansikten.log")
    # The service's registry path + base are bound at import time.
    monkeypatch.setattr(m, "BASE_DIR", base)
    monkeypatch.setattr(m, "DISTINCT_PAIRS_PATH", base / "distinct_pairs.json")
    # ManagementService now reads/writes through the process-wide FaceDBStore
    # singleton. Reset it per test so each starts with a fresh authority bound
    # to this temp dir (no state carried over from a previous test's dir).
    monkeypatch.setattr(db_store_mod, "_store", None)
    return base


def _entry(vec, backend="insightface", **extra):
    e = {"encoding": np.asarray(vec, dtype=float), "backend": backend}
    e.update(extra)
    return e


def _seed(known=None, ignored=None, hardneg=None, processed=None):
    faceid_db.save_database(known or {}, ignored or [], hardneg or {}, processed or [])


def _read_known():
    known, _, _, _ = faceid_db.load_database()
    return known


def _write_pairs(pairs):
    m.DISTINCT_PAIRS_PATH.write_text(
        json.dumps([list(p) for p in pairs]), encoding="utf-8"
    )


def _read_pairs():
    return {tuple(sorted(p)) for p in json.loads(m.DISTINCT_PAIRS_PATH.read_text())}


# --------------------------------------------------------------------------
# 1. rename_person
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rename_person_persists_to_disk(db_dir):
    _seed(known={"Alice": [_entry([1.0, 2.0])]})
    svc = ManagementService()

    await svc.rename_person("Alice", "Alicia")

    known = _read_known()
    assert set(known) == {"Alicia"}
    np.testing.assert_array_equal(known["Alicia"][0]["encoding"], np.array([1.0, 2.0]))


@pytest.mark.asyncio
async def test_rename_person_rewrites_distinct_pair(db_dir):
    _seed(known={"Alice": [_entry([1.0])], "Bob": [_entry([2.0])]})
    _write_pairs([("Alice", "Bob")])
    svc = ManagementService()

    await svc.rename_person("Alice", "Alicia")

    assert _read_pairs() == {("Alicia", "Bob")}


@pytest.mark.asyncio
async def test_rename_missing_person_raises(db_dir):
    _seed(known={"Alice": [_entry([1.0])]})
    svc = ManagementService()
    with pytest.raises(ValueError, match="not found"):
        await svc.rename_person("Ghost", "New")


@pytest.mark.asyncio
async def test_rename_onto_existing_name_raises(db_dir):
    _seed(known={"Alice": [_entry([1.0])], "Bob": [_entry([2.0])]})
    svc = ManagementService()
    with pytest.raises(ValueError, match="already exists"):
        await svc.rename_person("Alice", "Bob")


# --------------------------------------------------------------------------
# 2. merge_people
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_merge_combines_and_deletes_sources(db_dir):
    _seed(known={
        "Alice": [_entry([1.0, 0.0], encoding_hash="h1")],
        "Ali": [_entry([0.0, 1.0], encoding_hash="h2")],
    })
    svc = ManagementService()

    result = await svc.merge_people(["Ali"], "Alice")

    known = _read_known()
    assert set(known) == {"Alice"}
    assert len(known["Alice"]) == 2  # both encodings survive
    assert result["status"] == "success"


@pytest.mark.asyncio
async def test_merge_dedups_by_encoding_hash(db_dir):
    # Same encoding_hash on both sides collapses to one entry.
    _seed(known={
        "Alice": [_entry([1.0, 0.0], encoding_hash="dup")],
        "Ali": [_entry([1.0, 0.0], encoding_hash="dup")],
    })
    svc = ManagementService()

    await svc.merge_people(["Ali"], "Alice")

    known = _read_known()
    assert set(known) == {"Alice"}
    assert len(known["Alice"]) == 1


@pytest.mark.asyncio
async def test_merge_transfers_distinct_pair_to_target(db_dir):
    # Ali was marked distinct from Bob; merging Ali->Alice re-anchors on Alice.
    _seed(known={
        "Alice": [_entry([1.0], encoding_hash="a")],
        "Ali": [_entry([2.0], encoding_hash="b")],
        "Bob": [_entry([3.0], encoding_hash="c")],
    })
    _write_pairs([("Ali", "Bob")])
    svc = ManagementService()

    await svc.merge_people(["Ali"], "Alice")

    assert _read_pairs() == {("Alice", "Bob")}


@pytest.mark.asyncio
async def test_merge_missing_source_raises(db_dir):
    _seed(known={"Alice": [_entry([1.0])]})
    svc = ManagementService()
    with pytest.raises(ValueError, match="not found"):
        await svc.merge_people(["Ghost"], "Alice")


# --------------------------------------------------------------------------
# 3. delete_person
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_person_persists_and_drops_pairs(db_dir):
    _seed(known={"Alice": [_entry([1.0])], "Bob": [_entry([2.0])]})
    _write_pairs([("Alice", "Bob")])
    svc = ManagementService()

    result = await svc.delete_person("Alice")

    assert set(_read_known()) == {"Bob"}
    assert _read_pairs() == set()  # pair referencing Alice is dropped
    assert "1 encodings" in result["message"]


@pytest.mark.asyncio
async def test_delete_missing_person_raises(db_dir):
    _seed(known={"Alice": [_entry([1.0])]})
    svc = ManagementService()
    with pytest.raises(ValueError, match="not found"):
        await svc.delete_person("Ghost")


# --------------------------------------------------------------------------
# 4. move_to_ignore / move_from_ignore / undo_file (ignored + processed handling)
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_move_to_ignore_moves_all_encodings(db_dir):
    _seed(known={"Alice": [_entry([1.0]), _entry([2.0])]})
    svc = ManagementService()

    await svc.move_to_ignore("Alice")

    known, ignored, _, _ = faceid_db.load_database()
    assert "Alice" not in known
    assert len(ignored) == 2


@pytest.mark.asyncio
async def test_move_from_ignore_persists_shrunk_ignored_list(db_dir):
    """Pins the in-place mutation contract for move_from_ignore.

    The mutate() callback prunes the store's LIVE ignored list via slice
    assignment (`ignored[:] = ...`); a rebind (`ignored = ...`) would pass the
    suite while silently writing nothing. Assert the persisted on-disk state
    after flush: ignored actually SHRANK and the target gained the encodings.
    """
    _seed(ignored=[_entry([1.0]), _entry([2.0]), _entry([3.0])])
    svc = ManagementService()

    result = await svc.move_from_ignore(count=2, target_name="Alice")

    known, ignored, _, _ = faceid_db.load_database()
    assert len(ignored) == 1  # shrunk on disk, not just in the returned state
    np.testing.assert_array_equal(ignored[0]["encoding"], np.array([3.0]))
    assert len(known["Alice"]) == 2
    assert result["status"] == "success"


@pytest.mark.asyncio
async def test_undo_file_shrinks_processed_and_encodings_on_disk(db_dir):
    """Pins the in-place mutation contract for undo_file.

    undo_file prunes `processed` and `ignored` via slice assignment on the
    store's live lists. Assert the persisted shrink of processed_files,
    known_faces AND ignored_faces — not just the distinct-pairs side effect.
    """
    _seed(
        known={
            "Alice": [_entry([1.0], hash="fh1")],
            "Bob": [_entry([2.0], hash="fh2")],
        },
        ignored=[_entry([3.0], hash="fh1"), _entry([4.0], hash="fh2")],
        processed=[
            {"name": "a.NEF", "hash": "fh1"},
            {"name": "b.NEF", "hash": "fh2"},
        ],
    )
    svc = ManagementService()

    result = await svc.undo_file("a.NEF")

    known, ignored, _, processed = faceid_db.load_database()
    # processed shrank on disk: only the unmatched file remains.
    assert [pf["name"] for pf in processed] == ["b.NEF"]
    # Alice's only encoding came from a.NEF -> emptied and removed; Bob intact.
    assert set(known) == {"Bob"}
    # ignored shrank on disk: the fh1 entry is gone, the fh2 entry remains.
    assert len(ignored) == 1
    np.testing.assert_array_equal(ignored[0]["encoding"], np.array([4.0]))
    assert result["files_undone"] == ["a.NEF"]


# --------------------------------------------------------------------------
# 4b. dedup_people no-op guard
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_dedup_noop_schedules_no_save(db_dir):
    """A confirm that removes nothing must not mutate or schedule a save.

    Preserves the old `if total and not dry_run: save()` no-op contract: the
    plan runs under read() first, and mutate()/flush() only fire when there is
    something to remove.
    """
    _seed(known={"Alice": [_entry([1.0], encoding_hash="h1")]})  # no redundancy
    svc = ManagementService()

    result = await svc.dedup_people(["Alice"], threshold=0.0, dry_run=False)

    assert result["total_removed"] == 0
    store = db_store_mod.get_db_store()
    assert not store._dirty  # no mutation was recorded (empty dirty set)
    assert store._save_timer is None  # and no save is pending


# --------------------------------------------------------------------------
# 5. Freshness via FaceDBStore (replaces the old 2.0 s TTL tests)
#
# INTENTIONALLY UPDATED for the FaceDBStore migration: ManagementService no
# longer holds its own copies behind a 2.0 s time-to-live cache. It reads
# through the process-wide FaceDBStore, which invalidates by file fingerprint
# (st_mtime_ns + st_size), not by elapsed time. The old TTL tests
# (test_reload_database_skips_within_ttl / _rereads_after_ttl) asserted a
# now-removed behavior (a within-TTL external write is deliberately NOT seen);
# that contract is gone by design. The equivalent guarantee is: an external
# write is visible on the *next* read, with no TTL wait.
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_external_write_visible_on_next_read(db_dir):
    """External DB write is picked up immediately (fingerprint invalidation).

    Replaces the two TTL tests: there is no timed cache to wait out. The next
    read after an external write reflects it.
    """
    _seed(known={"Alice": [_entry([1.0])]})
    svc = ManagementService()

    state1 = await svc.get_database_state()
    assert {p["name"] for p in state1["people"]} == {"Alice"}

    # An external process rewrites the DB behind the service's back.
    _seed(known={"Alice": [_entry([1.0])], "Bob": [_entry([2.0])]})

    # No TTL wait: the store invalidates on the changed file fingerprint, so the
    # very next read sees the new person.
    state2 = await svc.get_database_state()
    assert {p["name"] for p in state2["people"]} == {"Alice", "Bob"}
