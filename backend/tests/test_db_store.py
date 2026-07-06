"""Unit tests for FaceDBStore (the process-wide face DB repository).

The store is introduced in Phase D but not yet wired to any service. These
tests pin its contract: initial load, mtime-stable snapshots, external-write
invalidation, versioning, debounced/coalesced saves, flush durability, no
false self-reload, thread-safety, and RLock reentrancy.

All core.db path constants are monkeypatched to a temp dir (same pattern as
test_faceid_db.py) so nothing ever touches ~/.local/share/faceid.
"""

import hashlib
import os
import threading
import time

import numpy as np
import pytest

from api.services import db_store as db_store_mod
from api.services.db_store import FaceDBStore, get_db_store
from core import db as faceid_db

# --------------------------------------------------------------------------
# Fixtures / helpers
# --------------------------------------------------------------------------

@pytest.fixture
def db_dir(tmp_path, monkeypatch):
    """Redirect every core.db path constant into a temp dir."""
    base = tmp_path / "faceid"
    base.mkdir()
    archive = base / "archive"
    monkeypatch.setattr(faceid_db, "BASE_DIR", base)
    monkeypatch.setattr(faceid_db, "ARCHIVE_DIR", archive)
    monkeypatch.setattr(faceid_db, "ENCODING_PATH", base / "encodings.pkl")
    monkeypatch.setattr(faceid_db, "IGNORED_PATH", base / "ignored.pkl")
    monkeypatch.setattr(faceid_db, "HARDNEG_PATH", base / "hardneg.pkl")
    monkeypatch.setattr(faceid_db, "PROCESSED_PATH", base / "processed_files.jsonl")
    monkeypatch.setattr(faceid_db, "ATTEMPT_LOG_PATH", base / "attempt_stats.jsonl")
    monkeypatch.setattr(faceid_db, "LOGGING_PATH", base / "ansikten.log")
    return base


@pytest.fixture
def fast_debounce(monkeypatch):
    """Shrink the debounce window so timer-based tests stay fast."""
    monkeypatch.setattr(db_store_mod, "SAVE_DEBOUNCE_SECONDS", 0.05)


@pytest.fixture
def make_store():
    """Factory for FaceDBStore instances with guaranteed timer cleanup.

    Cancels any pending debounce timer at teardown so a stray save can't fire
    after the temp-dir monkeypatch reverts (which would write to the real DB).
    """
    created = []

    def _make():
        s = FaceDBStore()
        created.append(s)
        return s

    yield _make

    for s in created:
        with s._lock:
            if s._save_timer is not None:
                s._save_timer.cancel()
                s._save_timer = None
            s._dirty = False


def _entry(vec, backend="insightface"):
    a = np.asarray(vec, dtype=float)
    return {
        "encoding": a,
        "file": None,
        "hash": None,
        "backend": backend,
        "backend_version": "unknown",
        "created_at": None,
        "encoding_hash": hashlib.sha1(a.tobytes()).hexdigest(),
    }


def _seed(known=None, ignored=None, hardneg=None, processed=None):
    """Write a starting DB to disk via the real save_database."""
    faceid_db.save_database(
        known or {},
        ignored or [],
        hardneg or {},
        processed or [],
    )


def _bump_mtime(path, delta=2.0):
    """Force a distinct mtime on a file (avoids filesystem-granularity ties)."""
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + int(delta * 1e9)))


def _wait_for(predicate, timeout=2.0, interval=0.01):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


# --------------------------------------------------------------------------
# 1. Initial load
# --------------------------------------------------------------------------

def test_initial_snapshot_loads_from_disk(db_dir, make_store):
    _seed(known={"Alice": [_entry([1.0, 2.0])]}, processed=[{"name": "a.NEF", "hash": "h1"}])
    store = make_store()
    snap = store.snapshot()
    assert list(snap.known_faces.keys()) == ["Alice"]
    assert snap.processed_files == [{"name": "a.NEF", "hash": "h1"}]
    assert snap.version == 1  # first load bumps 0 -> 1


def test_snapshot_empty_db(db_dir, make_store):
    store = make_store()
    snap = store.snapshot()
    assert snap.known_faces == {}
    assert snap.ignored_faces == []
    assert snap.hard_negatives == {}
    assert snap.processed_files == []


# --------------------------------------------------------------------------
# 2. Snapshot stability — no reload when mtimes unchanged
# --------------------------------------------------------------------------

def test_repeated_snapshot_does_not_reload(db_dir, monkeypatch, make_store):
    _seed(known={"Alice": [_entry([1.0, 2.0])]})
    store = make_store()

    calls = {"n": 0}
    real_load = faceid_db.load_database

    def spy_load():
        calls["n"] += 1
        return real_load()

    monkeypatch.setattr(faceid_db, "load_database", spy_load)
    monkeypatch.setattr(db_store_mod.db, "load_database", spy_load)

    s1 = store.snapshot()
    s2 = store.snapshot()
    s3 = store.snapshot()

    assert calls["n"] == 1  # only the first snapshot reloaded
    assert s1.version == s2.version == s3.version
    # Same live objects handed back each time.
    assert s1.known_faces is s2.known_faces is s3.known_faces


# --------------------------------------------------------------------------
# 3. External-write invalidation
# --------------------------------------------------------------------------

def test_external_write_triggers_reload(db_dir, make_store):
    _seed(known={"Alice": [_entry([1.0, 2.0])]})
    store = make_store()
    first = store.snapshot()
    assert list(first.known_faces.keys()) == ["Alice"]

    # Simulate an external process rewriting the DB.
    faceid_db.save_database({"Bob": [_entry([3.0, 4.0])]}, [], {}, [])
    _bump_mtime(faceid_db.ENCODING_PATH)

    second = store.snapshot()
    assert list(second.known_faces.keys()) == ["Bob"]
    assert second.version == first.version + 1


def test_external_write_to_each_file_invalidates(db_dir, make_store):
    _seed(
        known={"Alice": [_entry([1.0])]},
        ignored=[_entry([0.1])],
        hardneg={"Carol": [_entry([9.0])]},
        processed=[{"name": "a.NEF", "hash": "h"}],
    )
    store = make_store()
    v = store.snapshot().version
    for path in (
        faceid_db.ENCODING_PATH,
        faceid_db.IGNORED_PATH,
        faceid_db.HARDNEG_PATH,
        faceid_db.PROCESSED_PATH,
    ):
        _bump_mtime(path)
        v_new = store.snapshot().version
        assert v_new == v + 1, f"touching {path.name} did not invalidate"
        v = v_new


def test_newly_created_file_invalidates(db_dir, make_store):
    # Start with only encodings present; ignored.pkl absent.
    faceid_db.save_database({"Alice": [_entry([1.0])]}, [], {}, [])
    faceid_db.IGNORED_PATH.unlink(missing_ok=True)
    store = make_store()
    v = store.snapshot().version
    # An external writer now creates ignored.pkl (mtime None -> int).
    import pickle
    with open(faceid_db.IGNORED_PATH, "wb") as f:
        pickle.dump([_entry([0.5])], f)
    snap = store.snapshot()
    assert snap.version == v + 1
    assert len(snap.ignored_faces) == 1


# --------------------------------------------------------------------------
# 4. mutate: bumps version, schedules save
# --------------------------------------------------------------------------

def test_mutate_bumps_version_and_saves(db_dir, fast_debounce, make_store):
    _seed(known={"Alice": [_entry([1.0])]})
    store = make_store()
    v0 = store.snapshot().version

    def add_bob(known, ignored, hardneg, processed):
        known["Bob"] = [_entry([2.0])]
        return "ok"

    ret = store.mutate(add_bob)
    assert ret == "ok"
    assert store.version == v0 + 1

    # Debounced save eventually lands on disk.
    def bob_on_disk():
        k, _, _, _ = faceid_db.load_database()
        return "Bob" in k

    assert _wait_for(bob_on_disk)


def test_mutate_return_value_passthrough(db_dir, fast_debounce, make_store):
    store = make_store()
    result = store.mutate(lambda k, i, h, p: 42)
    assert result == 42


def test_mutate_on_fresh_store_loads_first(db_dir, fast_debounce, make_store):
    _seed(known={"Alice": [_entry([1.0])]})
    store = make_store()
    # No prior snapshot() — mutate must load before applying fn.
    seen = {}

    def check(known, ignored, hardneg, processed):
        seen["alice"] = "Alice" in known
        known["Bob"] = [_entry([2.0])]

    store.mutate(check)
    assert seen["alice"] is True


# --------------------------------------------------------------------------
# 5. Debounce coalescing
# --------------------------------------------------------------------------

def test_debounce_coalesces_saves(db_dir, monkeypatch, make_store):
    monkeypatch.setattr(db_store_mod, "SAVE_DEBOUNCE_SECONDS", 0.15)
    _seed()
    store = make_store()

    saves = {"n": 0}
    real_save = faceid_db.save_database

    def spy_save(*a, **kw):
        saves["n"] += 1
        return real_save(*a, **kw)

    monkeypatch.setattr(db_store_mod.db, "save_database", spy_save)

    # Two rapid mutations within the debounce window -> one save.
    store.mutate(lambda k, i, h, p: k.__setitem__("A", [_entry([1.0])]))
    store.mutate(lambda k, i, h, p: k.__setitem__("B", [_entry([2.0])]))

    assert _wait_for(lambda: saves["n"] >= 1, timeout=2.0)
    time.sleep(0.2)
    assert saves["n"] == 1, f"expected coalesced single save, got {saves['n']}"

    # Both mutations are present in the single write.
    k, _, _, _ = faceid_db.load_database()
    assert set(k.keys()) == {"A", "B"}


# --------------------------------------------------------------------------
# 6. flush: cancels timer, saves immediately
# --------------------------------------------------------------------------

def test_flush_saves_immediately(db_dir, monkeypatch, make_store):
    # Long debounce so the timer would NOT have fired yet.
    monkeypatch.setattr(db_store_mod, "SAVE_DEBOUNCE_SECONDS", 10.0)
    _seed()
    store = make_store()

    saves = {"n": 0}
    real_save = faceid_db.save_database

    def spy_save(*a, **kw):
        saves["n"] += 1
        return real_save(*a, **kw)

    monkeypatch.setattr(db_store_mod.db, "save_database", spy_save)

    store.mutate(lambda k, i, h, p: k.__setitem__("A", [_entry([1.0])]))
    assert saves["n"] == 0  # debounce hasn't fired

    store.flush()
    assert saves["n"] == 1
    assert store._save_timer is None

    k, _, _, _ = faceid_db.load_database()
    assert "A" in k


def test_flush_noop_when_clean(db_dir, monkeypatch, make_store):
    _seed()
    store = make_store()
    store.snapshot()

    saves = {"n": 0}
    monkeypatch.setattr(
        db_store_mod.db, "save_database",
        lambda *a, **kw: saves.__setitem__("n", saves["n"] + 1),
    )
    store.flush()
    assert saves["n"] == 0  # nothing dirty -> no write


# --------------------------------------------------------------------------
# 7. Own save does NOT trigger a false external reload
# --------------------------------------------------------------------------

def test_own_save_does_not_trigger_reload(db_dir, monkeypatch, make_store):
    monkeypatch.setattr(db_store_mod, "SAVE_DEBOUNCE_SECONDS", 0.05)
    _seed()
    store = make_store()

    loads = {"n": 0}
    real_load = faceid_db.load_database

    def spy_load():
        loads["n"] += 1
        return real_load()

    store.mutate(lambda k, i, h, p: k.__setitem__("A", [_entry([1.0])]))
    # Wait for the debounced save to complete and record post-save mtimes.
    assert _wait_for(lambda: store._dirty is False)

    # Now start spying and take a snapshot: our own write must not look external.
    monkeypatch.setattr(db_store_mod.db, "load_database", spy_load)
    monkeypatch.setattr(faceid_db, "load_database", spy_load)
    snap = store.snapshot()
    assert loads["n"] == 0, "own save falsely triggered an external reload"
    assert "A" in snap.known_faces


# --------------------------------------------------------------------------
# 8. Concurrency: no lost updates
# --------------------------------------------------------------------------

def test_concurrent_mutations_no_lost_updates(db_dir, monkeypatch, make_store):
    monkeypatch.setattr(db_store_mod, "SAVE_DEBOUNCE_SECONDS", 0.05)
    _seed()
    store = make_store()
    store.snapshot()  # prime

    n_threads = 20
    per_thread = 50

    def bump(known, ignored, hardneg, processed):
        # processed_files used as a shared counter list.
        processed.append(1)

    def worker():
        for _ in range(per_thread):
            store.mutate(bump)

    threads = [threading.Thread(target=worker) for _ in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    snap = store.snapshot()
    assert len(snap.processed_files) == n_threads * per_thread


# --------------------------------------------------------------------------
# 9. RLock reentrancy: mutate may call snapshot internally
# --------------------------------------------------------------------------

def test_mutate_can_call_snapshot_reentrantly(db_dir, fast_debounce, make_store):
    _seed(known={"Alice": [_entry([1.0])]})
    store = make_store()
    observed = {}

    def reentrant(known, ignored, hardneg, processed):
        # Calling snapshot() from within mutate must not deadlock (RLock).
        inner = store.snapshot()
        observed["keys"] = list(inner.known_faces.keys())
        known["Bob"] = [_entry([2.0])]

    store.mutate(reentrant)
    assert observed["keys"] == ["Alice"]
    assert "Bob" in store.snapshot().known_faces


# --------------------------------------------------------------------------
# 10. Singleton getter
# --------------------------------------------------------------------------

def test_get_db_store_is_singleton(db_dir, monkeypatch):
    # Reset any store constructed by an earlier test.
    monkeypatch.setattr(db_store_mod, "_store", None)
    a = get_db_store()
    b = get_db_store()
    assert a is b
    assert isinstance(a, FaceDBStore)
