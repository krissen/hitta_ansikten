"""CLI: build the SHA1 -> current-path source index and report resolution.

Usage (from ``backend/``)::

    python -m benchmarks.resolve                      # scan default roots
    python -m benchmarks.resolve ~/Pictures/nerladdat # scan explicit roots
    python -m benchmarks.resolve --json               # dump per-hash JSON

The source index is cached incrementally at ``_data/source_index.json`` and
only rehashes files whose size/mtime changed. Nothing under
``~/.local/share/faceid/`` is ever written.
"""

from __future__ import annotations

import argparse
import json
import sys

from benchmarks import config as cfg
from benchmarks.db_access import (
    DEFAULT_DB_PATH,
    face_counts,
    load_db_records,
    recorded_hash_map,
)
from benchmarks.resolver import SourceIndex, resolve_hashes


def build_index(roots, cache_path, verbose=True) -> SourceIndex:
    index = SourceIndex(cache_path).load()
    if verbose:
        print(f"Scanning {len(roots)} root(s):", file=sys.stderr)
        for r in roots:
            print(f"  - {r}", file=sys.stderr)
    stats = index.build(roots)
    index.save()
    if verbose:
        print(
            f"Indexed: scanned={stats.scanned} hashed={stats.hashed} "
            f"reused={stats.reused} errors={stats.errors} pruned={stats.pruned} "
            f"unique_files={len(index)}",
            file=sys.stderr,
        )
    return index


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("roots", nargs="*", help="Photo roots to scan (override config).")
    ap.add_argument("--config", default=None, help="Path to a roots.json config.")
    ap.add_argument("--cache", default=str(cfg.CACHE_PATH), help="Index cache path.")
    ap.add_argument("--db", default=str(DEFAULT_DB_PATH), help="encodings.pkl path.")
    ap.add_argument("--json", action="store_true", help="Emit per-hash JSON to stdout.")
    ap.add_argument("--quiet", action="store_true", help="Suppress progress on stderr.")
    args = ap.parse_args(argv)

    cfg.ensure_data_dir()
    roots = cfg.resolve_roots(args.roots or None, args.config)
    if not roots:
        print("No photo roots found to scan.", file=sys.stderr)
        return 2

    index = build_index(roots, args.cache, verbose=not args.quiet)

    records = load_db_records(args.db)
    recorded = recorded_hash_map(records)
    counts = face_counts(records)
    resolutions = resolve_hashes(recorded, counts, index)

    total_images = len(resolutions)
    resolved_images = sum(1 for r in resolutions if r.resolved)
    total_faces = len(records)
    resolved_faces = sum(r.face_count for r in resolutions if r.resolved)

    if args.json:
        json.dump(
            [
                {
                    "sha1": r.sha1,
                    "resolved": r.resolved,
                    "current_paths": r.current_paths,
                    "recorded_basenames": r.recorded_basenames,
                    "face_count": r.face_count,
                }
                for r in resolutions
            ],
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
    else:
        print(
            f"Source images (unique hashes): {resolved_images}/{total_images} "
            f"resolved ({_pct(resolved_images, total_images)})"
        )
        print(
            f"Faces (encodings):             {resolved_faces}/{total_faces} "
            f"resolved ({_pct(resolved_faces, total_faces)})"
        )
    return 0


def _pct(n, d) -> str:
    return f"{100 * n / d:.1f}%" if d else "n/a"


if __name__ == "__main__":
    raise SystemExit(main())
