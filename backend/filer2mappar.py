#!/usr/bin/env python3
"""Flytta filer till undermappar baserat på datum (YYMMDD).

Datumkällor:
- Filnamn (default): YYMMDD extraherat från filnamnet
- EXIF (--exif-date): CreateDate från EXIF-metadata
- Fil (--file-date): Filens modifieringsdatum

Filer flyttas till mapp YYMMDD/. Sidecar-filer (.xmp) följer med automatiskt.
"""

import argparse
import bisect
import os
import re
import shlex
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from glob import glob
from pathlib import Path

from core import fs_ops
from core.exiftool import find_exiftool
from core.files import SUPPORTED_EXTENSIONS

DATE_PATTERN = re.compile(r'^(\d{6})_')
TIMESTAMP_PATTERN = re.compile(r'^(\d{6}_\d{6})')
DEFAULT_SOURCE_ROOT = Path("~/Pictures/nerladdat").expanduser()
DEFAULT_TARGET_ROOT = Path("~/Pictures/framkallat").expanduser()


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

    try:
        cmd = [
            find_exiftool(), "-q", "-q", "-m",
            "-if", "defined $CreateDate",
            "-d", "%y%m%d",
            "-p", "$CreateDate|$FilePath",
            "--",
            *[str(f) for f in files]
        ]
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
    batch_id = fs_ops.new_batch_id()

    for date, files in sorted(moves.items()):
        target_dir = base_dir / date
        file_set = set(files)
        sidecars_by_main: dict[Path, list[Path]] = {}
        attached_sidecars: set[Path] = set()
        for file in files:
            if file.suffix.lower() == ".xmp":
                continue
            sidecars = [
                sidecar for sidecar in find_sidecar_files(file)
                if sidecar in file_set and sidecar not in attached_sidecars
            ]
            sidecars_by_main[file] = sidecars
            attached_sidecars.update(sidecars)

        if not dry_run and not target_dir.exists():
            target_dir.mkdir(parents=True)
            if verbose:
                print(f"Skapar mapp: {target_dir.name}/")
        elif dry_run and not target_dir.exists():
            print(f"(dry) Skapar mapp: {target_dir.name}/")

        for file in files:
            if file in attached_sidecars:
                continue
            target = target_dir / file.name
            sidecar_pairs = [
                (sidecar, target_dir / sidecar.name)
                for sidecar in sidecars_by_main.get(file, [])
            ]

            if target.exists():
                print(f"SKIP (finns redan): {file.name}", file=sys.stderr)
                continue

            if dry_run:
                print(f"(dry) {file.name} -> {date}/")
                for sidecar, _target in sidecar_pairs:
                    print(f"(dry) {sidecar.name} -> {date}/")
            else:
                try:
                    moved = fs_ops.rename_with_sidecars(
                        file,
                        target,
                        sidecar_pairs,
                        tool="filer2mappar",
                        journal_op="move",
                        batch_id=batch_id,
                    )
                    total_moved += len(moved)
                    if verbose:
                        print(f"{file.name} -> {date}/")
                except OSError as e:
                    print(f"FEL: {file.name}: {e}", file=sys.stderr)

    if not dry_run:
        print(f"Flyttade {total_moved} filer.")

    return total_moved


# === Matchning mot kallmappar ===

def extract_timestamp(filename: str) -> tuple[str, datetime] | None:
    """Return a leading YYMMDD_HHMMSS token and its naive local datetime."""
    match = TIMESTAMP_PATTERN.match(filename)
    if not match:
        return None
    token = match.group(1)
    try:
        return token, datetime.strptime(token, "%y%m%d_%H%M%S")
    except ValueError:
        return None


def iter_supported_images(root: Path, recursive: bool) -> list[Path]:
    """List supported image files in deterministic order."""
    candidates = root.rglob("*") if recursive else root.iterdir()
    return sorted(
        path for path in candidates
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def build_source_index(
    source_root: Path,
) -> tuple[dict[str, set[Path]], list[tuple[datetime, set[Path]]]]:
    """Index timestamps by relative source folder and build a timeline."""
    by_token: dict[str, set[Path]] = defaultdict(set)
    by_time: dict[datetime, set[Path]] = defaultdict(set)
    for path in iter_supported_images(source_root, recursive=True):
        parsed = extract_timestamp(path.name)
        if not parsed:
            continue
        token, timestamp = parsed
        relative_dir = path.parent.relative_to(source_root)
        by_token[token].add(relative_dir)
        by_time[timestamp].add(relative_dir)
    return dict(by_token), sorted(by_time.items())


def build_exact_evidence(
    target_root: Path,
    source_index: dict[str, set[Path]],
) -> list[tuple[datetime, Path]]:
    """Build a timeline of developed images with an unambiguous source folder."""
    evidence: list[tuple[datetime, Path]] = []
    seen: set[tuple[datetime, Path]] = set()
    for path in iter_supported_images(target_root, recursive=True):
        parsed = extract_timestamp(path.name)
        if not parsed:
            continue
        token, timestamp = parsed
        folders = source_index.get(token, set())
        if len(folders) != 1:
            continue
        item = (timestamp, next(iter(folders)))
        if item not in seen:
            evidence.append(item)
            seen.add(item)
    return sorted(evidence)


def guess_source_folder(
    timestamp: datetime,
    source_timeline: list[tuple[datetime, set[Path]]],
    exact_evidence: list[tuple[datetime, Path]],
    window_minutes: int,
) -> tuple[Path, int] | None:
    """Guess only when the nearest source and both exact neighbours agree."""
    if not source_timeline or len(exact_evidence) < 2:
        return None

    source_times = [item[0] for item in source_timeline]
    position = bisect.bisect_left(source_times, timestamp)
    nearby = source_timeline[max(0, position - 1):position + 1]
    if not nearby:
        return None
    min_delta = min(abs((item[0] - timestamp).total_seconds()) for item in nearby)
    nearest_folders: set[Path] = set()
    for source_time, folders in nearby:
        if abs((source_time - timestamp).total_seconds()) == min_delta:
            nearest_folders.update(folders)
    if min_delta > window_minutes * 60 or len(nearest_folders) != 1:
        return None
    candidate = next(iter(nearest_folders))

    evidence_times = [item[0] for item in exact_evidence]
    evidence_pos = bisect.bisect_left(evidence_times, timestamp)
    if evidence_pos == 0 or evidence_pos == len(exact_evidence):
        return None
    previous_folder = exact_evidence[evidence_pos - 1][1]
    next_folder = exact_evidence[evidence_pos][1]
    if previous_folder != candidate or next_folder != candidate:
        return None
    return candidate, round(min_delta)


def compute_matched_moves(
    source_root: Path,
    target_root: Path,
    window_minutes: int,
) -> tuple[list[tuple[Path, Path]], list[tuple[Path, Path, int]], list[Path]]:
    """Classify root images as safe, guessed, or unresolved moves."""
    source_index, source_timeline = build_source_index(source_root)
    evidence = build_exact_evidence(target_root, source_index)
    safe: list[tuple[Path, Path]] = []
    guessed: list[tuple[Path, Path, int]] = []
    unresolved: list[Path] = []

    for path in iter_supported_images(target_root, recursive=False):
        parsed = extract_timestamp(path.name)
        if not parsed:
            unresolved.append(path)
            continue
        token, timestamp = parsed
        folders = source_index.get(token, set())
        if len(folders) == 1:
            folder = next(iter(folders))
            if folder == Path("."):
                continue
            safe.append((path, target_root / folder / path.name))
            continue
        guess = guess_source_folder(timestamp, source_timeline, evidence, window_minutes)
        if guess:
            folder, delta_seconds = guess
            if folder == Path("."):
                continue
            guessed.append((path, target_root / folder / path.name, delta_seconds))
        else:
            unresolved.append(path)
    return safe, guessed, unresolved


def execute_matched_moves(
    pairs: list[tuple[Path, Path]], *, dry_run: bool, verbose: bool
) -> tuple[int, int]:
    """Move pairs without overwrites and record one shared journal batch."""
    moved = 0
    failed = 0
    batch_id = fs_ops.new_batch_id()
    for source, target in pairs:
        sidecars = find_sidecar_files(source)
        sidecar_pairs = [(sidecar, target.with_suffix(sidecar.suffix)) for sidecar in sidecars]
        relative_target = target
        if dry_run:
            print(f"(dry) {source.name} -> {relative_target.parent}/")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            fs_ops.rename_with_sidecars(
                source,
                target,
                sidecar_pairs,
                tool="filer2mappar-matcha-kalla",
                journal_op="move",
                batch_id=batch_id,
            )
            moved += 1
            if verbose:
                print(f"{source.name} -> {relative_target.parent}/")
        except OSError as error:
            failed += 1
            print(f"FEL: {source.name}: {error}", file=sys.stderr)
    return moved, failed


def match_source_main(argv: list[str]) -> int:
    """Run the ``matcha-kalla`` subcommand."""
    parser = argparse.ArgumentParser(
        prog="filer2mappar matcha-kalla",
        description="Fördela framkallade bilder enligt källornas relativa mappar",
    )
    parser.add_argument("-n", "--dry-run", action="store_true", help="Visa utan att flytta")
    parser.add_argument("-v", "--verbose", action="store_true", help="Visa varje flytt")
    parser.add_argument(
        "--kallrot", type=Path, default=DEFAULT_SOURCE_ROOT,
        help=f"Källträd (default: {DEFAULT_SOURCE_ROOT})",
    )
    parser.add_argument(
        "--malrot", type=Path, default=DEFAULT_TARGET_ROOT,
        help=f"Rot med framkallade bilder (default: {DEFAULT_TARGET_ROOT})",
    )
    parser.add_argument(
        "--flytta-osakra", action="store_true",
        help="Flytta även redovisade kvalificerade gissningar",
    )
    parser.add_argument(
        "--tidsfonster", type=int, default=30, metavar="MINUTER",
        help="Maximalt tidsavstånd för gissningar (default: 30)",
    )
    args = parser.parse_args(argv)
    source_root = args.kallrot.expanduser().resolve()
    target_root = args.malrot.expanduser().resolve()
    if args.tidsfonster <= 0:
        parser.error("--tidsfonster måste vara större än 0")
    for label, root in (("källrot", source_root), ("målrot", target_root)):
        if not root.is_dir():
            print(f"FEL: {label} finns inte eller är ingen katalog: {root}", file=sys.stderr)
            return 1
    if (
        source_root == target_root
        or source_root in target_root.parents
        or target_root in source_root.parents
    ):
        print("FEL: källrot och målrot får inte överlappa", file=sys.stderr)
        return 1

    safe, guessed, unresolved = compute_matched_moves(
        source_root, target_root, args.tidsfonster
    )
    rerun_base = (
        "filer2mappar matcha-kalla "
        f"--kallrot {shlex.quote(str(source_root))} "
        f"--malrot {shlex.quote(str(target_root))}"
    )
    selected = list(safe)
    if args.flytta_osakra:
        selected.extend((source, target) for source, target, _delta in guessed)

    print(
        f"Säkra: {len(safe)}, osäkra förslag: {len(guessed)}, "
        f"olösta: {len(unresolved)}."
    )
    if guessed:
        print("Osäkra förslag:")
        for source, target, delta_seconds in guessed:
            print(
                f"  {source.name} -> {target.parent.relative_to(target_root)}/ "
                f"(närmaste källa {delta_seconds} s bort)"
            )
        if not args.flytta_osakra:
            print(
                f"Flytta förslagen med: {rerun_base} "
                f"--tidsfonster {args.tidsfonster} --flytta-osakra"
            )
    if unresolved:
        print("Olösta filer:", file=sys.stderr)
        for path in unresolved:
            print(f"  {path.name}", file=sys.stderr)
        if args.tidsfonster < 60:
            print(
                f"Prova ett större fönster: {rerun_base} --tidsfonster 60",
                file=sys.stderr,
            )

    moved, failed = execute_matched_moves(
        selected, dry_run=args.dry_run, verbose=args.verbose or args.dry_run
    )
    if not args.dry_run:
        print(f"Flyttade {moved} bilder.")
    return 1 if unresolved or failed else 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["matcha-kalla"]:
        return match_source_main(argv[1:])

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

    args = parser.parse_args(argv)

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
