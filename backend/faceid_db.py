"""Deprecated shim: use core.db instead.

Kept temporarily for backward compatibility while importers migrate to the
core package. Aliases this module to ``core.db`` in ``sys.modules`` so that
``import faceid_db`` and ``import core.db`` resolve to the *same* module
object. This keeps attribute access and test monkeypatching coherent across
both names (patching ``faceid_db.BASE_DIR`` is patching ``core.db.BASE_DIR``).
"""

import sys

from core import db

sys.modules[__name__] = db
