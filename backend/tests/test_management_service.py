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
# 4. move_to_ignore (hard/ignored handling)
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_move_to_ignore_moves_all_encodings(db_dir):
    _seed(known={"Alice": [_entry([1.0]), _entry([2.0])]})
    svc = ManagementService()

    await svc.move_to_ignore("Alice")

    known, ignored, _, _ = faceid_db.load_database()
    assert "Alice" not in known
    assert len(ignored) == 2


# --------------------------------------------------------------------------
# 5. TTL reload behavior (2.0 s cache)
# --------------------------------------------------------------------------

def test_reload_database_skips_within_ttl(db_dir):
    _seed(known={"Alice": [_entry([1.0])]})
    svc = ManagementService()  # loads {Alice}, sets _last_reload=now

    # Change the DB on disk behind the service's back.
    _seed(known={"Alice": [_entry([1.0])], "Bob": [_entry([2.0])]})

    svc.reload_database()  # within the 2.0 s TTL -> should NOT re-read
    assert set(svc.known_faces) == {"Alice"}


def test_reload_database_rereads_after_ttl(db_dir):
    _seed(known={"Alice": [_entry([1.0])]})
    svc = ManagementService()

    _seed(known={"Alice": [_entry([1.0])], "Bob": [_entry([2.0])]})

    # Age the last-reload stamp past the TTL without sleeping.
    svc._last_reload -= (svc._cache_ttl + 10)
    svc.reload_database()
    assert set(svc.known_faces) == {"Alice", "Bob"}
