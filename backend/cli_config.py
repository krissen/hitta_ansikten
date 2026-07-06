"""Deprecated shim: use core.config instead.

Kept temporarily for backward compatibility while importers migrate to the
core package. Re-exports every public name from core.config.
"""

from core.config import *  # noqa: F401,F403
