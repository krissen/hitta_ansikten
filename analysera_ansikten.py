#!/usr/bin/env python3
import json
from collections import Counter, defaultdict
from pathlib import Path

LOG_FILE = Path.home() / ".local" / "share" / "faceid" / "attempt_stats.jsonl"

def load_stats(logfile):
    stats = []
    with open(logfile, "r") as f:
        for line in f:
            try:
                stats.append(json.loads(line))
            except Exception:
                pass
    return stats

def analyze(stats):
    # Vanliga counters
    attempt_pathways = Counter()
    attempt_info = defaultdict(lambda: {"used": 0, "faces": 0, "time": 0.0, "total": 0})
    outcome_counts = Counter()
    label_stats = Counter()
    position_label_stats = defaultdict(Counter)

    for entry in stats:
        attempts = entry["attempts"]
        used = entry.get("used_attempt")
        review_results = entry.get("review_results")
        labels_per_attempt = entry.get("labels_per_attempt")

        # Analysera attempt-förlopp
        if used is not None:
            attempt_pathways[used] += 1

        for idx, att in enumerate(attempts):
            key = (att["model"], att["upsample"], att["highres"])
            attempt_info[key]["total"] += 1
            if used == idx:
                attempt_info[key]["used"] += 1
                attempt_info[key]["faces"] += att["faces_found"]
                attempt_info[key]["time"] += att["time_seconds"]

        # Djupare analys på review_results och labels
        if review_results and labels_per_attempt:
            for i, (result, labels) in enumerate(zip(review_results, labels_per_attempt)):
                outcome_counts[result] += 1
                for pos, label in enumerate(labels):
                    label_stats[label] += 1
                    position_label_stats[pos][label] += 1

    # Skriv ut sammanfattning
    print("=== Hur ofta användes varje attempt (index, i ordning)? ===")
    total = sum(attempt_pathways.values())
    for idx, count in sorted(attempt_pathways.items()):
        percent = 100 * count / total if total else 0
        print(f"  Försök #{idx+1}: {count} bilder ({percent:.1f}%) godkändes på detta steg")

    print("\n=== Outcome per försök (alla review_results) ===")
    for res, count in outcome_counts.items():
        print(f"  {res:>12}: {count}")

    print("\n=== Detaljerad attempt-statistik ===")
    for key, info in attempt_info.items():
        n_used = info["used"]
        n_total = info["total"]
        mean_faces = info["faces"] / n_used if n_used else 0
        mean_time = info["time"] / n_used if n_used else 0
        print(
            f"  {key}: valdes {n_used} gånger av {n_total} ({100 * n_used/n_total:.1f}%), "
            f"snitt ansikten {mean_faces:.2f}, snitt tid {mean_time:.2f}s"
        )

    print("\n=== Label-statistik (hur ofta väljs olika etiketter på ansikten) ===")
    for label, count in label_stats.most_common(20):
        print(f"  {label:>20}: {count}")

    # (valfritt) Visa vanligaste etiketter på varje ansiktsposition (om många på bild)
    print("\n=== Vanligaste etikett per ansiktsposition ===")
    for pos in sorted(position_label_stats):
        most_common = position_label_stats[pos].most_common(1)
        if most_common:
            label, count = most_common[0]
            print(f"  Ansikte {pos+1}: {label} ({count} st)")

def main():
    if not LOG_FILE.exists():
        print(f"Ingen loggfil hittades: {LOG_FILE}")
        return
    stats = load_stats(LOG_FILE)
    if not stats:
        print("Inga loggar hittades.")
        return
    analyze(stats)

if __name__ == "__main__":
    main()

