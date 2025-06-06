#!/usr/bin/env python

import pickle
from pathlib import Path

from prompt_toolkit import prompt
from prompt_toolkit.completion import WordCompleter
from xdg import xdg_data_home

BASE_DIR = xdg_data_home() / "faceid"
ENCODING_PATH = BASE_DIR / "encodings.pkl"
IGNORED_PATH = BASE_DIR / "ignored.pkl"


def load():
    if ENCODING_PATH.exists():
        with open(ENCODING_PATH, "rb") as f:
            known = pickle.load(f)
    else:
        known = {}
    if IGNORED_PATH.exists():
        with open(IGNORED_PATH, "rb") as f:
            ignored = pickle.load(f)
    else:
        ignored = []
    return known, ignored


def save(known, ignored):
    with open(ENCODING_PATH, "wb") as f:
        pickle.dump(known, f)
    with open(IGNORED_PATH, "wb") as f:
        pickle.dump(ignored, f)


def print_known(known):
    print("\nNuvarande namn i databasen:")
    for idx, name in enumerate(sorted(known), 1):
        print(f"  {idx:2d}. {name} ({len(known[name])} encodings)")


def name_input(known, msg="Namn: "):
    completer = WordCompleter(sorted(known), ignore_case=True, sentence=True)
    return prompt(msg, completer=completer).strip()


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
 0. Avsluta
"""
    )


def main():
    known, ignored = load()
    while True:
        print_menu()
        val = input("Välj åtgärd: ").strip()
        if val == "1":
            print_known(known)
            name = name_input(known, "Vilket namn vill du byta? (autocomplete): ")
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
            save(known, ignored)
        elif val == "2":
            print_known(known)
            name1 = name_input(known, "Första namn att slå ihop (autocomplete): ")
            name2 = name_input(known, "Andra namn att slå ihop (autocomplete): ")
            if name1 not in known or name2 not in known:
                print("Ett eller båda namn finns inte.")
                continue
            target = input(f"Slå ihop som nytt namn: (default '{name1}') ").strip()
            if not target:
                target = name1
            # Samla alla encodings
            encodings = []
            if target in known:
                encodings.extend(known[target])
            if name1 in known:
                encodings.extend(known[name1])
            if name2 in known:
                encodings.extend(known[name2])
            # Unika encodings, bevara ordning (valfritt)
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
            save(known, ignored)
        elif val == "4":
            print_known(known)
            name = name_input(known, "Flytta vilket namn till ignore? (autocomplete): ")
            if name not in known:
                print("Namn hittades ej.")
                continue
            ignored.extend(known[name])
            del known[name]
            print(f"{name} flyttades till ignorerade ansikten.")
            save(known, ignored)
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
            save(known, ignored)
        elif val == "6":
            print_known(known)
            print(f"\nAntal ignorerade encodings: {len(ignored)}")
        elif val == "0":
            print("Avslutar!")
            break
        else:
            print("Ogiltigt val.")


if __name__ == "__main__":
    main()
