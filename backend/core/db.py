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
PROCESSED_PATH = BASE_DIR / "processed_files.jsonl"
SUPPORTED_EXT = [".nef", ".NEF"]
ATTEMPT_LOG_PATH = BASE_DIR / "attempt_stats.jsonl"
LOGGING_PATH = BASE_DIR / "ansikten.log"

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

    # Normalize all encodings to include backend metadata
    migration_stats = {
        'known_faces_migrated': 0,
        'ignored_faces_migrated': 0,
        'hard_negatives_migrated': 0
    }

    # Normalize known_faces
    for name in known_faces:
        normalized = []
        for entry in known_faces[name]:
            if isinstance(entry, np.ndarray) or (isinstance(entry, dict) and "backend" not in entry):
                migration_stats['known_faces_migrated'] += 1
            norm_entry = normalize_encoding_entry(entry)
            if norm_entry is not None:  # Skip corrupted entries
                normalized.append(norm_entry)
        known_faces[name] = normalized

    # Normalize ignored_faces
    normalized = []
    for entry in ignored_faces:
        if isinstance(entry, np.ndarray) or (isinstance(entry, dict) and "backend" not in entry):
            migration_stats['ignored_faces_migrated'] += 1
        norm_entry = normalize_encoding_entry(entry)
        if norm_entry is not None:  # Skip corrupted entries
            normalized.append(norm_entry)
    ignored_faces = normalized

    # Normalize hard_negatives
    for name in hard_negatives:
        normalized = []
        for entry in hard_negatives[name]:
            if isinstance(entry, np.ndarray) or (isinstance(entry, dict) and "backend" not in entry):
                migration_stats['hard_negatives_migrated'] += 1
            norm_entry = normalize_encoding_entry(entry)
            if norm_entry is not None:  # Skip corrupted entries
                normalized.append(norm_entry)
        hard_negatives[name] = normalized

    total_migrated = sum(migration_stats.values())
    if total_migrated > 0:
        logging.info(f"[DATABASE] Migrated {total_migrated} encodings to new format:")
        logging.info(f"  Known faces: {migration_stats['known_faces_migrated']}")
        logging.info(f"  Ignored faces: {migration_stats['ignored_faces_migrated']}")
        logging.info(f"  Hard negatives: {migration_stats['hard_negatives_migrated']}")

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


def save_database(
    known_faces: dict[str, list[dict[str, Any]]],
    ignored_faces: list[dict[str, Any]],
    hard_negatives: dict[str, list[dict[str, Any]]],
    processed_files: list[dict[str, Any]]
) -> None:
    """
    Save database with atomic writes and file locking to prevent corruption.

    Uses atomic write pattern (write to temp file, then rename) to ensure
    database files are never left in a partially-written state.
    Writes the four files in parallel for better throughput.
    """
    BASE_DIR.mkdir(parents=True, exist_ok=True)

    # Write all database files in parallel
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [
            pool.submit(_atomic_pickle_write, known_faces, ENCODING_PATH),
            pool.submit(_atomic_pickle_write, ignored_faces, IGNORED_PATH),
            pool.submit(_atomic_pickle_write, hard_negatives, HARDNEG_PATH),
            pool.submit(_atomic_jsonl_write, processed_files, PROCESSED_PATH),
        ]
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
