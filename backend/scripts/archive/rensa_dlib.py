#!/usr/bin/env python3
"""
Remove all dlib encodings from faceid database.

dlib backend is deprecated. This script removes all dlib encodings from:
- known_faces (encodings.pkl)
- ignored_faces (ignored.pkl)
- hard_negatives (hardneg.pkl)

Usage:
    python rensa_dlib.py --dry-run   # Preview what would be removed
    python rensa_dlib.py             # Actually remove dlib encodings
"""

import argparse
import sys
from pathlib import Path
from typing import Any

import numpy as np

# Archived tool: add backend/ (three levels up) to sys.path so faceid_db resolves.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from faceid_db import load_database, save_database  # noqa: E402


def is_insightface(entry: dict[str, Any] | np.ndarray) -> bool:
    """Check if entry is an InsightFace encoding."""
    if isinstance(entry, dict):
        return entry.get("backend") == "insightface"
    # Legacy numpy array without metadata - check shape
    if isinstance(entry, np.ndarray):
        return entry.shape == (512,)  # InsightFace is 512-dim, dlib is 128-dim
    return False


def count_by_backend(entries: dict[str, list[Any]] | list[Any]) -> tuple[int, int]:
    """Count entries by backend type."""
    if isinstance(entries, dict):
        # Dict of name -> list
        dlib = sum(1 for v in entries.values() for e in v if not is_insightface(e))
        insightface = sum(1 for v in entries.values() for e in v if is_insightface(e))
    else:
        # List
        dlib = sum(1 for e in entries if not is_insightface(e))
        insightface = sum(1 for e in entries if is_insightface(e))
    return dlib, insightface


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove dlib encodings from database")
    parser.add_argument("--dry-run", action="store_true", help="Preview without saving")
    args = parser.parse_args()

    print("Loading database...")
    known, ignored, hardneg, processed = load_database()

    # Count before
    known_dlib, known_if = count_by_backend(known)
    ignored_dlib, ignored_if = count_by_backend(ignored)
    hardneg_dlib, hardneg_if = count_by_backend(hardneg)

    print("\n=== Current state ===")
    print(f"known_faces:    {known_dlib:5} dlib, {known_if:5} insightface")
    print(f"ignored_faces:  {ignored_dlib:5} dlib, {ignored_if:5} insightface")
    print(f"hard_negatives: {hardneg_dlib:5} dlib, {hardneg_if:5} insightface")
    print(f"{'─' * 50}")
    total_dlib = known_dlib + ignored_dlib + hardneg_dlib
    total_if = known_if + ignored_if + hardneg_if
    print(f"TOTAL:          {total_dlib:5} dlib, {total_if:5} insightface")

    if total_dlib == 0:
        print("\nNo dlib encodings found. Nothing to do.")
        return

    # Filter known_faces (dict of name -> list)
    for name in list(known.keys()):
        known[name] = [e for e in known[name] if is_insightface(e)]
        if not known[name]:
            del known[name]

    # Filter ignored_faces (list)
    ignored = [e for e in ignored if is_insightface(e)]

    # Filter hard_negatives (dict of name -> list)
    for name in list(hardneg.keys()):
        hardneg[name] = [e for e in hardneg[name] if is_insightface(e)]
        if not hardneg[name]:
            del hardneg[name]

    print("\n=== After removal ===")
    print(f"known_faces:    {sum(len(v) for v in known.values()):5} encodings")
    print(f"ignored_faces:  {len(ignored):5} encodings")
    print(f"hard_negatives: {sum(len(v) for v in hardneg.values()):5} encodings")

    if args.dry_run:
        print(f"\n[DRY RUN] Would remove {total_dlib} dlib encodings.")
        print("Run without --dry-run to apply changes.")
    else:
        print("\nSaving database...")
        save_database(known, ignored, hardneg, processed)
        print(f"Removed {total_dlib} dlib encodings.")


if __name__ == "__main__":
    main()
