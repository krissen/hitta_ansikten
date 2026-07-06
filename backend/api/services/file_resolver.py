"""Shared file resolver for folder/glob/date-span inputs.

Resolves a set of root folders and/or glob patterns into a sorted, de-duplicated
list of absolute file paths, applying a case-insensitive extension filter and an
optional date span filtered on the *filename* date (YYMMDD_HHMMSS...).

Reusable Tier-0 helper: GUI modules that take a folder/wildcard input bar (count
players, organize files, rename, ...) all resolve their working set through here
so globbing semantics stay consistent across features.
"""

import glob
import os
from datetime import date, datetime
from pathlib import Path

from core.playerstats import parse_filename

from .rename_service import SUPPORTED_EXTENSIONS, extract_filename_datetime

# App-managed trash (soft-deleted files live here). Resolution always skips it so
# trashed files are never re-counted or re-listed by any feature. The culling
# service is the writer; it imports TRASH_DIR from here.
_DATA_HOME = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
TRASH_DIR = _DATA_HOME / "faceid" / "trash"

# Extension presets. Values are lowercase extensions including the leading dot.
# Matching against filenames is always case-insensitive.
EXTENSION_PRESETS: dict[str, list[str]] = {
    "jpg": [".jpg", ".jpeg"],
    "nef": [".nef"],
    "raw": [".nef", ".cr2", ".cr3", ".arw", ".dng", ".raw", ".raf", ".orf", ".rw2"],
    "images": [".jpg", ".jpeg", ".png", ".tiff", ".tif"],
    "all": list(SUPPORTED_EXTENSIONS),
}


def preset_extensions(preset: str | None) -> list[str]:
    """Map a preset name to its lowercase extension list.

    Unknown/empty preset -> [] (meaning: keep every file that parses).
    """
    if not preset:
        return []
    return EXTENSION_PRESETS.get(preset.lower(), [])


def _parse_date_bound(value: str | None) -> date | None:
    """Parse a date bound accepting YYMMDD, YYYY-MM-DD or YYYYMMDD. None passes through."""
    if not value:
        return None
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%y%m%d", "%Y%m%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Ogiltigt datumformat: {value!r} (förväntar YYYY-MM-DD eller YYMMDD)")


def _matches_extension(path: str, allowed_lower: set[str]) -> bool:
    if not allowed_lower:
        return True
    return os.path.splitext(path)[1].lower() in allowed_lower


def resolve_files(
    roots: list[str] | None = None,
    globs: list[str] | None = None,
    extensions: list[str] | None = None,
    recursive: bool = True,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[str]:
    """Resolve roots + glob patterns into a sorted list of absolute file paths.

    Args:
        roots: directories to scan (each scanned recursively when recursive=True).
        globs: shell glob patterns (``~`` is expanded), e.g. ``~/Pictures/250601*.jpg``.
        extensions: lowercase extensions with leading dot to keep; empty/None = keep all.
        recursive: when True, roots are walked recursively.
        date_from / date_to: inclusive bounds on the filename date (YYMMDD / YYYY-MM-DD).
            When either is set, files whose name does not parse to a date are dropped.

    Returns:
        Sorted, de-duplicated list of absolute file paths.
    """
    roots = roots or []
    globs = globs or []
    allowed_lower = {e.lower() for e in (extensions or [])}

    d_from = _parse_date_bound(date_from)
    d_to = _parse_date_bound(date_to)
    date_filtering = d_from is not None or d_to is not None

    trash_prefix = str(TRASH_DIR.resolve()) + os.sep

    candidates: set[str] = set()

    for pat in globs:
        for match in glob.glob(os.path.expanduser(pat), recursive=recursive):
            if os.path.isfile(match):
                candidates.add(os.path.abspath(match))

    for root in roots:
        base = Path(os.path.expanduser(root))
        if not base.is_dir():
            continue
        iterator = base.rglob("*") if recursive else base.glob("*")
        for p in iterator:
            if p.is_file():
                candidates.add(str(p.resolve()))

    result: list[str] = []
    for path in candidates:
        # Never surface soft-deleted files living in the app trash.
        if path.startswith(trash_prefix):
            continue
        if not _matches_extension(path, allowed_lower):
            continue
        if date_filtering:
            # parse_filename needs a _Name part; fall back to the name-agnostic
            # prefix parser so un-named files (e.g. YYMMDD_HHMMSS.NEF from general
            # culling) survive date filtering instead of being silently dropped.
            dt, _ = parse_filename(path)
            if dt is None:
                dt = extract_filename_datetime(os.path.basename(path))
            if dt is None:
                continue
            d = dt.date()
            if d_from is not None and d < d_from:
                continue
            if d_to is not None and d > d_to:
                continue
        result.append(path)

    result.sort()
    return result
