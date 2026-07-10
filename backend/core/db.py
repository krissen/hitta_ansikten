import fcntl
import hashlib
import json
import logging
import pickle
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from io import BufferedReader
from pathlib import Path
from typing import Any

import numpy as np
from xdg.BaseDirectory import xdg_data_home


# === Security: Restricted Unpickler ===
class RestrictedUnpickler(pickle.Unpickler):
    """
    Restricted unpickler that only allows safe classes.

    Prevents arbitrary code execution from malicious pickle files by
    whitelisting only necessary classes (numpy arrays, basic Python types).
    """
    # Whitelist of allowed modules and classes
    ALLOWED_CLASSES = {
        ('numpy', 'ndarray'),
        ('numpy', 'dtype'),
        # Support both old (numpy.core) and new (numpy._core) module paths
        ('numpy.core.multiarray', '_reconstruct'),
        ('numpy.core.multiarray', 'scalar'),
        ('numpy._core.multiarray', '_reconstruct'),  # numpy >= 1.20
        ('numpy._core.multiarray', 'scalar'),        # numpy >= 1.20
        # numpy 2.x reconstructs arrays via _frombuffer instead of _reconstruct
        ('numpy.core.numeric', '_frombuffer'),
        ('numpy._core.numeric', '_frombuffer'),
        ('builtins', 'dict'),
        ('builtins', 'list'),
        ('builtins', 'tuple'),
        ('builtins', 'str'),
        ('builtins', 'int'),
        ('builtins', 'float'),
        ('builtins', 'bool'),
        ('builtins', 'NoneType'),
        ('builtins', 'set'),
        ('builtins', 'frozenset'),
        ('collections', 'OrderedDict'),
        ('collections', 'defaultdict'),
    }

    def find_class(self, module: str, name: str) -> type:
        """Only allow whitelisted classes to be unpickled."""
        if (module, name) in self.ALLOWED_CLASSES:
            return super().find_class(module, name)
        # Log attempted unpickling of forbidden class
        logging.error(f"[SECURITY] Attempted to unpickle forbidden class: {module}.{name}")
        raise pickle.UnpicklingError(f"Forbidden class: {module}.{name}")


def safe_pickle_load(file_handle: BufferedReader) -> Any:
    """Safely load pickle file using RestrictedUnpickler."""
    return RestrictedUnpickler(file_handle).load()


# === Konstanter ===
BASE_DIR = Path(xdg_data_home) / "faceid"
ARCHIVE_DIR = BASE_DIR / "archive"
ATTEMPT_SETTINGS_SIG = BASE_DIR / "attempt_settings.sig"
CONFIG_PATH = BASE_DIR / "config.json"
ENCODING_PATH = BASE_DIR / "encodings.pkl"
IGNORED_PATH = BASE_DIR / "ignored.pkl"
HARDNEG_PATH = BASE_DIR / "hardneg.pkl"
METADATA_PATH = BASE_DIR / "metadata.json"
DB_META_PATH = BASE_DIR / "db_meta.json"
PROCESSED_PATH = BASE_DIR / "processed_files.jsonl"
SUPPORTED_EXT = [".nef", ".NEF"]
ATTEMPT_LOG_PATH = BASE_DIR / "attempt_stats.jsonl"
LOGGING_PATH = BASE_DIR / "ansikten.log"

# Current on-disk encoding schema. A ``db_meta.json`` sidecar recording this
# version means every entry in the pickle collections is already normalized
# (dict form with backend metadata), so ``load_database`` may skip the
# per-entry normalization pass entirely. Bump this if the normalized shape
# produced by ``normalize_encoding_entry`` ever changes — an older marker
# (schema < DB_SCHEMA_VERSION) then forces a fresh full pass + re-save.
DB_SCHEMA_VERSION = 2

# Log rotation settings
MAX_PROCESSED_ENTRIES = 50000    # Max entries in processed_files.jsonl
MAX_ATTEMPT_ENTRIES = 10000      # Max entries in attempt_stats.jsonl
MAX_LOG_SIZE_MB = 10             # Max size of ansikten.log in MB


def normalize_encoding_entry(entry: np.ndarray | dict[str, Any], default_backend: str = "dlib") -> dict[str, Any] | None:
    """
    Normalize encoding entry to dict format with backend metadata.

    Handles:
    - Legacy bare numpy arrays -> dict with dlib backend
    - Dicts without backend metadata -> add dlib backend
    - Modern dicts with full metadata -> pass through

    Args:
        entry: Either a numpy array or dict
        default_backend: Backend to assign for legacy data

    Returns:
        Dict with keys: encoding, file, hash, backend, backend_version,
                       created_at, encoding_hash
    """
    import numpy as np

    if isinstance(entry, np.ndarray):
        # Legacy format: bare array
        try:
            encoding_hash = hashlib.sha1(entry.tobytes()).hexdigest()
        except (AttributeError, ValueError) as e:
            logging.warning(f"Failed to hash encoding: {e}")
            encoding_hash = None

        return {
            "encoding": entry,
            "file": None,
            "hash": None,
            "backend": default_backend,
            "backend_version": "unknown",
            "created_at": None,
            "encoding_hash": encoding_hash
        }
    elif isinstance(entry, dict):
        # Ensure all required fields exist
        if "backend" not in entry:
            entry["backend"] = default_backend
        if "backend_version" not in entry:
            entry["backend_version"] = "unknown"
        if "created_at" not in entry:
            entry["created_at"] = None
        if "encoding_hash" not in entry and entry.get("encoding") is not None:
            try:
                enc = entry["encoding"]
                if hasattr(enc, 'tobytes'):
                    entry["encoding_hash"] = hashlib.sha1(enc.tobytes()).hexdigest()
                else:
                    entry["encoding_hash"] = None
            except (AttributeError, ValueError) as e:
                logging.warning(f"Failed to hash encoding: {e}")
                entry["encoding_hash"] = None
        return entry
    else:
        # Log warning and return None for invalid types (graceful degradation)
        logging.warning(f"Invalid encoding entry type: {type(entry)}, skipping")
        return None


def _entry_needs_normalization(entry: Any) -> bool:
    """Return True if ``normalize_encoding_entry`` would change ``entry``.

    Enumerates every migration the normalizer performs so callers can detect a
    genuine change without relying on the (looser) counting used previously:

    - bare ``np.ndarray`` -> wrapped in a dict;
    - dict missing ``backend`` / ``backend_version`` / ``created_at`` -> filled in;
    - dict missing ``encoding_hash`` while ``encoding`` is not None -> hash backfilled.

    A dict with ``encoding=None`` (manual face) never gets ``encoding_hash``, so
    its absence is not a migration need. Non-array/non-dict entries are corrupt
    (the normalizer drops them) and are handled separately by the caller — this
    predicate returns False for them.
    """
    if isinstance(entry, np.ndarray):
        return True
    if isinstance(entry, dict):
        if "backend" not in entry or "backend_version" not in entry or "created_at" not in entry:
            return True
        if "encoding_hash" not in entry and entry.get("encoding") is not None:
            return True
        return False
    return False


def _normalize_collection(entries: list[Any]) -> tuple[list[dict[str, Any]], int, int]:
    """Normalize a list of encoding entries.

    Returns ``(normalized_entries, migrated_count, corrupt_count)`` where
    ``migrated_count`` is the number of entries that actually needed a schema
    migration and ``corrupt_count`` is the number dropped (normalizer returned
    None). Dropping corrupt entries is in-memory only — the caller decides
    whether to persist, and never persists when any entry was corrupt.
    """
    normalized: list[dict[str, Any]] = []
    migrated = 0
    corrupt = 0
    for entry in entries:
        if _entry_needs_normalization(entry):
            migrated += 1
        norm_entry = normalize_encoding_entry(entry)
        if norm_entry is None:
            corrupt += 1
            continue
        normalized.append(norm_entry)
    return normalized, migrated, corrupt


def _read_schema_version() -> int | None:
    """Read the schema version from the ``db_meta.json`` sidecar.

    Returns the integer schema, or None when the marker is absent, unreadable,
    or malformed — in which case the caller falls back to a full normalization
    pass (safe default).
    """
    try:
        with open(DB_META_PATH, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
        return None
    version = meta.get("schema") if isinstance(meta, dict) else None
    return version if isinstance(version, int) else None


def _write_schema_marker() -> None:
    """Atomically record that the DB is normalized to the current schema.

    Written via temp-file + rename so a concurrent reader (CLI or server) never
    sees a half-written marker. Failure is non-fatal: if the marker cannot be
    written, the next load simply re-normalizes (as today) — no data is at risk.
    """
    temp_path = DB_META_PATH.with_suffix(".tmp")
    try:
        BASE_DIR.mkdir(parents=True, exist_ok=True)
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump({"schema": DB_SCHEMA_VERSION}, f)
        temp_path.replace(DB_META_PATH)
    except OSError as e:
        logging.warning(f"[DATABASE] Failed to write schema marker: {e}")
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def load_database() -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]], dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    """
    Load database with file locking to ensure consistency.

    Uses shared locks (LOCK_SH) to allow multiple concurrent readers
    while blocking if a writer has exclusive lock.
    """
    # Ladda known faces
    if ENCODING_PATH.exists():
        with open(ENCODING_PATH, "rb") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_SH)
            known_faces = safe_pickle_load(f)
            # Lock released on close
    else:
        known_faces = {}

    # Ladda ignored faces
    if IGNORED_PATH.exists():
        with open(IGNORED_PATH, "rb") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_SH)
            ignored_faces = safe_pickle_load(f)
    else:
        ignored_faces = []

    # Ladda hard negatives
    if HARDNEG_PATH.exists():
        with open(HARDNEG_PATH, "rb") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_SH)
            hard_negatives = safe_pickle_load(f)
    else:
        hard_negatives = {}

    # Ladda processed_files
    processed_files = []
    if PROCESSED_PATH.exists():
        with open(PROCESSED_PATH, "r", encoding="utf-8") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_SH)
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if isinstance(entry, dict) and "hash" in entry and "name" in entry:
                        processed_files.append(entry)
                        continue
                except Exception as e:
                    logging.debug(f"Failed to parse processed file entry: {e}")
                    pass
                # fallback legacy
                processed_files.append({"name": line, "hash": None})

    # One-time migration: if a previous run already normalized the DB to the
    # current schema (recorded in db_meta.json), skip the per-entry pass
    # entirely. Every consume site (core.matching.filter_database_by_backend,
    # the management/refinement/statistics services) tolerates bare arrays and
    # backend-less dicts by construction (defaulting to the 'dlib' backend), so
    # a legacy entry that sneaks past the marker via an external tool is
    # harmlessly ignored during matching rather than crashing it. That
    # defensiveness is the belt-and-braces that makes trusting the marker safe.
    if (schema := _read_schema_version()) is not None and schema >= DB_SCHEMA_VERSION:
        return known_faces, ignored_faces, hard_negatives, processed_files

    # Normalize all encodings to include backend metadata (full pass — first
    # load, or marker missing/stale).
    kf_migrated = kf_corrupt = 0
    for name in known_faces:
        known_faces[name], m, c = _normalize_collection(known_faces[name])
        kf_migrated += m
        kf_corrupt += c

    ignored_faces, if_migrated, if_corrupt = _normalize_collection(ignored_faces)

    hn_migrated = hn_corrupt = 0
    for name in hard_negatives:
        hard_negatives[name], m, c = _normalize_collection(hard_negatives[name])
        hn_migrated += m
        hn_corrupt += c

    total_migrated = kf_migrated + if_migrated + hn_migrated
    total_corrupt = kf_corrupt + if_corrupt + hn_corrupt

    if total_migrated > 0:
        logging.info(f"[DATABASE] Migrated {total_migrated} encodings to new format:")
        logging.info(f"  Known faces: {kf_migrated}")
        logging.info(f"  Ignored faces: {if_migrated}")
        logging.info(f"  Hard negatives: {hn_migrated}")

    # Persist the migration and record the schema marker so future loads skip
    # the pass. Two safety rules:
    #   1. Only write the DATA files when normalization actually changed
    #      something (total_migrated > 0) — a no-op load never rewrites the
    #      irreplaceable pickles; it only drops the (tiny) marker.
    #   2. If ANY entry was corrupt, do nothing: no data save (a save-back
    #      would silently drop the corrupt entry from disk, unlike today) and
    #      no marker (so the DB keeps being re-normalized every load, exactly
    #      as today). This preserves the pinned corrupt-entry behavior.
    # Single-writer assumption: this read-modify-write holds no lock across
    # R+W, so a writer mutating concurrently with the ONE-TIME first-migration
    # load could be clobbered by the save-back. This matches save_database's
    # pre-existing single-writer model (the GUI serializes writes through
    # FaceDBStore; CLI-vs-server concurrent writes were always last-writer-
    # wins) and only applies to the single upgrade event per database.
    if total_corrupt == 0:
        if total_migrated > 0:
            only = set()
            if kf_migrated:
                only.add("known")
            if if_migrated:
                only.add("ignored")
            if hn_migrated:
                only.add("hardneg")
            try:
                save_database(known_faces, ignored_faces, hard_negatives, processed_files, only=only)
            except Exception as e:
                # Migration save failed — leave the on-disk data as-is and do
                # NOT mark; the next load retries the migration.
                logging.warning(f"[DATABASE] Migration save failed, will retry next load: {e}")
            else:
                _write_schema_marker()
        else:
            # Already-clean DB with no marker (e.g. first load after upgrade):
            # record the marker so subsequent loads skip the pass. No data write.
            _write_schema_marker()

    return known_faces, ignored_faces, hard_negatives, processed_files


def _atomic_pickle_write(data, target_path):
    """Write pickle file atomically with exclusive lock."""
    temp_path = target_path.with_suffix('.tmp')
    try:
        with open(temp_path, "wb") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            pickle.dump(data, f)
        temp_path.replace(target_path)
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        raise e


def _atomic_jsonl_write(entries, target_path):
    """Write JSONL file atomically with exclusive lock."""
    temp_path = target_path.with_suffix('.tmp')
    try:
        with open(temp_path, "w", encoding="utf-8") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            for entry in entries:
                if isinstance(entry, dict):
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                else:
                    f.write(json.dumps({"name": entry, "hash": None}, ensure_ascii=False) + "\n")
        temp_path.replace(target_path)
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        raise e


# The four writable database collections, in canonical order. Used by
# save_database's ``only`` parameter for per-collection (dirty-flag) saves.
DB_COLLECTIONS = frozenset({"known", "ignored", "hardneg", "processed"})


def save_database(
    known_faces: dict[str, list[dict[str, Any]]],
    ignored_faces: list[dict[str, Any]],
    hard_negatives: dict[str, list[dict[str, Any]]],
    processed_files: list[dict[str, Any]],
    only: set[str] | frozenset[str] | None = None,
) -> None:
    """
    Save database with atomic writes and file locking to prevent corruption.

    Uses atomic write pattern (write to temp file, then rename) to ensure
    database files are never left in a partially-written state.

    Args:
        known_faces, ignored_faces, hard_negatives, processed_files:
            The four collections to persist.
        only: Optional subset of ``DB_COLLECTIONS`` ({'known', 'ignored',
            'hardneg', 'processed'}) naming exactly which files to rewrite.
            ``None`` (default) rewrites all four — preserving CLI/legacy
            behavior. Unknown names raise ``ValueError``. Only the named files
            are touched on disk; the others keep their existing mtime/size.

    Multi-file saves write in parallel (ThreadPoolExecutor). A single-file save
    writes inline (no pool overhead).
    """
    if only is not None:
        unknown = set(only) - DB_COLLECTIONS
        if unknown:
            raise ValueError(f"save_database: unknown collections in only={sorted(unknown)}")
        selected = frozenset(only)
    else:
        selected = DB_COLLECTIONS

    if not selected:
        return  # Nothing selected — nothing to write.

    BASE_DIR.mkdir(parents=True, exist_ok=True)

    # (writer, data, path) for each selected file.
    writes = []
    if "known" in selected:
        writes.append((_atomic_pickle_write, known_faces, ENCODING_PATH))
    if "ignored" in selected:
        writes.append((_atomic_pickle_write, ignored_faces, IGNORED_PATH))
    if "hardneg" in selected:
        writes.append((_atomic_pickle_write, hard_negatives, HARDNEG_PATH))
    if "processed" in selected:
        writes.append((_atomic_jsonl_write, processed_files, PROCESSED_PATH))

    if len(writes) == 1:
        # Single-file save: skip the thread-pool overhead.
        writer, data, path = writes[0]
        writer(data, path)
        return

    # Multi-file save: write in parallel for better throughput.
    with ThreadPoolExecutor(max_workers=len(writes)) as pool:
        futures = [pool.submit(writer, data, path) for writer, data, path in writes]
        # Raise first exception if any write failed
        for f in futures:
            f.result()


def load_attempt_log(all_files: bool = False) -> list[dict[str, Any]]:
    """Returnerar samtliga entries från attempt-logg (ev. även arkiv)"""
    log = []
    files = [ATTEMPT_LOG_PATH]
    if all_files and ARCHIVE_DIR.exists():
        files += sorted(ARCHIVE_DIR.glob("attempt_stats*.jsonl"))
    for fp in files:
        if not Path(fp).exists():
            continue
        with open(fp, "r") as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    log.append(entry)
                except Exception as e:
                    logging.debug(f"Failed to parse attempt log entry: {e}")
                    pass
    return log


def load_processed_files() -> list[dict[str, Any]]:
    """Returnerar lista av dicts {"name":..., "hash":...}"""
    _, _, _, processed_files = load_database()
    if processed_files and isinstance(processed_files[0], str):
        return [{"name": pf, "hash": None} for pf in processed_files]
    return processed_files


def extract_face_labels(labels: list[str | dict[str, Any]]) -> list[str]:
    """Tar ut alla personnamn från en labels_per_attempt-lista."""
    persons = []
    for label in labels:
        if isinstance(label, dict):
            label = label.get("label", "")
        match = re.match(r"#\d+\n(.+)", label)
        if match:
            name = match.group(1).strip()
            if name.lower() not in {"ignorerad", "okänt", "ign"}:
                persons.append(name)
    return persons


def get_file_hash(path: Path | str) -> str | None:
    """
    Compute SHA1 hash of a file using chunked reading.

    Args:
        path: Path object or string path to file

    Returns:
        SHA1 hex digest string, or None on error
    """
    h = hashlib.sha1()
    try:
        with open(path, "rb") as f:
            while True:
                chunk = f.read(65536)  # 64KB chunks for large files
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()
    except Exception as e:
        logging.warning(f"Failed to compute file hash for {path}: {e}")
        return None


def rotate_logs() -> None:
    """
    Rotate log files to prevent unbounded growth.

    - processed_files.jsonl: Keep last MAX_PROCESSED_ENTRIES entries
    - attempt_stats.jsonl: Keep last MAX_ATTEMPT_ENTRIES entries
    - ansikten.log: Rotate when exceeding MAX_LOG_SIZE_MB
    """
    # Rotate processed_files.jsonl
    if PROCESSED_PATH.exists():
        try:
            entries = []
            with open(PROCESSED_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass

            if len(entries) > MAX_PROCESSED_ENTRIES:
                # Keep the most recent entries
                entries = entries[-MAX_PROCESSED_ENTRIES:]
                with open(PROCESSED_PATH, "w", encoding="utf-8") as f:
                    for entry in entries:
                        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                logging.info(f"[LogRotation] Trimmed processed_files.jsonl to {len(entries)} entries")
        except Exception as e:
            logging.warning(f"[LogRotation] Failed to rotate processed_files.jsonl: {e}")

    # Rotate attempt_stats.jsonl
    if ATTEMPT_LOG_PATH.exists():
        try:
            entries = []
            with open(ATTEMPT_LOG_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass

            if len(entries) > MAX_ATTEMPT_ENTRIES:
                # Archive old entries
                ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
                archive_name = f"attempt_stats_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"
                archive_path = ARCHIVE_DIR / archive_name

                # Write old entries to archive
                old_entries = entries[:-MAX_ATTEMPT_ENTRIES]
                with open(archive_path, "w", encoding="utf-8") as f:
                    for entry in old_entries:
                        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

                # Keep recent entries in main file
                recent_entries = entries[-MAX_ATTEMPT_ENTRIES:]
                with open(ATTEMPT_LOG_PATH, "w", encoding="utf-8") as f:
                    for entry in recent_entries:
                        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

                logging.info(f"[LogRotation] Archived {len(old_entries)} attempt entries to {archive_name}")
        except Exception as e:
            logging.warning(f"[LogRotation] Failed to rotate attempt_stats.jsonl: {e}")

    # Rotate ansikten.log
    if LOGGING_PATH.exists():
        try:
            size_mb = LOGGING_PATH.stat().st_size / (1024 * 1024)
            if size_mb > MAX_LOG_SIZE_MB:
                # Rotate to archive
                ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
                archive_name = f"ansikten_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
                archive_path = ARCHIVE_DIR / archive_name

                # Move current log to archive
                LOGGING_PATH.rename(archive_path)
                logging.info(f"[LogRotation] Rotated log file to {archive_name}")

                # Clean up old archived logs (keep last 5)
                archived_logs = sorted(ARCHIVE_DIR.glob("ansikten_*.log"))
                if len(archived_logs) > 5:
                    for old_log in archived_logs[:-5]:
                        old_log.unlink()
                        logging.debug(f"[LogRotation] Deleted old archived log: {old_log.name}")
        except Exception as e:
            logging.warning(f"[LogRotation] Failed to rotate ansikten.log: {e}")
