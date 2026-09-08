#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import glob
import os
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime

from core.playerstats import (
    ALWAYS_GRUPP,
    ALWAYS_PUBLIK,
    bucket_counter,
    build_entries,
    compute_baseline,
    compute_player_stats,
    load_exclusion_config,
    parse_filename,
    resolve_always_markers,
    resolve_exclusion_sets,
    save_exclusion_config,
    segment_matches,
)

# The pure counting/statistics core and the exclusion-config helpers live in
# ``core.playerstats`` so the CLI and the FastAPI backend share one source of
# truth. Re-exported here for backward compatibility: the CLI's historical
# public surface (external callers / tests import these names from
# ``rakna_spelare``). This module keeps only terminal rendering + argparse/main.
__all__ = [
    "ALWAYS_GRUPP",
    "ALWAYS_PUBLIK",
    "build_entries",
    "bucket_counter",
    "compute_baseline",
    "compute_player_stats",
    "load_exclusion_config",
    "parse_filename",
    "resolve_always_markers",
    "resolve_exclusion_sets",
    "save_exclusion_config",
    "segment_matches",
]


def _split_csv(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [n.strip() for n in value.split(",") if n.strip()]


def get_exclusion_lists(args: argparse.Namespace) -> tuple[set[str], set[str], set[str]]:
    # --tranare/--publik replace config/env; --add-* extend. The base sets
    # (config/env + built-in ALWAYS markers) come from the shared resolver, so
    # the CLI and the GUI/API agree on Laget/FBK/Klacken etc.
    tranare_set, publik_set, grupp_set = resolve_exclusion_sets(
        tranare=_split_csv(args.tranare),
        publik=_split_csv(args.publik),
    )
    if args.add_tranare:
        tranare_set |= set(_split_csv(args.add_tranare) or [])
    if args.add_publik:
        publik_set |= set(_split_csv(args.add_publik) or [])
    return tranare_set, publik_set, grupp_set


class Colors:
    """ANSI color codes for terminal output."""

    RED = "\x1b[31m"
    YELLOW = "\x1b[33m"
    GREEN = "\x1b[32m"
    CYAN = "\x1b[36m"
    MAGENTA = "\x1b[35m"
    BOLD = "\x1b[1m"
    DIM = "\x1b[2m"
    RESET = "\x1b[0m"

    @classmethod
    def disable(cls) -> None:
        cls.RED = cls.YELLOW = cls.GREEN = cls.CYAN = ""
        cls.MAGENTA = cls.BOLD = cls.DIM = cls.RESET = ""


def render_bar(value: int, baseline: float, width: int = 20, ascii_mode: bool = False) -> str:
    """Render a progress bar showing value relative to baseline."""
    if baseline <= 0:
        ratio = 1.0
    else:
        ratio = value / baseline

    fill_char = "#" if ascii_mode else "#"
    empty_char = "-" if ascii_mode else "-"

    filled = min(width, max(0, int(round(ratio * (width / 2)))))
    bar = fill_char * filled + empty_char * (width - filled)
    return f"[{bar}]"


def render_spark(
    timestamps: list[datetime],
    start_dt: datetime,
    end_dt: datetime,
    width: int = 12,
    ascii_mode: bool = False,
    match_ranges: list[tuple[datetime, datetime]] | None = None,
) -> str:
    """
    Render temporal spark showing when images appear in the time span.
    Bins are proportional to total time span.

    If match_ranges is provided (list of (match_start, match_end) datetimes),
    each match is rendered with expanded width and gaps between matches
    are shown as "--".
    """
    if ascii_mode:
        chars = ".:*#"
    else:
        chars = "·:*#"

    def bin_to_char(count: int) -> str:
        if count == 0:
            return chars[0]
        elif count < 3:
            return chars[1]
        elif count < 5:
            return chars[2]
        else:
            return chars[3]

    def render_single_span(
        ts_list: list[datetime], span_start: datetime, span_end: datetime, span_width: int
    ) -> str:
        """Render a single time span with given width."""
        if not ts_list or span_width <= 0:
            return chars[0] * span_width

        span_seconds = (span_end - span_start).total_seconds()
        if span_seconds <= 0:
            return chars[0] * span_width

        bins = [0] * span_width
        for ts in ts_list:
            pos = (ts - span_start).total_seconds() / span_seconds
            bin_idx = min(span_width - 1, max(0, int(pos * span_width)))
            bins[bin_idx] += 1

        return "".join(bin_to_char(c) for c in bins)

    if not timestamps or start_dt >= end_dt:
        return chars[0] * width

    if not match_ranges:
        # Normal rendering - proportional to time
        return render_single_span(timestamps, start_dt, end_dt, width)

    # Expanded rendering: each match gets proportional width, gaps become "--"
    num_matches = len(match_ranges)
    num_gaps = num_matches - 1
    gap_chars_total = num_gaps * 2  # "--" per gap

    match_width_total = width - gap_chars_total
    if match_width_total < num_matches:
        match_width_total = num_matches  # At least 1 char per match

    # Calculate total match duration for proportional allocation
    total_match_duration = sum((m_end - m_start).total_seconds() for m_start, m_end in match_ranges)

    spark = ""
    allocated = 0
    for i, (m_start, m_end) in enumerate(match_ranges):
        # Allocate width proportionally to match duration
        match_duration = (m_end - m_start).total_seconds()
        if i == num_matches - 1:
            # Last match gets remaining width to avoid rounding issues
            match_width = match_width_total - allocated
        else:
            match_width = max(1, round(match_width_total * match_duration / total_match_duration))
            allocated += match_width

        # Filter timestamps for this match
        match_ts = [ts for ts in timestamps if m_start <= ts <= m_end]

        # Render this match's spark
        spark += render_single_span(match_ts, m_start, m_end, match_width)

        # Add gap separator (except after last match)
        if i < num_matches - 1:
            spark += "--"

    return spark


def get_deviation_label(delta_pct: float) -> str:
    abs_pct = abs(delta_pct)
    if abs_pct > 20:
        return "HIGH" if delta_pct > 0 else "LOW "
    elif abs_pct > 10:
        return "WARN" if delta_pct > 0 else "warn"
    return " OK "


def get_deviation_color(delta_pct: float) -> str:
    abs_pct = abs(delta_pct)
    if abs_pct > 20:
        return Colors.RED
    elif abs_pct > 10:
        return Colors.YELLOW
    return Colors.GREEN


def format_player_line(
    name: str,
    count: int,
    total_images: int,
    baseline: float,
    timestamps: list[datetime],
    start_dt: datetime,
    end_dt: datetime,
    use_color: bool = True,
    ascii_mode: bool = False,
    spark_width: int = 12,
    bar_width: int = 20,
    name_width: int = 12,
    match_ranges: list[tuple[datetime, datetime]] | None = None,
) -> str:
    pct = 100 * count / total_images if total_images > 0 else 0
    delta_n = count - baseline
    delta_pct = 100 * delta_n / baseline if baseline > 0 else 0

    bar = render_bar(count, baseline, bar_width, ascii_mode)
    spark = render_spark(timestamps, start_dt, end_dt, spark_width, ascii_mode, match_ranges)

    sign = "+" if delta_n >= 0 else ""
    delta_n_str = f"({sign}{delta_n:.0f})".rjust(7)

    if use_color:
        color = get_deviation_color(delta_pct)
        delta_pct_str = f"{sign}{delta_pct:.0f}%".rjust(5)
        delta_str = f"{color}{delta_pct_str}{Colors.RESET}"
    else:
        label = get_deviation_label(delta_pct)
        delta_pct_str = f"{sign}{delta_pct:.0f}%".rjust(5)
        delta_str = f"{label} {delta_pct_str}"

    truncated_name = name[:name_width].ljust(name_width)

    return f"{truncated_name}  {count:4d}  {pct:5.1f}%  {delta_str}  {delta_n_str}  {bar}  {spark}"


def print_section(
    title: str,
    counter: Counter[str],
    timestamps_per_person: dict[str, list[datetime]],
    total_images: int,
    start_dt: datetime,
    end_dt: datetime,
    min_images: int,
    baseline_method: str,
    use_color: bool,
    ascii_mode: bool,
    spark_width: int,
    bar_width: int,
    tranare_set: set[str] | None = None,
    publik_set: set[str] | None = None,
    grupp_set: set[str] | None = None,
    compact: bool = False,
    match_ranges: list[tuple[datetime, datetime]] | None = None,
) -> None:
    tranare_set = tranare_set or set()
    publik_set = publik_set or set()
    grupp_set = grupp_set or set()

    buckets = bucket_counter(counter, min_images, tranare_set, publik_set, grupp_set)
    players = buckets["players"]
    below_threshold = buckets["below_threshold"]
    tranare = buckets["tranare"]
    publik = buckets["publik"]
    grupp = buckets["grupp"]

    baseline_counts = list(players.values())
    baseline = compute_baseline(baseline_counts, baseline_method) if baseline_counts else 0

    excluded_count = len(tranare) + len(publik) + len(grupp) + len(below_threshold)
    total_in_list = len(counter)

    print(f"\n{Colors.BOLD}{title}{Colors.RESET}" if use_color else f"\n{title}")
    info_parts = [f"Bilder: {total_images}", f"Spelare: {len(players)}"]
    if excluded_count > 0:
        info_parts.append(f"(av {total_in_list}, exkl. {excluded_count})")
    info_parts.append(f"Baseline: {baseline_method}={baseline:.1f}")
    print("   ".join(info_parts))

    term_width = shutil.get_terminal_size(fallback=(100, 20)).columns
    name_width = min(15, max(8, term_width - 70))

    if use_color:
        header = f"{'NAMN':<{name_width}}  {'ANT':>4}      %     {'Δ%':>5}      {'ΔN':>5}  {'BAR':<{bar_width + 2}}  SPARK"
    else:
        header = f"{'NAMN':<{name_width}}  {'ANT':>4}      %       {'Δ%':>5}    {'ΔN':>5}  {'BAR':<{bar_width + 2}}  SPARK"
    print(f"{Colors.DIM}{header}{Colors.RESET}" if use_color else header)

    sorted_players = sorted(players.items(), key=lambda x: x[1] - baseline, reverse=True)

    for name, count in sorted_players:
        ts_list = timestamps_per_person.get(name, [])
        line = format_player_line(
            name,
            count,
            total_images,
            baseline,
            ts_list,
            start_dt,
            end_dt,
            use_color,
            ascii_mode,
            spark_width,
            bar_width,
            name_width,
            match_ranges,
        )
        print(line)

    # In compact mode, skip extra sections (tränare, grupp, publik, below threshold)
    if not compact:
        if tranare:
            print()
            label = f"--- Tränare ({len(tranare)} st) ---"
            print(f"{Colors.CYAN}{label}{Colors.RESET}" if use_color else label)
            for name, count in sorted(tranare.items(), key=lambda x: x[1], reverse=True):
                pct = 100 * count / total_images if total_images > 0 else 0
                print(f"  {name}: {count} ({pct:.1f}%)")

        if grupp:
            print()
            label = f"--- Gruppbilder ({len(grupp)} st) ---"
            print(f"{Colors.DIM}{label}{Colors.RESET}" if use_color else label)
            for name, count in sorted(grupp.items(), key=lambda x: x[1], reverse=True):
                pct = 100 * count / total_images if total_images > 0 else 0
                print(f"  {name}: {count} ({pct:.1f}%)")

        if publik:
            print()
            label = f"--- Publik ({len(publik)} st) ---"
            print(f"{Colors.MAGENTA}{label}{Colors.RESET}" if use_color else label)
            for name, count in sorted(publik.items(), key=lambda x: x[1], reverse=True):
                pct = 100 * count / total_images if total_images > 0 else 0
                print(f"  {name}: {count} ({pct:.1f}%)")

        if below_threshold:
            print()
            label = f"--- Under tröskeln (min-images={min_images}) ---"
            print(f"{Colors.DIM}{label}{Colors.RESET}" if use_color else label)
            for name, count in sorted(below_threshold.items(), key=lambda x: x[1], reverse=True):
                pct = 100 * count / total_images if total_images > 0 else 0
                print(f"  {name}: {count} ({pct:.1f}%)")


def main(args: argparse.Namespace) -> None:
    if args.no_color or args.color == "never" or (args.color == "auto" and not sys.stdout.isatty()):
        Colors.disable()
        use_color = False
    else:
        use_color = True

    if os.environ.get("NO_COLOR"):
        Colors.disable()
        use_color = False

    tranare_set, publik_set, grupp_set = get_exclusion_lists(args)

    files = []
    for pat in args.glob_patterns:
        files.extend(glob.glob(os.path.expanduser(pat)))
    if not files:
        print("Ingen fil matchade angivet mönster.")
        sys.exit(1)

    entries = build_entries(files)

    if not entries:
        print("Inga giltiga bilder hittades bland matchande filer.")
        sys.exit(1)

    matcher = segment_matches(entries, args.gap_minutes)

    total_counter = Counter()
    total_timestamps = defaultdict(list)
    per_match_counters = []
    per_match_timestamps = []

    for idx_list in matcher:
        c = Counter()
        ts_map = defaultdict(list)
        for idx in idx_list:
            dt, names, _ = entries[idx]
            for n in names:
                c[n] += 1
                total_counter[n] += 1
                ts_map[n].append(dt)
                total_timestamps[n].append(dt)
        per_match_counters.append(c)
        per_match_timestamps.append(ts_map)

    total_images = len(entries)
    global_start = entries[0][0]
    global_end = entries[-1][0]

    duration = global_end - global_start
    duration_minutes = duration.total_seconds() / 60
    spark_width = max(8, min(20, int(duration_minutes / 3)))

    # Calculate match ranges (start/end for each match) for spark visualization
    match_ranges = []
    for idx_list in matcher:
        match_start = entries[idx_list[0]][0]
        match_end = entries[idx_list[-1]][0]
        match_ranges.append((match_start, match_end))

    print_section(
        f"=== Totalt ({global_start.strftime('%H:%M')} → {global_end.strftime('%H:%M')}, {duration_minutes:.0f} min) ===",
        total_counter,
        total_timestamps,
        total_images,
        global_start,
        global_end,
        args.min_images,
        args.baseline,
        use_color,
        args.ascii,
        spark_width,
        args.bar_width,
        tranare_set,
        publik_set,
        grupp_set,
        match_ranges=match_ranges if len(match_ranges) > 1 else None,
    )

    if args.per_match:
        print()
        for match_idx, (c, ts_map) in enumerate(
            zip(per_match_counters, per_match_timestamps), start=1
        ):
            idx_list = matcher[match_idx - 1]
            start_dt = entries[idx_list[0]][0]
            end_dt = entries[idx_list[-1]][0]
            match_duration = (end_dt - start_dt).total_seconds() / 60
            match_spark_width = max(6, min(16, int(match_duration / 2)))

            match_images = len(idx_list)

            print_section(
                f"--- Match {match_idx} ({start_dt.strftime('%Y-%m-%d %H:%M')} → {end_dt.strftime('%H:%M')}, {match_duration:.0f} min) ---",
                c,
                ts_map,
                match_images,
                start_dt,
                end_dt,
                args.min_images,
                args.baseline,
                use_color,
                args.ascii,
                match_spark_width,
                args.bar_width,
                tranare_set,
                publik_set,
                grupp_set,
                compact=True,  # Suppress tränare/grupp/publik in per-match output
            )

            print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "Räknar antal bilder per person med statistik för att hitta över-/underrepresenterade spelare. "
            "Visar procent, deviation från baseline (median/mean), progress-bar och temporal spark."
        )
    )
    parser.add_argument(
        "glob_patterns",
        nargs="+",
        help="Ett eller flera glob-mönster, t.ex. 250601*.jpg eller ~/Pictures/*.jpg",
    )
    parser.add_argument(
        "-g",
        "--gap-minutes",
        type=int,
        default=30,
        help="Maximalt antal minuter mellan bilder för samma match (standard: 30)",
    )
    parser.add_argument(
        "-p",
        "--per-match",
        action="store_true",
        help="Visa även resultat per match med täckning",
    )
    parser.add_argument(
        "--baseline",
        choices=["median", "mean"],
        default="median",
        help="Baseline-metod för deviation (standard: median)",
    )
    parser.add_argument(
        "--min-images",
        type=int,
        default=3,
        help="Minsta antal bilder för att inkluderas i baseline (standard: 3)",
    )
    parser.add_argument(
        "--no-color",
        action="store_true",
        help="Stäng av färgutskrift",
    )
    parser.add_argument(
        "--color",
        choices=["auto", "always", "never"],
        default="auto",
        help="Färgläge (standard: auto)",
    )
    parser.add_argument(
        "--ascii",
        action="store_true",
        help="Använd endast ASCII-tecken (inga unicode)",
    )
    parser.add_argument(
        "--bar-width",
        type=int,
        default=20,
        help="Bredd på progress-bar (standard: 20)",
    )
    parser.add_argument(
        "--tranare",
        type=str,
        default=None,
        help="Kommaseparerad lista på tränare (ersätter config/env)",
    )
    parser.add_argument(
        "--add-tranare",
        type=str,
        default=None,
        help="Lägg till tränare till config/env-listan",
    )
    parser.add_argument(
        "--publik",
        type=str,
        default=None,
        help="Kommaseparerad lista på publik (ersätter config/env)",
    )
    parser.add_argument(
        "--add-publik",
        type=str,
        default=None,
        help="Lägg till publik till config/env-listan",
    )
    args = parser.parse_args()
    main(args)
