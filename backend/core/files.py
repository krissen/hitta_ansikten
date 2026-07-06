"""Canonical image file-extension sets.

Single source of truth for the extensions the backend recognizes, so the
various services (detection, preprocessing, rename, file resolution) no longer
maintain their own drifting copies. Extensions are lowercase and include the
leading dot; membership tests must lower-case the candidate first.
"""

# RAW formats handled via rawpy/libraw.
RAW_EXTENSIONS: tuple[str, ...] = (
    ".nef",
    ".cr2",
    ".cr3",
    ".arw",
    ".dng",
    ".raw",
    ".raf",
    ".orf",
    ".rw2",
)

# JPEG variants only.
JPEG_EXTENSIONS: tuple[str, ...] = (".jpg", ".jpeg")

# Standard (non-RAW) image formats.
STANDARD_EXTENSIONS: tuple[str, ...] = (".jpg", ".jpeg", ".tiff", ".tif", ".png")

# Everything the rename/resolve pipeline accepts (RAW + standard).
SUPPORTED_EXTENSIONS: tuple[str, ...] = RAW_EXTENSIONS + STANDARD_EXTENSIONS
