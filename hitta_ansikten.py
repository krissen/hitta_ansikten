import fnmatch
import json
import os
import pickle
import signal
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

import face_recognition
import imageio
import matplotlib.font_manager as fm
import numpy as np
import rawpy
from PIL import Image, ImageDraw, ImageFont
from prompt_toolkit import prompt
from prompt_toolkit.completion import WordCompleter
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
    "auto_ignore_on_fix": True,
    "detection_model": "hog",
    "label_bg_color": [0, 0, 0, 192],
    "label_text_color": [255, 255, 0],
    "max_downsample_px": 2500,
    "max_fullres_px": 6000
}

def load_config():
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r") as f:
                return {**DEFAULT_CONFIG, **json.load(f)}
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


def log_attempt_stats(image_path, attempts, used_attempt_idx, base_dir, log_name="attempt_stats.jsonl"):
    """
    Spara attempts-statistik för en bild till en JSONL-fil i base_dir.
    :param image_path: Path till bilden.
    :param attempts: Lista med dict för varje attempt.
    :param used_attempt_idx: Index (int) för attempt som blev det faktiska valet (eller None om ingen).
    :param base_dir: Path till katalogen där loggfilen ska finnas.
    :param log_name: Filnamn på loggfilen.
    """
    log_entry = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "filename": str(image_path),
        "attempts": attempts,
        "used_attempt": used_attempt_idx
    }
    log_path = base_dir / log_name
    base_dir.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a") as f:
        f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")


# === Funktion för att skapa tempbild med etiketter ===
def create_labeled_image(rgb_image, face_locations, labels, config):
    image = Image.fromarray(rgb_image)
    draw = ImageDraw.Draw(image, "RGBA")
    width, height = image.size
    font_size = max(10, width // config.get("font_size_factor", 45))
    font_path = fm.findfont(fm.FontProperties(family="DejaVu Sans"))
    font = ImageFont.truetype(font_path, font_size)

    bg_color = tuple(config.get("label_bg_color", [0, 0, 0, 192]))
    text_color = tuple(config.get("label_text_color", [255, 255, 0]))

    for i, (top, right, bottom, left) in enumerate(face_locations):
        label = labels[i]
        label_lines = label.split("\n")
        padding = config.get("padding", 15)
        line_sizes = [draw.textbbox((0, 0), line, font=font) for line in label_lines]
        text_width = max(b[2] - b[0] for b in line_sizes)
        text_height = font_size * len(label_lines)

        # Starta under lådan, flytta uppåt vid krock
        label_y = bottom + padding
        if label_y + text_height > height:
            label_y = top - padding - text_height

        # Om etikett krockar med annan ansiktslåda: flytta över istället för under (eller vice versa)
        for other_top, other_right, other_bottom, other_left in face_locations:
            if (
                other_top < label_y + text_height
                and label_y < other_bottom
                and left < other_right
                and right > other_left
                and not (other_top == top and other_right == right)
            ):
                # Prova ovanför istället
                label_y = top - padding - text_height
                break

        rect_start = (left, label_y)
        rect_end = (left + text_width + 10, label_y + text_height + 4)
        draw.rectangle([rect_start, rect_end], fill=bg_color)

        draw.rectangle(
            [(left, top), (right, bottom)],
            outline="red",
            width=config.get("rectangle_thickness", 6),
        )

        # Rita varje textrad, gul text
        y_offset = 0
        for line in label_lines:
            draw.text(
                (left + 5, label_y + y_offset + 2), line, fill=text_color, font=font
            )
            y_offset += font_size

    temp_name = "/tmp/hitta_ansikten_preview.jpg"
    image.save(temp_name, format="JPEG")
    return temp_name


# === Beräkna avstånd till kända encodings ===
def best_matches(encoding, known_faces, ignored_faces, config):
    matches = []
    for name, encs in known_faces.items():
        dists = face_recognition.face_distance(encs, encoding)
        score = 1 - np.min(dists)
        if np.min(dists) < config.get("match_threshold", 0.6):
            matches.append((name, score))
    matches.sort(key=lambda x: -x[1])

    ignore_scores = []
    for ignored in ignored_faces:
        d = face_recognition.face_distance([ignored], encoding)[0]
        score = 1 - d
        if d < config.get("ignore_distance", 0.5):
            ignore_scores.append(score)
    best_ignore = max(ignore_scores) if ignore_scores else None

    return matches, best_ignore


def load_and_resize_raw(image_path, max_dim=None):
    with rawpy.imread(str(image_path)) as raw:
        rgb = raw.postprocess()
    if max_dim and max(rgb.shape[0], rgb.shape[1]) > max_dim:
        scale = max_dim / max(rgb.shape[0], rgb.shape[1])
        rgb = (Image.fromarray(rgb)
               .resize((int(rgb.shape[1] * scale), int(rgb.shape[0] * scale)), Image.LANCZOS))
        rgb = np.array(rgb)
    return rgb

def face_detection_attempt(rgb, model, upsample):
    face_locations = face_recognition.face_locations(
        rgb, model=model, number_of_times_to_upsample=upsample
    )
    face_locations = sorted(face_locations, key=lambda loc: loc[3])
    face_encodings = face_recognition.face_encodings(rgb, face_locations)
    return face_locations, face_encodings

def label_preview_for_encodings(face_encodings, known_faces, ignored_faces, config):
    labels = []
    for i, encoding in enumerate(face_encodings):
        matches, ignore_score = best_matches(
            encoding, known_faces, ignored_faces, config
        )
        if ignore_score and not config.get("auto_ignore", False):
            label = "#{}\nIGN?".format(i + 1)
        elif matches:
            suggestion = matches[0][0]
            label = "#{}\n{}".format(i + 1, suggestion)
        else:
            label = "#{}\nOkänd".format(i + 1)
        labels.append(label)
    return labels

def input_name(known_names):
    completer = WordCompleter(sorted(known_names), ignore_case=True, sentence=True)
    name = prompt("Ange namn (eller 'i' för ignorera, n = försök igen, x = skippa bild) › ", completer=completer)
    return name.strip()

def user_review_encodings(face_encodings, known_faces, ignored_faces, config):
    labels = []
    all_ignored = True
    retry_requested = False
    for i, encoding in enumerate(face_encodings):
        print("\nAnsikte #{}:".format(i + 1))
        matches, ignore_score = best_matches(
            encoding, known_faces, ignored_faces, config
        )
        # Ignorera-prompt
        ans = None
        if ignore_score and not config.get("auto_ignore", False):
            ans = input(
                "↪ Detta ansikte liknar ett tidigare ignorerat. [Enter = bekräfta ignorera, r = rätta, n = försök igen, x = skippa bild] › "
            ).strip().lower()
            if ans == "x":
                return "skipped", []
            if ans == "n":
                retry_requested = True
                break
            if ans != "r":
                ignored_faces.append(encoding)
                labels.append("#{}\nIGNORERAD".format(i + 1))
                continue

        # Namnförslag om match finns
        if matches:
            suggestion = matches[0][0]
            confidence = int(matches[0][1] * 100)
            prompt_txt = "↪ Föreslaget: {} ({}%)\n[Enter = bekräfta, r = rätta, n = försök igen, i = ignorera, x = skippa bild] › ".format(
                suggestion, confidence
            )
            val = input(prompt_txt).strip().lower()
            if val == "x":
                return "skipped", []
            if val == "n":
                retry_requested = True
                break
            if val == "":
                name = suggestion
                all_ignored = False
            elif val == "i":
                ignored_faces.append(encoding)
                labels.append("#{}\nIGNORERAD".format(i + 1))
                continue
            else:
                name = input_name(list(known_faces.keys()))
                if name.lower() == "x":
                    return "skipped", []
                if name.lower() == "n":
                    retry_requested = True
                    break
                if name == "i":
                    ignored_faces.append(encoding)
                    labels.append("#{}\nIGNORERAD".format(i + 1))
                    continue
                all_ignored = False
        else:
            name = input_name(list(known_faces.keys()))
            if name.lower() == "x":
                return "skipped", []
            if name.lower() == "n":
                retry_requested = True
                break
            if name == "i":
                ignored_faces.append(encoding)
                labels.append("#{}\nIGNORERAD".format(i + 1))
                continue
            all_ignored = False

        if name not in known_faces:
            known_faces[name] = []
        known_faces[name].append(encoding)
        labels.append("#{}\n{}".format(i + 1, name))

    if retry_requested:
        return "retry", []
    if all_ignored:
        return "all_ignored", []
    return "ok", labels

def main_process_image_loop(image_path, known_faces, ignored_faces, config):
    attempt_settings = [
        {"model": config.get("detection_model", "hog"), "upsample": 1, "highres": False},
        {"model": "cnn", "upsample": 0, "highres": False},
        {"model": "cnn", "upsample": 0, "highres": True},
        {"model": "hog", "upsample": 1, "highres": True},
        {"model": "cnn", "upsample": 1, "highres": True},
        {"model": "hog", "upsample": 2, "highres": True},
        {"model": "cnn", "upsample": 2, "highres": False},
    ]
    max_down = config.get("max_downsample_px", 2500)
    max_full = config.get("max_fullres_px", 6000)
    rgb_down = load_and_resize_raw(image_path, max_down)
    rgb_full = None  # Lazy-load vid behov

    shown_image = False
    attempt_idx = 0
    attempts_stats = []
    used_attempt = None

    while attempt_idx < len(attempt_settings):
        setting = attempt_settings[attempt_idx]
        if not setting.get("highres"):
            rgb = rgb_down
        else:
            if rgb_full is None:
                rgb_full = load_and_resize_raw(image_path, max_full if max_full > 0 else None)
            rgb = rgb_full

        t0 = time.time()
        if attempt_idx > 0:
            print(
                "⚙️  Försök {}: model={}, upsample={}".format(
                    attempt_idx + 1, setting["model"], setting["upsample"]
                )
            )

        face_locations, face_encodings = face_detection_attempt(
            rgb, setting["model"], setting["upsample"]
        )
        elapsed = time.time() - t0
        print(
            f"[DEBUG] Försök {attempt_idx + 1}: {setting['model']}, upsample={setting['upsample']}, tid: {elapsed:.2f} s, antal ansikten: {len(face_locations)}"
        )

        attempts_stats.append({
            "attempt_index": attempt_idx,
            "model": setting["model"],
            "upsample": setting["upsample"],
            "highres": setting["highres"],
            "time_seconds": round(elapsed, 3),
            "faces_found": len(face_encodings),
        })

        preview_labels = label_preview_for_encodings(face_encodings, known_faces, ignored_faces, config)
        if face_encodings:
            preview_path = create_labeled_image(
                rgb, face_locations, preview_labels, config
            )
            os.system(f"open -a Phoenix\\ Slides '{preview_path}'")
            review_result, labels = user_review_encodings(face_encodings, known_faces, ignored_faces, config)

            if review_result == "skipped":
                log_attempt_stats(image_path, attempts_stats, used_attempt, BASE_DIR)
                return "skipped"
            if review_result == "retry":
                attempt_idx += 1
                continue
            if review_result == "all_ignored":
                attempt_idx += 1
                continue
            if review_result == "ok":
                used_attempt = attempt_idx
                log_attempt_stats(image_path, attempts_stats, used_attempt, BASE_DIR)
                return True

        if not shown_image:
            temp_path = create_labeled_image(rgb, [], ["INGA ANSIKTEN"], config)
            os.system(f"open -a Phoenix\\ Slides '{temp_path}'")
            shown_image = True
            ans = input("⚠️  Fortsätta försöka? [Enter = ja, x = hoppa över] › ").strip().lower()
            if ans == "x":
                log_attempt_stats(image_path, attempts_stats, None)
                return "skipped"

        attempt_idx += 1

    print("⏭ Inga ansikten kunde hittas i {} , hoppar över.".format(image_path.name))
    log_attempt_stats(image_path, attempts_stats, None)
    return "no_faces"

def process_image(image_path, known_faces, ignored_faces, config):
    return main_process_image_loop(image_path, known_faces, ignored_faces, config)


# === Graceful Exit ===
def signal_handler(sig, frame):
    print("\n⏹ Avbruten. Programmet avslutas.")
    sys.exit(0)


signal.signal(signal.SIGINT, signal_handler)


# === Entry point ===
def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('path')
    parser.add_argument('--fix', nargs='*', default=None)
    args = parser.parse_args()

    config = load_config()
    known_faces, ignored_faces, processed_files = load_database()
    root = Path(args.path)

    if args.fix:
        files_to_fix = set(args.fix)
    else:
        files_to_fix = None

    for path in sorted(root.rglob("*")):
        if path.suffix not in SUPPORTED_EXT:
            continue
        if files_to_fix is not None and path.name not in files_to_fix:
            continue
        if files_to_fix is None and path.name in processed_files:
            print(f"⏭ Hoppar över tidigare behandlad fil: {path.name}")
            continue

        print(f"\n=== Bearbetar: {path.name} ===")
        result = process_image(path, known_faces, ignored_faces, config)
        if result is True or result == "no_faces" or result == "skipped":
            processed_files.add(path.name)
            save_database(known_faces, ignored_faces, processed_files)


if __name__ == "__main__":
    main()
