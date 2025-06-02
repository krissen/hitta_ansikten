import fnmatch
import json
import os
import pickle
import signal
import sys
import tempfile
from pathlib import Path

import face_recognition
import imageio
import matplotlib.font_manager as fm
import numpy as np
import rawpy
from PIL import Image, ImageDraw, ImageFont
from xdg import xdg_data_home

# === Konstanter ===
BASE_DIR = xdg_data_home() / "faceid"
ENCODING_PATH = BASE_DIR / "encodings.pkl"
IGNORED_PATH = BASE_DIR / "ignored.pkl"
PROCESSED_PATH = BASE_DIR / "processed.txt"
METADATA_PATH = BASE_DIR / "metadata.json"
CONFIG_PATH = BASE_DIR / "config.json"
SUPPORTED_EXT = [".nef", ".NEF"]

# === Standardkonfiguration ===
DEFAULT_CONFIG = {
    "min_confidence": 0.4,
    "ignore_distance": 0.5,
    "match_threshold": 0.6,
    "font_size_factor": 45,
    "rectangle_thickness": 6,
    "padding": 15,
    "auto_ignore": False,
    "auto_ignore_on_fix": True
}

def load_config():
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r") as f:
                return json.load(f)
        except Exception:
            pass
    with open(CONFIG_PATH, "w") as f:
        json.dump(DEFAULT_CONFIG, f, indent=2)
    return DEFAULT_CONFIG

# === Ladda / initiera databaser ===
def load_database():
    if ENCODING_PATH.exists():
        with open(ENCODING_PATH, "rb") as f:
            known_faces = pickle.load(f)
    else:
        known_faces = {}

    if IGNORED_PATH.exists():
        with open(IGNORED_PATH, "rb") as f:
            ignored_faces = pickle.load(f)
    else:
        ignored_faces = []

    if PROCESSED_PATH.exists():
        with open(PROCESSED_PATH, "r") as f:
            processed_files = set(line.strip() for line in f)
    else:
        processed_files = set()

    return known_faces, ignored_faces, processed_files

def save_database(known_faces, ignored_faces, processed_files):
    with open(ENCODING_PATH, "wb") as f:
        pickle.dump(known_faces, f)
    with open(IGNORED_PATH, "wb") as f:
        pickle.dump(ignored_faces, f)
    with open(PROCESSED_PATH, "w") as f:
        f.writelines(f"{name}\n" for name in sorted(processed_files))

# === Funktion för att skapa tempbild med etiketter ===
def create_labeled_image(rgb_image, face_locations, labels, config):
    img = Image.fromarray(rgb_image)
    draw = ImageDraw.Draw(img)
    padding = config.get("padding", DEFAULT_CONFIG["padding"])
    width, height = img.size
    font_size_factor = config.get("font_size_factor", DEFAULT_CONFIG["font_size_factor"])
    font_size = int(max(width / font_size_factor, 16))
    print(f"[DEBUG] Bildbredd: {width}, font_size_factor: {font_size_factor}, resulterande fontstorlek: {font_size}")

    try:
        font_path = fm.findfont(fm.FontProperties(family='DejaVu Sans'))
        font = ImageFont.truetype(font_path, font_size)
    except:
        font = ImageFont.load_default()

    used_boxes = []
    for idx, ((top, right, bottom, left), label) in enumerate(zip(face_locations, labels)):
        draw.rectangle(
            ((left - padding, top - padding), (right + padding, bottom + padding)),
            outline=(255, 0, 0), width=config.get("rectangle_thickness", DEFAULT_CONFIG["rectangle_thickness"])
        )
        text = f"#{idx + 1}: {label}"
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]

        text_x = left - padding + 5
        text_y = top - padding - text_height - 8
        if text_y < 0:
            text_y = bottom + padding + 3

        for (t2, r2, b2, l2) in face_locations:
            if t2 < text_y + text_height and b2 > text_y and l2 < text_x + text_width and r2 > text_x:
                text_y = bottom + padding + 3
                break

        draw.rectangle(
            [(text_x - 5, text_y - 3), (text_x + text_width + 5, text_y + text_height + 3)],
            fill=(0, 0, 0, 192)
        )
        draw.text(
            (text_x, text_y),
            text,
            fill=(255, 255, 0),
            font=font
        )

    tmp_path = Path(tempfile.gettempdir()) / "face_train_preview.jpg"
    if tmp_path.exists():
        tmp_path.unlink()
    img.save(tmp_path)
    img.close()
    return tmp_path

# === Beräkna avstånd till kända encodings ===
def best_matches(encoding, known_faces, ignored_faces, config):
    suggestions = []
    for name, encodings in known_faces.items():
        for e in encodings:
            dist = np.linalg.norm(encoding - e)
            suggestions.append((name, dist))
    suggestions.sort(key=lambda x: x[1])

    matches = [(name, round(1.0 - dist, 2)) for name, dist in suggestions[:5] if dist < config["match_threshold"]]

    ignore_hits = []
    for e in ignored_faces:
        dist = np.linalg.norm(encoding - e)
        if dist < config["ignore_distance"]:
            ignore_hits.append(round(1.0 - dist, 2))

    return ("IGNORED", matches) if ignore_hits else (matches[0][0] if matches else None, matches)

# === Huvudlogik ===
def process_image(image_path, known_faces, ignored_faces, config):
    with rawpy.imread(str(image_path)) as raw:
        rgb = raw.postprocess()

    face_locations = face_recognition.face_locations(rgb)
    face_locations = sorted(face_locations, key=lambda loc: loc[3])
    face_encodings = face_recognition.face_encodings(rgb, face_locations)

    if not face_encodings:
        print(f"Inga ansikten i {image_path.name}")
        return False

    metadata = []
    labels = []
    for i, encoding in enumerate(face_encodings):
        match, suggestions = best_matches(encoding, known_faces, ignored_faces, config)
        if match == "IGNORED" and config.get("auto_ignore"):
            label = f"Ignorerat (auto)"
        elif match == "IGNORED":
            label = f"Möjl. ignorera"
        elif match:
            label = f"{match}"
        else:
            label = f"Okänt ansikte"
        labels.append(label)
        metadata.append({"index": i+1, "suggestion": match, "suggestions": suggestions})

    img_path = create_labeled_image(rgb, face_locations, labels, config)
    os.system(f"open {img_path}")

    for i, encoding in enumerate(face_encodings):
        print(f"\nAnsikte #{i+1}:")
        match, suggestions = best_matches(encoding, known_faces, ignored_faces, config)

        if match == "IGNORED" and config.get("auto_ignore"):
            print("↪ Detta ansikte har tidigare ignorerats (auto). Hoppar över.")
            continue
        elif match == "IGNORED":
            print("↪ Detta ansikte liknar ett tidigare ignorerat. [Enter = bekräfta ignorera, r = rätta] › ", end="")
            ans = input().strip()
            if ans == "":
                ignored_faces.append(encoding)
                continue
            elif ans.lower() != "r":
                continue

        if match and match != "IGNORED":
            print(f"↪ Föreslaget: {match} ({suggestions[0][1]*100:.0f}%)")
            answer = input("[Enter = bekräfta, n = rätta, i = ignorera] › ").strip()
            if answer == "":
                name = match
            elif answer == "n":
                name = input("Ange korrekt namn › ").strip()
            elif answer == "i":
                ignored_faces.append(encoding)
                continue
            else:
                print("Ogiltigt svar. Hoppar över.")
                continue
        else:
            if suggestions:
                print("↪ Osäkra förslag:")
                used_keys = set()
                shortcut_map = {}
                for s, p in suggestions:
                    key = next((c for c in s.lower() if c not in used_keys), None)
                    if not key:
                        key = str(len(shortcut_map))
                    used_keys.add(key)
                    shortcut_map[key] = s
                    print(f"  [{key.upper()}] {s} ({p*100:.0f}%)")
                answer = input("Välj förslag, skriv namn, eller 'i' för ignorera › ").strip().lower()
                if answer == "i":
                    ignored_faces.append(encoding)
                    continue
                elif answer in shortcut_map:
                    name = shortcut_map[answer]
                else:
                    name = answer
            else:
                name = input("Ange namn (eller 'i' för ignorera) › ").strip()
                if name == "i":
                    ignored_faces.append(encoding)
                    continue

        known_faces.setdefault(name, []).append(encoding)
        metadata[i]["confirmed"] = name

    with open(METADATA_PATH, "a") as meta_file:
        json.dump({"file": image_path.name, "faces": metadata}, meta_file)
        meta_file.write("\n")

    return True

# === Graceful Exit ===
def signal_handler(sig, frame):
    print("\n⏹ Avbruten. Programmet avslutas.")
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

# === Entry point ===
def main():
    if len(sys.argv) < 2:
        print("Användning: python train_faces.py <sökväg_till_bilder> [--fix globpattern]")
        sys.exit(1)

    fix_mode = False
    glob_pattern = None

    if "--fix" in sys.argv:
        fix_mode = True
        idx = sys.argv.index("--fix")
        if idx + 1 < len(sys.argv):
            glob_pattern = sys.argv[idx + 1].lower()
        else:
            print("⚠️  Du måste ange ett filnamnsmönster efter --fix")
            sys.exit(1)

    folder = Path(sys.argv[1])
    files = [f for f in folder.iterdir() if f.suffix in SUPPORTED_EXT]
    config = load_config()

    known_faces, ignored_faces, processed_files = load_database()

    for file in sorted(files):
        if fix_mode:
            if not fnmatch.fnmatch(file.name.lower(), glob_pattern):
                continue
        elif file.name in processed_files:
            print(f"↪ Hoppar över redan behandlad fil: {file.name}")
            continue

        print(f"\n=== Bearbetar: {file.name} ===")
        try:
            if process_image(file, known_faces, ignored_faces, config):
                processed_files.add(file.name)
                save_database(known_faces, ignored_faces, processed_files)
        except Exception as e:
            print(f"Fel vid bearbetning av {file.name}: {e}")

    print("\n✅ Klart. Databas uppdaterad.")

if __name__ == "__main__":
    main()

