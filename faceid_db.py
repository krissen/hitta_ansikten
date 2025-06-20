import json
import pickle
import re
from pathlib import Path

from xdg import xdg_data_home

# === Konstanter ===
BASE_DIR = xdg_data_home() / "faceid"
ARCHIVE_DIR = BASE_DIR / "archive"
ATTEMPT_SETTINGS_SIG = BASE_DIR / "attempt_settings.sig"
CONFIG_PATH = BASE_DIR / "config.json"
ENCODING_PATH = BASE_DIR / "encodings.pkl"
IGNORED_PATH = BASE_DIR / "ignored.pkl"
METADATA_PATH = BASE_DIR / "metadata.json"
PROCESSED_PATH = BASE_DIR / "processed_files.jsonl"
SUPPORTED_EXT = [".nef", ".NEF"]
ATTEMPT_LOG_PATH = BASE_DIR / "attempt_stats.jsonl"


def load_database():
    if ENCODING_PATH.exists():
        with open(ENCODING_PATH, "rb") as f:
            known_faces = pickle.load(f)
    else:
        known_faces = {}

    if IGNORED_PATH.exists():
        with open(IGNORED_PATH, "rb") as f:
            ignored_faces = pickle.load(f)
    else:
        ignored_faces = []

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
    return known_faces, ignored_faces, processed_files


def save_database(known_faces, ignored_faces, processed_files):
    with open(ENCODING_PATH, "wb") as f:
        pickle.dump(known_faces, f)
    with open(IGNORED_PATH, "wb") as f:
        pickle.dump(ignored_faces, f)
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
        with open(path, "rb") as f:
            return hashlib.sha1(f.read()).hexdigest()
    except Exception:
        return None
