"""Characterization tests for faceid_db (the pickle + jsonl data layer).

These tests pin CURRENT behavior of the data layer so upcoming refactors
have a safety net. They intentionally document behavior as-is — including
a few quirks that look like latent bugs (flagged with NOTE comments) —
rather than asserting idealized behavior.

All path constants are monkeypatched to a temp dir so nothing ever
touches ~/.local/share/faceid.
"""

import fcntl
import hashlib
import json
import pickle

import numpy as np
import pytest

import faceid_db


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------

@pytest.fixture
def db_dir(tmp_path, monkeypatch):
    """Redirect every faceid_db path constant into a temp dir."""
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


def _entry(vec, backend="insightface"):
    """A fully normalized encoding entry (all fields present)."""
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


def _assert_entries_equal(a, b):
    """Compare two encoding entries (numpy arrays via np.testing)."""
    assert a.keys() == b.keys()
    for k in a:
        if isinstance(a[k], np.ndarray) or isinstance(b[k], np.ndarray):
            np.testing.assert_array_equal(a[k], b[k])
        else:
            assert a[k] == b[k], f"mismatch on key {k!r}"


# --------------------------------------------------------------------------
# 1. load/save round-trip
# --------------------------------------------------------------------------

def test_save_load_round_trip(db_dir):
    known = {
        "Alice": [_entry([1.0, 2.0, 3.0]), _entry([4.0, 5.0, 6.0])],
        "Bob": [_entry([7.0, 8.0, 9.0])],
    }
    ignored = [_entry([0.1, 0.2, 0.3])]
    hardneg = {"Carol": [_entry([9.0, 9.0, 9.0])]}
    processed = [
        {"name": "260401_120000.NEF", "hash": "abc123"},
        {"name": "260401_120100.NEF", "hash": "def456"},
    ]

    faceid_db.save_database(known, ignored, hardneg, processed)

    lk, li, lh, lp = faceid_db.load_database()

    assert set(lk) == {"Alice", "Bob"}
    for name in known:
        assert len(lk[name]) == len(known[name])
        for got, want in zip(lk[name], known[name]):
            _assert_entries_equal(got, want)

    assert len(li) == 1
    _assert_entries_equal(li[0], ignored[0])

    assert set(lh) == {"Carol"}
    _assert_entries_equal(lh["Carol"][0], hardneg["Carol"][0])

    assert lp == processed


def test_save_creates_all_files(db_dir):
    faceid_db.save_database({}, [], {}, [])
    assert faceid_db.ENCODING_PATH.exists()
    assert faceid_db.IGNORED_PATH.exists()
    assert faceid_db.HARDNEG_PATH.exists()
    assert faceid_db.PROCESSED_PATH.exists()


def test_load_missing_files_returns_empty_defaults(db_dir):
    # Nothing written yet.
    known, ignored, hardneg, processed = faceid_db.load_database()
    assert known == {}
    assert ignored == []
    assert hardneg == {}
    assert processed == []


def test_processed_legacy_bare_line_fallback(db_dir):
    # A non-JSON line becomes {"name": line, "hash": None}.
    faceid_db.PROCESSED_PATH.write_text(
        '{"name": "a.NEF", "hash": "h1"}\n'
        "legacy_bare_filename.NEF\n",
        encoding="utf-8",
    )
    _, _, _, processed = faceid_db.load_database()
    assert processed == [
        {"name": "a.NEF", "hash": "h1"},
        {"name": "legacy_bare_filename.NEF", "hash": None},
    ]


# --------------------------------------------------------------------------
# 2. normalize_encoding_entry
# --------------------------------------------------------------------------

def test_normalize_legacy_bare_array():
    arr = np.array([1.0, 2.0, 3.0])
    out = faceid_db.normalize_encoding_entry(arr)
    assert out["backend"] == "dlib"
    assert out["backend_version"] == "unknown"
    assert out["created_at"] is None
    assert out["file"] is None
    assert out["hash"] is None
    np.testing.assert_array_equal(out["encoding"], arr)
    assert out["encoding_hash"] == hashlib.sha1(arr.tobytes()).hexdigest()


def test_normalize_custom_default_backend():
    arr = np.array([1.0, 2.0])
    out = faceid_db.normalize_encoding_entry(arr, default_backend="insightface")
    assert out["backend"] == "insightface"


def test_normalize_dict_missing_backend_defaults_dlib():
    entry = {"encoding": np.array([1.0, 2.0])}
    out = faceid_db.normalize_encoding_entry(entry)
    assert out["backend"] == "dlib"
    assert out["backend_version"] == "unknown"
    assert out["created_at"] is None
    # encoding_hash computed because encoding is not None
    assert out["encoding_hash"] == hashlib.sha1(
        np.array([1.0, 2.0]).tobytes()
    ).hexdigest()


def test_normalize_already_normalized_passthrough():
    entry = _entry([1.0, 2.0, 3.0])
    original_hash = entry["encoding_hash"]
    out = faceid_db.normalize_encoding_entry(entry)
    # Same object returned, unchanged.
    assert out is entry
    assert out["backend"] == "insightface"
    assert out["encoding_hash"] == original_hash


def test_normalize_dict_none_encoding_gets_no_hash():
    # Manual faces have encoding=None; encoding_hash is NOT added.
    entry = {"encoding": None, "is_manual": True}
    out = faceid_db.normalize_encoding_entry(entry)
    assert out["backend"] == "dlib"
    assert "encoding_hash" not in out


def test_normalize_invalid_type_returns_none():
    # Pinning current behavior: non-array, non-dict -> None (graceful skip).
    assert faceid_db.normalize_encoding_entry("not an encoding") is None
    assert faceid_db.normalize_encoding_entry(12345) is None
    assert faceid_db.normalize_encoding_entry(None) is None


def test_normalize_mutates_input_dict_in_place():
    # NOTE: pins that the dict branch mutates its argument (side effect).
    entry = {"encoding": np.array([1.0])}
    faceid_db.normalize_encoding_entry(entry)
    assert "backend" in entry  # original dict was modified


# --------------------------------------------------------------------------
# 3. get_file_hash
# --------------------------------------------------------------------------

def test_get_file_hash_known_content(tmp_path):
    p = tmp_path / "f.bin"
    p.write_bytes(b"hello world")
    expected = hashlib.sha1(b"hello world").hexdigest()
    assert faceid_db.get_file_hash(p) == expected
    # Sanity: matches the well-known SHA1 of "hello world".
    assert expected == "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed"


def test_get_file_hash_chunked_large_file(tmp_path):
    # Larger than the 64KB chunk size to exercise the read loop.
    data = bytes(np.random.RandomState(0).randint(0, 256, size=200_000, dtype=np.uint8))
    p = tmp_path / "big.bin"
    p.write_bytes(data)
    assert faceid_db.get_file_hash(p) == hashlib.sha1(data).hexdigest()


def test_get_file_hash_accepts_str_path(tmp_path):
    p = tmp_path / "f.bin"
    p.write_bytes(b"abc")
    assert faceid_db.get_file_hash(str(p)) == hashlib.sha1(b"abc").hexdigest()


def test_get_file_hash_missing_file_returns_none(tmp_path):
    assert faceid_db.get_file_hash(tmp_path / "nope.bin") is None


# --------------------------------------------------------------------------
# 4. rotate_logs
# --------------------------------------------------------------------------

def test_rotate_logs_noop_below_limits(db_dir, monkeypatch):
    monkeypatch.setattr(faceid_db, "MAX_PROCESSED_ENTRIES", 5)
    monkeypatch.setattr(faceid_db, "MAX_ATTEMPT_ENTRIES", 5)
    lines = [json.dumps({"name": f"{i}.NEF", "hash": str(i)}) for i in range(3)]
    faceid_db.PROCESSED_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    faceid_db.ATTEMPT_LOG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    faceid_db.rotate_logs()

    assert faceid_db.PROCESSED_PATH.read_text(encoding="utf-8").count("\n") == 3
    assert faceid_db.ATTEMPT_LOG_PATH.read_text(encoding="utf-8").count("\n") == 3
    assert not faceid_db.ARCHIVE_DIR.exists()  # nothing archived


def test_rotate_logs_trims_processed(db_dir, monkeypatch):
    monkeypatch.setattr(faceid_db, "MAX_PROCESSED_ENTRIES", 5)
    entries = [{"name": f"{i}.NEF", "hash": str(i)} for i in range(20)]
    faceid_db.PROCESSED_PATH.write_text(
        "\n".join(json.dumps(e) for e in entries) + "\n", encoding="utf-8"
    )

    faceid_db.rotate_logs()

    kept = [json.loads(l) for l in faceid_db.PROCESSED_PATH.read_text(encoding="utf-8").splitlines()]
    assert len(kept) == 5
    # Keeps the MOST RECENT entries.
    assert kept == entries[-5:]


def test_rotate_logs_archives_attempts(db_dir, monkeypatch):
    monkeypatch.setattr(faceid_db, "MAX_ATTEMPT_ENTRIES", 5)
    entries = [{"i": i} for i in range(20)]
    faceid_db.ATTEMPT_LOG_PATH.write_text(
        "\n".join(json.dumps(e) for e in entries) + "\n", encoding="utf-8"
    )

    faceid_db.rotate_logs()

    recent = [json.loads(l) for l in faceid_db.ATTEMPT_LOG_PATH.read_text(encoding="utf-8").splitlines()]
    assert recent == entries[-5:]

    archives = list(faceid_db.ARCHIVE_DIR.glob("attempt_stats_*.jsonl"))
    assert len(archives) == 1
    archived = [json.loads(l) for l in archives[0].read_text(encoding="utf-8").splitlines()]
    assert archived == entries[:-5]  # the older 15


def test_rotate_logs_rotates_oversized_log(db_dir, monkeypatch):
    monkeypatch.setattr(faceid_db, "MAX_LOG_SIZE_MB", 0)  # any non-empty log rotates
    faceid_db.LOGGING_PATH.write_text("some log content\n", encoding="utf-8")

    faceid_db.rotate_logs()

    assert not faceid_db.LOGGING_PATH.exists()  # moved to archive
    archived = list(faceid_db.ARCHIVE_DIR.glob("ansikten_*.log"))
    assert len(archived) == 1
    assert archived[0].read_text(encoding="utf-8") == "some log content\n"


# --------------------------------------------------------------------------
# 5. Atomic write
# --------------------------------------------------------------------------

def test_atomic_pickle_write_failure_preserves_original(db_dir, monkeypatch):
    target = faceid_db.ENCODING_PATH
    # Seed an original, valid file.
    original = {"Alice": ["intact"]}
    with open(target, "wb") as f:
        pickle.dump(original, f)

    def boom(*a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(faceid_db.pickle, "dump", boom)

    with pytest.raises(RuntimeError, match="disk full"):
        faceid_db._atomic_pickle_write({"Bob": ["new"]}, target)

    # Original untouched, no temp litter.
    with open(target, "rb") as f:
        assert pickle.load(f) == original
    assert not target.with_suffix(".tmp").exists()


def test_atomic_pickle_write_success_replaces(db_dir):
    target = faceid_db.ENCODING_PATH
    faceid_db._atomic_pickle_write({"x": 1}, target)
    with open(target, "rb") as f:
        assert pickle.load(f) == {"x": 1}
    assert not target.with_suffix(".tmp").exists()


def test_atomic_jsonl_write_failure_preserves_original(db_dir, monkeypatch):
    target = faceid_db.PROCESSED_PATH
    target.write_text('{"name": "orig.NEF", "hash": "h"}\n', encoding="utf-8")

    def boom(*a, **k):
        raise RuntimeError("json boom")

    monkeypatch.setattr(faceid_db.json, "dumps", boom)

    with pytest.raises(RuntimeError, match="json boom"):
        faceid_db._atomic_jsonl_write([{"name": "new.NEF", "hash": "h2"}], target)

    assert target.read_text(encoding="utf-8") == '{"name": "orig.NEF", "hash": "h"}\n'
    assert not target.with_suffix(".tmp").exists()


# --------------------------------------------------------------------------
# 6. flock presence
# --------------------------------------------------------------------------

def test_load_takes_shared_locks(db_dir, monkeypatch):
    faceid_db.save_database({"A": [_entry([1.0])]}, [_entry([2.0])], {"B": [_entry([3.0])]},
                            [{"name": "x.NEF", "hash": "h"}])

    calls = []
    real_flock = fcntl.flock

    def recording_flock(fd, op):
        calls.append(op)
        return real_flock(fd, op)

    monkeypatch.setattr(faceid_db.fcntl, "flock", recording_flock)

    faceid_db.load_database()

    # All four files open with a shared lock; no exclusive locks on read.
    assert calls  # locks were taken
    assert all(op == fcntl.LOCK_SH for op in calls)
    assert len(calls) == 4  # encodings, ignored, hardneg, processed


def test_save_takes_exclusive_locks(db_dir, monkeypatch):
    calls = []
    real_flock = fcntl.flock

    def recording_flock(fd, op):
        calls.append(op)
        return real_flock(fd, op)

    monkeypatch.setattr(faceid_db.fcntl, "flock", recording_flock)

    faceid_db.save_database({"A": [_entry([1.0])]}, [], {}, [])

    assert calls
    assert all(op == fcntl.LOCK_EX for op in calls)
    assert len(calls) == 4  # one exclusive lock per written file


# --------------------------------------------------------------------------
# 7. RestrictedUnpickler
# --------------------------------------------------------------------------

def test_restricted_unpickler_blocks_forbidden_class(db_dir):
    import io
    from datetime import datetime

    # datetime.datetime is not whitelisted.
    payload = pickle.dumps(datetime(2026, 1, 1))
    with pytest.raises(pickle.UnpicklingError, match="Forbidden class"):
        faceid_db.safe_pickle_load(io.BytesIO(payload))


def test_restricted_unpickler_allows_whitelisted(db_dir):
    import io

    payload = pickle.dumps({"Alice": [np.array([1.0, 2.0])], "n": 3, "flag": True})
    out = faceid_db.safe_pickle_load(io.BytesIO(payload))
    assert set(out) == {"Alice", "n", "flag"}
    np.testing.assert_array_equal(out["Alice"][0], np.array([1.0, 2.0]))


def test_load_database_rejects_malicious_pickle(db_dir):
    # A forbidden class in encodings.pkl propagates the UnpicklingError.
    from datetime import datetime

    with open(faceid_db.ENCODING_PATH, "wb") as f:
        pickle.dump({"evil": datetime(2026, 1, 1)}, f)

    with pytest.raises(pickle.UnpicklingError, match="Forbidden class"):
        faceid_db.load_database()
