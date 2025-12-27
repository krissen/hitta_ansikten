import fcntl
import hashlib
import json
import logging
import pickle
import re
from pathlib import Path

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
        ('numpy.core.multiarray', '_reconstruct'),
        ('numpy.core.multiarray', 'scalar'),
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

    def find_class(self, module, name):
        """Only allow whitelisted classes to be unpickled."""
        if (module, name) in self.ALLOWED_CLASSES:
            return super().find_class(module, name)
        # Log attempted unpickling of forbidden class
        logging.error(f"[SECURITY] Attempted to unpickle forbidden class: {module}.{name}")
        raise pickle.UnpicklingError(f"Forbidden class: {module}.{name}")


def safe_pickle_load(file_handle):
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
LOGGING_PATH = BASE_DIR / "hitta_ansikten.log"


def normalize_encoding_entry(entry, default_backend="dlib"):
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


def load_database():
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

    # Log migration statistics if any migration occurred
    total_migrated = sum(migration_stats.values())
    if total_migrated > 0:
        logging.info(f"[DATABASE] Migrated {total_migrated} encodings to new format:")
        logging.info(f"  Known faces: {migration_stats['known_faces_migrated']}")
        logging.info(f"  Ignored faces: {migration_stats['ignored_faces_migrated']}")
        logging.info(f"  Hard negatives: {migration_stats['hard_negatives_migrated']}")
    else:
        logging.debug("[DATABASE] Database already in current format, no migration needed")

    return known_faces, ignored_faces, hard_negatives, processed_files


def save_database(known_faces, ignored_faces, hard_negatives, processed_files):
    """
    Save database with atomic writes and file locking to prevent corruption.

    Uses atomic write pattern (write to temp file, then rename) to ensure
    database files are never left in a partially-written state.
    """
    BASE_DIR.mkdir(parents=True, exist_ok=True)

    def atomic_pickle_write(data, target_path):
        """Write pickle file atomically with exclusive lock."""
        temp_path = target_path.with_suffix('.tmp')
        try:
            with open(temp_path, "wb") as f:
                # Acquire exclusive lock to prevent concurrent writes
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                pickle.dump(data, f)
                # Lock released automatically on close
            # Atomic rename - replaces target atomically
            temp_path.replace(target_path)
        except Exception as e:
            # Clean up temp file on error
            if temp_path.exists():
                temp_path.unlink()
            raise e

    def atomic_jsonl_write(entries, target_path):
        """Write JSONL file atomically with exclusive lock."""
        temp_path = target_path.with_suffix('.tmp')
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                # Acquire exclusive lock
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                for entry in entries:
                    if isinstance(entry, dict):
                        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                    else:
                        f.write(json.dumps({"name": entry, "hash": None}, ensure_ascii=False) + "\n")
            # Atomic rename
            temp_path.replace(target_path)
        except Exception as e:
            if temp_path.exists():
                temp_path.unlink()
            raise e

    # Write all database files atomically
    atomic_pickle_write(known_faces, ENCODING_PATH)
    atomic_pickle_write(ignored_faces, IGNORED_PATH)
    atomic_pickle_write(hard_negatives, HARDNEG_PATH)
    atomic_jsonl_write(processed_files, PROCESSED_PATH)


def load_attempt_log(all_files=False):
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


def load_processed_files():
    """Returnerar lista av dicts {"name":..., "hash":...}"""
    _, _, _, processed_files = load_database()
    if processed_files and isinstance(processed_files[0], str):
        return [{"name": pf, "hash": None} for pf in processed_files]
    return processed_files


def extract_face_labels(labels):
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


def get_file_hash(path):
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
