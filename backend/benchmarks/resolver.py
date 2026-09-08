"""Source-image resolver core (pure, testable).

Builds a SHA1 -> current-path index by walking configurable photo roots and
hashing image files, with an incremental cache that only rehashes a file when
its size or mtime changes. The join logic maps the face database's recorded
SHA1 hashes onto currently-present files.

Nothing here reads the real face database or touches the network — that lives
in ``db_access.py`` (real DB) and ``recovery.py`` (backup lookups). Keeping the
core pure means the tests can drive it with synthetic tmp dirs and a fabricated
mini-DB dict.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

try:
    # Reuse the backend's canonical extension set when available.
    from core.files import SUPPORTED_EXTENSIONS as _CORE_EXTENSIONS
except ImportError:  # pragma: no cover - fallback if run outside the backend tree
    _CORE_EXTENSIONS = (
        ".nef",
        ".cr2",
        ".cr3",
        ".arw",
        ".dng",
        ".raw",
        ".raf",
        ".orf",
        ".rw2",
        ".jpg",
        ".jpeg",
        ".tiff",
        ".tif",
        ".png",
    )

# Lowercase, dot-prefixed. Membership tests must lower-case the candidate first.
DEFAULT_EXTENSIONS: tuple[str, ...] = tuple(_CORE_EXTENSIONS)

# Directory names never worth walking into.
SKIP_DIRS: frozenset[str] = frozenset(
    {".git", "__pycache__", ".Trash", "$RECYCLE.BIN", "node_modules"}
)

_CHUNK = 65536


def sha1_file(path: Path | str) -> str | None:
    """SHA1 hex digest of a file, chunked.

    Matches ``core.db.get_file_hash`` byte-for-byte so hashes computed here
    join directly against the values recorded in ``encodings.pkl``.
    Returns ``None`` on any read error.
    """
    h = hashlib.sha1()
    try:
        with open(path, "rb") as f:
            while True:
                chunk = f.read(_CHUNK)
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def is_image(path: Path, extensions: Iterable[str] = DEFAULT_EXTENSIONS) -> bool:
    """True when ``path``'s extension is one of the recognized image types."""
    exts = extensions if isinstance(extensions, (set, frozenset, tuple)) else tuple(extensions)
    return path.suffix.lower() in exts


@dataclass
class IndexEntry:
    """One cached file: identity metadata + computed hash."""

    path: str
    size: int
    mtime: float
    sha1: str

    def to_json(self) -> dict:
        return {"size": self.size, "mtime": self.mtime, "sha1": self.sha1}


@dataclass
class BuildStats:
    """Outcome counters for a single ``build`` pass."""

    scanned: int = 0  # image files encountered on disk
    hashed: int = 0  # files (re)hashed this pass
    reused: int = 0  # files served from cache (unchanged)
    errors: int = 0  # files that could not be hashed
    pruned: int = 0  # cache entries dropped (file gone)
    roots: list[str] = field(default_factory=list)


class SourceIndex:
    """Incrementally-cached SHA1 -> path index over a set of photo roots.

    Cache file schema (``_data/source_index.json``)::

        {
          "version": 1,
          "files": { "<abspath>": {"size": int, "mtime": float, "sha1": str} }
        }

    A file is rehashed only when it is new or its ``(size, mtime)`` changed;
    otherwise the cached digest is reused. Entries whose file has disappeared
    are pruned on the next build.
    """

    VERSION = 1

    def __init__(self, cache_path: Path | str | None = None):
        self.cache_path = Path(cache_path) if cache_path else None
        # abspath -> IndexEntry
        self._entries: dict[str, IndexEntry] = {}

    # -- persistence -------------------------------------------------------
    def load(self) -> "SourceIndex":
        if self.cache_path and self.cache_path.exists():
            try:
                data = json.loads(self.cache_path.read_text())
            except (OSError, json.JSONDecodeError):
                data = {}
            for path, meta in (data.get("files") or {}).items():
                try:
                    self._entries[path] = IndexEntry(
                        path=path,
                        size=int(meta["size"]),
                        mtime=float(meta["mtime"]),
                        sha1=str(meta["sha1"]),
                    )
                except (KeyError, TypeError, ValueError):
                    continue
        return self

    def save(self) -> None:
        if not self.cache_path:
            return
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": self.VERSION,
            "files": {e.path: e.to_json() for e in self._entries.values()},
        }
        tmp = self.cache_path.with_suffix(self.cache_path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, indent=2, sort_keys=True))
        tmp.replace(self.cache_path)

    # -- building ----------------------------------------------------------
    def build(
        self,
        roots: Iterable[Path | str],
        extensions: Iterable[str] = DEFAULT_EXTENSIONS,
        follow_symlinks: bool = False,
    ) -> BuildStats:
        """Walk ``roots``, hashing new/changed image files. Returns stats.

        Existing cache entries are reused when ``(size, mtime)`` is unchanged.
        Entries for files that no longer exist under the given roots (or that
        vanished) are pruned.
        """
        exts = tuple(e.lower() for e in extensions)
        stats = BuildStats(roots=[str(r) for r in roots])
        seen: set[str] = set()

        for root in roots:
            root = Path(root)
            if not root.exists():
                continue
            for dirpath, dirnames, filenames in os.walk(root, followlinks=follow_symlinks):
                # Prune uninteresting directories in-place.
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for name in filenames:
                    p = Path(dirpath) / name
                    if p.suffix.lower() not in exts:
                        continue
                    stats.scanned += 1
                    ap = os.path.abspath(p)
                    seen.add(ap)
                    try:
                        st = p.stat()
                    except OSError:
                        stats.errors += 1
                        continue
                    cached = self._entries.get(ap)
                    if (
                        cached is not None
                        and cached.size == st.st_size
                        and cached.mtime == st.st_mtime
                    ):
                        stats.reused += 1
                        continue
                    digest = sha1_file(p)
                    if digest is None:
                        stats.errors += 1
                        continue
                    self._entries[ap] = IndexEntry(
                        path=ap, size=st.st_size, mtime=st.st_mtime, sha1=digest
                    )
                    stats.hashed += 1

        # Prune cache entries whose file lives under a scanned root but is gone.
        # Only prune paths that were under the roots we just walked, so a
        # partial-root build does not wipe entries for other roots.
        root_prefixes = [os.path.abspath(str(r)) + os.sep for r in roots]
        for ap in list(self._entries):
            under_scanned = any(ap.startswith(pref) for pref in root_prefixes)
            if under_scanned and ap not in seen:
                del self._entries[ap]
                stats.pruned += 1

        return stats

    # -- querying ----------------------------------------------------------
    def hash_to_paths(self) -> dict[str, list[str]]:
        """SHA1 -> sorted list of current paths carrying that content."""
        out: dict[str, list[str]] = {}
        for e in self._entries.values():
            out.setdefault(e.sha1, []).append(e.path)
        for paths in out.values():
            paths.sort()
        return out

    def hashes(self) -> set[str]:
        return {e.sha1 for e in self._entries.values()}

    def __len__(self) -> int:
        return len(self._entries)


@dataclass
class Resolution:
    """Per-recorded-hash resolution outcome (one row per unique source image)."""

    sha1: str
    resolved: bool
    current_paths: list[str]
    recorded_basenames: list[str]  # distinct basenames the DB recorded for this hash
    face_count: int  # encodings referencing this source image


def resolve_hashes(
    recorded: dict[str, list[str]],
    face_counts: dict[str, int],
    index: SourceIndex,
) -> list[Resolution]:
    """Join recorded DB hashes against the current source index.

    ``recorded`` maps SHA1 -> list of basenames the DB recorded for it;
    ``face_counts`` maps SHA1 -> number of encodings referencing it.
    """
    h2p = index.hash_to_paths()
    out: list[Resolution] = []
    for sha1, basenames in recorded.items():
        paths = h2p.get(sha1, [])
        out.append(
            Resolution(
                sha1=sha1,
                resolved=bool(paths),
                current_paths=paths,
                recorded_basenames=sorted(set(basenames)),
                face_count=face_counts.get(sha1, 0),
            )
        )
    return out
