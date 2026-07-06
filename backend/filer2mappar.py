#!/usr/bin/env python3
"""Flytta filer till undermappar baserat på datum (YYMMDD).

Datumkällor:
- Filnamn (default): YYMMDD extraherat från filnamnet
- EXIF (--exif-date): CreateDate från EXIF-metadata
- Fil (--file-date): Filens modifieringsdatum

Filer flyttas till mapp YYMMDD/. Sidecar-filer (.xmp) följer med automatiskt.
"""

import argparse
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from glob import glob
from pathlib import Path

DATE_PATTERN = re.compile(r'^(\d{6})_')


def parse_date_arg(date_str: str) -> str:
    """Parsa datumargument till YYMMDD-format.

    Accepterar: YYMMDD, YYYY-MM-DD, YY-MM-DD, YYYYMMDD
    """
    date_str = date_str.strip()

    if re.match(r'^\d{6}$', date_str):
        return date_str
    if re.match(r'^\d{8}$', date_str):
        return date_str[2:]
    if re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return dt.strftime('%y%m%d')
    if re.match(r'^\d{2}-\d{2}-\d{2}$', date_str):
        dt = datetime.strptime(date_str, '%y-%m-%d')
        return dt.strftime('%y%m%d')

    raise ValueError(f"Okänt datumformat: {date_str} (använd YYMMDD, YYYY-MM-DD, YY-MM-DD eller YYYYMMDD)")


def format_date_display(yymmdd: str) -> str:
    """Formatera YYMMDD för visning."""
    try:
        dt = datetime.strptime(yymmdd, '%y%m%d')
        return dt.strftime('%Y-%m-%d')
    except ValueError:
        return yymmdd


# === Datumkällor ===

def extract_date_from_filename(filename: str) -> str | None:
    """Extrahera YYMMDD från filnamn."""
    match = DATE_PATTERN.match(filename)
    return match.group(1) if match else None


def extract_date_from_mtime(file: Path) -> str | None:
    """Extrahera YYMMDD från filens mtime."""
    try:
        mtime = os.path.getmtime(file)
        dt = datetime.fromtimestamp(mtime)
        return dt.strftime('%y%m%d')
    except OSError:
        return None


def extract_dates_from_exif(files: list[Path]) -> dict[Path, str]:
    """Extrahera YYMMDD från EXIF CreateDate för flera filer."""
    if not files:
        return {}

    cmd = [
        "exiftool", "-q", "-q", "-m",
        "-if", "defined $CreateDate",
        "-d", "%y%m%d",
        "-p", "$CreateDate|$FilePath",
        "--",
        *[str(f) for f in files]
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        print("FEL: exiftool krävs för --exif-date", file=sys.stderr)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("FEL: exiftool timeout", file=sys.stderr)
        sys.exit(1)

    dates: dict[Path, str] = {}
    for line in result.stdout.strip().split("\n"):
        if not line or "|" not in line:
            continue
        parts = line.split("|", 1)
        if len(parts) != 2:
            continue
        date, filepath = parts
        dates[Path(filepath).resolve()] = date

    return dates


def get_file_dates(
    files: list[Path],
    source: str = "filename"
) -> dict[Path, str]:
    """Hämta datum för filer baserat på vald källa."""

    if source == "exif":
        return extract_dates_from_exif(files)

    dates: dict[Path, str] = {}
    for file in files:
        if source == "filename":
            date = extract_date_from_filename(file.name)
        elif source == "file":
            date = extract_date_from_mtime(file)
        else:
            date = extract_date_from_filename(file.name)

        if date:
            dates[file] = date

    return dates


# === Sidecar-hantering ===

def find_sidecar_files(file: Path) -> list[Path]:
    """Hitta sidecar-filer (.xmp) för en given fil."""
    sidecars = []
    stem = file.stem
    for sidecar in file.parent.glob(f"{stem}.[xX][mM][pP]"):
        if sidecar.exists() and sidecar != file:
            sidecars.append(sidecar)
            break  # macOS är case-insensitive
    return sidecars


# === Filtrering och flytt ===

def filter_by_date(
    file_dates: dict[Path, str],
    before: str | None = None,
    after: str | None = None,
    exact: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict[Path, str]:
    """Filtrera filer baserat på datum."""

    if not any([before, after, exact, from_date, to_date]):
        return file_dates

    filtered: dict[Path, str] = {}
    for file, date in file_dates.items():
        if exact and date != exact:
            continue
        if before and date >= before:
            continue
        if after and date <= after:
            continue
        if from_date and date < from_date:
            continue
        if to_date and date > to_date:
            continue
        filtered[file] = date

    return filtered


def compute_moves(
    file_dates: dict[Path, str],
    include_sidecars: bool = True
) -> dict[str, list[Path]]:
    """Gruppera filer per datum och inkludera sidecars."""
    moves: dict[str, list[Path]] = defaultdict(list)
    seen: set[Path] = set()

    for file, date in file_dates.items():
        if file in seen:
            continue

        moves[date].append(file)
        seen.add(file)

        if include_sidecars:
            for sidecar in find_sidecar_files(file):
                if sidecar not in seen:
                    moves[date].append(sidecar)
                    seen.add(sidecar)

    return moves


def execute_moves(
    moves: dict[str, list[Path]],
    base_dir: Path,
    dry_run: bool = False,
    verbose: bool = False
) -> int:
    """Utför flytt av filer till datummappar."""
    if not moves:
        print("Inga filer att flytta.")
        return 0

    total_moved = 0

    for date, files in sorted(moves.items()):
        target_dir = base_dir / date

        if not dry_run and not target_dir.exists():
            target_dir.mkdir(parents=True)
            if verbose:
                print(f"Skapar mapp: {target_dir.name}/")
        elif dry_run and not target_dir.exists():
            print(f"(dry) Skapar mapp: {target_dir.name}/")

        for file in files:
            target = target_dir / file.name

            if target.exists():
                print(f"SKIP (finns redan): {file.name}", file=sys.stderr)
                continue

            if dry_run:
                print(f"(dry) {file.name} -> {date}/")
            else:
                try:
                    file.rename(target)
                    total_moved += 1
                    if verbose:
                        print(f"{file.name} -> {date}/")
                except OSError as e:
                    print(f"FEL: {file.name}: {e}", file=sys.stderr)

    if not dry_run:
        print(f"Flyttade {total_moved} filer.")

    return total_moved


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Flytta filer till undermappar baserat på datum (YYMMDD)",
        epilog="Datumformat: YYMMDD, YYYY-MM-DD, YY-MM-DD eller YYYYMMDD"
    )

    # Allmänna
    parser.add_argument(
        "-n", "--dry-run",
        action="store_true",
        help="Visa vad som skulle göras utan att utföra"
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Visa varje flytt"
    )
    parser.add_argument(
        "--no-sidecars", "--inga-sidecars",
        dest="no_sidecars",
        action="store_true",
        help="Flytta inte .xmp-filer automatiskt"
    )

    # Datumkälla
    source_group = parser.add_argument_group('datumkälla (default: filnamn)')
    source_mutex = source_group.add_mutually_exclusive_group()
    source_mutex.add_argument(
        "--exif-date", "--exif-datum",
        dest="exif_date",
        action="store_true",
        help="Använd EXIF CreateDate (kräver exiftool)"
    )
    source_mutex.add_argument(
        "--file-date", "--fil-datum",
        dest="file_date",
        action="store_true",
        help="Använd filens modifieringsdatum"
    )

    # Datumfilter
    filter_group = parser.add_argument_group('datumfilter')
    filter_group.add_argument(
        "--before", "--fore-datum", "--datum-fore",
        dest="before",
        metavar="DATUM",
        help="Filer med datum FÖRE detta (exklusivt)"
    )
    filter_group.add_argument(
        "--after", "--efter-datum", "--datum-efter",
        dest="after",
        metavar="DATUM",
        help="Filer med datum EFTER detta (exklusivt)"
    )
    filter_group.add_argument(
        "--exact", "--datum", "--exakt-datum",
        dest="exact",
        metavar="DATUM",
        help="Endast filer med exakt detta datum"
    )
    filter_group.add_argument(
        "--from", "--fran-datum", "--fran",
        dest="from_date",
        metavar="DATUM",
        help="Filer från och med detta datum (inklusivt)"
    )
    filter_group.add_argument(
        "--to", "--till-datum", "--till",
        dest="to_date",
        metavar="DATUM",
        help="Filer till och med detta datum (inklusivt)"
    )

    parser.add_argument(
        "patterns",
        nargs="*",
        default=["*.NEF"],
        help="Filer eller glob-mönster (default: *.NEF)"
    )

    args = parser.parse_args()

    # Bestäm datumkälla
    if args.exif_date:
        date_source = "exif"
    elif args.file_date:
        date_source = "file"
    else:
        date_source = "filename"

    # Parsa datumargument
    try:
        before = parse_date_arg(args.before) if args.before else None
        after = parse_date_arg(args.after) if args.after else None
        exact = parse_date_arg(args.exact) if args.exact else None
        from_date = parse_date_arg(args.from_date) if args.from_date else None
        to_date = parse_date_arg(args.to_date) if args.to_date else None
    except ValueError as e:
        print(f"FEL: {e}", file=sys.stderr)
        return 1

    # Bygg filtertext för output
    filters = []
    if before:
        filters.append(f"före {format_date_display(before)}")
    if after:
        filters.append(f"efter {format_date_display(after)}")
    if exact:
        filters.append(f"datum = {format_date_display(exact)}")
    if from_date:
        filters.append(f"från {format_date_display(from_date)}")
    if to_date:
        filters.append(f"till {format_date_display(to_date)}")

    # Samla filer från alla mönster
    files: list[Path] = []
    for pattern in args.patterns:
        p = Path(pattern)
        if p.is_file():
            files.append(p.resolve())
        else:
            files.extend(Path(f).resolve() for f in glob(pattern) if Path(f).is_file())

    if not files:
        print(f"Inga filer matchar: {' '.join(args.patterns)}")
        return 0

    # Hämta datum för filer
    source_names = {"filename": "filnamn", "exif": "EXIF", "file": "fildatum"}
    if args.verbose or args.dry_run:
        print(f"Datumkälla: {source_names[date_source]}")

    file_dates = get_file_dates(files, source=date_source)

    if not file_dates:
        if date_source == "filename":
            print("Inga filer med YYMMDD_* mönster hittades.")
        else:
            print("Kunde inte extrahera datum från några filer.")
        return 0

    # Applicera datumfilter
    filtered_dates = filter_by_date(
        file_dates,
        before=before,
        after=after,
        exact=exact,
        from_date=from_date,
        to_date=to_date,
    )

    if not filtered_dates:
        print(f"Inga filer matchar datumfiltret ({', '.join(filters)}).")
        return 0

    # Bestäm bas-katalog
    base_dir = list(filtered_dates.keys())[0].parent

    # Beräkna flytt
    moves = compute_moves(filtered_dates, include_sidecars=not args.no_sidecars)

    # Sammanfattning
    total_files = sum(len(f) for f in moves.values())
    filter_str = f" ({', '.join(filters)})" if filters else ""
    print(f"Hittade {total_files} filer i {len(moves)} datumgrupper{filter_str}.")

    # Utför flytt
    execute_moves(moves, base_dir, dry_run=args.dry_run, verbose=args.verbose or args.dry_run)

    return 0


if __name__ == "__main__":
    sys.exit(main())
