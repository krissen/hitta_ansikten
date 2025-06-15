#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import glob
import os
import re
import sys
from collections import Counter
from datetime import datetime, timedelta


def parse_filename(fn):
    """
    Plockar ut timestamp och lista av namn från ett filnamn enligt format:
    YYMMDD_HHMMSS[-N]_Namn1[, _Namn2,...].jpg

    Returnerar två värden:
      1) datetime-objekt (baserat på YYMMDDHHMMSS, där "-N" suffix tas bort)
      2) lista av namn (utan några "-N" baktill)
    """
    base = os.path.basename(fn)
    name, ext = os.path.splitext(base)
    # Hitta positionerna för de två första '_' i namnet
    i1 = name.find("_")
    i2 = name.find("_", i1 + 1)
    if i1 == -1 or i2 == -1:
        return None, None

    # dt_full innehåller t.ex. "250601_110520-2"
    dt_full = name[:i2]
    # names_part innehåller t.ex. "Albin" eller "Emil,_Edvin"
    names_part = name[i2 + 1 :]

    # Ta bort "-N"-suffix om det finns
    dt_part = dt_full.split("-", 1)[0]  # "250601_110520"
    # Ta bort underscore mellan datum och tid för strptime
    dt_str = dt_part.replace("_", "")  # "250601110520"
    try:
        dt = datetime.strptime(dt_str, "%y%m%d%H%M%S")
    except ValueError:
        return None, None

    # Dela listan av namn på ",_" och ta bort ev "-N"-suffix på varje namn
    raw_names = [n.strip() for n in names_part.split(",_") if n.strip()]
    names = [re.sub(r"-\d+$", "", n) for n in raw_names]
    return dt, names


def main(args):
    # Hämta alla filer som matchar glob-mönster
    files = []
    for pat in args.glob_patterns:
        files.extend(glob.glob(pat))
    if not files:
        print("Ingen fil matchade angivet mönster.")
        sys.exit(1)

    # Parsning: skapa en lista av (datetime, [namn], filnamn)
    entries = []
    for fn in files:
        dt, names = parse_filename(fn)
        if dt is None:
            continue
        entries.append((dt, names, fn))

    if not entries:
        print("Inga giltiga bilder hittades bland matchande filer.")
        sys.exit(1)

    # Sortera efter tidsstämpel
    entries.sort(key=lambda x: x[0])

    # Dela in i matcher baserat på gap-minuter
    matcher = []
    current_match = [0]
    for i in range(1, len(entries)):
        prev_dt = entries[i - 1][0]
        this_dt = entries[i][0]
        if this_dt - prev_dt > timedelta(minutes=args.gap_minutes):
            matcher.append(current_match)
            current_match = [i]
        else:
            current_match.append(i)
    matcher.append(current_match)

    # Räkna totalt antal bilder per person
    total_counter = Counter()
    # Räkna antal bilder per person, per match
    per_match_counters = []

    # Totalt antal bilder (antal filer)
    total_images = len(entries)

    for idx_list in matcher:
        c = Counter()
        for idx in idx_list:
            _, names, _ = entries[idx]
            for n in names:
                c[n] += 1
                total_counter[n] += 1
        per_match_counters.append(c)

    # Skriv ut totalsammanställningen
    print("=== Totalt (alla matcher) ===")
    # Skriv ut totalt antal bilder
    print(f"Totalt antal bilder: {total_images}")
    # Skriv ut antal per person
    for namn, cnt in total_counter.most_common():
        print(f"{namn}: {cnt}")

    # Om flaggan per_match är satt, skriv ut varje enskild match
    if args.per_match:
        print()
        for match_idx, c in enumerate(per_match_counters, start=1):
            idx_list = matcher[match_idx - 1]
            start_dt = entries[idx_list[0]][0]
            end_dt = entries[idx_list[-1]][0]
            # Skriv ut totalbilder för aktuellt matchblock
            print(
                f"--- Match {match_idx} ({start_dt.strftime('%Y-%m-%d %H:%M:%S')} → {end_dt.strftime('%Y-%m-%d %H:%M:%S')}) ---"
            )
            print(f"Totalt antal bilder i match {match_idx}: {len(idx_list)}")
            for namn, cnt in c.most_common():
                print(f"{namn}: {cnt}")
            print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "Räknar antal bilder per person, totalt och per match, "
            "för filer som matchar givna glob-mönster. "
            "En ny match påbörjas om tidsintervallet mellan två bilder "
            "överstiger angivet antal minuter."
        )
    )
    parser.add_argument(
        "glob_patterns",
        nargs="+",
        help="Ett eller flera glob-mönster, t.ex. 250601* eller *.jpg",
    )
    parser.add_argument(
        "-g",
        "--gap-minutes",
        type=int,
        default=30,
        help="Maximalt antal minuter mellan två bilder för att de ska räknas i samma match (standard: 30)",
    )
    parser.add_argument(
        "-p",
        "--per-match",
        action="store_true",
        help="Visa även resultat per match (standard: endast total)",
    )
    args = parser.parse_args()
    main(args)
