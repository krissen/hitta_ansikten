#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import glob
import json
import os
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean, median

CONFIG_DIR = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "faceid"
CONFIG_FILE = CONFIG_DIR / "rakna_spelare.json"

# Built-in DEFAULT always-excluded markers — names that are never individual
# players (team/group photos, crowd shots). Used when the config doesn't specify
# its own always-set. The always-set is configurable (config keys
# `always_grupp`/`always_publik`, or env RAKNA_ALWAYS_GRUPP/PUBLIK), so the
# photographer can add their own (e.g. "Forward") or change which markers are
# always excluded. Kept as the defaults so existing configs behave unchanged.
ALWAYS_GRUPP = {"Laget", "FBK"}   # default team / group photo markers
ALWAYS_PUBLIK = {"Klacken"}        # default crowd / supporter markers


def resolve_always_markers(
    config: dict | None = None,
) -> tuple[set[str], set[str]]:
    """The configured always-excluded markers ``(grupp, publik)``.

    Precedence per set: env (RAKNA_ALWAYS_GRUPP/PUBLIK) > config key
    (`always_grupp`/`always_publik`) > built-in default. A present-but-empty
    config key means "no always-markers" (not the default) — so the user can
    clear them. Shared by the CLI and GUI/API so they never fork.
    """
    if config is None:
        config = load_exclusion_config()

    def _resolve(key: str, env: str, default: set[str]) -> set[str]:
        env_val = os.environ.get(env, "")
        if env_val:
            return {n.strip() for n in env_val.split(",") if n.strip()}
        if key in config:
            return {n.strip() for n in (config.get(key) or []) if n.strip()}
        return set(default)

    grupp = _resolve("always_grupp", "RAKNA_ALWAYS_GRUPP", ALWAYS_GRUPP)
    publik = _resolve("always_publik", "RAKNA_ALWAYS_PUBLIK", ALWAYS_PUBLIK)
    return grupp, publik


def load_exclusion_config() -> dict[str, list[str]]:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"tranare": [], "publik": [], "grupp": []}


def save_exclusion_config(
    tranare: list[str] | None = None,
    publik: list[str] | None = None,
    grupp: list[str] | None = None,
    always_grupp: list[str] | None = None,
    always_publik: list[str] | None = None,
) -> dict[str, list[str]]:
    """Persist coach/audience/group exclusion lists to the config file.

    Only the provided lists are overwritten; ``None`` preserves the existing
    value (so saving just tranare/publik keeps a configured grupp). The
    always-markers are stored in their own keys (``always_grupp``/
    ``always_publik``) and stripped from the regular grupp/publik lists so they
    aren't duplicated. Returns the written config dict.
    """
    existing = load_exclusion_config()

    def _clean(names: list[str], drop: set[str]) -> list[str]:
        # De-dupe, drop empties and any name in `drop`, keep first-seen order.
        seen: set[str] = set()
        out: list[str] = []
        for raw in names:
            name = raw.strip()
            if not name or name in drop or name in seen:
                continue
            seen.add(name)
            out.append(name)
        return out

    # The always-set to strip the regular lists against: the new values if being
    # saved, otherwise the config file's always-set (or the built-in defaults).
    # Deliberately ignores RAKNA_ALWAYS_* env — persistence must depend on what's
    # on disk, not on a transient env override.
    def _cfg_always(key: str, default: set[str]) -> set[str]:
        if key in existing:
            return {n.strip() for n in (existing.get(key) or []) if n.strip()}
        return set(default)

    new_always_grupp = (
        set(_clean(always_grupp, set())) if always_grupp is not None
        else _cfg_always("always_grupp", ALWAYS_GRUPP)
    )
    new_always_publik = (
        set(_clean(always_publik, set())) if always_publik is not None
        else _cfg_always("always_publik", ALWAYS_PUBLIK)
    )

    config: dict[str, list[str]] = {
        "tranare": _clean(tranare, set()) if tranare is not None else list(existing.get("tranare", [])),
        "publik": _clean(publik, new_always_publik) if publik is not None else list(existing.get("publik", [])),
        "grupp": _clean(grupp, new_always_grupp) if grupp is not None else list(existing.get("grupp", [])),
    }

    # Persist the always-keys when provided, else preserve any existing ones
    # (absent key = fall back to the built-in defaults at resolve time).
    if always_grupp is not None:
        config["always_grupp"] = _clean(always_grupp, set())
    elif "always_grupp" in existing:
        config["always_grupp"] = list(existing["always_grupp"])
    if always_publik is not None:
        config["always_publik"] = _clean(always_publik, set())
    elif "always_publik" in existing:
        config["always_publik"] = list(existing["always_publik"])

    # Atomic write (tmp + replace) so a crash mid-write can't leave a
    # half-written config that zeroes the exclusion lists on the next load.
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    tmp.replace(CONFIG_FILE)
    return config


def resolve_exclusion_sets(
    tranare: list[str] | None = None,
    publik: list[str] | None = None,
    grupp: list[str] | None = None,
) -> tuple[set[str], set[str], set[str]]:
    """Single source of truth for coach/audience/group exclusion sets.

    Per-argument overrides win; otherwise env vars (RAKNA_TRANARE/PUBLIK/GRUPP)
    then the config file. The configured always-markers (``resolve_always_markers``,
    defaulting to Laget/FBK and Klacken) are always merged into grupp/publik, so
    they're excluded regardless of the per-request/config lists. Shared by the
    CLI and the GUI/API so the numbers never fork.
    """
    config = load_exclusion_config()

    def _resolve(key: str, override: list[str] | None, env: str) -> list[str]:
        if override is not None:
            return override
        env_val = os.environ.get(env, "")
        if env_val:
            return [n.strip() for n in env_val.split(",") if n.strip()]
        return list(config.get(key, []))

    always_grupp, always_publik = resolve_always_markers(config)
    tranare_set = set(_resolve("tranare", tranare, "RAKNA_TRANARE"))
    publik_set = set(_resolve("publik", publik, "RAKNA_PUBLIK")) | always_publik
    grupp_set = set(_resolve("grupp", grupp, "RAKNA_GRUPP")) | always_grupp
    return tranare_set, publik_set, grupp_set


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


def parse_filename(fn: str) -> tuple[datetime | None, list[str] | None]:
    """
    Plockar ut timestamp och lista av namn från ett filnamn enligt format:
    YYMMDD_HHMMSS[-N]_Namn1[, _Namn2,...].jpg

    Returnerar två värden:
      1) datetime-objekt (baserat på YYMMDDHHMMSS, där "-N" suffix tas bort)
      2) lista av namn (utan några "-N" baktill)
    """
    base = os.path.basename(fn)
    name, ext = os.path.splitext(base)
    i1 = name.find("_")
    i2 = name.find("_", i1 + 1)
    if i1 == -1 or i2 == -1:
        return None, None

    dt_full = name[:i2]
    names_part = name[i2 + 1 :]

    dt_part = dt_full.split("-", 1)[0]
    dt_str = dt_part.replace("_", "")
    try:
        dt = datetime.strptime(dt_str, "%y%m%d%H%M%S")
    except ValueError:
        return None, None

    raw_names = [n.strip() for n in names_part.split(",_") if n.strip()]
    names = [re.sub(r"-\d+$", "", n) for n in raw_names]
    return dt, names


def compute_baseline(counts: list[int], method: str = "median") -> float:
    """Compute baseline (target) value from a list of counts."""
    if not counts:
        return 0
    return median(counts) if method == "median" else mean(counts)


# ============================================================================
# Reusable counting core (shared by the CLI and the GUI/API).
#
# These functions produce plain data (lists/dicts of primitives) and never
# print. The terminal renderers (render_bar/render_spark/print_section) consume
# the same parsed entries but format for the console; the API consumes the dicts
# from compute_player_stats() and renders its own visuals.
# ============================================================================


def build_entries(files: list[str]) -> list[tuple[datetime, list[str], str]]:
    """Parse + filter + sort files into (datetime, names, filename) entries.

    Files whose name does not match the YYMMDD_HHMMSS[_Name...] format are
    silently skipped (parse_filename returns None). Sorted by timestamp.
    """
    entries: list[tuple[datetime, list[str], str]] = []
    for fn in files:
        dt, names = parse_filename(fn)
        if dt is None:
            continue
        entries.append((dt, names or [], fn))
    entries.sort(key=lambda x: x[0])
    return entries


def segment_matches(
    entries: list[tuple[datetime, list[str], str]], gap_minutes: int
) -> list[list[int]]:
    """Group temporally-adjacent entries into matches.

    A new match starts whenever the gap to the previous entry exceeds
    gap_minutes. Returns a list of matches, each a list of indices into entries.
    """
    if not entries:
        return []
    matches: list[list[int]] = []
    current = [0]
    for i in range(1, len(entries)):
        if entries[i][0] - entries[i - 1][0] > timedelta(minutes=gap_minutes):
            matches.append(current)
            current = [i]
        else:
            current.append(i)
    matches.append(current)
    return matches


def bucket_counter(
    counter: Counter,
    min_images: int,
    tranare_set: set[str],
    publik_set: set[str],
    grupp_set: set[str],
) -> dict[str, dict[str, int]]:
    """Split a name->count Counter into the five output buckets.

    Returns dict with keys: players, below_threshold, tranare, publik, grupp.
    """
    excluded = tranare_set | publik_set | grupp_set
    return {
        "players": {n: c for n, c in counter.items() if n not in excluded and c >= min_images},
        "below_threshold": {n: c for n, c in counter.items() if n not in excluded and c < min_images},
        "tranare": {n: c for n, c in counter.items() if n in tranare_set},
        "publik": {n: c for n, c in counter.items() if n in publik_set},
        "grupp": {n: c for n, c in counter.items() if n in grupp_set},
    }


def classify_deviation(delta_pct: float) -> str:
    """Machine-readable deviation level matching the CLI color thresholds.

    Mirrors get_deviation_color: abs>20 -> "high", abs>10 -> "warn", else "ok".
    """
    abs_pct = abs(delta_pct)
    if abs_pct > 20:
        return "high"
    if abs_pct > 10:
        return "warn"
    return "ok"


def summarize_counter(
    counter: Counter,
    timestamps_per_person: dict[str, list[datetime]],
    total_images: int,
    min_images: int,
    baseline_method: str,
    tranare_set: set[str],
    publik_set: set[str],
    grupp_set: set[str],
) -> dict:
    """Produce a JSON-serializable summary for one counter (total or per match).

    Players are sorted by (count - baseline) descending, same as the CLI table.
    Excluded groups (tranare/publik/grupp/below_threshold) are sorted by count.
    """
    buckets = bucket_counter(counter, min_images, tranare_set, publik_set, grupp_set)
    players_counts = buckets["players"]
    baseline = compute_baseline(list(players_counts.values()), baseline_method) if players_counts else 0

    def player_row(name: str, count: int) -> dict:
        pct = 100 * count / total_images if total_images > 0 else 0
        delta_n = count - baseline
        delta_pct = 100 * delta_n / baseline if baseline > 0 else 0
        return {
            "name": name,
            "count": count,
            "pct": round(pct, 1),
            "delta_n": round(delta_n, 1),
            "delta_pct": round(delta_pct, 1),
            "level": classify_deviation(delta_pct),
            "timestamps": [ts.isoformat() for ts in timestamps_per_person.get(name, [])],
        }

    players = [
        player_row(n, c)
        for n, c in sorted(players_counts.items(), key=lambda x: x[1] - baseline, reverse=True)
    ]

    def excluded_rows(group: dict[str, int]) -> list[dict]:
        return [
            {
                "name": n,
                "count": c,
                "pct": round(100 * c / total_images, 1) if total_images > 0 else 0,
            }
            for n, c in sorted(group.items(), key=lambda x: x[1], reverse=True)
        ]

    return {
        "baseline": round(baseline, 1),
        "baseline_method": baseline_method,
        "players": players,
        "excluded": {
            "tranare": excluded_rows(buckets["tranare"]),
            "publik": excluded_rows(buckets["publik"]),
            "grupp": excluded_rows(buckets["grupp"]),
            "below_threshold": excluded_rows(buckets["below_threshold"]),
        },
    }


def compute_player_stats(
    files: list[str],
    gap_minutes: int = 30,
    baseline_method: str = "median",
    min_images: int = 3,
    tranare_set: set[str] | None = None,
    publik_set: set[str] | None = None,
    grupp_set: set[str] | None = None,
    per_match: bool = False,
) -> dict:
    """Top-level counting core: files -> JSON-serializable statistics.

    Returns {total_images, time_range, ...summary, matches: [...]} or
    {total_images: 0, ...empty...} when nothing parsed. Shared by the GUI/API;
    the CLI uses build_entries/segment_matches directly for its rendering.
    """
    tranare_set = tranare_set or set()
    publik_set = publik_set or set()
    grupp_set = grupp_set or set()

    entries = build_entries(files)
    if not entries:
        return {
            "total_images": 0,
            "time_range": None,
            "baseline": 0,
            "baseline_method": baseline_method,
            "players": [],
            "excluded": {"tranare": [], "publik": [], "grupp": [], "below_threshold": []},
            "matches": [],
        }

    matches = segment_matches(entries, gap_minutes)

    total_counter: Counter = Counter()
    total_timestamps: dict[str, list[datetime]] = defaultdict(list)
    for dt, names, _ in entries:
        for n in names:
            total_counter[n] += 1
            total_timestamps[n].append(dt)

    total_images = len(entries)
    global_start = entries[0][0]
    global_end = entries[-1][0]
    duration_minutes = (global_end - global_start).total_seconds() / 60

    summary = summarize_counter(
        total_counter, total_timestamps, total_images, min_images, baseline_method,
        tranare_set, publik_set, grupp_set,
    )

    match_summaries: list[dict] = []
    if per_match:
        for match_idx, idx_list in enumerate(matches, start=1):
            c: Counter = Counter()
            ts_map: dict[str, list[datetime]] = defaultdict(list)
            for idx in idx_list:
                dt, names, _ = entries[idx]
                for n in names:
                    c[n] += 1
                    ts_map[n].append(dt)
            m_start = entries[idx_list[0]][0]
            m_end = entries[idx_list[-1]][0]
            m_summary = summarize_counter(
                c, ts_map, len(idx_list), min_images, baseline_method,
                tranare_set, publik_set, grupp_set,
            )
            match_summaries.append({
                "index": match_idx,
                "start": m_start.isoformat(),
                "end": m_end.isoformat(),
                "duration_minutes": round((m_end - m_start).total_seconds() / 60, 1),
                "total_images": len(idx_list),
                **m_summary,
            })

    return {
        "total_images": total_images,
        "time_range": {
            "start": global_start.isoformat(),
            "end": global_end.isoformat(),
            "duration_minutes": round(duration_minutes, 1),
        },
        **summary,
        "matches": match_summaries,
    }


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

    def render_single_span(ts_list: list[datetime], span_start: datetime, span_end: datetime, span_width: int) -> str:
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
    total_match_duration = sum(
        (m_end - m_start).total_seconds() for m_start, m_end in match_ranges
    )

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
        header = f"{'NAMN':<{name_width}}  {'ANT':>4}      %     {'Δ%':>5}      {'ΔN':>5}  {'BAR':<{bar_width+2}}  SPARK"
    else:
        header = f"{'NAMN':<{name_width}}  {'ANT':>4}      %       {'Δ%':>5}    {'ΔN':>5}  {'BAR':<{bar_width+2}}  SPARK"
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
        for match_idx, (c, ts_map) in enumerate(zip(per_match_counters, per_match_timestamps), start=1):
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
