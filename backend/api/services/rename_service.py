"""
Rename Service

Handles file renaming based on confirmed face identities.
Ported from the Ansikten CLI rename functionality.
"""

import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from api.services.db_store import get_db_store
from core import fs_ops
from core.exiftool import find_exiftool
from core.files import SUPPORTED_EXTENSIONS
from core.naming import normalize_name, record_previous_name
from faceid_db import (
    get_file_hash,
    load_attempt_log,
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
    # Sidecar files
    "renameSidecars": True,
    "sidecarExtensions": ["xmp"],
}


# ============================================================================
# EXIF and date extraction
# ============================================================================

def extract_exif_datetime(file_path: Path) -> datetime | None:
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
                exif_data = getattr(img, '_getexif', lambda: None)()
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
            with rawpy.imread(str(file_path)):
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
                [find_exiftool(), '-DateTimeOriginal', '-s', '-s', '-s', str(file_path)],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                dt_str = result.stdout.strip()
                return datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S")
        except Exception as e:
            logger.debug(f"[EXIF] exiftool failed for {file_path.name}: {e}")

    return None


def get_file_datetime(file_path: Path) -> datetime | None:
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


def extract_filename_datetime(fname: str) -> datetime | None:
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


def get_prefix_datetime(file_path: Path, config: dict[str, Any]) -> datetime | None:
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

# SUPPORTED_EXTENSIONS (RAW + standard) is imported from core.files above.
# Build regex pattern for extensions (case-insensitive matching done via re.IGNORECASE)
_EXT_PATTERN = "|".join(re.escape(ext) for ext in SUPPORTED_EXTENSIONS)


# ============================================================================
# Sidecar file handling
# ============================================================================

def find_sidecar_files(file_path: Path, extensions: list[str]) -> list[Path]:
    """
    Find sidecar files for a given image file.

    Searches case-insensitively for files with matching stem and specified extensions.

    Args:
        file_path: Path to the main image file
        extensions: List of extensions to look for (without dot), e.g. ["xmp", "dng"]

    Returns:
        List of Path objects for found sidecar files
    """
    sidecars = []
    stem = file_path.stem
    parent = file_path.parent

    if not parent.exists():
        return sidecars

    # Normalize extensions to lowercase for comparison
    ext_lower = {ext.lower() for ext in extensions}

    try:
        for candidate in parent.iterdir():
            if not candidate.is_file():
                continue
            # Check if stem matches and extension is in our list (case insensitive)
            if candidate.stem == stem:
                candidate_ext = candidate.suffix.lstrip('.').lower()
                if candidate_ext in ext_lower:
                    sidecars.append(candidate)
    except PermissionError:
        logger.warning(f"[Sidecar] Permission denied reading directory: {parent}")
    except Exception as e:
        logger.warning(f"[Sidecar] Error scanning for sidecars: {e}")

    return sidecars


# ============================================================================
# Utility functions (ported from hitta_ansikten.py)
# ============================================================================

def extract_prefix_suffix(fname: str) -> tuple[str | None, str | None]:
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


def split_fornamn_efternamn(namn: str) -> tuple[str, str]:
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
    all_persons: list[str],
    config: dict[str, Any] | None = None
) -> dict[str, str]:
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
    fornamn_map: dict[str, set] = {}
    namn_map: dict[str, tuple[str, str]] = {}

    for namn in set(all_persons):
        fornamn, efternamn = split_fornamn_efternamn(namn)
        if not fornamn:
            continue
        if fornamn not in fornamn_map:
            fornamn_map[fornamn] = set()
        fornamn_map[fornamn].add(efternamn)
        namn_map[namn] = (fornamn, efternamn)

    # Determine short name for each person
    kortnamn: dict[str, str] = {}
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


def build_new_filename(fname: str, personer: list[str], namnmap: dict[str, str]) -> str | None:
    """
    Build new filename with person names (legacy function for compatibility).
    """
    return build_new_filename_with_config(fname, personer, namnmap, None, None)


def build_new_filename_with_config(
    fname: str,
    personer: list[str],
    namnmap: dict[str, str],
    file_path: Path | None,
    config: dict[str, Any] | None,
    manual_suffix: str | None = None
) -> str | None:
    """
    Build new filename with person names using configuration.

    Args:
        fname: Original filename
        personer: List of person names in detection order
        namnmap: Dict mapping full name to short name
        file_path: Path to file (for EXIF/date extraction)
        config: Rename configuration
        manual_suffix: Optional free-text suffix (raw). Normalized and appended
            AFTER the person names. NOT a person name; never touches the DB.

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

    # Append the free-text manual suffix (if any) AFTER the person names, so a
    # suffix-only file (no faces) still renames. Lazy import avoids a circular
    # dependency (manual_suffix_service imports normalize_name from here).
    if manual_suffix:
        from api.services.manual_suffix_service import normalize_suffix
        normalized_suffix = normalize_suffix(manual_suffix)
        if normalized_suffix:
            name_list.append(normalized_suffix)

    # Return None only when there is nothing to write (no names AND no suffix).
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
    elif prefix_source == "filename":
        # Keep the filename's own timestamp INCLUDING any -N burst marker and
        # photographer suffix. Reformatting via the parsed datetime would drop
        # the -N, collapsing burst-disambiguated twins to the same
        # YYMMDD_HHMMSS_Name — they then collide and the DB records both under
        # one name. extract_prefix_suffix preserves -N (and any -N_Name form).
        old_prefix, _ = extract_prefix_suffix(fname)
        prefix = old_prefix if old_prefix else original_stem
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
    filelist: list[str],
    known_faces: dict[str, list],
    processed_files: list | None = None,
    attempt_log: list | None = None
) -> dict[str, list[str]]:
    """
    Collect person names for each file from database and attempt log.

    Uses merge strategy with review-order priority:
    1. If attempt_stats has reviewed data -> start with those names (preserves review order)
    2. Merge in names from encodings.pkl that aren't already present (dedupe)
    3. If no attempt_stats -> fall back to encodings.pkl only

    This ensures manual faces (only in attempt_stats) are included alongside
    auto-detected faces (in encodings.pkl).

    Args:
        filelist: List of file paths
        known_faces: Known faces database
        processed_files: List of processed file entries
        attempt_log: Loaded attempt log entries

    Returns:
        Dict mapping full file path to list of person names in detection order.
    """
    # Build index for encodings.pkl: filename -> names, hash -> names
    file_to_persons: dict[str, list[str]] = {}
    hash_to_persons: dict[str, list[str]] = {}

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
    filehash_map: dict[str, str | None] = {}
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

    if attempt_log is None:
        attempt_log = load_attempt_log()

    stats_by_hash: dict[str, list[str]] = {}
    stats_by_name: dict[str, list[str]] = {}
    basename_count: dict[str, int] = {}

    for entry in attempt_log:
        fn = Path(entry.get("filename", "")).name
        fh = entry.get("file_hash")
        if entry.get("used_attempt") is not None and entry.get("review_results"):
            idx = entry["used_attempt"]
            if idx < len(entry.get("labels_per_attempt", [])):
                res = entry["review_results"][idx] if idx < len(entry["review_results"]) else None
                labels = entry["labels_per_attempt"][idx]
                if res == "ok" and labels:
                    persons_with_idx = []
                    for lbl in labels:
                        label = lbl["label"] if isinstance(lbl, dict) else lbl
                        if "\n" in label:
                            prefix, namn = label.split("\n", 1)
                            if namn.lower() not in ("ignorerad", "ign", "okänt", "okant"):
                                try:
                                    idx = int(prefix.lstrip("#"))
                                except ValueError:
                                    idx = 999
                                persons_with_idx.append((idx, namn))
                    persons_with_idx.sort(key=lambda x: x[0])
                    persons = [p[1] for p in persons_with_idx]
                    if persons:
                        if fh:
                            stats_by_hash[fh] = persons
                        stats_by_name[fn] = persons
                        basename_count[fn] = basename_count.get(fn, 0) + 1

    result: dict[str, list[str]] = {}
    for f in filelist:
        fpath = Path(f)
        fname = fpath.name
        h = filehash_map.get(str(fpath)) or processed_name_to_hash.get(fname)

        # Union of basename- and hash-matched names (deduped). Manual faces may be
        # anchored by only one key (legacy entries have hash=None → basename-only),
        # so a hash-only match must not be suppressed by a basename match, or vice versa.
        encoding_persons = list(file_to_persons.get(fname, []))
        if h:
            for name in hash_to_persons.get(h, []):
                if name not in encoding_persons:
                    encoding_persons.append(name)

        review_persons = []
        if h and h in stats_by_hash:
            review_persons = stats_by_hash[h]
        elif fname in stats_by_name and basename_count.get(fname, 0) == 1:
            review_persons = stats_by_name[fname]

        if review_persons:
            persons = list(review_persons)
            merged = [n for n in encoding_persons if n not in persons]
            if merged:
                logger.info(f"[Rename] Merged {merged} from encodings for {fname}")
            for name in merged:
                persons.append(name)
        else:
            persons = encoding_persons

        result[str(fpath)] = persons

    return result


# ============================================================================
# Path validation
# ============================================================================

def validate_path_security(file_path: str) -> tuple[bool, str]:
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

    def get_default_config(self) -> dict[str, Any]:
        """Return default rename configuration."""
        return DEFAULT_RENAME_CONFIG.copy()

    def preview_rename(
        self,
        file_paths: list[str],
        allow_renamed: bool = False,
        config: dict[str, Any] | None = None
    ) -> dict[str, Any]:
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
        logger.debug(f"[RenameService] Config: {effective_config}")

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

        # Read known_faces + processed_files from the shared store (single
        # authority; no per-request pickle load). collect_persons_for_files
        # only reads these collections, so a snapshot is sufficient.
        known_faces, processed_files = get_db_store().read(
            lambda known, ignored, hardneg, processed: (known, processed)
        )

        # Collect persons for validated files only
        persons_map = collect_persons_for_files(
            validated_paths,
            known_faces,
            processed_files
        )

        # Build a manual-suffix map keyed by full path (content-hash lookup).
        # A free-text suffix is NOT a person name and never touches the DB.
        from api.services.manual_suffix_service import get_manual_suffix
        suffix_map: dict[str, str] = {}
        for fp in validated_paths:
            p = Path(fp)
            if p.exists():
                h = get_file_hash(p)
                raw = get_manual_suffix(h) if h else None
                if raw:
                    suffix_map[fp] = raw

        # Collect all person names for disambiguation
        all_persons = []
        for persons in persons_map.values():
            all_persons.extend(persons)

        # Resolve first name collisions using config
        name_map = resolve_fornamn_dubletter(all_persons, effective_config)

        # Get sidecar config
        rename_sidecars = effective_config.get("renameSidecars", True)
        sidecar_extensions = effective_config.get("sidecarExtensions", ["xmp"])

        # Build preview items (start with security-rejected ones)
        items = list(security_rejected)
        # Add empty sidecars to security-rejected items
        for item in items:
            item["sidecars"] = []
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
                    "conflict_with": None,
                    "sidecars": []
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
                    "conflict_with": None,
                    "sidecars": []
                })
                continue

            # Get persons for this file (keyed by full path to avoid basename collisions)
            persons = persons_map.get(file_path, [])
            raw_suffix = suffix_map.get(file_path)
            logger.debug(f"[RenameService] {fname}: persons={persons} suffix={raw_suffix!r}")
            # Skip only when there are neither faces nor a manual suffix — a
            # faceless photo with a suffix must still rename.
            if not persons and not raw_suffix:
                items.append({
                    "original_path": file_path,
                    "original_name": fname,
                    "new_name": None,
                    "persons": [],
                    "status": "no_persons",
                    "conflict_with": None,
                    "sidecars": []
                })
                continue

            # Build new filename using config (suffix appended after any names)
            new_name = build_new_filename_with_config(
                fname, persons, name_map, path, effective_config, manual_suffix=raw_suffix
            )
            logger.debug(f"[RenameService] {fname} -> {new_name}")
            if not new_name:
                items.append({
                    "original_path": file_path,
                    "original_name": fname,
                    "new_name": None,
                    "persons": persons,
                    "status": "build_failed",
                    "conflict_with": None,
                    "sidecars": []
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
                    "conflict_with": str(new_path),
                    "sidecars": []
                })
                continue

            # Find sidecar files if enabled
            sidecars = []
            if rename_sidecars and sidecar_extensions:
                sidecars = [str(s) for s in find_sidecar_files(path, sidecar_extensions)]

            # All good
            items.append({
                "original_path": file_path,
                "original_name": fname,
                "new_name": new_name,
                "persons": persons,
                "status": "ok",
                "conflict_with": None,
                "sidecars": sidecars
            })

        return {
            "items": items,
            "name_map": name_map
        }

    def execute_rename(
        self,
        file_paths: list[str],
        allow_renamed: bool = False,
        config: dict[str, Any] | None = None
    ) -> dict[str, Any]:
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
        batch_id = fs_ops.new_batch_id()

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

            # Pair each existing sidecar with its destination stem. The move is
            # atomic (main + sidecars): fs_ops rechecks the target exists (TOCTOU
            # guard — the preview may be stale) and rolls back every move if any
            # step fails, so a rename never half-applies with an orphaned sidecar.
            sidecar_pairs = []
            for sidecar_path_str in item.get("sidecars", []):
                sidecar_path = Path(sidecar_path_str)
                if sidecar_path.exists():
                    new_sidecar = sidecar_path.parent / f"{new_path.stem}{sidecar_path.suffix}"
                    sidecar_pairs.append((sidecar_path, new_sidecar))

            try:
                fs_ops.rename_with_sidecars(
                    old_path, new_path, sidecar_pairs,
                    tool="rename", journal_op="rename", batch_id=batch_id,
                )
                renamed.append({
                    "original": str(old_path),
                    "new": str(new_path),
                    "sidecars": [
                        {"original": str(sc), "new": str(sc_dst)}
                        for sc, sc_dst in sidecar_pairs
                    ],
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


    def _update_database_paths(self, renamed_files: list[dict[str, str]],
                               match: str = "basename") -> int:
        """
        Update database entries to reflect renamed files.

        Updates known_faces and processed_files to point to new paths.

        Args:
            renamed_files: List of {"original": old_path, "new": new_path} dicts
            match: How a DB entry is matched to a renamed file.
                "basename" (default, forward rename): match on the trailing
                    filename and keep the entry's own parent directory — the
                    forward flow has no better key than the basename.
                "fullpath" (undo): match on the whole path (abspath-normalised,
                    symlinks NOT resolved) and rewrite it to the full new path,
                    so undoing a rename in one folder never rewrites a DB entry
                    that merely shares a basename in another folder. A DB entry
                    that carries NO directory component (a bare basename — how
                    ordinary review writes processed_files, `Path(image_path).name`)
                    has no directory to be exact against, so it is matched and
                    rewritten by basename and KEPT in bare-basename form (the same
                    global-basename semantics as the forward path).

        Returns:
            Number of database entries updated
        """
        if not renamed_files:
            return 0

        full = match == "fullpath"
        # basename mode: old basename -> new basename (parent kept per entry).
        # fullpath mode: abspath(old full path) -> new full path (verbatim), PLUS
        # a basename fallback for DB entries stored without any directory.
        rename_map = {}
        base_map = {}
        for item in renamed_files:
            if full:
                rename_map[os.path.abspath(item["original"])] = item["new"]
                base_map[Path(item["original"]).name] = Path(item["new"]).name
            else:
                rename_map[Path(item["original"]).name] = Path(item["new"]).name

        def _lookup(stored: str):
            """Return (matched, new_value) for a stored path string, or (False, None)."""
            if full:
                # A bare basename (no directory component) can't be matched on the
                # full path; fall back to basename and keep the bare form.
                if os.path.dirname(stored) == "":
                    base = Path(stored).name
                    if base in base_map:
                        return True, base_map[base]
                    return False, None
                key = os.path.abspath(stored)
                if key in rename_map:
                    return True, rename_map[key]
                return False, None
            base = Path(stored).name
            if base in rename_map:
                return True, str(Path(stored).parent / rename_map[base])
            return False, None

        def compute(known_faces, processed_files, apply_changes):
            updated_count = 0

            # Update known_faces entries (edited in place only when applying)
            for person_name, entries in known_faces.items():
                for entry in entries:
                    if isinstance(entry, dict) and entry.get("file"):
                        matched, new_value = _lookup(entry["file"])
                        if matched:
                            updated_count += 1
                            if apply_changes:
                                logger.debug(f"[RenameService] Updated encoding entry: {entry['file']} -> {new_value}")
                                entry["file"] = new_value

            # Update processed_files entries
            for pf in processed_files:
                if isinstance(pf, dict) and pf.get("name"):
                    matched, new_value = _lookup(pf["name"])
                    if matched:
                        updated_count += 1
                        if apply_changes:
                            old_name = pf["name"]
                            if new_value != old_name:
                                logger.debug(f"[RenameService] Updated processed entry: {old_name} -> {new_value}")
                                record_previous_name(pf, old_name)
                                pf["name"] = new_value

            return updated_count

        store = get_db_store()
        # Plan under read() first so a no-op schedules no save; going through the
        # store's write path keeps its in-memory state authoritative (a direct
        # save_database would clobber it).
        updated_count = store.read(
            lambda known, ignored, hardneg, processed: compute(known, processed, False)
        )
        if updated_count > 0:
            updated_count = store.mutate(
                lambda known, ignored, hardneg, processed: compute(known, processed, True),
                touches={"known", "processed"},
            )
            store.flush()  # user-confirmed rename → persist synchronously
            logger.info(f"[RenameService] Updated {updated_count} database entries after rename")

        return updated_count


_rename_service = None

def get_rename_service():
    global _rename_service
    if _rename_service is None:
        _rename_service = RenameService()
    return _rename_service

class _RenameServiceProxy:
    def __getattr__(self, name):
        return getattr(get_rename_service(), name)

rename_service = _RenameServiceProxy()
