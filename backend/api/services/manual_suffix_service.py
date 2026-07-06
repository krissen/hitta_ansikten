"""
Manual Suffix Service

Persists a free-text filename suffix per image, keyed by the image's
content hash (SHA1). This is NOT a person name: it is never written to the
face database (encodings.pkl), name autocomplete, or the person pipeline.
It only affects the resulting filename during rename.

Store: `manual_suffixes.json` under BASE_DIR, mapping sha1 -> raw suffix string.
"""

import json
import logging
import os
import re
import tempfile

from api.services.rename_service import normalize_name
from faceid_db import BASE_DIR

logger = logging.getLogger(__name__)

# Path to the JSON store. Kept as a module attribute so tests can monkeypatch it.
MANUAL_SUFFIX_PATH = BASE_DIR / "manual_suffixes.json"


def normalize_suffix(raw: str) -> str:
    """
    Normalize a free-text suffix into a filesystem-safe token.

    Rules (mirrored client-side in the UI preview):
    - trim surrounding whitespace
    - collapse runs of whitespace into a single underscore
    - fold diacritics and sanitize path separators (reuse normalize_name)
    - collapse repeated underscores, trim leading/trailing underscores

    Returns '' for empty / whitespace-only / path-only input.
    """
    if not raw:
        return ""
    s = raw.strip()
    if not s:
        return ""
    # Whitespace runs -> single underscore
    s = re.sub(r"\s+", "_", s)
    # Diacritic folding + path-safety (å/ä -> a, ö -> o, / \ \0 -> _)
    s = normalize_name(s)
    # No '..' path-traversal tokens: build_new_filename_with_config's guard
    # rejects them, so keep the suffix (and the UI preview) buildable.
    s = re.sub(r"\.{2,}", "_", s)
    # Collapse repeated underscores and trim edges
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def load_manual_suffixes() -> dict:
    """
    Load the suffix store. Tolerates a missing or corrupt file (returns {}).
    """
    try:
        with open(MANUAL_SUFFIX_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
        logger.warning("[ManualSuffix] Store is not a dict, ignoring")
        return {}
    except FileNotFoundError:
        return {}
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"[ManualSuffix] Could not read store: {e}")
        return {}


def get_manual_suffix(file_hash):
    """Return the stored raw suffix for a content hash, or None."""
    if not file_hash:
        return None
    return load_manual_suffixes().get(file_hash)


def set_manual_suffix(file_hash, suffix):
    """
    Set or clear the raw suffix for a content hash.

    An empty / whitespace-only / path-only suffix (one that normalizes to '')
    DELETES the entry. Otherwise the trimmed raw text is stored.
    """
    if not file_hash:
        return
    data = load_manual_suffixes()
    if not suffix or not normalize_suffix(suffix):
        data.pop(file_hash, None)
    else:
        data[file_hash] = suffix.strip()
    _atomic_write(data)


def _atomic_write(data: dict) -> None:
    """Write the store atomically (tmp file + os.replace)."""
    MANUAL_SUFFIX_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(MANUAL_SUFFIX_PATH.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, MANUAL_SUFFIX_PATH)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
