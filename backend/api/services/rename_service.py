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
from datetime import datetime

from faceid_db import (
    load_database,
    save_database,
    load_attempt_log,
    get_file_hash,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Default rename configuration
# ============================================================================

DEFAULT_RENAME_CONFIG = {
    # Prefix source: 'filename', 'exif', 'filedate', 'none'
    "prefixSource": "filename",
    # Fallback if EXIF missing: 'filedate', 'skip', 'original'
    "exifFallback": "filedate",
    # Date pattern for formatting (Python strftime)
    "datePattern": "%y%m%d_%H%M%S",
    # Filename pattern template
    "filenamePattern": "{prefix}_{names}{ext}",
    # Name formatting
    "useFirstNameOnly": True,
    "nameSeparator": ",_",
    "removeDiacritics": True,
    # Disambiguation
    "disambiguationStyle": "initial",  # 'initial' or 'full'
    "alwaysIncludeSurname": False,
    # File handling
    "allowAlreadyRenamed": False,
    "includeIgnoredFaces": False,
}


# ============================================================================
# EXIF and date extraction
# ============================================================================

def extract_exif_datetime(file_path: Path) -> Optional[datetime]:
    """
    Extract DateTimeOriginal from image EXIF data.

    Supports JPEG, TIFF, and NEF (via rawpy).

    Args:
        file_path: Path to image file

    Returns:
        datetime object or None if not found
    """
    ext = file_path.suffix.lower()

    # Try PIL for standard formats
    try:
        from PIL import Image
        from PIL.ExifTags import TAGS

        if ext in ['.jpg', '.jpeg', '.tiff', '.tif']:
            with Image.open(file_path) as img:
                exif_data = img._getexif()
                if exif_data:
                    for tag_id, value in exif_data.items():
                        tag = TAGS.get(tag_id, tag_id)
                        if tag == 'DateTimeOriginal':
                            # Format: "2025:06:12 15:30:40"
                            return datetime.strptime(value, "%Y:%m:%d %H:%M:%S")
    except Exception as e:
        logger.debug(f"[EXIF] PIL extraction failed for {file_path.name}: {e}")

    # Try rawpy for RAW formats (NEF, CR2, ARW)
    if ext in ['.nef', '.cr2', '.arw', '.dng', '.raw']:
        try:
            import rawpy
            with rawpy.imread(str(file_path)) as raw:
                # rawpy doesn't expose EXIF directly, try exifread as fallback
                pass
        except Exception as e:
            logger.debug(f"[EXIF] rawpy failed for {file_path.name}: {e}")

        # Try exifread if available (better for RAW files)
        try:
            import exifread
            with open(file_path, 'rb') as f:
                tags = exifread.process_file(f, stop_tag='EXIF DateTimeOriginal')
                if 'EXIF DateTimeOriginal' in tags:
                    dt_str = str(tags['EXIF DateTimeOriginal'])
                    return datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S")
        except ImportError:
            logger.debug("[EXIF] exifread not installed, trying alternative")
        except Exception as e:
            logger.debug(f"[EXIF] exifread failed for {file_path.name}: {e}")

        # Fallback: try to extract from NEF using subprocess (exiftool)
        try:
            import subprocess
            result = subprocess.run(
                ['exiftool', '-DateTimeOriginal', '-s', '-s', '-s', str(file_path)],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                dt_str = result.stdout.strip()
                return datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S")
        except Exception as e:
            logger.debug(f"[EXIF] exiftool failed for {file_path.name}: {e}")

    return None


def get_file_datetime(file_path: Path) -> Optional[datetime]:
    """
    Get file modification datetime.

    Args:
        file_path: Path to file

    Returns:
        datetime object or None
    """
    try:
        mtime = file_path.stat().st_mtime
        return datetime.fromtimestamp(mtime)
    except Exception as e:
        logger.debug(f"[FileDate] Failed to get mtime for {file_path.name}: {e}")
        return None


def extract_filename_datetime(fname: str) -> Optional[datetime]:
    """
    Extract datetime from filename pattern YYMMDD_HHMMSS.

    Args:
        fname: Filename like "250612_153040.NEF"

    Returns:
        datetime object or None if pattern doesn't match
    """
    m = re.match(r"^(\d{6})_(\d{6})", fname)
    if m:
        try:
            date_str = m.group(1)
            time_str = m.group(2)
            return datetime.strptime(f"{date_str}{time_str}", "%y%m%d%H%M%S")
        except ValueError:
            pass
    return None


def get_prefix_datetime(file_path: Path, config: Dict[str, Any]) -> Optional[datetime]:
    """
    Get datetime for prefix based on configuration.

    Args:
        file_path: Path to file
        config: Rename configuration

    Returns:
        datetime object or None
    """
    source = config.get("prefixSource", "filename")
    fallback = config.get("exifFallback", "filedate")

    # No prefix requested
    if source == "none":
        return None

    dt = None

    if source == "filename":
        dt = extract_filename_datetime(file_path.name)
    elif source == "exif":
        dt = extract_exif_datetime(file_path)
        if dt is None and fallback == "filedate":
            dt = get_file_datetime(file_path)
        elif dt is None and fallback == "original":
            dt = extract_filename_datetime(file_path.name)
    elif source == "filedate":
        dt = get_file_datetime(file_path)

    return dt


def format_datetime(dt: datetime, pattern: str) -> str:
    """
    Format datetime using strftime pattern.

    Args:
        dt: datetime object
        pattern: strftime pattern

    Returns:
        Formatted string
    """
    return dt.strftime(pattern)


# ============================================================================
# Supported file extensions
# ============================================================================

# RAW formats and common image formats supported for rename operations
SUPPORTED_EXTENSIONS = [
    ".nef", ".cr2", ".cr3", ".arw", ".dng", ".raw", ".raf", ".orf", ".rw2",  # RAW
    ".jpg", ".jpeg", ".tiff", ".tif", ".png",  # Standard
]

# Build regex pattern for extensions (case-insensitive matching done via re.IGNORECASE)
_EXT_PATTERN = "|".join(re.escape(ext) for ext in SUPPORTED_EXTENSIONS)


# ============================================================================
# Utility functions (ported from hitta_ansikten.py)
# ============================================================================

def extract_prefix_suffix(fname: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract timestamp prefix and extension suffix from filename.

    Supports photographer suffix after timestamp, e.g.:
    - 250612_153040.NEF -> prefix="250612_153040"
    - 250612_153040en.NEF -> prefix="250612_153040en" (photographer suffix preserved)
    - 250612_153040-2ab_Anna.NEF -> prefix="250612_153040-2ab"

    Args:
        fname: Filename like "250612_153040.NEF" or "250612_153040en_Anna.NEF"

    Returns:
        Tuple of (prefix, suffix) where prefix includes any photographer suffix,
        and suffix is the file extension. Returns (None, None) if pattern doesn't match.
    """
    # Pattern: YYMMDD_HHMMSS + optional burst (-N) + optional photographer suffix (1-3 letters)
    pattern = rf"^(\d{{6}}_\d{{6}}(?:-\d+)?[a-zA-Z]{{0,3}})(?:_[^.]*)?({_EXT_PATTERN})$"
    m = re.match(pattern, fname, re.IGNORECASE)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def is_unrenamed(fname: str) -> bool:
    """
    Check if filename is in original unrenamed format.

    Returns True for: 250612_153040.NEF, 250612_153040-2.NEF, 250612_153040en.NEF
    Returns False for: 250612_153040_Anna.NEF (already has names)
    """
    # An unrenamed file matches pattern exactly without any name suffix
    # Includes optional photographer suffix (1-3 letters after timestamp)
    pattern = rf"^(\d{{6}}_\d{{6}}(?:-\d+)?[a-zA-Z]{{0,3}})({_EXT_PATTERN})$"
    m = re.match(pattern, fname, re.IGNORECASE)
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


def resolve_fornamn_dubletter(
    all_persons: List[str],
    config: Optional[Dict[str, Any]] = None
) -> Dict[str, str]:
    """
    Resolve first name collisions by adding surname initials.

    When multiple people share the same first name, adds minimum required
    characters from surname to disambiguate.

    Args:
        all_persons: List of all person names in the batch
        config: Optional configuration dict with:
            - useFirstNameOnly: If False, always use full name
            - disambiguationStyle: 'initial' or 'full'
            - alwaysIncludeSurname: Always add surname even without collision

    Returns:
        Dict mapping full name to short name.
        E.g., {"Anna Bergman": "AnnaB", "Anna Svensson": "AnnaS", "Bert Karlsson": "Bert"}
    """
    if config is None:
        config = DEFAULT_RENAME_CONFIG

    use_first_only = config.get("useFirstNameOnly", True)
    disambig_style = config.get("disambiguationStyle", "initial")
    always_surname = config.get("alwaysIncludeSurname", False)

    # If not using first name only, return full names
    if not use_first_only:
        return {namn: namn.replace(" ", "_") for namn in set(all_persons) if namn}

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
        has_collision = len(efternamnset) > 1
        needs_surname = has_collision or always_surname

        if not needs_surname:
            # No collision and not forced -> use first name only
            kortnamn[namn] = fornamn
        elif disambig_style == "full":
            # Full surname style: Anna_Bergman
            if efternamn:
                kortnamn[namn] = f"{fornamn}_{efternamn.replace(' ', '_')}"
            else:
                kortnamn[namn] = fornamn
        else:
            # Initial style: AnnaB (minimum chars to disambiguate)
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
    Build new filename with person names (legacy function for compatibility).
    """
    return build_new_filename_with_config(fname, personer, namnmap, None, None)


def build_new_filename_with_config(
    fname: str,
    personer: List[str],
    namnmap: Dict[str, str],
    file_path: Optional[Path],
    config: Optional[Dict[str, Any]]
) -> Optional[str]:
    """
    Build new filename with person names using configuration.

    Args:
        fname: Original filename
        personer: List of person names in detection order
        namnmap: Dict mapping full name to short name
        file_path: Path to file (for EXIF/date extraction)
        config: Rename configuration

    Returns:
        New filename or None if cannot build.

    Security: Validates against path traversal attempts.
    """
    if config is None:
        config = DEFAULT_RENAME_CONFIG

    remove_diacritics = config.get("removeDiacritics", True)
    name_separator = config.get("nameSeparator", ",_")
    filename_pattern = config.get("filenamePattern", "{prefix}_{names}{ext}")
    date_pattern = config.get("datePattern", "%y%m%d_%H%M%S")

    # Get extension
    ext = Path(fname).suffix  # e.g., ".NEF"

    # Build names string
    name_list = []
    for namn in personer:
        kort = namnmap.get(namn)
        if kort:
            if remove_diacritics:
                kort = normalize_name(kort)
            else:
                # Still sanitize for filesystem safety
                kort = kort.replace('/', '_').replace('\\', '_').replace('\0', '_')
            name_list.append(kort)

    if not name_list:
        return None

    names_str = name_separator.join(name_list)

    # Get prefix based on configuration
    prefix = ""
    original_stem = Path(fname).stem  # filename without extension
    prefix_source = config.get("prefixSource", "filename")

    if prefix_source == "none":
        # No prefix - empty string (pattern should handle this)
        prefix = ""
    elif file_path and file_path.exists():
        dt = get_prefix_datetime(file_path, config)
        if dt:
            prefix = format_datetime(dt, date_pattern)
        else:
            # Fallback to extracting from original filename (preserves photographer suffix)
            old_prefix, _ = extract_prefix_suffix(fname)
            prefix = old_prefix if old_prefix else original_stem
    else:
        # Fallback to extracting from original filename
        old_prefix, _ = extract_prefix_suffix(fname)
        prefix = old_prefix if old_prefix else original_stem

    # Build filename using pattern
    # Available variables: {prefix}, {names}, {ext}, {original}, {date}, {time}
    try:
        # Parse datetime for separate date/time if we have it
        dt = None
        if file_path and file_path.exists():
            dt = get_prefix_datetime(file_path, config)

        date_str = dt.strftime("%y%m%d") if dt else prefix[:6] if len(prefix) >= 6 else ""
        time_str = dt.strftime("%H%M%S") if dt else prefix[7:13] if len(prefix) >= 13 else ""

        new_name = filename_pattern.format(
            prefix=prefix,
            names=names_str,
            ext=ext,
            original=original_stem,
            date=date_str,
            time=time_str
        )
    except KeyError as e:
        logger.error(f"[Rename] Invalid filename pattern variable: {e}")
        # Fallback to simple pattern
        new_name = f"{prefix}_{names_str}{ext}"

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
        Dict mapping full file path to list of person names in detection order.
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
                    if name not in file_to_persons.setdefault(f, []):
                        file_to_persons[f].append(name)
                if h:
                    if name not in hash_to_persons.setdefault(h, []):
                        hash_to_persons[h].append(name)

    # Build hash map for current files - keyed by FULL PATH to avoid basename collisions
    filehash_map: Dict[str, Optional[str]] = {}
    for f in filelist:
        fpath = Path(f)
        if fpath.exists():
            h = get_file_hash(fpath)
            filehash_map[str(fpath)] = h
        else:
            filehash_map[str(fpath)] = None

    # Index for processed_files (keyed by basename since that's how DB stores them)
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
    # Keyed by basename since attempt_log stores basenames
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

    # Collect persons for each file - result keyed by FULL PATH
    result: Dict[str, List[str]] = {}
    for f in filelist:
        fpath = Path(f)
        fname = fpath.name
        # Use full path for hash lookup to avoid basename collisions
        h = filehash_map.get(str(fpath)) or processed_name_to_hash.get(fname)

        # 1. Try filename first (encodings.pkl stores basenames)
        persons = file_to_persons.get(fname, [])

        # 2. Otherwise try hash (encodings.pkl)
        if not persons and h:
            persons = hash_to_persons.get(h, [])

        # 3. Otherwise try attempts log (fallback, uses basenames)
        if not persons:
            persons = stats_map.get(fname, [])

        # Key result by full path to avoid collisions
        result[str(fpath)] = persons

    return result


# ============================================================================
# Path validation
# ============================================================================

def validate_path_security(file_path: str) -> Tuple[bool, str]:
    """
    Validate a file path for security concerns.

    Checks:
    1. No path traversal attempts (..)
    2. Path is absolute and real (resolve symlinks)
    3. File exists and is a regular file

    Args:
        file_path: Path to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    # Check for path traversal attempts in the string
    if '..' in file_path:
        logger.warning(f"[SECURITY] Path traversal attempt detected: {file_path}")
        return False, "Path traversal not allowed"

    # Check for null bytes
    if '\0' in file_path:
        logger.warning(f"[SECURITY] Null byte in path: {file_path}")
        return False, "Invalid path characters"

    path = Path(file_path)

    # Must be absolute path
    if not path.is_absolute():
        return False, "Must be absolute path"

    # Resolve symlinks and check real path
    # Note: resolve(strict=True) returns canonical absolute path without '..'
    try:
        real_path = path.resolve(strict=True)
    except FileNotFoundError:
        return False, "File not found"
    except RuntimeError as e:
        return False, f"Cannot resolve path: {e}"

    # Must be a regular file
    if not real_path.is_file():
        return False, "Not a regular file"

    return True, ""


# ============================================================================
# Rename Service
# ============================================================================

class RenameService:
    """Service for renaming files based on detected faces."""

    def __init__(self):
        logger.info("[RenameService] Initializing...")

    def get_default_config(self) -> Dict[str, Any]:
        """Return default rename configuration."""
        return DEFAULT_RENAME_CONFIG.copy()

    def preview_rename(
        self,
        file_paths: List[str],
        allow_renamed: bool = False,
        config: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generate preview of proposed renames without executing.

        Args:
            file_paths: List of file paths to rename
            allow_renamed: If True, allow renaming already-renamed files
            config: Optional rename configuration (uses defaults if None)

        Returns:
            Dict with 'items' (list of preview items) and 'name_map' (disambiguation map)
        """
        # Merge config with defaults
        effective_config = DEFAULT_RENAME_CONFIG.copy()
        if config:
            effective_config.update(config)

        # Override allow_renamed from config if not explicitly set
        if config and "allowAlreadyRenamed" in config:
            allow_renamed = config["allowAlreadyRenamed"]

        logger.info(f"[RenameService] Generating preview for {len(file_paths)} files")

        # Validate all paths for security
        validated_paths = []
        security_rejected = []
        for fp in file_paths:
            is_valid, error = validate_path_security(fp)
            if is_valid:
                validated_paths.append(fp)
            else:
                security_rejected.append({
                    "original_path": fp,
                    "original_name": Path(fp).name,
                    "new_name": None,
                    "persons": [],
                    "status": "security_rejected",
                    "conflict_with": error
                })

        # Load database
        known_faces, _, _, processed_files = load_database()

        # Collect persons for validated files only
        persons_map = collect_persons_for_files(
            validated_paths,
            known_faces,
            processed_files
        )

        # Collect all person names for disambiguation
        all_persons = []
        for persons in persons_map.values():
            all_persons.extend(persons)

        # Resolve first name collisions using config
        name_map = resolve_fornamn_dubletter(all_persons, effective_config)

        # Build preview items (start with security-rejected ones)
        items = list(security_rejected)
        for file_path in validated_paths:
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

            # Get persons for this file (keyed by full path to avoid basename collisions)
            persons = persons_map.get(file_path, [])
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

            # Build new filename using config
            new_name = build_new_filename_with_config(fname, persons, name_map, path, effective_config)
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
        allow_renamed: bool = False,
        config: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Execute file renames.

        Args:
            file_paths: List of file paths to rename
            allow_renamed: If True, allow renaming already-renamed files
            config: Optional rename configuration (uses defaults if None)

        Returns:
            Dict with 'renamed', 'skipped', and 'errors' lists
        """
        logger.info(f"[RenameService] Executing rename for {len(file_paths)} files")

        # Get preview first (with config)
        preview = self.preview_rename(file_paths, allow_renamed, config)

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

        # Update database entries to reflect new filenames
        db_updated = self._update_database_paths(renamed)

        return {
            "renamed": renamed,
            "skipped": skipped,
            "errors": errors,
            "db_entries_updated": db_updated
        }


    def _update_database_paths(self, renamed_files: List[Dict[str, str]]) -> int:
        """
        Update database entries to reflect renamed files.

        Updates known_faces and processed_files to point to new paths.

        Args:
            renamed_files: List of {"original": old_path, "new": new_path} dicts

        Returns:
            Number of database entries updated
        """
        if not renamed_files:
            return 0

        # Build mapping from old basename to new basename
        name_map = {}
        for item in renamed_files:
            old_name = Path(item["original"]).name
            new_name = Path(item["new"]).name
            name_map[old_name] = new_name

        # Load current database
        known_faces, ignored_faces, hard_negatives, processed_files = load_database()

        updated_count = 0

        # Update known_faces entries
        for person_name, entries in known_faces.items():
            for entry in entries:
                if isinstance(entry, dict) and entry.get("file"):
                    old_file = Path(entry["file"]).name
                    if old_file in name_map:
                        # Update the file path
                        old_path = Path(entry["file"])
                        new_path = old_path.parent / name_map[old_file]
                        entry["file"] = str(new_path)
                        updated_count += 1
                        logger.debug(f"[RenameService] Updated encoding entry: {old_file} -> {name_map[old_file]}")

        # Update processed_files entries
        for pf in processed_files:
            if isinstance(pf, dict) and pf.get("name"):
                old_name = Path(pf["name"]).name
                if old_name in name_map:
                    old_path = Path(pf["name"])
                    new_path = old_path.parent / name_map[old_name]
                    pf["name"] = str(new_path)
                    updated_count += 1
                    logger.debug(f"[RenameService] Updated processed entry: {old_name} -> {name_map[old_name]}")

        # Save updated database
        if updated_count > 0:
            save_database(known_faces, ignored_faces, hard_negatives, processed_files)
            logger.info(f"[RenameService] Updated {updated_count} database entries after rename")

        return updated_count


# Singleton instance
rename_service = RenameService()
