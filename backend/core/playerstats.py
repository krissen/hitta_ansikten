#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Player statistics core (shared by the CLI and the GUI/API).

Pure counting/statistics + exclusion-config helpers extracted from the
``rakna_spelare.py`` CLI so the FastAPI backend and the CLI share one source of
truth for the numbers. These functions produce plain data (lists/dicts of
primitives) and never print — terminal rendering (render_bar/render_spark/
print_section) and argparse/main live in ``rakna_spelare.py``, which imports
from here.
"""

import json
import os
import re
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
    names = [re.sub(r"(?:-\d+)+$", "", n) for n in raw_names]
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
    force_players: set[str] | None = None,
) -> dict[str, dict[str, int]]:
    """Split a name->count Counter into the five output buckets.

    Returns dict with keys: players, below_threshold, tranare, publik, grupp.
    ``force_players`` names always land in players — they bypass both the
    exclusion sets and the ``min_images`` threshold (session-only "make this
    name a player" from the GUI).
    """
    force = force_players or set()
    excluded = (tranare_set | publik_set | grupp_set) - force
    return {
        "players": {
            n: c for n, c in counter.items()
            if n not in excluded and (c >= min_images or n in force)
        },
        "below_threshold": {
            n: c for n, c in counter.items()
            if n not in excluded and c < min_images and n not in force
        },
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
    force_players: set[str] | None = None,
) -> dict:
    """Produce a JSON-serializable summary for one counter (total or per match).

    Players are sorted by (count - baseline) descending, same as the CLI table.
    Excluded groups (tranare/publik/grupp/below_threshold) are sorted by count.
    """
    buckets = bucket_counter(
        counter, min_images, tranare_set, publik_set, grupp_set, force_players
    )
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
    force_players: set[str] | None = None,
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
        tranare_set, publik_set, grupp_set, force_players,
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
                tranare_set, publik_set, grupp_set, force_players,
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
