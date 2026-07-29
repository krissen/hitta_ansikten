#!/usr/bin/env python3
"""Measure what the review log says about naming, to size a control surface.

Reads ``attempt_stats.jsonl`` and reports how naming labour is actually
distributed: how much of it is ``ignorerad``, how many distinct names exist
globally, and — the load-bearing part — how few names cover a single shoot.
The output sizes the button mapping for the MIDI control surface (see
``docs/dev/midi.md``) from measurement instead of guesswork.

Usage::

    python -m benchmarks.label_usage
    python -m benchmarks.label_usage --log /path/to/attempt_stats.jsonl
    python -m benchmarks.label_usage --min-labels 50 --tops 8,16 --csv out.csv

**What this can and cannot answer.** ``attempt_stats.jsonl`` records
*outcomes*, not keystrokes. The schema (``core.attempts.log_attempt_stats``)
is timestamp, filename, file_hash, attempts, used_attempt, review_results and
labels_per_attempt. Nothing logs navigation, view switches, culling actions or
which key was pressed. Name frequency is therefore measured; **action
frequency is not**, and no output of this script ranks actions.

Like everything else in this package: developer tooling, read-only against
``~/.local/share/faceid/``, excluded from the shipped bundle. Unlike the rest
of the package this is not face-recognition benchmarking — it shares the
package's contract, not its subject.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

DEFAULT_LOG = Path("~/.local/share/faceid/attempt_stats.jsonl").expanduser()

try:
    # Reuse the backend's canonical ignore-marker set when available.
    from core.naming import IGNORE_MARKERS
except Exception:  # pragma: no cover - fallback if run outside the backend tree
    IGNORE_MARKERS = frozenset({"ignorerad", "ign", "okänt", "okant"})

# The label the reviewer picks when a detected face should not be enrolled.
# It is an *action*, not a person, and is counted separately everywhere.
#
# Every marker in IGNORE_MARKERS folds into this one bucket. Only "ignorerad"
# occurs in the current corpus, but a log carrying "ign"/"okänt"/"okant" would
# otherwise count them as people, inflating both the name count and top-N
# coverage.
IGNORE_LABEL = "ignorerad"

# A review outcome of "ok" means the attempt was accepted. Anything else
# (retry, skipped, no_faces, all_ignored) is a review that did not land
# cleanly on the first pass.
OK_RESULT = "ok"


def label_name(label: dict | str) -> str:
    """Extract the person name from one label entry.

    Labels are stored for display as ``"#3\\nElis Niemi"`` — an index prefix,
    a newline, then the name. A few malformed entries carry the prefix with an
    empty name; those are dropped by the caller.

    Accepts a bare string as well as the usual dict, matching
    ``core.db.extract_face_labels`` and ``core.naming``. The whole corpus is
    dicts today, but the app's own helpers tolerate strings and a dict-only
    reader would raise on the first one.

    Any ignore marker is normalised to ``IGNORE_LABEL`` so the variants share
    one bucket instead of being counted as people.
    """
    text = label.get("label", "") if isinstance(label, dict) else label
    if not isinstance(text, str):
        return ""
    name = text.split("\n")[-1].strip()
    if name.lower() in IGNORE_MARKERS:
        return IGNORE_LABEL
    return name


def load_records(log_path: Path) -> list[dict]:
    """Read the JSONL log, skipping unparseable lines."""
    records = []
    with open(log_path, encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                print(f"warning: skipping malformed line {line_no}", file=sys.stderr)
    return records


def shoot_key(record: dict) -> tuple[str, str]:
    """Group reviews into shoots by source directory + calendar date.

    A shoot is one match or session: the photos live in one directory and were
    reviewed on one day. This is the unit the button mapping has to serve,
    because it is the unit within which the same faces recur.
    """
    directory = os.path.dirname(record.get("filename", ""))
    date = str(record.get("timestamp", ""))[:10]
    return (directory, date)


def collect(records: list[dict]) -> tuple[Counter, dict, dict]:
    """Tally labels globally and per shoot.

    Counts labels across **all** attempts, not just the used one: every label
    shown was a naming decision the reviewer made, and a retried attempt
    represents real work.

    Returns ``(global_counts, per_shoot_counts, totals)`` where the counters
    include ``ignorerad`` and ``totals`` carries the corpus-level numbers.
    """
    global_counts: Counter = Counter()
    per_shoot: dict[tuple[str, str], Counter] = defaultdict(Counter)
    total_labels = 0
    empty_labels = 0
    non_ok_reviews = 0

    for record in records:
        key = shoot_key(record)
        for attempt_labels in record.get("labels_per_attempt") or []:
            for label in attempt_labels:
                total_labels += 1
                name = label_name(label)
                if not name:
                    empty_labels += 1
                    continue
                global_counts[name] += 1
                per_shoot[key][name] += 1
        for result in record.get("review_results") or []:
            if result != OK_RESULT:
                non_ok_reviews += 1

    totals = {
        "records": len(records),
        "labels_raw": total_labels,
        "labels_empty": empty_labels,
        "labels": total_labels - empty_labels,
        "ignored": global_counts.get(IGNORE_LABEL, 0),
        "non_ok_reviews": non_ok_reviews,
    }
    return global_counts, per_shoot, totals


def names_only(counts: Counter) -> Counter:
    """Drop the ignore marker, leaving actual person names."""
    return Counter({k: v for k, v in counts.items() if k != IGNORE_LABEL})


def top_coverage(counts: Counter, n: int) -> float | None:
    """Fraction of namings covered by the n most frequent names.

    Returns ``None`` for an empty counter rather than dividing by zero.
    """
    total = sum(counts.values())
    if not total:
        return None
    return sum(count for _, count in counts.most_common(n)) / total


def analyse(records: list[dict], min_labels: int, tops: list[int]) -> dict:
    """Produce every number the report prints."""
    global_counts, per_shoot, totals = collect(records)
    global_names = names_only(global_counts)

    # Shoots large enough to be representative. A handful of stray reviews in
    # a directory says nothing about how a working session is distributed.
    big_shoots = {
        key: counts
        for key, counts in per_shoot.items()
        if sum(names_only(counts).values()) >= min_labels
    }

    unique_per_shoot = [len(names_only(counts)) for counts in big_shoots.values()]
    shoot_coverage = {}
    for n in tops:
        values = [
            coverage
            for counts in big_shoots.values()
            if (coverage := top_coverage(names_only(counts), n)) is not None
        ]
        shoot_coverage[n] = values

    timestamps = [str(r.get("timestamp", "")) for r in records if r.get("timestamp")]

    return {
        "totals": totals,
        "date_first": min(timestamps)[:10] if timestamps else "?",
        "date_last": max(timestamps)[:10] if timestamps else "?",
        "unique_names": len(global_names),
        "global_names": global_names,
        "global_coverage": {n: top_coverage(global_names, n) for n in tops},
        "shoots_total": len(per_shoot),
        "shoots_counted": len(big_shoots),
        "unique_per_shoot": unique_per_shoot,
        "shoot_coverage": shoot_coverage,
        "min_labels": min_labels,
        "tops": tops,
    }


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.0f} %"


def print_report(result: dict) -> None:
    """Print the summary table, mirroring what docs/dev/midi.md records."""
    totals = result["totals"]
    labels = totals["labels"]
    tops = result["tops"]

    print()
    print(f"Label usage — {result['date_first']} to {result['date_last']}")
    print(f"  {totals['records']} reviewed images, {result['shoots_total']} shoots")
    print()
    print(f"{'measure':<34}{'value':>14}")
    print("-" * 48)
    print(f"{'labels total':<34}{labels:>14,}")
    if totals["labels_empty"]:
        print(f"{'  (malformed, dropped)':<34}{totals['labels_empty']:>14,}")
    share = totals["ignored"] / labels if labels else 0
    print(f"{'of which ignorerad':<34}{totals['ignored']:>8,} ({share * 100:.0f} %)")
    print(f"{'reviews not ok (retry etc.)':<34}{totals['non_ok_reviews']:>14,}")
    print(f"{'unique names total':<34}{result['unique_names']:>14,}")
    for n in tops:
        print(f"{f'top-{n} globally':<34}{_pct(result['global_coverage'][n]):>14}")
    print()
    print(f"Per shoot (>= {result['min_labels']} namings; {result['shoots_counted']} shoots)")
    print("-" * 48)
    unique = result["unique_per_shoot"]
    if unique:
        print(f"{'median unique names':<34}{statistics.median(unique):>14.1f}")
        print(f"{'mean unique names':<34}{statistics.mean(unique):>14.1f}")
        print(f"{'max unique names':<34}{max(unique):>14}")
    for n in tops:
        values = result["shoot_coverage"][n]
        if not values:
            continue
        median = statistics.median(values)
        mean = statistics.mean(values)
        print(f"{f'top-{n} in a shoot (median)':<34}{median * 100:>13.0f} %")
        print(f"{f'top-{n} in a shoot (mean)':<34}{mean * 100:>13.0f} %")
    print()


def write_csv(result: dict, path: Path) -> None:
    """Write the global name frequencies, most frequent first."""
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["name", "count"])
        writer.writerow([IGNORE_LABEL, result["totals"]["ignored"]])
        for name, count in result["global_names"].most_common():
            writer.writerow([name, count])
    print(f"Wrote {path}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Measure naming distribution in attempt_stats.jsonl.",
    )
    parser.add_argument(
        "--log",
        type=Path,
        default=DEFAULT_LOG,
        help=f"path to attempt_stats.jsonl (default: {DEFAULT_LOG})",
    )
    parser.add_argument(
        "--min-labels",
        type=int,
        default=50,
        help="minimum namings for a shoot to be counted (default: 50)",
    )
    parser.add_argument(
        "--tops",
        default="8,16",
        help="comma-separated coverage cutoffs (default: 8,16)",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="also write global name frequencies to this CSV",
    )
    args = parser.parse_args(argv)

    if not args.log.exists():
        print(f"error: no such log: {args.log}", file=sys.stderr)
        return 1

    try:
        tops = [int(t) for t in str(args.tops).split(",") if t.strip()]
    except ValueError:
        print(f"error: --tops must be integers, got {args.tops!r}", file=sys.stderr)
        return 2
    if not tops:
        print("error: --tops must name at least one cutoff", file=sys.stderr)
        return 2

    records = load_records(args.log)
    if not records:
        print(f"error: no usable records in {args.log}", file=sys.stderr)
        return 1

    result = analyse(records, args.min_labels, tops)
    print_report(result)
    if args.csv:
        write_csv(result, args.csv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
