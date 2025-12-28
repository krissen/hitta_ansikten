#!/usr/bin/env python

import argparse
import fnmatch
import json
import pickle

import numpy as np
from xdg.BaseDirectory import xdg_data_home
from pathlib import Path

# Import safe pickle loader from faceid_db
from faceid_db import safe_pickle_load

# === Konstanter ===
BASE_DIR = Path(xdg_data_home) / "faceid"
IGNORED_PATH = BASE_DIR / "ignored.pkl"


# === Ladda ignorerade ansikten ===
def load_ignored():
    if IGNORED_PATH.exists():
        with open(IGNORED_PATH, "rb") as f:
            return safe_pickle_load(f)
    return []


def save_ignored(ignored_faces):
    with open(IGNORED_PATH, "wb") as f:
        pickle.dump(ignored_faces, f)


# === Ladda metadata ===
def load_metadata():
    metadata_path = BASE_DIR / "metadata.json"
    if not metadata_path.exists():
        return []
    with open(metadata_path) as f:
        return [json.loads(line) for line in f if line.strip()]


# === Rensa ignorerade ansikten för valda filer ===
def redo_glob(glob_pattern):
    ignored = load_ignored()
    meta = load_metadata()
    match_encodings = []

    for item in meta:
        if fnmatch.fnmatch(item["file"], glob_pattern):
            for face in item["faces"]:
                if face.get("suggestion") == "IGNORED" and "encoding" in face:
                    match_encodings.append(np.array(face["encoding"]))

    if not match_encodings:
        print("Inga ignorerade ansikten matchade mönstret.")
        return

    print(f"Hittade {len(match_encodings)} ansikten att ta bort ur ignore-lista.")
    before = len(ignored)
    ignored = [
        e
        for e in ignored
        if not any(np.allclose(e, m, atol=1e-5) for m in match_encodings)
    ]
    after = len(ignored)

    print(f"Tog bort {before - after} ignorerade entries.")
    save_ignored(ignored)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rättelseläge för ignorerade ansikten")
    parser.add_argument("glob", help="Globmönster för filnamn att rätta")
    args = parser.parse_args()
    redo_glob(args.glob)
