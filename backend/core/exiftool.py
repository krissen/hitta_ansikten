"""Locate the ``exiftool`` binary robustly.

A GUI-launched Electron app on macOS inherits a minimal PATH that usually lacks
``/opt/homebrew/bin`` (Apple Silicon Homebrew) and ``/usr/local/bin`` (Intel
Homebrew), so a bare ``exiftool`` invocation raises FileNotFoundError even when
the tool is installed. Resolving the absolute path here lets every exiftool
caller work regardless of how the process was started.
"""

import os
import shutil

# Common install locations to probe when exiftool is not on PATH.
_FALLBACK_PATHS = (
    "/opt/homebrew/bin/exiftool",
    "/usr/local/bin/exiftool",
)


def find_exiftool() -> str:
    """Return an absolute path to a runnable ``exiftool``.

    Tries PATH first (``shutil.which``), then well-known Homebrew locations.

    Raises:
        FileNotFoundError: if no runnable exiftool can be found.
    """
    found = shutil.which("exiftool")
    if found:
        return found

    for candidate in _FALLBACK_PATHS:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate

    raise FileNotFoundError("exiftool not found on PATH or in /opt/homebrew/bin, /usr/local/bin")
