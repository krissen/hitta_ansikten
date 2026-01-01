"""
Rename Service

Handles file renaming based on confirmed face identities.
Ported from hitta_ansikten.py rename functionality.
"""

import logging
import os
import re
import unicodedata
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

from faceid_db import (
    load_database,
    load_attempt_log,
    get_file_hash,
    BASE_DIR
)

logger = logging.getLogger(__name__)


# ============================================================================
# Utility functions (ported from hitta_ansikten.py)
# ============================================================================

def extract_prefix_suffix(fname: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract timestamp prefix and extension suffix from filename.

    Args:
        fname: Filename like "250612_153040.NEF" or "250612_153040-2_Anna.NEF"

    Returns:
        Tuple of (prefix, suffix) where prefix is "YYMMDD_HHMMSS" or "YYMMDD_HHMMSS-N"
        and suffix is ".NEF". Returns (None, None) if pattern doesn't match.
    """
    m = re.match(r"^(\d{6}_\d{6}(?:-\d+)?)(?:_[^.]*)?(\.NEF)$", fname, re.IGNORECASE)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def is_unrenamed(fname: str) -> bool:
    """
    Check if filename is in original unrenamed format.

    Returns True for: 250612_153040.NEF, 250612_153040-2.NEF
    Returns False for: 250612_153040_Anna.NEF (already has names)
    """
    # An unrenamed file matches pattern exactly without any name suffix
    m = re.match(r"^(\d{6}_\d{6}(?:-\d+)?)(\.NEF)$", fname, re.IGNORECASE)
    return bool(m)


def normalize_name(name: str) -> str:
    """
    Normalize name by removing diacritics and sanitizing for safe filename use.

    Security: Replaces path separators and null bytes to prevent path traversal.
    """
    # Remove diacritics (Källa → Kalla, François → Francois)
    n = unicodedata.normalize('NFKD', name)
    n = "".join(c for c in n if not unicodedata.combining(c))

    # Sanitize for filesystem safety: remove path separators and null bytes
    n = n.replace('/', '_').replace('\\', '_').replace('\0', '_')

    return n


def split_fornamn_efternamn(namn: str) -> Tuple[str, str]:
    """
    Split full name into first name and last name.

    Args:
        namn: Full name like "Anna Svensson"

    Returns:
        Tuple of (first_name, last_name). Last name may be empty.
    """
    parts = namn.strip().split()
    if len(parts) < 2:
        return parts[0] if parts else "", ""
    return parts[0], " ".join(parts[1:])


def resolve_fornamn_dubletter(all_persons: List[str]) -> Dict[str, str]:
    """
    Resolve first name collisions by adding surname initials.

    When multiple people share the same first name, adds minimum required
    characters from surname to disambiguate.

    Args:
        all_persons: List of all person names in the batch

    Returns:
        Dict mapping full name to short name.
        E.g., {"Anna Bergman": "AnnaB", "Anna Svensson": "AnnaS", "Bert Karlsson": "Bert"}
    """
    # Build map: first_name -> set of last names
    fornamn_map: Dict[str, set] = {}
    namn_map: Dict[str, Tuple[str, str]] = {}

    for namn in set(all_persons):
        fornamn, efternamn = split_fornamn_efternamn(namn)
        if not fornamn:
            continue
        if fornamn not in fornamn_map:
            fornamn_map[fornamn] = set()
        fornamn_map[fornamn].add(efternamn)
        namn_map[namn] = (fornamn, efternamn)

    # Determine short name for each person
    kortnamn: Dict[str, str] = {}
    for namn, (fornamn, efternamn) in namn_map.items():
        efternamnset = fornamn_map[fornamn] - {""}
        if len(efternamnset) <= 1:
            # Only one surname for this first name -> use first name only
            kortnamn[namn] = fornamn
        else:
            # Multiple different surnames: add minimum chars from surname
            andra_efternamn = sorted(efternamnset - {efternamn})
            prefixlen = 1
            while efternamn and any(
                efternamn[:prefixlen] == andra[:prefixlen]
                for andra in andra_efternamn
                if andra
            ):
                prefixlen += 1
            kortnamn[namn] = fornamn + (efternamn[:prefixlen] if efternamn else "")

    return kortnamn


def build_new_filename(fname: str, personer: List[str], namnmap: Dict[str, str]) -> Optional[str]:
    """
    Build new filename with person names.

    Args:
        fname: Original filename
        personer: List of person names in detection order
        namnmap: Dict mapping full name to short name

    Returns:
        New filename or None if cannot build.

    Security: Validates against path traversal attempts.
    """
    prefix, suffix = extract_prefix_suffix(fname)
    if not (prefix and suffix):
        return None

    fornamn_lista = []
    for namn in personer:
        kort = namnmap.get(namn)
        if kort:
            fornamn_lista.append(normalize_name(kort))

    if not fornamn_lista:
        return None

    namnstr = ",_".join(fornamn_lista)
    new_name = f"{prefix}_{namnstr}{suffix}"

    # Security: Validate no path traversal attempts
    if '..' in new_name or '/' in new_name or '\\' in new_name or '\0' in new_name:
        logger.error(f"[SECURITY] Rejected unsafe filename: {new_name}")
        return None

    return new_name


def collect_persons_for_files(
    filelist: List[str],
    known_faces: Dict[str, List],
    processed_files: Optional[List] = None,
    attempt_log: Optional[List] = None
) -> Dict[str, List[str]]:
    """
    Collect person names for each file from database and attempt log.

    Uses 3-tier priority:
    1. encodings.pkl - direct filename match
    2. encodings.pkl - hash match
    3. attempt_stats.jsonl - fallback

    Args:
        filelist: List of file paths
        known_faces: Known faces database
        processed_files: List of processed file entries
        attempt_log: Loaded attempt log entries

    Returns:
        Dict mapping filename (basename) to list of person names in detection order.
    """
    # Build index for encodings.pkl: filename -> names, hash -> names
    file_to_persons: Dict[str, List[str]] = {}
    hash_to_persons: Dict[str, List[str]] = {}

    for name, entries in known_faces.items():
        for entry in entries:
            if isinstance(entry, dict):
                f = entry.get("file")
                h = entry.get("hash")
                if f:
                    f = Path(f).name  # basename only
                    file_to_persons.setdefault(f, []).append(name)
                if h:
                    hash_to_persons.setdefault(h, []).append(name)

    # Build hash map for current files
    filehash_map: Dict[str, Optional[str]] = {}
    for f in filelist:
        fpath = Path(f)
        if fpath.exists():
            h = get_file_hash(fpath)
            filehash_map[fpath.name] = h
        else:
            filehash_map[fpath.name] = None

    # Index for processed_files
    if processed_files is None:
        processed_files = []
    processed_name_to_hash = {
        Path(x['name']).name: x.get('hash')
        for x in processed_files
        if isinstance(x, dict) and x.get('name')
    }

    # Load attempts log for fallback
    if attempt_log is None:
        attempt_log = load_attempt_log()

    # Build attempts fallback: filename -> labels (in detection order)
    stats_map: Dict[str, List[str]] = {}
    for entry in attempt_log:
        fn = Path(entry.get("filename", "")).name
        if entry.get("used_attempt") is not None and entry.get("review_results"):
            idx = entry["used_attempt"]
            if idx < len(entry.get("labels_per_attempt", [])):
                res = entry["review_results"][idx] if idx < len(entry["review_results"]) else None
                labels = entry["labels_per_attempt"][idx]
                if res == "ok" and labels:
                    # Extract person names from labels: "#1\nName"
                    persons = []
                    for lbl in labels:
                        label = lbl["label"] if isinstance(lbl, dict) else lbl
                        if "\n" in label:
                            namn = label.split("\n", 1)[1]
                            if namn.lower() not in ("ignorerad", "ign", "okänt", "okant"):
                                persons.append(namn)
                    if persons:
                        stats_map[fn] = persons

    # Collect persons for each file
    result: Dict[str, List[str]] = {}
    for f in filelist:
        fname = Path(f).name
        h = filehash_map.get(fname) or processed_name_to_hash.get(fname)

        # 1. Try filename first (encodings.pkl)
        persons = file_to_persons.get(fname, [])

        # 2. Otherwise try hash (encodings.pkl)
        if not persons and h:
            persons = hash_to_persons.get(h, [])

        # 3. Otherwise try attempts log (fallback)
        if not persons:
            persons = stats_map.get(fname, [])

        result[fname] = persons

    return result


# ============================================================================
# Rename Service
# ============================================================================

class RenameService:
    """Service for renaming files based on detected faces."""

    def __init__(self):
        logger.info("[RenameService] Initializing...")

    def preview_rename(
        self,
        file_paths: List[str],
        allow_renamed: bool = False
    ) -> Dict[str, Any]:
        """
        Generate preview of proposed renames without executing.

        Args:
            file_paths: List of file paths to rename
            allow_renamed: If True, allow renaming already-renamed files

        Returns:
            Dict with 'items' (list of preview items) and 'name_map' (disambiguation map)
        """
        logger.info(f"[RenameService] Generating preview for {len(file_paths)} files")

        # Load database
        known_faces, _, _, processed_files = load_database()

        # Collect persons for all files
        persons_map = collect_persons_for_files(
            file_paths,
            known_faces,
            processed_files
        )

        # Collect all person names for disambiguation
        all_persons = []
        for persons in persons_map.values():
            all_persons.extend(persons)

        # Resolve first name collisions
        name_map = resolve_fornamn_dubletter(all_persons)

        # Build preview items
        items = []
        for file_path in file_paths:
            path = Path(file_path)
            fname = path.name

            # Check if file exists
            if not path.exists():
                items.append({
                    "original_path": file_path,
                    "original_name": fname,
                    "new_name": None,
                    "persons": [],
                    "status": "file_not_found",
                    "conflict_with": None
                })
                continue

            # Check if already renamed (unless allow_renamed)
            if not allow_renamed and not is_unrenamed(fname):
                items.append({
                    "original_path": file_path,
                    "original_name": fname,
                    "new_name": None,
                    "persons": [],
                    "status": "already_renamed",
                    "conflict_with": None
                })
                continue

            # Get persons for this file
            persons = persons_map.get(fname, [])
            if not persons:
                items.append({
                    "original_path": file_path,
                    "original_name": fname,
                    "new_name": None,
                    "persons": [],
                    "status": "no_persons",
                    "conflict_with": None
                })
                continue

            # Build new filename
            new_name = build_new_filename(fname, persons, name_map)
            if not new_name:
                items.append({
                    "original_path": file_path,
                    "original_name": fname,
                    "new_name": None,
                    "persons": persons,
                    "status": "build_failed",
                    "conflict_with": None
                })
                continue

            # Check for conflicts
            new_path = path.parent / new_name
            if new_path.exists() and new_path != path:
                items.append({
                    "original_path": file_path,
                    "original_name": fname,
                    "new_name": new_name,
                    "persons": persons,
                    "status": "conflict",
                    "conflict_with": str(new_path)
                })
                continue

            # All good
            items.append({
                "original_path": file_path,
                "original_name": fname,
                "new_name": new_name,
                "persons": persons,
                "status": "ok",
                "conflict_with": None
            })

        return {
            "items": items,
            "name_map": name_map
        }

    def execute_rename(
        self,
        file_paths: List[str],
        allow_renamed: bool = False
    ) -> Dict[str, Any]:
        """
        Execute file renames.

        Args:
            file_paths: List of file paths to rename
            allow_renamed: If True, allow renaming already-renamed files

        Returns:
            Dict with 'renamed', 'skipped', and 'errors' lists
        """
        logger.info(f"[RenameService] Executing rename for {len(file_paths)} files")

        # Get preview first
        preview = self.preview_rename(file_paths, allow_renamed)

        renamed = []
        skipped = []
        errors = []

        for item in preview["items"]:
            if item["status"] != "ok":
                skipped.append({
                    "path": item["original_path"],
                    "reason": item["status"]
                })
                continue

            # Execute rename
            old_path = Path(item["original_path"])
            new_path = old_path.parent / item["new_name"]

            try:
                os.rename(old_path, new_path)
                renamed.append({
                    "original": str(old_path),
                    "new": str(new_path)
                })
                logger.info(f"[RenameService] Renamed: {old_path.name} -> {new_path.name}")
            except Exception as e:
                errors.append({
                    "path": str(old_path),
                    "error": str(e)
                })
                logger.error(f"[RenameService] Error renaming {old_path}: {e}")

        return {
            "renamed": renamed,
            "skipped": skipped,
            "errors": errors
        }


# Singleton instance
rename_service = RenameService()
