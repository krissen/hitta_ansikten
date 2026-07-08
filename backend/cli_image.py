"""Deprecated shim: use core.image instead.

Kept temporarily for backward compatibility while importers migrate to the
core package. Re-exports every public name from core.image.
"""

from core.image import *  # noqa: F401,F403
