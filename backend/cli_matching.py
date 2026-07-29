"""Deprecated shim: use core.matching instead.

Kept temporarily for backward compatibility while importers migrate to the
core package. Re-exports every public name from core.matching.
"""

from core.matching import *  # noqa: F403
