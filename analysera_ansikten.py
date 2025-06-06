#!/usr/bin/env python3
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

BASE_DIR = Path.home() / ".local" / "share" / "faceid"
LOG_FILE = BASE_DIR / "attempt_stats.jsonl"
ARCHIVE_DIR = BASE_DIR / "archive"

def load_stats(logfile):
    stats = []
    with open(logfile, "r") as f:
        for line in f:
            try:
                stats.append(json.loads(line))
            except Exception:
                pass
    return stats

def load_multiple_stats(files):
    stats = []
    for f in files:
        label = Path(f).stem
        for line in open(f):
            try:
                entry = json.loads(line)
                entry["__sourcefile"] = label
                stats.append(entry)
            except Exception:
                pass
    return stats

def analyze(stats, group_by_source=False):
    # Möjliggör jämförelse mellan olika databaser (per fil)
    if group_by_source:
        sources = defaultdict(list)
        for entry in stats:
            sources[entry.get("__sourcefile", "current")].append(entry)
        for label, entries in sources.items():
            print(f"\n##### Statistik för databas: {label} #####")
            _analyze_single(entries)
    else:
        _analyze_single(stats)

def _analyze_single(stats):
    attempt_success = Counter()
    attempt_info = defaultdict(lambda: {"used": 0, "faces": 0, "time": 0.0, "total": 0})
    review_outcomes = Counter()
    scale_stats = defaultdict(lambda: {"used": 0, "total": 0, "time": 0.0, "faces": 0})
    upsample_stats = defaultdict(lambda: {"used": 0, "total": 0})
    label_stats = Counter()
    position_label_stats = defaultdict(Counter)

    for entry in stats:
        attempts = entry["attempts"]
        used = entry.get("used_attempt")
        review_results = entry.get("review_results")
        labels_per_attempt = entry.get("labels_per_attempt")

        if used is not None:
            setting = attempts[used]
            key = (
                setting.get("model"),
                setting.get("upsample"),
                setting.get("scale_label"),
                setting.get("scale_px"),
            )
            attempt_success[key] += 1
            scale_stats[setting.get("scale_label")]["used"] += 1
            upsample_stats[setting.get("upsample")]["used"] += 1

        for att in attempts:
            key = (
                att.get("model"),
                att.get("upsample"),
                att.get("scale_label"),
                att.get("scale_px"),
            )
            attempt_info[key]["total"] += 1
            scale_stats[att.get("scale_label")]["total"] += 1
            upsample_stats[att.get("upsample")]["total"] += 1
        if used is not None:
            setting = attempts[used]
            key = (
                setting.get("model"),
                setting.get("upsample"),
                setting.get("scale_label"),
                setting.get("scale_px"),
            )
            attempt_info[key]["used"] += 1
            attempt_info[key]["faces"] += setting.get("faces_found", 0)
            attempt_info[key]["time"] += setting.get("time_seconds", 0.0)
            scale_stats[setting.get("scale_label")]["faces"] += setting.get("faces_found", 0)
            scale_stats[setting.get("scale_label")]["time"] += setting.get("time_seconds", 0.0)

        if review_results and labels_per_attempt:
            for i, (result, labels) in enumerate(zip(review_results, labels_per_attempt)):
                review_outcomes[result] += 1
                for pos, label in enumerate(labels):
                    label_stats[label] += 1
                    position_label_stats[pos][label] += 1

    print("=== Hur ofta valdes varje attempt (modell, upsample, skala) ===")
    for key, count in attempt_success.most_common():
        model, upsample, scale, px = key
        print(f"  model={model}, upsample={upsample}, scale={scale} ({px}px): {count} gånger")

    print("\n=== Successrate per attempt-setup ===")
    for key, info in attempt_info.items():
        model, upsample, scale, px = key
        n_used = info["used"]
        n_total = info["total"]
        mean_faces = info["faces"] / n_used if n_used else 0
        mean_time = info["time"] / n_used if n_used else 0
        print(
            f"  model={model}, upsample={upsample}, scale={scale} ({px}px): "
            f"{n_used} av {n_total} ({100*n_used/n_total:.1f}%) | snitt ansikten {mean_faces:.2f}, snitt tid {mean_time:.2f}s"
        )

    print("\n=== Outcomes (review_results) ===")
    for res, count in review_outcomes.items():
        print(f"  {res:>12}: {count}")

    print("\n=== Label-statistik (totalt) ===")
    for label, count in label_stats.most_common(20):
        print(f"  {label:>20}: {count}")

    print("\n=== Användning per skala ===")
    for scale, info in scale_stats.items():
        n_used = info["used"]
        n_total = info["total"]
        mean_faces = info["faces"] / n_used if n_used else 0
        mean_time = info["time"] / n_used if n_used else 0
        print(
            f"  {scale}: {n_used} av {n_total} ({100*n_used/n_total:.1f}%) | snitt ansikten {mean_faces:.2f}, snitt tid {mean_time:.2f}s"
        )

    print("\n=== Användning per upsample ===")
    for upsample, info in upsample_stats.items():
        print(
            f"  upsample={upsample}: {info['used']} av {info['total']} ({100*info['used']/info['total']:.1f}%)"
        )

    print("\n=== Vanligaste etikett per ansiktsposition ===")
    for pos in sorted(position_label_stats):
        most_common = position_label_stats[pos].most_common(1)
        if most_common:
            label, count = most_common[0]
            print(f"  Ansikte {pos+1}: {label} ({count} st)")

def find_all_stats_files():
    files = []
    # Nuvarande
    if LOG_FILE.exists():
        files.append(LOG_FILE)
    # Alla arkiv
    if ARCHIVE_DIR.exists():
        files += sorted(ARCHIVE_DIR.glob("attempt_stats*.jsonl"))
    return files

def main():
    # Default: analysera nuvarande loggfil
    if len(sys.argv) == 1:
        if not LOG_FILE.exists():
            print(f"Ingen loggfil hittades: {LOG_FILE}")
            return
        stats = load_stats(LOG_FILE)
        if not stats:
            print("Inga loggar hittades.")
            return
        analyze(stats)
    # "all" => analysera alla arkiv + nuvarande
    elif sys.argv[1] == "all":
        files = find_all_stats_files()
        if not files:
            print("Inga statistikfiler hittades.")
            return
        print("Analyserar samtliga databaser:")
        for f in files:
            print("  -", f)
        stats = load_multiple_stats(files)
        analyze(stats, group_by_source=True)
    # "file ..." => analysera angivna filer (eller paths)
    else:
        files = [Path(arg) for arg in sys.argv[1:]]
        stats = load_multiple_stats(files)
        analyze(stats, group_by_source=True)

if __name__ == "__main__":
    main()

