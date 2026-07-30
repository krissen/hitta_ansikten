"""
labels.py - The review-label vocabulary: ignore markers and index prefixes.

A review label is stored for display as ``"#3\\nElis Niemi"`` — a one-based
index prefix, a newline, then the person name. Some names are not persons at
all but markers meaning "do not enrol this face": the reviewer skipped it, or
the identity is unknown.

This module is the single definition of that vocabulary. It is deliberately a
leaf: it imports nothing from ``core`` (or the API), so both ``core.db`` and
``core.naming`` can use it without an import cycle.
"""

from __future__ import annotations

import re

# Label names that mean "this face is not a person". Compare lowercased.
# ``okant`` is the ASCII spelling of ``okänt``; both occur in the log.
IGNORE_MARKERS: frozenset[str] = frozenset({"ignorerad", "ign", "okänt", "okant"})

# The marker *written* when a face is skipped. Readers accept all four variants
# (older logs and hand edits carry the others); writers only ever use this one.
CANONICAL_IGNORE_MARKER = "ignorerad"

# The ``#N\n`` display prefix. Stripped only when it is exactly that shape, so
# a name that merely contains a newline is left alone.
_INDEX_PREFIX_RE = re.compile(r"^#\d+\n")


def strip_label_index(label: str) -> str:
    """Return the name part of a display label, without the ``#N\\n`` prefix.

    Labels lacking the prefix are returned as-is (whitespace-stripped), so this
    is safe to call on names that were already de-prefixed by the caller.
    """
    return _INDEX_PREFIX_RE.sub("", label, count=1).strip()


def is_ignore_name(name: str) -> bool:
    """True if an already de-prefixed label name is an ignore marker.

    Matches exactly (after whitespace-strip and lowercasing) against
    :data:`IGNORE_MARKERS`. A name that merely *ends with* a marker — say
    ``"X ignorerad"`` — is a person name and is not a marker.
    """
    return name.strip().lower() in IGNORE_MARKERS


def is_ignore_label(label: str) -> bool:
    """True if a raw display label (``#N\\nname`` or bare name) is an ignore marker."""
    return is_ignore_name(strip_label_index(label))
