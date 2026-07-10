"""CLI: produce the go/no-go feasibility report for the face benchmark.

Usage (from ``backend/``)::

    python -m benchmarks.report_feasibility            # scan default roots
    python -m benchmarks.report_feasibility ~/Pictures/nerladdat

Writes ``_data/feasibility_report.md`` and ``_data/unresolved_hashes.json``
(both gitignored). Read-only w.r.t. the face database.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys

from benchmarks import config as cfg
from benchmarks.db_access import (
    DEFAULT_DB_PATH,
    DEFAULT_DISTINCT_PAIRS_PATH,
    face_counts,
    load_db_records,
    recorded_hash_map,
)
from benchmarks.resolve import build_index
from benchmarks.strata import GroupCount, gallery_probe_viability, stratify


def _load_distinct_pairs(path) -> list[list[str]]:
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _pct(n, d) -> str:
    return f"{100 * n / d:.1f}%" if d else "n/a"


def _group_table(title: str, buckets: dict[str, GroupCount]) -> list[str]:
    lines = [f"### {title}", ""]
    lines.append("| Bucket | Faces | Faces recovered | Images | Images recovered | Face rate |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for name, gc in buckets.items():
        lines.append(
            f"| {name} | {gc.total_faces} | {gc.recovered_faces} | "
            f"{gc.total_images} | {gc.recovered_images} | {_pct(gc.recovered_faces, gc.total_faces)} |"
        )
    lines.append("")
    return lines


def build_report(records, index, distinct_pairs) -> tuple[str, list[dict]]:
    resolved = index.hashes()
    recorded = recorded_hash_map(records)
    counts = face_counts(records)

    total_faces = len(records)
    unique_images = len(recorded)
    recovered_images = sum(1 for h in recorded if h in resolved)
    recovered_faces = sum(counts[h] for h in recorded if h in resolved)

    viability = gallery_probe_viability(records, resolved)
    strata = stratify(records, resolved, distinct_pairs)

    now = _dt.datetime.now().isoformat(timespec="seconds")
    L: list[str] = []
    L.append("# Face-recognition benchmark — feasibility report")
    L.append("")
    L.append(f"_Generated {now}_")
    L.append("")
    L.append("## Recovery rate (current, local roots only)")
    L.append("")
    L.append("| Level | Recovered | Total | Rate |")
    L.append("|---|---:|---:|---:|")
    L.append(f"| Source images (unique SHA1) | {recovered_images} | {unique_images} | {_pct(recovered_images, unique_images)} |")
    L.append(f"| Faces (encodings) | {recovered_faces} | {total_faces} | {_pct(recovered_faces, total_faces)} |")
    L.append("")
    L.append("## Gallery + probe viability")
    L.append("")
    L.append(f"- Identities total: **{viability['total_identities']}**")
    L.append(f"- Identities with >=1 recovered source image: **{viability['identities_with_any_recovered']}**")
    L.append(f"- Identities with >=2 recovered *distinct* source images (gallery+probe viable): **{viability['identities_gallery_probe_viable']}**")
    L.append("")
    L.append("## Strata")
    L.append("")
    L.extend(_group_table("By manual vs detected", strata.get("is_manual", {})))
    L.extend(_group_table("By bounding-box area quartile (Q1 = smallest)", strata.get("bbox_quartile", {})))
    L.extend(_group_table("Sibling surname groups (shared surname, >=2 identities)", strata.get("sibling_surname", {})))
    if "twin_pairs" in strata:
        L.extend(_group_table("Confirmed twin pairs (distinct_pairs.json)", strata["twin_pairs"]))
    L.extend(_group_table("Per event (YYMMDD prefix)", strata.get("event", {})))

    # Unresolved list for backup recovery.
    unresolved: list[dict] = []
    for h, basenames in recorded.items():
        if h not in resolved:
            unresolved.append(
                {
                    "sha1": h,
                    "recorded_basenames": sorted(set(basenames)),
                    "face_count": counts[h],
                }
            )
    unresolved.sort(key=lambda d: (-d["face_count"], d["recorded_basenames"][0] if d["recorded_basenames"] else ""))

    L.append("## Unresolved source images")
    L.append("")
    L.append(f"{len(unresolved)} unique source images are not present locally. "
             f"Full list (with recorded basenames) written to `unresolved_hashes.json` "
             f"as input for backup recovery.")
    L.append("")
    L.append("Sample (top 20 by face count):")
    L.append("")
    L.append("| SHA1 (short) | Faces | Recorded basename(s) |")
    L.append("|---|---:|---|")
    for u in unresolved[:20]:
        names = ", ".join(u["recorded_basenames"][:3])
        L.append(f"| `{u['sha1'][:12]}` | {u['face_count']} | {names} |")
    L.append("")

    return "\n".join(L), unresolved


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("roots", nargs="*", help="Photo roots to scan (override config).")
    ap.add_argument("--config", default=None)
    ap.add_argument("--cache", default=str(cfg.CACHE_PATH))
    ap.add_argument("--db", default=str(DEFAULT_DB_PATH))
    ap.add_argument("--distinct-pairs", default=str(DEFAULT_DISTINCT_PAIRS_PATH))
    ap.add_argument("--report", default=str(cfg.REPORT_PATH))
    ap.add_argument("--unresolved", default=str(cfg.UNRESOLVED_PATH))
    args = ap.parse_args(argv)

    cfg.ensure_data_dir()
    roots = cfg.resolve_roots(args.roots or None, args.config)
    if not roots:
        print("No photo roots found to scan.", file=sys.stderr)
        return 2

    index = build_index(roots, args.cache)
    records = load_db_records(args.db)
    distinct_pairs = _load_distinct_pairs(args.distinct_pairs)

    report, unresolved = build_report(records, index, distinct_pairs)

    with open(args.report, "w") as f:
        f.write(report + "\n")
    with open(args.unresolved, "w") as f:
        json.dump(unresolved, f, indent=2)

    print(f"Wrote report:     {args.report}", file=sys.stderr)
    print(f"Wrote unresolved: {args.unresolved} ({len(unresolved)} images)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
