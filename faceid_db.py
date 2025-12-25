import hashlib
import json
import logging
import pickle
import re
from pathlib import Path

import numpy as np
from xdg.BaseDirectory import xdg_data_home

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
        return {
            "encoding": entry,
            "file": None,
            "hash": None,
            "backend": default_backend,
            "backend_version": "unknown",
            "created_at": None,
            "encoding_hash": hashlib.sha1(entry.tobytes()).hexdigest()
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
            entry["encoding_hash"] = hashlib.sha1(entry["encoding"].tobytes()).hexdigest()
        return entry
    else:
        raise ValueError(f"Invalid encoding entry type: {type(entry)}")


def load_database():
    # Ladda known faces
    if ENCODING_PATH.exists():
        with open(ENCODING_PATH, "rb") as f:
            known_faces = pickle.load(f)
    else:
        known_faces = {}

    # Ladda ignored faces
    if IGNORED_PATH.exists():
        with open(IGNORED_PATH, "rb") as f:
            ignored_faces = pickle.load(f)
    else:
        ignored_faces = []

    # Ladda hard negatives
    if HARDNEG_PATH.exists():
        with open(HARDNEG_PATH, "rb") as f:
            hard_negatives = pickle.load(f)
    else:
        hard_negatives = {}

    # Ladda processed_files
    processed_files = []
    if PROCESSED_PATH.exists():
        with open(PROCESSED_PATH, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if isinstance(entry, dict) and "hash" in entry and "name" in entry:
                        processed_files.append(entry)
                        continue
                except Exception:
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
        for i, entry in enumerate(known_faces[name]):
            if isinstance(entry, np.ndarray) or "backend" not in entry:
                migration_stats['known_faces_migrated'] += 1
            known_faces[name][i] = normalize_encoding_entry(entry)

    # Normalize ignored_faces
    for i, entry in enumerate(ignored_faces):
        if isinstance(entry, np.ndarray) or (isinstance(entry, dict) and "backend" not in entry):
            migration_stats['ignored_faces_migrated'] += 1
        ignored_faces[i] = normalize_encoding_entry(entry)

    # Normalize hard_negatives
    for name in hard_negatives:
        for i, entry in enumerate(hard_negatives[name]):
            if isinstance(entry, np.ndarray) or (isinstance(entry, dict) and "backend" not in entry):
                migration_stats['hard_negatives_migrated'] += 1
            hard_negatives[name][i] = normalize_encoding_entry(entry)

    # Log migration statistics if any migration occurred
    total_migrated = sum(migration_stats.values())
    if total_migrated > 0:
        logging.info(f"[DATABASE] Migrated {total_migrated} encodings to new format:")
        logging.info(f"  Known faces: {migration_stats['known_faces_migrated']}")
        logging.info(f"  Ignored faces: {migration_stats['ignored_faces_migrated']}")
        logging.info(f"  Hard negatives: {migration_stats['hard_negatives_migrated']}")

    return known_faces, ignored_faces, hard_negatives, processed_files


def save_database(known_faces, ignored_faces, hard_negatives, processed_files):
    with open(ENCODING_PATH, "wb") as f:
        pickle.dump(known_faces, f)
    with open(IGNORED_PATH, "wb") as f:
        pickle.dump(ignored_faces, f)
    with open(HARDNEG_PATH, "wb") as f:
        pickle.dump(hard_negatives, f)
    with open(PROCESSED_PATH, "w") as f:
        for entry in processed_files:
            if isinstance(entry, dict):
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            else:
                f.write(json.dumps({"name": entry, "hash": None}) + "\n")


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
                except Exception:
                    pass
    return log


def load_processed_files():
    """Returnerar lista av dicts {"name":..., "hash":...}"""
    _, _, processed_files = load_database()
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
    try:
        if hasattr(path, "read_bytes"):
            # Path-objekt
            return hashlib.sha1(path.read_bytes()).hexdigest()
        else:
            with open(path, "rb") as f:
                return hashlib.sha1(f.read()).hexdigest()
    except Exception as e:
        print(f"[WARN] Kunde inte läsa hash för {path}: {e}")
        return None
