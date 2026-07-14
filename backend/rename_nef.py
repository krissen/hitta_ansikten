#!/usr/bin/env python3
"""Rename NEF files based on EXIF CreateDate.

Output format: YYMMDD_HHMMSS.NEF
Files with identical timestamps get suffixes: -00, -01, etc.
Uses two-pass rename (via temp files) to avoid collisions.
"""

import argparse
import logging
import os
import re
import subprocess
import sys
from collections import defaultdict
from glob import glob
from pathlib import Path

from core.exiftool import find_exiftool

# A file is "already named" when its stem already carries its EXIF timestamp,
# optionally followed by a burst marker (-N), a name suffix (_Name1,_Name2), or
# both (-N_Name). Such a file has been through review/naming already and must not
# be stripped back to a bare timestamp by an EXIF rename. Matches the empty rest
# too, so a bare YYMMDD_HHMMSS file is a no-op as before.
_NAMED_REST = re.compile(r"(-\d+)?(_.*)?$")

# Simple logging setup for this standalone script
logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)


def get_exif_data(files: list[Path]) -> list[tuple[str, int, Path]]:
    if not files:
        return []
    
    cmd = [
        find_exiftool(), "-q", "-q", "-m",
        "-if", "defined $CreateDate",
        "-d", "%y%m%d_%H%M%S",
        "-p", "$CreateDate|${SubSecTimeOriginal;$_||=0}|$FilePath",
        "--",
        *[str(f) for f in files]
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 and result.stderr:
        logging.warning(f"exiftool warning: {result.stderr.strip()}")
        print(f"exiftool warning: {result.stderr}", file=sys.stderr)
    
    entries = []
    for line in result.stdout.strip().split("\n"):
        if not line or "|" not in line:
            continue
        parts = line.split("|", 2)
        if len(parts) != 3:
            continue
        timestamp, subsec_str, filepath = parts
        try:
            subsec = int(subsec_str) if subsec_str else 0
        except ValueError:
            subsec = 0
        entries.append((timestamp, subsec, Path(filepath)))
    
    entries.sort(key=lambda x: (x[0], x[1], str(x[2])))
    return entries


def is_already_named(name: str, ts: str) -> bool:
    """True when `name`'s stem already begins with its EXIF timestamp `ts`.

    Recognizes the bare timestamp and the suffix forms the app produces:
    ``ts``, ``ts-N``, ``ts_Name1,_Name2`` and ``ts-N_Name``. These are files
    that have already been named (or are already in canonical form), so an
    EXIF-based rename must leave them untouched unless explicitly opted in.
    """
    if not ts:
        return False
    stem = Path(name).stem
    if not stem.startswith(ts):
        return False
    return _NAMED_REST.fullmatch(stem[len(ts):]) is not None


# Sentinel for the bare-timestamp slot (`ts.NEF`), distinct from integer -N slots.
_BARE_SLOT = "bare"


def timestamp_slot(name: str, ts: str) -> "str | int":
    """Which numbering slot `name` occupies within timestamp `ts`.

    A file occupies its timestamp slot regardless of any name suffix, because
    the downstream review-rename preserves the timestamp prefix: `ts.NEF` and
    `ts_Name.NEF` both occupy the bare slot; `ts-N.NEF` and `ts-N_Name.NEF` both
    occupy index N. So an unnamed sibling planned into a free slot can never be
    named into a collision with a protected named neighbor later.

    Returns ``_BARE_SLOT`` or the integer index. Assumes `is_already_named`.
    """
    rest = Path(name).stem[len(ts):]
    m = re.match(r"-(\d+)", rest)
    return int(m.group(1)) if m else _BARE_SLOT


def compute_renames(
    entries: list[tuple[str, int, Path]],
    include_named: bool = False,
) -> list[tuple[Path, Path, Path]]:
    # By default, already-named files (stem already carries the EXIF timestamp)
    # keep their name — but they are NOT simply dropped: a same-second unnamed
    # file must not be planned into a slot a protected file already holds, or a
    # later prefix-preserving review-rename could collide with it. So we
    # partition them out of the rename set yet reserve their timestamp SLOTS
    # (bare or index N) and hand unnamed files the next free slot.
    # include_named=True renames everything (stripping any suffix).
    if include_named:
        to_rename = list(entries)
        protected: list[tuple[str, int, Path]] = []
    else:
        to_rename, protected = [], []
        for e in entries:
            (protected if is_already_named(e[2].name, e[0]) else to_rename).append(e)

    # Bare-vs-burst and zero-pad width are decided by the files actually being
    # renamed; protected files only reserve slots.
    ts_counts: dict[str, int] = defaultdict(int)
    for ts, _, _ in to_rename:
        ts_counts[ts] += 1

    ts_digits = {ts: max(1, len(str(count - 1))) for ts, count in ts_counts.items()}

    # Slots taken by protected files, per (parent, ext, ts). Each timestamp has
    # its own slot namespace (a `-0` under one second is unrelated to another's).
    occupied: dict[tuple[Path, str, str], set] = defaultdict(set)
    for ts, _sub, src in protected:
        occupied[(src.parent, src.suffix or ".NEF", ts)].add(timestamp_slot(src.name, ts))

    renames = []
    stamp = f"{os.getpid()}.{hash(str(entries)) % 10000}"

    for i, (ts, _, src) in enumerate(to_rename):
        ext = src.suffix or ".NEF"
        key = (src.parent, ext, ts)
        taken = occupied[key]

        # Sole holder of this timestamp AND the bare slot is free → bare name.
        # Otherwise (shared timestamp, or the bare slot held by a protected
        # file) take the lowest free -N index.
        if ts_counts[ts] == 1 and _BARE_SLOT not in taken:
            dst_base = ts
            taken.add(_BARE_SLOT)
        else:
            n = 0
            while n in taken:
                n += 1
            taken.add(n)
            dst_base = f"{ts}-{str(n).zfill(ts_digits[ts])}"

        dst = src.parent / f"{dst_base}{ext}"
        tmp = src.parent / f".rename_tmp_{stamp}_{i}{ext}"

        if src.name == dst.name:
            continue

        renames.append((src, dst, tmp))

    return renames


def execute_renames(renames: list[tuple[Path, Path, Path]], dry_run: bool = False) -> None:
    if not renames:
        print("Inga filer att döpa om.")
        return
    
    if dry_run:
        for src, dst, _ in renames:
            print(f"(dry) {src.name} -> {dst.name}")
        return
    
    for src, dst, tmp in renames:
        try:
            src.rename(tmp)
        except OSError as e:
            logging.error(f"Rename to temp failed: {src} -> {tmp}: {e}")
            print(f"misslyckades (till temp): {src} -> {tmp}: {e}", file=sys.stderr)

    for src, dst, tmp in renames:
        if dst.exists():
            logging.warning(f"Destination exists, skipping: {dst}")
            print(f"skip: finns redan -> {dst}", file=sys.stderr)
            if tmp.exists():
                tmp.unlink()
            continue
        try:
            tmp.rename(dst)
        except OSError as e:
            logging.error(f"Rename to final failed: {tmp} -> {dst}: {e}")
            print(f"misslyckades (till final): {tmp} -> {dst}: {e}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Döp om NEF-filer baserat på EXIF CreateDate (YYMMDD_HHMMSS)"
    )
    parser.add_argument(
        "-n", "--dry-run",
        action="store_true",
        help="Visa vad som skulle göras utan att utföra"
    )
    parser.add_argument(
        "--include-named",
        action="store_true",
        help="Döp även om redan namngivna filer (tar bort namnsuffix)"
    )
    parser.add_argument(
        "files",
        nargs="*",
        default=["*.NEF"],
        help="Filer eller glob-mönster (default: *.NEF)"
    )
    args = parser.parse_args()
    
    files = []
    for pattern in args.files:
        p = Path(pattern)
        if p.is_file():
            files.append(p)
        else:
            files.extend(Path(f) for f in glob(pattern) if Path(f).is_file())
    
    if not files:
        print(f"Inga filer matchar: {' '.join(args.files)}")
        return 0

    entries = get_exif_data(files)

    if not entries:
        print(f"Inga filer med CreateDate i: {' '.join(args.files)}")
        return 0
    
    renames = compute_renames(entries, include_named=args.include_named)
    execute_renames(renames, dry_run=args.dry_run)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
