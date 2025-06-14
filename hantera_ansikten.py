#!/usr/bin/env python3

import fnmatch
from pathlib import Path

from prompt_toolkit import prompt
from prompt_toolkit.completion import WordCompleter

from faceid_db import (
    load_attempt_log,
    load_database,
    load_processed_files,
    save_database,
)

# === Verktygsfunktioner ===


def print_known(known):
    print("\nNuvarande namn i databasen:")
    for idx, name in enumerate(sorted(known), 1):
        print(f"  {idx:2d}. {name} ({len(known[name])} encodings)")


def name_input(known, msg="Namn: "):
    names = sorted(known)
    completer = WordCompleter(names, ignore_case=True, sentence=True)
    ans = prompt(msg, completer=completer).strip()
    # Siffra som alias
    if ans.isdigit() and 1 <= int(ans) <= len(names):
        ans = names[int(ans) - 1]
    return ans


def print_menu():
    print(
        """
Meny:
 1. Byt namn på en person
 2. Slå ihop två personer
 3. Ta bort en person
 4. Flytta persons encodings till ignore
 5. Flytta encodings från ignore till nytt namn
 6. Visa namn/statistik
 7. Lista senaste hanterade filer
 8. Undo senaste fil
 9. Purgea senaste X antal encodings för ett namn/ignore
10. Undo för vald fil eller glob
 0. Avsluta
"""
    )


def list_recent_files(n=10):
    processed = load_processed_files()
    print("\nSenaste hanterade filer:")
    for i, entry in enumerate(reversed(processed[-n:]), 1):
        fname = entry["name"] if isinstance(entry, dict) else entry
        print(f"{i:2d}. {fname}")


def undo_last_file(known, ignored, processed):
    log = load_attempt_log()
    if not processed or not log:
        print("Ingen fil att ångra.")
        return known, ignored, processed
    last_entry = processed[-1]
    last_name = last_entry["name"] if isinstance(last_entry, dict) else last_entry
    entry = next(
        (e for e in reversed(log) if Path(e.get("filename", "")).name == last_name),
        None,
    )
    if not entry or not entry.get("labels_per_attempt"):
        print("Ingen loggning för senaste filen.")
        return known, ignored, processed

    removed = 0
    for labels in entry["labels_per_attempt"]:
        for label in labels:
            parts = label.split("\n")
            if len(parts) == 2:
                name = parts[1]
                if name == "ignorerad":
                    if ignored:
                        ignored.pop()
                        removed += 1
                else:
                    if name in known and known[name]:
                        known[name].pop()
                        removed += 1
    print(f"Ångrade {removed} encodings för fil: {last_name}")
    processed = processed[:-1]
    return known, ignored, processed


def undo_file_by_name(known, ignored, processed):
    pattern = input("Ange exakt filnamn eller glob (t.ex. 2024*.NEF): ").strip()
    if not pattern:
        print("Ingen fil angavs.")
        return known, ignored, processed
    matched_files = [
        pf
        for pf in processed
        if fnmatch.fnmatch((pf["name"] if isinstance(pf, dict) else pf), pattern)
    ]
    if not matched_files:
        print("Inga filer matchar.")
        return known, ignored, processed

    print("\nFöljande filer matchar:")
    for idx, pf in enumerate(matched_files, 1):
        fname = pf["name"] if isinstance(pf, dict) else pf
        print(f"  {idx:2d}. {fname}")

    confirm = input("Fortsätt och ångra ALLA dessa filer? (ja/nej): ").strip().lower()
    if confirm != "ja":
        print("Avbryter.")
        return known, ignored, processed

    log = load_attempt_log()
    removed_total = 0
    names_to_remove = set(
        pf["name"] if isinstance(pf, dict) else pf for pf in matched_files
    )
    processed_new = [
        pf
        for pf in processed
        if (pf["name"] if isinstance(pf, dict) else pf) not in names_to_remove
    ]
    for target_name in names_to_remove:
        for entry in reversed(log):
            if Path(entry.get("filename", "")).name == target_name:
                labels_per_attempt = entry.get("labels_per_attempt", [])
                for labels in labels_per_attempt:
                    for label in labels:
                        parts = label.split("\n")
                        if len(parts) == 2:
                            name = parts[1]
                            if name == "ignorerad":
                                if ignored:
                                    ignored.pop()
                                    removed_total += 1
                            else:
                                if name in known and known[name]:
                                    known[name].pop()
                                    removed_total += 1
    print(f"Ångrade {removed_total} encodings för {len(matched_files)} filer.")
    return known, ignored, processed_new


def print_mapping_counts(known, ignored):
    print("\nAntal mappningar per namn:")
    for idx, name in enumerate(sorted(known), 1):
        print(f"  {idx:2d}. {name} ({len(known[name])})")
    print(f"\nIgnorerade: {len(ignored)}")


def purge_last_x_for_name(known, ignored):
    all_names = sorted(known) + ["ignore"]
    for idx, n in enumerate(all_names, 1):
        print(f"{idx:2d}. {n} ({len(known[n]) if n != 'ignore' else len(ignored)})")
    ans = input("Välj namn (nummer eller namn): ").strip()
    if ans.isdigit() and 1 <= int(ans) <= len(all_names):
        ans = all_names[int(ans) - 1]
    name = ans
    try:
        x = int(input("Hur många senaste encodings vill du ta bort? ").strip())
    except:
        print("Ogiltigt antal.")
        return known, ignored
    if x < 1:
        print("Ogiltigt antal.")
        return known, ignored
    if name == "ignore":
        if x > len(ignored):
            print("För många.")
            return known, ignored
        ignored = ignored[:-x] if x < len(ignored) else []
        print(f"Tog bort {x} senaste encodings från ignore.")
    elif name in known:
        if x > len(known[name]):
            print("För många.")
            return known, ignored
        known[name] = known[name][:-x] if x < len(known[name]) else []
        print(f"Tog bort {x} senaste encodings från {name}.")
    else:
        print("Namn hittades ej.")
    return known, ignored


# ===================================================


def main():
    known, ignored, processed = load_database()
    while True:
        print_menu()
        val = input("Välj åtgärd: ").strip()
        if val == "1":
            print_known(known)
            name = name_input(known, "Vilket namn vill du byta? (namn eller nummer): ")
            if name not in known:
                print("Namn hittades ej.")
                continue
            new_name = input(f"Vad ska '{name}' bytas till? (nytt namn): ").strip()
            if not new_name:
                print("Inget nytt namn angavs.")
                continue
            if new_name in known:
                print("Namnet finns redan! Använd slå ihop istället.")
                continue
            known[new_name] = known.pop(name)
            print(f"{name} → {new_name}")
            save_database(known, ignored, processed)
        elif val == "2":
            print_known(known)
            name1 = name_input(known, "Första namn att slå ihop (namn eller nummer): ")
            name2 = name_input(known, "Andra namn att slå ihop (namn eller nummer): ")
            if name1 not in known or name2 not in known:
                print("Ett eller båda namn finns inte.")
                continue
            target = input(f"Slå ihop som nytt namn: (default '{name1}') ").strip()
            if not target:
                target = name1
            encodings = []
            if target in known:
                encodings.extend(known[target])
            if name1 in known:
                encodings.extend(known[name1])
            if name2 in known:
                encodings.extend(known[name2])
            seen = set()
            encodings_unique = []
            for enc in encodings:
                if id(enc) not in seen:
                    seen.add(id(enc))
                    encodings_unique.append(enc)
            known[target] = encodings_unique
            for n in (name1, name2):
                if n != target and n in known:
                    del known[n]
            print(f"{name1} + {name2} → {target}")
            save_database(known, ignored, processed)
        elif val == "3":
            print_known(known)
            name = name_input(known, "Ta bort vilket namn? (namn eller nummer): ")
            if name not in known:
                print("Namn hittades ej.")
                continue
            del known[name]
            print(f"{name} togs bort.")
            save_database(known, ignored, processed)
        elif val == "4":
            print_known(known)
            name = name_input(
                known, "Flytta vilket namn till ignore? (namn eller nummer): "
            )
            if name not in known:
                print("Namn hittades ej.")
                continue
            ignored.extend(known[name])
            del known[name]
            print(f"{name} flyttades till ignorerade ansikten.")
            save_database(known, ignored, processed)
        elif val == "5":
            print(f"Antal encodings i ignore: {len(ignored)}")
            n = input("Hur många flyttas? (1/all): ").strip()
            if n == "all":
                count = len(ignored)
            else:
                try:
                    count = int(n)
                except:
                    print("Ogiltigt antal.")
                    continue
                if count < 1 or count > len(ignored):
                    print("Ogiltigt antal.")
                    continue
            new_name = input("Ange nytt namn för dessa: ").strip()
            if not new_name:
                print("Inget namn angavs.")
                continue
            known[new_name] = known.get(new_name, []) + ignored[:count]
            ignored = ignored[count:]
            print(f"{count} encodings flyttades till '{new_name}'")
            save_database(known, ignored, processed)
        elif val == "6":
            print_mapping_counts(known, ignored)
        elif val == "7":
            list_recent_files(10)
        elif val == "8":
            known, ignored, processed = undo_last_file(known, ignored, processed)
            save_database(known, ignored, processed)
        elif val == "9":
            known, ignored = purge_last_x_for_name(known, ignored)
            save_database(known, ignored, processed)
        elif val == "10":
            known, ignored, processed = undo_file_by_name(known, ignored, processed)
            save_database(known, ignored, processed)
        elif val == "0":
            print("Avslutar!")
            break
        else:
            print("Ogiltigt val.")


if __name__ == "__main__":
    main()
