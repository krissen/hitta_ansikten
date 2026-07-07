"""Characterization tests for core.db (the pickle + jsonl data layer).

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

from core import db as faceid_db

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
    monkeypatch.setattr(faceid_db, "DB_META_PATH", base / "db_meta.json")
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


def test_save_only_rewrites_named_files(db_dir):
    """save_database(only={'known'}) rewrites just encodings.pkl; the other
    three keep their mtime (per-collection dirty-flag save)."""
    faceid_db.save_database(
        {"Alice": [_entry([1.0])]},
        [_entry([0.1])],
        {"Carol": [_entry([9.0])]},
        [{"name": "a.NEF", "hash": "h"}],
    )
    others = {
        p: p.stat().st_mtime_ns
        for p in (faceid_db.IGNORED_PATH, faceid_db.HARDNEG_PATH, faceid_db.PROCESSED_PATH)
    }
    enc_before = faceid_db.ENCODING_PATH.stat().st_mtime_ns

    # Bump mtimes so a rewrite is unambiguously detectable.
    import os
    for p in others:
        st = p.stat()
        os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns))

    faceid_db.save_database(
        {"Alice": [_entry([1.0])], "Bob": [_entry([2.0])]}, [], {}, [], only={"known"}
    )

    assert faceid_db.ENCODING_PATH.stat().st_mtime_ns != enc_before
    for p, mtime in others.items():
        assert p.stat().st_mtime_ns == mtime, f"{p.name} was rewritten"
    # Only known.pkl content changed; the untouched files keep old content.
    known, ignored, hardneg, processed = faceid_db.load_database()
    assert set(known.keys()) == {"Alice", "Bob"}
    assert len(ignored) == 1  # unchanged on disk
    assert "Carol" in hardneg
    assert processed == [{"name": "a.NEF", "hash": "h"}]


def test_save_only_subset_rewrites_exactly_those(db_dir):
    faceid_db.save_database({}, [], {}, [])
    paths = {
        "known": faceid_db.ENCODING_PATH,
        "ignored": faceid_db.IGNORED_PATH,
        "hardneg": faceid_db.HARDNEG_PATH,
        "processed": faceid_db.PROCESSED_PATH,
    }
    before = {k: p.stat().st_mtime_ns for k, p in paths.items()}
    import os
    for p in paths.values():
        st = p.stat()
        os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns))

    faceid_db.save_database(
        {"A": [_entry([1.0])]}, [], {"B": [_entry([2.0])]}, [],
        only={"known", "hardneg"},
    )
    assert paths["known"].stat().st_mtime_ns != before["known"]
    assert paths["hardneg"].stat().st_mtime_ns != before["hardneg"]
    assert paths["ignored"].stat().st_mtime_ns == before["ignored"]
    assert paths["processed"].stat().st_mtime_ns == before["processed"]


def test_save_only_empty_set_is_noop(db_dir):
    # Files must not even be created when only=set().
    faceid_db.save_database({"A": [_entry([1.0])]}, [], {}, [], only=set())
    assert not faceid_db.ENCODING_PATH.exists()


def test_save_only_unknown_collection_raises(db_dir):
    with pytest.raises(ValueError):
        faceid_db.save_database({}, [], {}, [], only={"known", "bogus"})


def test_save_only_none_rewrites_all(db_dir):
    faceid_db.save_database({}, [], {}, [], only=None)
    for p in (faceid_db.ENCODING_PATH, faceid_db.IGNORED_PATH,
              faceid_db.HARDNEG_PATH, faceid_db.PROCESSED_PATH):
        assert p.exists()


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
# 1b. One-time normalization with schema marker
# --------------------------------------------------------------------------

def _write_legacy_encodings(base):
    """Seed encodings.pkl with legacy-format entries needing migration:
    a bare ndarray, a dict missing 'backend', and a dict missing 'encoding_hash'.
    """
    legacy = {
        "Alice": [
            np.array([1.0, 2.0, 3.0]),                      # bare array
            {"encoding": np.array([4.0, 5.0, 6.0])},        # dict missing backend/hash
        ],
        "Bob": [
            {"encoding": np.array([7.0, 8.0]), "backend": "insightface"},  # missing hash/version/created_at
        ],
    }
    with open(base / "encodings.pkl", "wb") as f:
        pickle.dump(legacy, f)


def test_first_load_migrates_and_writes_marker(db_dir):
    _write_legacy_encodings(db_dir)
    assert not faceid_db.DB_META_PATH.exists()

    known, _, _, _ = faceid_db.load_database()

    # Entries normalized in the returned data.
    for name in ("Alice", "Bob"):
        for entry in known[name]:
            assert isinstance(entry, dict)
            assert "backend" in entry
            assert "backend_version" in entry
            assert "created_at" in entry
            assert entry["encoding_hash"] is not None

    # Marker written at the current schema.
    assert faceid_db.DB_META_PATH.exists()
    meta = json.loads(faceid_db.DB_META_PATH.read_text(encoding="utf-8"))
    assert meta == {"schema": faceid_db.DB_SCHEMA_VERSION}

    # Migration was persisted back to disk: reloading the raw pickle shows dicts.
    with open(faceid_db.ENCODING_PATH, "rb") as f:
        raw = faceid_db.safe_pickle_load(f)
    assert all(isinstance(e, dict) and "backend" in e for e in raw["Alice"])
    assert all(isinstance(e, dict) and "backend" in e for e in raw["Bob"])


def test_second_load_skips_normalization(db_dir, monkeypatch):
    _write_legacy_encodings(db_dir)
    faceid_db.load_database()  # first load: migrates + writes marker

    calls = []
    real = faceid_db.normalize_encoding_entry

    def counting(entry, *a, **k):
        calls.append(entry)
        return real(entry, *a, **k)

    monkeypatch.setattr(faceid_db, "normalize_encoding_entry", counting)

    faceid_db.load_database()  # second load: marker present -> skip pass
    assert calls == []  # normalize_encoding_entry never invoked


def test_marker_missing_forces_full_pass(db_dir, monkeypatch):
    _write_legacy_encodings(db_dir)
    faceid_db.load_database()
    assert faceid_db.DB_META_PATH.exists()
    faceid_db.DB_META_PATH.unlink()  # simulate missing marker

    calls = []
    real = faceid_db.normalize_encoding_entry
    monkeypatch.setattr(
        faceid_db, "normalize_encoding_entry",
        lambda entry, *a, **k: (calls.append(entry), real(entry, *a, **k))[1],
    )
    faceid_db.load_database()
    assert calls  # full pass ran again (compat when marker absent)
    assert faceid_db.DB_META_PATH.exists()  # marker re-created


def test_stale_marker_forces_full_pass(db_dir):
    _write_legacy_encodings(db_dir)
    # Marker at an older schema must not short-circuit migration.
    faceid_db.DB_META_PATH.write_text(json.dumps({"schema": faceid_db.DB_SCHEMA_VERSION - 1}), encoding="utf-8")

    known, _, _, _ = faceid_db.load_database()
    assert all("backend" in e for e in known["Alice"])  # migrated despite marker
    meta = json.loads(faceid_db.DB_META_PATH.read_text(encoding="utf-8"))
    assert meta == {"schema": faceid_db.DB_SCHEMA_VERSION}  # bumped to current


def test_clean_load_writes_marker_without_rewriting_data(db_dir):
    # Already-normalized DB, but no marker yet (e.g. first load after upgrade).
    faceid_db.save_database({"Alice": [_entry([1.0, 2.0])]}, [], {}, [])
    faceid_db.DB_META_PATH.unlink(missing_ok=True) if faceid_db.DB_META_PATH.exists() else None
    # save_database does not write the marker; ensure it is absent.
    if faceid_db.DB_META_PATH.exists():
        faceid_db.DB_META_PATH.unlink()

    import os
    st = faceid_db.ENCODING_PATH.stat()
    os.utime(faceid_db.ENCODING_PATH, ns=(st.st_atime_ns, st.st_mtime_ns))
    enc_mtime = faceid_db.ENCODING_PATH.stat().st_mtime_ns

    faceid_db.load_database()

    # Marker written, but the data file was NOT rewritten (no migration needed).
    assert faceid_db.DB_META_PATH.exists()
    assert faceid_db.ENCODING_PATH.stat().st_mtime_ns == enc_mtime


def test_corrupt_entry_no_marker_no_save(db_dir):
    # A corrupt (non-array, non-dict) entry must behave exactly as today:
    # dropped in-memory, NOT persisted, and NO marker written (so it keeps
    # being handled on every load).
    with open(faceid_db.ENCODING_PATH, "wb") as f:
        pickle.dump({"Alice": [np.array([1.0, 2.0]), "corrupt_string"]}, f)

    known, _, _, _ = faceid_db.load_database()

    # Corrupt entry dropped in the returned data; valid one kept + normalized.
    assert len(known["Alice"]) == 1
    assert isinstance(known["Alice"][0], dict)

    # No marker (DB not certified clean).
    assert not faceid_db.DB_META_PATH.exists()

    # On-disk pickle still contains the corrupt entry (not silently dropped).
    with open(faceid_db.ENCODING_PATH, "rb") as f:
        raw = faceid_db.safe_pickle_load(f)
    assert any(e == "corrupt_string" for e in raw["Alice"] if isinstance(e, str))


def test_corrupt_in_one_collection_suppresses_save_of_another(db_dir):
    # Cross-collection suppression: a corrupt entry in IGNORED must suppress
    # the save-back of migrated KNOWN entries too (global all-clean gate) —
    # the on-disk known pickle must keep its legacy form and no marker appears.
    with open(faceid_db.ENCODING_PATH, "wb") as f:
        pickle.dump({"Alice": [np.array([1.0, 2.0])]}, f)  # legacy bare array
    with open(faceid_db.IGNORED_PATH, "wb") as f:
        pickle.dump([np.array([3.0, 4.0]), "corrupt_string"], f)

    known, _, _, _ = faceid_db.load_database()

    # In-memory: known migrated to dict form as always.
    assert isinstance(known["Alice"][0], dict)
    # No marker, and the known pickle was NOT rewritten (still legacy on disk).
    assert not faceid_db.DB_META_PATH.exists()
    with open(faceid_db.ENCODING_PATH, "rb") as f:
        raw = faceid_db.safe_pickle_load(f)
    assert isinstance(raw["Alice"][0], np.ndarray)


def test_marker_present_but_legacy_entry_does_not_crash(db_dir):
    # Marker says schema is current, but an external tool wrote a legacy bare
    # array. load_database trusts the marker and skips normalization; the entry
    # comes back raw (no crash), and the defensive consume sites tolerate it.
    with open(faceid_db.ENCODING_PATH, "wb") as f:
        pickle.dump({"Alice": [np.array([1.0, 2.0, 3.0])]}, f)
    faceid_db.DB_META_PATH.write_text(json.dumps({"schema": faceid_db.DB_SCHEMA_VERSION}), encoding="utf-8")

    known, _, _, _ = faceid_db.load_database()
    # Skipped normalization: the bare array is returned unchanged.
    assert isinstance(known["Alice"][0], np.ndarray)


def test_malformed_marker_falls_back_to_full_pass(db_dir):
    _write_legacy_encodings(db_dir)
    faceid_db.DB_META_PATH.write_text("{not valid json", encoding="utf-8")

    known, _, _, _ = faceid_db.load_database()
    # Unreadable marker -> treated as missing -> full pass migrates.
    assert all("backend" in e for e in known["Alice"])
    meta = json.loads(faceid_db.DB_META_PATH.read_text(encoding="utf-8"))
    assert meta == {"schema": faceid_db.DB_SCHEMA_VERSION}


def test_entry_needs_normalization_predicate():
    assert faceid_db._entry_needs_normalization(np.array([1.0])) is True
    assert faceid_db._entry_needs_normalization({"encoding": np.array([1.0])}) is True
    # Missing only encoding_hash (with a real encoding) still needs migration.
    assert faceid_db._entry_needs_normalization(
        {"encoding": np.array([1.0]), "backend": "insightface",
         "backend_version": "x", "created_at": None}
    ) is True
    # Manual face (encoding=None) without encoding_hash does NOT need migration.
    assert faceid_db._entry_needs_normalization(
        {"encoding": None, "backend": "dlib", "backend_version": "unknown",
         "created_at": None}
    ) is False
    # Fully normalized -> no migration.
    assert faceid_db._entry_needs_normalization(_entry([1.0, 2.0])) is False
    # Corrupt -> predicate returns False (handled separately as a drop).
    assert faceid_db._entry_needs_normalization("junk") is False


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

    kept = [json.loads(line) for line in faceid_db.PROCESSED_PATH.read_text(encoding="utf-8").splitlines()]
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

    recent = [json.loads(line) for line in faceid_db.ATTEMPT_LOG_PATH.read_text(encoding="utf-8").splitlines()]
    assert recent == entries[-5:]

    archives = list(faceid_db.ARCHIVE_DIR.glob("attempt_stats_*.jsonl"))
    assert len(archives) == 1
    archived = [json.loads(line) for line in archives[0].read_text(encoding="utf-8").splitlines()]
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
