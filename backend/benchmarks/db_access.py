"""Read-only extraction of face records from the encodings database.

The real database (``~/.local/share/faceid/encodings.pkl``) is a dict mapping
identity name -> list of encoding entries. Each entry is a dict with keys such
as ``file`` (recorded source path), ``hash`` (SHA1 of the source file),
``bounding_box`` (``{x, y, width, height}`` or ``None``), ``is_manual`` (only
present, and ``True``, for manually-added faces), ``created_at`` and
``encoding``/``encoding_hash``.

``records_from_db`` is a *pure* transform over an in-memory dict, so tests can
drive it with a fabricated mini-DB. ``load_db_records`` is the thin, read-only
disk loader used by the CLIs. NOTHING here mutates the database.
"""

from __future__ import annotations

import os
import pickle
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Canonical location of the confirmed-faces database (read-only).
DEFAULT_DB_PATH = Path(os.path.expanduser("~/.local/share/faceid/encodings.pkl"))
DEFAULT_DISTINCT_PAIRS_PATH = Path(
    os.path.expanduser("~/.local/share/faceid/distinct_pairs.json")
)


@dataclass
class FaceRecord:
    """One confirmed encoding, flattened for benchmark analysis."""

    identity: str
    recorded_file: str            # value of the DB ``file`` field (path or basename)
    basename: str                 # os.path.basename(recorded_file)
    sha1: str                     # source-file SHA1 (DB ``hash``)
    bbox: dict | None             # {x, y, width, height} or None
    is_manual: bool
    created_at: str | None

    @property
    def bbox_area(self) -> int | None:
        if not self.bbox:
            return None
        try:
            return int(self.bbox["width"]) * int(self.bbox["height"])
        except (KeyError, TypeError, ValueError):
            return None

    @property
    def event_prefix(self) -> str | None:
        """Leading ``YYMMDD`` of the recorded basename, if present."""
        stem = self.basename
        if len(stem) >= 6 and stem[:6].isdigit():
            return stem[:6]
        return None


def records_from_db(db: dict[str, list[dict[str, Any]]]) -> list[FaceRecord]:
    """Flatten an in-memory encodings dict into ``FaceRecord`` rows.

    Skips entries without a usable ``hash``. Pure — no I/O.
    """
    records: list[FaceRecord] = []
    for identity, entries in db.items():
        for entry in entries or []:
            sha1 = entry.get("hash")
            if not sha1:
                continue
            recorded_file = entry.get("file") or ""
            records.append(
                FaceRecord(
                    identity=str(identity),
                    recorded_file=str(recorded_file),
                    basename=os.path.basename(str(recorded_file)),
                    sha1=str(sha1),
                    bbox=entry.get("bounding_box"),
                    is_manual=bool(entry.get("is_manual", False)),
                    created_at=entry.get("created_at"),
                )
            )
    return records


def load_db_records(db_path: Path | str = DEFAULT_DB_PATH) -> list[FaceRecord]:
    """Load the real encodings DB (read-only) and flatten to records."""
    with open(db_path, "rb") as f:
        db = pickle.load(f)
    return records_from_db(db)


def recorded_hash_map(records: list[FaceRecord]) -> dict[str, list[str]]:
    """SHA1 -> list of recorded basenames (one per encoding referencing it)."""
    out: dict[str, list[str]] = defaultdict(list)
    for r in records:
        out[r.sha1].append(r.basename)
    return dict(out)


def face_counts(records: list[FaceRecord]) -> dict[str, int]:
    """SHA1 -> number of encodings (faces) referencing that source image."""
    out: dict[str, int] = defaultdict(int)
    for r in records:
        out[r.sha1] += 1
    return dict(out)
