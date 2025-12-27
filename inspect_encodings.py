#!/usr/bin/env python
import pickle
from pathlib import Path
import hashlib
import argparse

# Import safe pickle loader from faceid_db
from faceid_db import safe_pickle_load

def file_hash(path):
    """Returnera SHA1-hash av en fil."""
    h = hashlib.sha1()
    try:
        with open(path, "rb") as f:
            while True:
                data = f.read(65536)
                if not data:
                    break
                h.update(data)
        return h.hexdigest()
    except Exception as e:
        print(f"[WARN] Kunde inte hasha {path}: {e}")
        return None

parser = argparse.ArgumentParser()
parser.add_argument("--mode", choices=["filnamn", "hash", "både"], default="både",
                    help="Sök baserat på filnamn, hash, eller båda (default: båda)")
args = parser.parse_args()

encodings_path = Path.home() / ".local/share/faceid/encodings.pkl"
data_dir = Path("/Users/krisniem/Pictures/nerladdat/facerec/18")  # Ange sökväg till dina bilder här om du vill söka på hash!

target_files = [
    "250518_143900.NEF",
    "250518_143917.NEF",
    "250518_144109.NEF",
    "250518_144440.NEF",
    "250518_143718.NEF",
    "250518_144015.NEF",
    "250518_144155.NEF",
    "250518_144443.NEF",
    "250518_143909.NEF",
]

# Beräkna hash för varje fil (om filen finns)
hashes = {}
for tf in target_files:
    p = data_dir / tf
    hashes[tf] = file_hash(p) if p.exists() else None

with open(encodings_path, "rb") as f:
    known_faces = safe_pickle_load(f)

print("Söker efter encodings kopplade till dessa filer (och/eller hash):")
for tf in target_files:
    msg = f" - {tf}"
    if hashes[tf]:
        msg += f" (hash: {hashes[tf]})"
    print(msg)

found = {tf: [] for tf in target_files}

for name, entries in known_faces.items():
    for entry in entries:
        file_field = None
        hash_field = None
        if isinstance(entry, dict):
            file_field = entry.get("file") or entry.get("filename")  # stöd båda
            hash_field = entry.get("hash")
        # Jämför enligt valt läge:
        for tf in target_files:
            match = False
            if args.mode in ("både", "filnamn"):
                if file_field == tf:
                    match = True
            if args.mode in ("både", "hash"):
                if hashes[tf] and hashes[tf] == hash_field:
                    match = True
            if match:
                found[tf].append((name, hash_field, file_field))

print("\nResultat:")
for tf in target_files:
    if found[tf]:
        print(f"{tf}:")
        for namn, h, filf in found[tf]:
            print(f"  - Person: {namn} (hash: {h}, file: {filf})")
    else:
        print(f"{tf}: INGEN encoding med denna fil/hash")

