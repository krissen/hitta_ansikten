import glob
import hashlib
import json
import pickle
import sys
from pathlib import Path

# Import utilities from faceid_db
from faceid_db import safe_pickle_load, get_file_hash

ENCODINGS_PATH = Path.home() / ".local/share/faceid/encodings.pkl"
BACKUP_PATH = Path(str(ENCODINGS_PATH) + ".bak")
ATTEMPTS_FILES = [Path.home() / ".local/share/faceid/attempt_stats.jsonl"]
ARCHIVE_DIR = Path.home() / ".local/share/faceid/archive"
if ARCHIVE_DIR.exists():
    ATTEMPTS_FILES += sorted(ARCHIVE_DIR.glob("attempt_stats*.jsonl"))


def build_attempt_hash_map(attempt_files):
    filehash_map = {}
    for logfile in attempt_files:
        if not Path(logfile).exists():
            continue
        with open(logfile, "r") as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    fname = Path(entry.get("filename", "")).name
                    if not fname:
                        continue
                    file_hash = entry.get("file_hash")
                    if not file_hash and Path(entry.get("filename", "")).exists():
                        file_hash = get_file_hash(entry["filename"])
                    if file_hash:
                        filehash_map[fname] = file_hash
                except Exception:
                    continue
    return filehash_map


def main(patterns):
    print(f"Backup: {ENCODINGS_PATH} → {BACKUP_PATH}")
    if not BACKUP_PATH.exists():
        BACKUP_PATH.write_bytes(ENCODINGS_PATH.read_bytes())

    with open(ENCODINGS_PATH, "rb") as f:
        known_faces = safe_pickle_load(f)

    # 1. Samla alla relevanta filer (filnamn, basename)
    files = set()
    for pattern in patterns:
        for p in glob.glob(pattern):
            files.add(Path(p).name)
    print("Bearbetar följande filer:")
    for fname in files:
        print(f"  - {fname}")

    # 2. Bygg mappning från attempts-loggar: filnamn → hash
    filehash_map = build_attempt_hash_map(ATTEMPTS_FILES)
    print("\n[DEBUG] Hashmap byggd från attempts-logg:")
    for k, v in filehash_map.items():
        print(f"  {k} → {v}")

    updated = 0
    for namn, entries in known_faces.items():
        for entry in entries:
            if not isinstance(entry, dict):
                print(
                    f"[DEBUG] Entry i {namn} är EJ dict, typ: {type(entry)}. Skippas."
                )
                continue
            hash_field = entry.get("hash")
            file_field = entry.get("file")
            if hash_field:
                print(
                    f"[DEBUG] {namn} – {file_field}: HASH finns redan ({hash_field}), hoppar över."
                )
                continue
            if not file_field:
                print(f"[DEBUG] {namn}: Ingen 'file' i entry – skippas.")
                continue
            file_basename = Path(file_field).name
            print(
                f"[DEBUG] Kollar: {namn}, file={file_field} (basename={file_basename})"
            )
            if file_basename not in files:
                print(
                    f"    [DEBUG] {file_basename} är EJ i bearbetningslistan, skippas."
                )
                continue
            hashval = filehash_map.get(file_basename)
            if hashval:
                print(f"    [DEBUG] Uppdaterar {namn}, {file_field} → hash: {hashval}")
                entry["hash"] = hashval
                updated += 1
            else:
                print(f"    [DEBUG] INGEN hash funnen i mapping för {file_basename}.")

    if updated > 0:
        with open(ENCODINGS_PATH, "wb") as f:
            pickle.dump(known_faces, f)
        print(f"Uppdaterade {updated} encoding-poster med hash.")
    else:
        print("Inget att uppdatera.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(
            "Användning: python update_encodings_with_filehash.py <glob1> [<glob2> ...]"
        )
        print("Exempel: python update_encodings_with_filehash.py '2024*.NEF'")
        sys.exit(1)
    main(sys.argv[1:])
