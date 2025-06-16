#!/usr/bin/env python
# ruff: noqa: E402

import warnings

warnings.filterwarnings("ignore", category=UserWarning, module="face_recognition_models")

import copy
import fnmatch
import hashlib
import json
import logging
import math
import multiprocessing
import os
import re
import signal
import sys
import tempfile
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import face_recognition
import matplotlib.font_manager as fm
import numpy as np
import rawpy
from PIL import Image, ImageDraw, ImageFont
from prompt_toolkit import prompt
from prompt_toolkit.completion import WordCompleter

from faceid_db import (ARCHIVE_DIR, ATTEMPT_SETTINGS_SIG, BASE_DIR,
                       CONFIG_PATH, SUPPORTED_EXT, load_attempt_log,
                       load_database, save_database)

# === CONSTANTS === #
ORDINARY_PREVIEW_PATH = "/tmp/hitta_ansikten_preview.jpg"
MAX_ATTEMPTS = 3
MAX_QUEUE = 10


# === Standardkonfiguration ===
DEFAULT_CONFIG = {
  "auto_ignore": False,
  "auto_ignore_on_fix": True,
  "detection_model": "hog",
  "font_size_factor": 45,
  "ignore_distance": 0.5,
  "image_viewer_app": "Bildvisare",
  "label_bg_color": [0, 0, 0, 192],
  "label_text_color": [255, 255, 0],
  "match_threshold": 0.6,
  "max_downsample_px": 2800,
  "max_fullres_px": 8000,
  "max_midsample_px": 4500,
  "min_confidence": 0.4,
  "padding": 15,
  "prefer_name_margin": 0.10,  # Namn måste vara minst så här mycket bättre än ignore för att vinna automatiskt
  "rectangle_thickness": 6,
  "temp_image_path": "/tmp/hitta_ansikten_preview.jpg",
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


def get_attempt_settings(config, rgb_down, rgb_mid, rgb_full):
    # All attempts i rätt ordning, parametriserat
    return [
        {"model": "cnn", "upsample": 0, "scale_label": "down", "scale_px": config["max_downsample_px"], "rgb_img": rgb_down},
        {"model": "cnn", "upsample": 0, "scale_label": "mid",  "scale_px": config["max_midsample_px"],  "rgb_img": rgb_mid},
        {"model": "cnn", "upsample": 1, "scale_label": "down", "scale_px": config["max_downsample_px"], "rgb_img": rgb_down},
        {"model": "hog", "upsample": 0, "scale_label": "full", "scale_px": config["max_fullres_px"], "rgb_img": rgb_full},
        {"model": "cnn", "upsample": 0, "scale_label": "full", "scale_px": config["max_fullres_px"], "rgb_img": rgb_full},
        {"model": "cnn", "upsample": 1, "scale_label": "mid",  "scale_px": config["max_midsample_px"],  "rgb_img": rgb_mid},
        {"model": "cnn", "upsample": 1, "scale_label": "full", "scale_px": config["max_fullres_px"], "rgb_img": rgb_full},
    ]

def get_settings_signature(attempt_settings):
    # Serialiserbar och ordningsoberoende
    as_json = json.dumps([
        {k: v for k, v in s.items() if k != "rgb_img"}
        for s in attempt_settings
    ], sort_keys=True)
    return hashlib.md5(as_json.encode("utf-8")).hexdigest()

def archive_stats_if_needed(current_sig, force=False):
    sig_path = ATTEMPT_SETTINGS_SIG
    log_path = BASE_DIR / "attempt_stats.jsonl"
    if not log_path.exists():
        sig_path.write_text(current_sig)
        return

    old_sig = sig_path.read_text().strip() if sig_path.exists() else None
    if force or (old_sig != current_sig):
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        dt_str = datetime.now().strftime("%Y%m%d-%H%M%S")
        archive_name = f"attempt_stats_{dt_str}_{old_sig or 'unknown'}.jsonl"
        archive_path = ARCHIVE_DIR / archive_name
        log_path.rename(archive_path)
        print(f"[INFO] Arkiverade statistikfil till: {archive_path}")
        sig_path.write_text(current_sig)
    else:
        # Skriv alltid signaturen för nuvarande settings
        sig_path.write_text(current_sig)

def hash_encoding(enc):
    return hashlib.sha1(enc.tobytes()).hexdigest()


def export_and_show_original(image_path, config):
    """
    Exporterar NEF-filen till högupplöst JPG och skriver en statusfil för Bildvisare-appen.
    Visar bilden i bildvisaren (om du vill).
    """
    import json
    from pathlib import Path

    import rawpy
    from PIL import Image

    export_path = Path("/tmp/hitta_ansikten_original.jpg")
    # Läs NEF, konvertera till RGB
    with rawpy.imread(str(image_path)) as raw:
        rgb = raw.postprocess()

    img = Image.fromarray(rgb)
    img.save(export_path, format="JPEG", quality=98)

    status_path = Path.home() / "Library" / "Application Support" / "bildvisare" / "original_status.json"
    status = {
        "timestamp": time.time(),
        "source_nef": str(image_path),
        "exported_jpg": str(export_path)
    }
    with open(status_path, "w") as f:
        json.dump(status, f, indent=2)

    # Visa bilden (eller låt bildvisaren själv ladda in statusfilen)
    # os.system(f"open -a '{config.get('image_viewer_app', 'Bildvisare')}' '{export_path}'")


def show_temp_image(preview_path, config, last_shown=[None]):
    import subprocess
    viewer_app = config.get("image_viewer_app")
    status_path = Path.home() / "Library" / "Application Support" / "bildvisare" / "status.json"
    expected_path = str(Path(preview_path).resolve())

    should_open = True  # Default: öppna om osäkert

    if status_path.exists():
        try:
            with open(status_path, "r") as f:
                status = json.load(f)
            if status.get("app_status") == "running" and os.path.samefile(status.get("file_path", ""), expected_path):
                should_open = False  # Bildvisare kör redan och visar rätt fil
                logging.debug(f"[BILDVISARE] Bildvisaren visar redan rätt fil: {expected_path}")

            elif status.get("app_status") == "exited":
                should_open = True
            else:
                should_open = True
        except Exception:
            should_open = True

    if should_open:
        logging.debug(f"[BILDVISARE] Öppnar bild i visare: {expected_path}")
        subprocess.Popen(["open", "-a", viewer_app, preview_path])
        last_shown[0] = preview_path
    else:
        logging.debug(f"[BILDVISARE] Hoppar över open; rätt bild visas redan: {expected_path}")
        last_shown[0] = preview_path


def safe_input(prompt_text, completer=None):
    """
    Wrapper för både vanlig input och prompt_toolkit.prompt, med graceful exit.
    Om completer anges, används prompt_toolkit.prompt, annars vanlig input().
    """
    try:
        if completer is not None:
            from prompt_toolkit import prompt
            return prompt(prompt_text, completer=completer)
        else:
            return input(prompt_text)
    except KeyboardInterrupt:
        print("\n⏹ Avbruten. Programmet avslutas.")
        sys.exit(0)

def parse_inputs(args, supported_ext):
    seen = set()  # för att undvika dubbletter
    for arg in args:
        path = Path(arg)
        if path.is_dir():
            # Generator för rekursivt genomgång av katalog
            for f in path.rglob("*"):
                if f.suffix in supported_ext and f.is_file() and f not in seen:
                    seen.add(f)
                    yield f.resolve()
        elif "*" in arg or "?" in arg or "[" in arg:
            for f in Path(".").glob(arg):
                if f.suffix in supported_ext and f.is_file() and f not in seen:
                    seen.add(f)
                    yield f.resolve()
        elif arg == ".":
            for f in Path(".").rglob("*"):
                if f.suffix in supported_ext and f.is_file() and f not in seen:
                    seen.add(f)
                    yield f.resolve()
        elif path.is_file() and path.suffix in supported_ext:
            if path.resolve() not in seen:
                seen.add(path.resolve())
                yield path.resolve()
        else:
            for f in Path(".").rglob("*"):
                if fnmatch.fnmatch(f.name, arg) and f.suffix in supported_ext and f.is_file() and f not in seen:
                    seen.add(f)
                    yield f.resolve()


def log_attempt_stats(
    image_path,
    attempts,
    used_attempt_idx,
    base_dir=None,
    log_name="attempt_stats.jsonl",
    review_results=None,
    labels_per_attempt=None
):
    """
    Spara attempts-statistik för en bild till en JSONL-fil i base_dir.
    :param image_path: Path till bilden.
    :param attempts: Lista med dict för varje attempt.
    :param used_attempt_idx: Index (int) för attempt som blev det faktiska valet (eller None om ingen).
    :param base_dir: Path till katalogen där loggfilen ska finnas (om None: '.').
    :param log_name: Filnamn på loggfilen.
    :param review_results: Lista med user_review_encodings-resultat per attempt, t.ex. ["ok", "retry", ...]
    :param labels_per_attempt: Lista av etikettlistor (labels från varje attempt).
    """
    from pathlib import Path
    if base_dir is None:
        base_dir = Path(".")
    log_entry = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "filename": str(image_path),
        "attempts": attempts,
        "used_attempt": used_attempt_idx
    }
    if review_results is not None:
        log_entry["review_results"] = review_results
    if labels_per_attempt is not None:
        log_entry["labels_per_attempt"] = labels_per_attempt
    log_path = Path(base_dir) / log_name
    Path(base_dir).mkdir(parents=True, exist_ok=True)
    with open(log_path, "a") as f:
        f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")


def get_match_label(i, best_name, best_name_dist, name_conf, best_ignore, best_ignore_dist, ign_conf, config):
    name_thr = config.get("match_threshold")
    ignore_thr = config.get("ignore_distance")
    margin = config.get("prefer_name_margin")

    # Fall: båda nära, inom margin
    if (
        best_name is not None and best_name_dist is not None and best_name_dist < name_thr and
        best_ignore_dist is not None and best_ignore_dist < ignore_thr and
        abs(best_name_dist - best_ignore_dist) < margin
    ):
        if best_name_dist < best_ignore_dist:
            return f"#%d\n{best_name} / ign" % (i + 1), "uncertain_name"
        else:
            return f"#%d\nign / {best_name}" % (i + 1), "uncertain_ign"

    # Fall: namn vinner klart
    elif (
        best_name is not None and best_name_dist is not None and best_name_dist < name_thr and
        (best_ignore_dist is None or best_name_dist < best_ignore_dist - margin)
    ):
        return f"#%d\n{best_name}" % (i + 1), "name"

    # Fall: ign vinner klart
    elif (
        best_ignore_dist is not None and best_ignore_dist < ignore_thr and
        (best_name_dist is None or best_ignore_dist < best_name_dist - margin)
    ):
        return "#%d\nign" % (i + 1), "ign"

    # Fall: *ingen* tillräckligt nära (okänt)
    else:
        return "#%d\nOkänt" % (i + 1), "unknown"

def label_preview_for_encodings(face_encodings, known_faces, ignored_faces, config):
    labels = []
    for i, encoding in enumerate(face_encodings):
        (best_name, best_name_dist), (best_ignore, best_ignore_dist) = best_matches(
            encoding, known_faces, ignored_faces, config
        )
        name_conf = int((1 - best_name_dist) * 100) if best_name_dist is not None else None
        ign_conf = int((1 - best_ignore_dist) * 100) if best_ignore_dist is not None else None
        label, _ = get_match_label(i, best_name, best_name_dist, name_conf, best_ignore, best_ignore_dist, ign_conf, config)
        labels.append(label)
    return labels

def user_review_encodings(face_encodings, known_faces, ignored_faces, config, image_path=None, preview_path=None):
    labels = []
    all_ignored = True
    retry_requested = False

    margin = config["prefer_name_margin"]
    name_thr = config["match_threshold"]
    ignore_thr = config["ignore_distance"]

    for i, encoding in enumerate(face_encodings):
        name = None
        print("\nAnsikte #{}:".format(i + 1))
        (best_name, best_name_dist), (best_ignore, best_ignore_dist) = best_matches(
            encoding, known_faces, ignored_faces, config
        )
        name_confidence = int((1 - best_name_dist) * 100) if best_name_dist is not None else None
        ignore_confidence = int((1 - best_ignore_dist) * 100) if best_ignore_dist is not None else None

        # --- 1. Osäkert: Båda nära, inom margin ---
        if (
            best_name is not None and best_name_dist is not None and best_name_dist < name_thr and
            best_ignore_dist is not None and best_ignore_dist < ignore_thr and
            abs(best_name_dist - best_ignore_dist) < margin
        ):
            if best_name_dist < best_ignore_dist:
                # Namn är snäppet närmare
                prompt_txt = (f"↪ Osäkert: {best_name} ({name_confidence}%) / ign ({ignore_confidence}%)\n"
                              "[Enter = bekräfta namn, i = ignorera, r = rätta, n = försök igen, o = öppna original, x = skippa bild] › ")
                default_action = "name"
            else:
                # IGN är snäppet närmare
                prompt_txt = (f"↪ Osäkert: ign ({ignore_confidence}%) / {best_name} ({name_confidence}%)\n"
                              "[Enter = bekräfta ignorera, n = försök igen, r = rätta, a = acceptera namn, o = öppna original, x = skippa bild] › ")
                default_action = "ign"

            while True:
                ans = safe_input(prompt_txt).strip().lower()
                if ans == "o" and preview_path is not None:
                    show_temp_image(preview_path, config)
                    continue
                if ans == "o" and image_path is not None:
                    export_and_show_original(image_path, config)
                    continue
                if default_action == "name":
                    if ans == "x":
                        return "skipped", []
                    if ans == "n":
                        retry_requested = True
                        break
                    if ans == "i":
                        ignored_faces.append(encoding)
                        labels.append({"label": "#{}\nignorerad".format(i + 1), "hash": hash_encoding(encoding)})
                        break
                    elif ans == "r":
                        name = input_name(list(known_faces.keys()))
                        if name.lower() == "x":
                            return "skipped", []
                        if name.lower() == "n":
                            retry_requested = True
                            break
                        if name == "i":
                            ignored_faces.append(encoding)
                            labels.append({"label": "#{}\nignorerad".format(i + 1), "hash": hash_encoding(encoding)})
                            break
                        all_ignored = False
                        break
                    else:
                        name = best_name
                        all_ignored = False
                        break
                else:
                    if ans == "x":
                        return "skipped", []
                    if ans == "n":
                        retry_requested = True
                        break
                    if ans == "a":
                        name = best_name
                        all_ignored = False
                        break
                    elif ans == "r":
                        name = input_name(list(known_faces.keys()))
                        if name.lower() == "x":
                            return "skipped", []
                        if name.lower() == "n":
                            retry_requested = True
                            break
                        if name == "i":
                            ignored_faces.append(encoding)
                            labels.append({"label": "#{}\nignorerad".format(i + 1), "hash": hash_encoding(encoding)})
                            break
                        all_ignored = False
                        break
                    else:
                        ignored_faces.append(encoding)
                        labels.append({"label": "#{}\nignorerad".format(i + 1), "hash": hash_encoding(encoding)})
                        break
            if retry_requested:
                break

        # --- 2. Namn vinner klart ---
        elif (
            best_name is not None and best_name_dist is not None and best_name_dist < name_thr and
            (best_ignore_dist is None or best_name_dist < best_ignore_dist - margin)
        ):
            prompt_txt = f"↪ Föreslaget: {best_name} ({name_confidence}%)\n[Enter = bekräfta, r = rätta, n = försök igen, i = ignorera, o = öppna original, x = skippa bild] › "
            while True:
                val = safe_input(prompt_txt).strip().lower()
                if val == "o" and image_path is not None:
                    export_and_show_original(image_path, config)
                    continue
                if val == "x":
                    return "skipped", []
                if val == "n":
                    retry_requested = True
                    break
                if val == "":
                    name = best_name
                    all_ignored = False
                    break
                elif val == "i":
                    ignored_faces.append(encoding)
                    labels.append({"label": "#{}\nignorerad".format(i + 1), "hash": hash_encoding(encoding)})
                    break
                elif val == "r":
                    name = input_name(list(known_faces.keys()))
                    if name.lower() == "x":
                        return "skipped", []
                    if name.lower() == "n":
                        retry_requested = True
                        break
                    if name == "i":
                        ignored_faces.append(encoding)
                        labels.append({"label": "#{}\nignorerad".format(i + 1), "hash": hash_encoding(encoding)})
                        break
                    all_ignored = False
                    break
            if retry_requested:
                break

        # --- 3. IGN vinner klart ---
        elif (
            best_ignore_dist is not None and best_ignore_dist < ignore_thr and
            (best_name_dist is None or best_ignore_dist < best_name_dist - margin)
        ):
            prompt_txt = f"↪ Ansiktet liknar ett tidigare ignorerat ({ignore_confidence}%). [Enter = bekräfta ignorera, r = rätta, n = försök igen, a = acceptera namn, o = öppna original, x = skippa bild] › "
            while True:
                ans = safe_input(prompt_txt).strip().lower()
                if ans == "o" and image_path is not None:
                    export_and_show_original(image_path, config)
                    continue
                if ans == "x":
                    return "skipped", []
                if ans == "n":
                    retry_requested = True
                    break
                if ans == "a":
                    name = best_name if best_name else input_name(list(known_faces.keys()))
                    all_ignored = False
                    break
                elif ans == "r":
                    name = input_name(list(known_faces.keys()))
                    if name.lower() == "x":
                        return "skipped", []
                    if name.lower() == "n":
                        retry_requested = True
                        break
                    if name == "i":
                        ignored_faces.append(encoding)
                        labels.append({"label": "#{}\nignorerad".format(i + 1), "hash": hash_encoding(encoding)})
                        break
                    all_ignored = False
                    break
                else:
                    ignored_faces.append(encoding)
                    labels.append({"label": "#{}\nignorerad".format(i + 1), "hash": hash_encoding(encoding)})
                    break
            if retry_requested:
                break

        # --- 4. Okänd ---
        else:
            prompt_txt = "↪ Okänt ansikte. Ange namn (eller 'i' för ignorera, n = försök igen, o = öppna original, x = skippa bild) › "
            while True:
                name = input_name(list(known_faces.keys()), prompt_txt)
                if name.lower() == "o" and image_path is not None:
                    export_and_show_original(image_path, config)
                    continue
                if name.lower() == "x":
                    return "skipped", []
                if name.lower() == "n":
                    retry_requested = True
                    break
                if name.lower() == "i":
                    ignored_faces.append(encoding)
                    labels.append({"label": "#{}\nignorerad".format(i + 1), "hash": hash_encoding(encoding)})
                    break
                all_ignored = False
                break
            if retry_requested:
                break

        if name is not None and name.lower() not in {"i", "x", "n", "o"}:
            if name not in known_faces:
                known_faces[name] = []
            known_faces[name].append(encoding)
            labels.append({"label": "#{}\n{}".format(i + 1, name), "hash": hash_encoding(encoding)})

    if retry_requested:
        return "retry", []
    if all_ignored:
        return "all_ignored", []
    return "ok", labels

def box_overlaps_with_buffer(b1, b2, buffer=40):
    l1, t1, r1, b1_ = b1
    l2, t2, r2, b2_ = b2
    return not (r1 + buffer <= l2 - buffer or
                l1 - buffer >= r2 + buffer or
                b1_ + buffer <= t2 - buffer or
                t1 - buffer >= b2_ + buffer)

def robust_word_wrap(label_text, max_label_width, draw, font):
    lines = []
    text = label_text
    while text:
        for cut in range(len(text), 0, -1):
            trial = text[:cut]
            bbox = draw.textbbox((0, 0), trial, font=font)
            line_width = bbox[2] - bbox[0]
            if line_width <= max_label_width or cut == 1:
                lines.append(trial.strip())
                text = text[cut:].lstrip()
                break
    return lines


# === Funktion för att skapa tempbild med etiketter ===
def create_labeled_image(rgb_image, face_locations, labels, config, suffix=""):

    from PIL import Image

    font_size = max(10, rgb_image.shape[1] // config.get("font_size_factor"))
    font_path = fm.findfont(fm.FontProperties(family="DejaVu Sans"))
    font = ImageFont.truetype(font_path, font_size)
    bg_color = tuple(config.get("label_bg_color"))
    text_color = tuple(config.get("label_text_color"))

    orig_height, orig_width = rgb_image.shape[0:2]
    max_label_width = orig_width // 3
    margin = 50
    buffer = 40  # px skyddszon runt alla lådor

    # Hjälpfunktioner
    # Dummy draw for measuring text size
    draw_temp = ImageDraw.Draw(Image.new("RGB", (orig_width, orig_height)), "RGBA")
    placements = []
    placed_boxes = []

    for i, (top, right, bottom, left) in enumerate(face_locations):
        face_box = (left, top, right, bottom)
        placed_boxes.append(face_box)

        label_text = "{} {}".format(labels[i].split('\n')[0], labels[i].split('\n')[1]) if "\n" in labels[i] else labels[i]
        lines = robust_word_wrap(label_text, max_label_width, draw_temp, font)
        line_sizes = [draw_temp.textbbox((0, 0), line, font=font) for line in lines]
        text_width = max(b[2] - b[0] for b in line_sizes) + 10
        text_height = font_size * len(lines) + 4

        # Siffran, ovanför ansiktslådan om plats
        num_font_size = max(12, font_size // 2)
        num_font = ImageFont.truetype(font_path, num_font_size)
        num_text = f"#{i+1}"
        num_text_bbox = draw_temp.textbbox((0, 0), num_text, font=num_font)
        num_text_w = num_text_bbox[2] - num_text_bbox[0]
        num_text_h = num_text_bbox[3] - num_text_bbox[1]
        num_x = left
        num_y = top - num_text_h - 4
        num_box = (num_x, num_y, num_x + num_text_w, num_y + num_text_h)

        # ----- Hitta etikettposition -----
        found = False
        # Pröva ringar/cirklar längre och längre bort
        cx = (left + right) // 2
        cy = (top + bottom) // 2
        for radius in range(max((bottom-top), (right-left)) + margin, max(orig_width, orig_height) * 2, 25):
            for angle in range(0, 360, 10):
                radians = math.radians(angle)
                lx = int(cx + radius * math.cos(radians) - text_width // 2)
                ly = int(cy + radius * math.sin(radians) - text_height // 2)
                label_box = (lx, ly, lx + text_width, ly + text_height)
                # Får inte krocka med någon befintlig låda (inkl. buffer)
                collision = False
                for box in placed_boxes:
                    if box_overlaps_with_buffer(label_box, box, buffer):
                        collision = True
                        break
                if not collision:
                    found = True
                    break
            if found:
                break
        # Om ingen plats finns ens utanför – låt etiketten ligga långt ut (canvas expanderas sen)
        if not found:
            lx = -text_width - margin
            ly = -text_height - margin
            label_box = (lx, ly, lx + text_width, ly + text_height)
        placed_boxes.append(label_box)
        placements.append({
            "face_box": face_box,
            "label_box": label_box,
            "num_box": num_box,
            "lines": lines,
            "num_text": num_text,
            "num_font": num_font,
            "text_width": text_width,
            "text_height": text_height,
            "label_pos": (lx, ly),
        })

    # 2. Beräkna nödvändigt canvas-storlek utifrån alla etikettboxar
    min_x = 0
    min_y = 0
    max_x = orig_width
    max_y = orig_height
    for p in placements:
        for box in [p["label_box"], p["num_box"]]:
            min_x = min(min_x, box[0])
            min_y = min(min_y, box[1])
            max_x = max(max_x, box[2])
            max_y = max(max_y, box[3])
    offset_x = -min_x
    offset_y = -min_y
    canvas_width = max_x - min_x
    canvas_height = max_y - min_y

    canvas = Image.new("RGB", (canvas_width, canvas_height), (20, 20, 20))
    canvas.paste(Image.fromarray(rgb_image), (offset_x, offset_y))
    draw = ImageDraw.Draw(canvas, "RGBA")

    # Rita allt på nya canvasen
    for p in placements:
        # Ansiktslåda
        face_box = tuple(x + offset if i % 2 == 0 else x + offset_y for i, (x, offset) in enumerate(zip(p["face_box"], (offset_x, offset_y, offset_x, offset_y))))
        draw.rectangle([face_box[0], face_box[1], face_box[2], face_box[3]],
                       outline="red",
                       width=config.get("rectangle_thickness", 6))

        # Etikett
        lx, ly = p["label_pos"]
        lx += offset_x
        ly += offset_y
        draw.rectangle([lx, ly, lx + p["text_width"], ly + p["text_height"]], fill=bg_color)
        y_offset = 2
        for line in p["lines"]:
            draw.text((lx + 5, ly + y_offset), line, fill=text_color, font=font)
            y_offset += font_size

        # Nummer
        nb = p["num_box"]
        nb_off = (nb[0] + offset_x, nb[1] + offset_y, nb[2] + offset_x, nb[3] + offset_y)
        draw.rectangle(nb_off, fill=(0, 0, 0, 180))
        draw.text((nb_off[0], nb_off[1]), p["num_text"], fill=(255,255,0), font=p["num_font"])

        # Pil
        face_cx = (face_box[0] + face_box[2]) // 2
        face_cy = (face_box[1] + face_box[3]) // 2
        label_cx = lx + p["text_width"] // 2
        label_cy = ly + p["text_height"] // 2
        draw.line([(face_cx, face_cy), (label_cx, label_cy)], fill="yellow", width=2)

    temp_dir = os.path.dirname(config.get("temp_image_path", "/tmp/hitta_ansikten_preview.jpg"))
    temp_prefix = "hitta_ansikten_preview"
    temp_suffix = f"{suffix}.jpg" if suffix else ".jpg"

    with tempfile.NamedTemporaryFile(prefix=temp_prefix, suffix=temp_suffix, dir=temp_dir, delete=False) as tmp:
        canvas.save(tmp.name, format="JPEG")
        return tmp.name

# === Beräkna avstånd till kända encodings ===
def best_matches(encoding, known_faces, ignored_faces, config):
    """
    Returnerar:
        (best_name, best_name_dist), (best_ignore_idx, best_ignore_dist)
    där dist är lägre = bättre.
    """
    best_name = None
    best_name_dist = None
    best_ignore = None
    best_ignore_dist = None

    # Namnmatch
    for name, encs in known_faces.items():
        if not encs:
            continue  # Skippa namn utan encodings
        dists = face_recognition.face_distance(encs, encoding)
        min_dist = np.min(dists)
        if best_name_dist is None or min_dist < best_name_dist:
            best_name_dist = min_dist
            best_name = name

    # Ignore-match
    for idx, ignored in enumerate(ignored_faces):
        d = face_recognition.face_distance([ignored], encoding)[0]
        if best_ignore_dist is None or d < best_ignore_dist:
            best_ignore_dist = d
            best_ignore = idx

    return (best_name, best_name_dist), (best_ignore, best_ignore_dist)


def load_and_resize_raw(image_path, max_dim=None):
    """
    Läser och eventuellt nedskalar RAW-bild till max_dim (längsta sida).
    Om max_dim=None returneras full originalstorlek.
    """
    with rawpy.imread(str(image_path)) as raw:
        rgb = raw.postprocess()
    if max_dim and max(rgb.shape[0], rgb.shape[1]) > max_dim:
        scale = max_dim / max(rgb.shape[0], rgb.shape[1])
        rgb = (Image.fromarray(rgb)
               .resize((int(rgb.shape[1] * scale), int(rgb.shape[0] * scale)), Image.LANCZOS))
        rgb = np.array(rgb)
    return rgb

def face_detection_attempt(rgb, model, upsample):
    t0 = time.time()
    logging.debug(f"[FACEDETECT] begins : model={model}, upsample={upsample}, time {t0}")
    face_locations = face_recognition.face_locations(
        rgb, model=model, number_of_times_to_upsample=upsample
    )
    t1 = time.time()
    face_locations = sorted(face_locations, key=lambda loc: loc[3])
    logging.debug(f"[FACEDETECT] Have locations at time {t1}")
    face_encodings = face_recognition.face_encodings(rgb, face_locations)
    t2 = time.time()
    logging.debug(f"[FACEDETECT] Have encodings at time {t2}")
    return face_locations, face_encodings

def input_name(known_names, prompt_txt="Ange namn (eller 'i' för ignorera, n = försök igen, x = skippa bild) › "):
    completer = WordCompleter(sorted(known_names), ignore_case=True, sentence=True)
    try:
        name = prompt(prompt_txt, completer=completer)
        return name.strip()
    except (KeyboardInterrupt, EOFError):
        print("\n⏹ Avbruten. Programmet avslutas.")
        sys.exit(0)


def remove_encodings_for_file(known_faces, ignored_faces, identifier):
    """
    Tar bort ALLA encodings (via hash) som mappats från just denna fil.
    identifier kan vara filnamn (str), hash (str), eller lista av dessa.
    Returnerar antal borttagna encodings.
    """
    log = load_attempt_log()
    hashes_to_remove = []
    labels_by_hash = {}
    # Stöd för flera identifierare
    if isinstance(identifier, str):
        identifiers = [identifier]
    else:
        identifiers = list(identifier)
    # Samla hashar från alla labels_per_attempt för matchande entry
    for entry in log:
        entry_fname = Path(entry.get("filename", "")).name
        entry_hash = entry.get("file_hash")  # För framtida utbyggnad, logga hash per entry!
        match = entry_fname in identifiers or (entry_hash and entry_hash in identifiers)
        if match:
            for attempt in entry.get("labels_per_attempt", []):
                for lbl in attempt:
                    if isinstance(lbl, dict) and "hash" in lbl:
                        hashes_to_remove.append(lbl["hash"])
                        labelstr = lbl.get("label", "")
                        namn = labelstr.split("\n")[1] if "\n" in labelstr else None
                        labels_by_hash[lbl["hash"]] = namn
    # Ta bort encodings från ignored_faces (matcha via hash)
    removed = 0
    for hashval in hashes_to_remove:
        idx_to_del = None
        for idx, enc in enumerate(ignored_faces):
            if hash_encoding(enc) == hashval:
                idx_to_del = idx
                break
        if idx_to_del is not None:
            del ignored_faces[idx_to_del]
            removed += 1
    # Ta bort från known_faces
    for hashval, namn in labels_by_hash.items():
        if namn and namn != "ignorerad" and namn in known_faces:
            idx_to_del = None
            for idx, enc in enumerate(known_faces[namn]):
                if hash_encoding(enc) == hashval:
                    idx_to_del = idx
                    break
            if idx_to_del is not None:
                del known_faces[namn][idx_to_del]
                removed += 1
    return removed

def preprocess_image(image_path, known_faces, ignored_faces, config, max_attempts=3):
    logging.debug("preprocess_image: START")

    try:
        max_down = config.get("max_downsample_px")
        max_mid = config.get("max_midsample_px")
        max_full = config.get("max_fullres_px")
        logging.debug(" Före load_and_resize_raw: down")
        rgb_down = load_and_resize_raw(image_path, max_down)
        logging.debug(" Före load_and_resize_raw: mid")
        rgb_mid = load_and_resize_raw(image_path, max_mid)
        logging.debug(" Före load_and_resize_raw: full")
        rgb_full = load_and_resize_raw(image_path, max_full)

        logging.debug(" Före get_attempt_settings")
        attempt_settings = get_attempt_settings(config, rgb_down, rgb_mid, rgb_full)
        logging.debug(" Efter get_attempt_settings")
    except Exception as e:
        logging.warning(f"[RAWREAD][SKIP] Kunde inte öppna {image_path}: {e}")
        return []   # eller returnera vad du vill (tom lista signalerar 'skip')

    attempt_results = []
    for attempt_idx, setting in enumerate(attempt_settings):
        logging.debug(f" Attempt {attempt_idx}: start")
        rgb = setting["rgb_img"]
        t0 = time.time()
        logging.debug(f" Attempt {attempt_idx}: face_detection_attempt")
        face_locations, face_encodings = face_detection_attempt(
            rgb, setting["model"], setting["upsample"]
        )
        logging.debug(f" Attempt {attempt_idx}: label_preview_for_encodings")
        preview_labels = label_preview_for_encodings(
            face_encodings, known_faces, ignored_faces, config
        )
        logging.debug(f" Attempt {attempt_idx}: create_labeled_image")
        preview_path = create_labeled_image(
            rgb, face_locations, preview_labels, config, suffix=f"_preview_{attempt_idx}"
        )
        elapsed = time.time() - t0
        logging.debug(f" Attempt {attempt_idx}: done ({elapsed:.2f}s)")

        attempt_results.append({
            "attempt_index": attempt_idx,
            "model": setting["model"],
            "upsample": setting["upsample"],
            "scale_label": setting["scale_label"],
            "scale_px": setting["scale_px"],
            "time_seconds": round(elapsed, 3),
            "faces_found": len(face_encodings),
            "face_locations": face_locations,
            "face_encodings": face_encodings,
            "preview_labels": preview_labels,
            "preview_path": preview_path,
        })

        if attempt_idx + 1 >= max_attempts:
            break

    logging.debug(" preprocess_image: END")
    return attempt_results


def main_process_image_loop(image_path, known_faces, ignored_faces, config, attempt_results):
    """
    Review-loop för en redan preprocessad bild (med attempt_results).
    """
    attempt_idx = 0
    attempts_stats = []
    used_attempt = None
    review_results = []
    labels_per_attempt = []
    # Hårdkodad maxgräns om du vill
    max_possible_attempts = config.get("max_attempts", MAX_ATTEMPTS)

    while attempt_idx < len(attempt_results):
        logging.debug(f"[NLOOP] attempt_idx={attempt_idx}, len(attempt_results)={len(attempt_results)}")

        res = attempt_results[attempt_idx]
        print(
            f"⚙️  Försök {attempt_idx + 1}: model={res['model']}, upsample={res['upsample']}, "
            f"scale={res['scale_label']} ({res['scale_px']}px)"
        )
        face_encodings = res["face_encodings"]
        face_locations = res["face_locations"]
        preview_path = res["preview_path"]
        res["preview_labels"]
        elapsed = res["time_seconds"]

        print(
            f"    [DEBUG] Försök {attempt_idx + 1}: {res['model']}, upsample={res['upsample']}, "
            f"scale={res['scale_label']}, tid: {elapsed:.2f} s, antal ansikten: {len(face_locations)}"
        )
        attempts_stats.append({
            "attempt_index": attempt_idx,
            "model": res["model"],
            "upsample": res["upsample"],
            "scale_label": res["scale_label"],
            "scale_px": res["scale_px"],
            "time_seconds": elapsed,
            "faces_found": len(face_encodings),
        })

        if face_encodings:

            import shutil
            ORDINARY_PREVIEW_PATH = config.get("ordinary_preview_path", "/tmp/hitta_ansikten_preview.jpg")
            try:
                shutil.copy(preview_path, ORDINARY_PREVIEW_PATH)
            except Exception as e:
                print(f"[WARN] Kunde inte kopiera preview till {ORDINARY_PREVIEW_PATH}: {e}")
            show_temp_image(ORDINARY_PREVIEW_PATH, config)

            review_result, labels = user_review_encodings(
                face_encodings, known_faces, ignored_faces, config, image_path
            )
            review_results.append(review_result)
            labels_per_attempt.append(labels)

            if review_result == "skipped":
                log_attempt_stats(
                    image_path, attempts_stats, used_attempt, BASE_DIR,
                    review_results=review_results, labels_per_attempt=labels_per_attempt
                )
                return "skipped"
            if review_result == "retry":
                attempt_idx += 1
                if attempt_idx >= len(attempt_results) and attempt_idx < max_possible_attempts:
                    new_results = preprocess_image(image_path, known_faces, ignored_faces, config, max_attempts=attempt_idx+1)
                    attempt_results.extend(new_results[len(attempt_results):])
                continue
            if review_result == "all_ignored":
                attempt_idx += 1
                continue
            if review_result == "ok":
                used_attempt = attempt_idx
                log_attempt_stats(
                    image_path, attempts_stats, used_attempt, BASE_DIR,
                    review_results=review_results, labels_per_attempt=labels_per_attempt
                )
                return True
        else:
            import shutil
            ORDINARY_PREVIEW_PATH = config.get("ordinary_preview_path", "/tmp/hitta_ansikten_preview.jpg")
            # Om inga ansikten hittades i attempt – logga ändå
            review_results.append("no_faces")
            labels_per_attempt.append([])

            temp_path = res["preview_path"]

            try:
                shutil.copy(temp_path, ORDINARY_PREVIEW_PATH)
            except Exception as e:
                print(f"[WARN] Kunde inte kopiera preview till {ORDINARY_PREVIEW_PATH}: {e}")
            show_temp_image(ORDINARY_PREVIEW_PATH, config)
            show_temp_image(temp_path, config)
            ans = safe_input("⚠️  Fortsätta försöka? [Enter = ja, n = försök nästa nivå, x = hoppa över] › ").strip().lower()
            if ans == "x":
                log_attempt_stats(
                    image_path, attempts_stats, used_attempt, BASE_DIR,
                    review_results=review_results, labels_per_attempt=labels_per_attempt
                )
                return "skipped"
            elif ans == "n" or ans == "":
                attempt_idx += 1
                if attempt_idx >= len(attempt_results) and attempt_idx < max_possible_attempts:
                    logging.debug(f"[NLOOP] Genererar nytt attempt, idx={attempt_idx}")
                    new_results = preprocess_image(image_path, known_faces, ignored_faces, config, max_attempts=attempt_idx+1)
                    attempt_results.extend(new_results[len(attempt_results):])
                continue

        attempt_idx += 1

    print("⏭ Inga ansikten kunde hittas i {} , hoppar över.".format(image_path.name))
    log_attempt_stats(
        image_path, attempts_stats, None, BASE_DIR,
        review_results=review_results, labels_per_attempt=labels_per_attempt
    )
    return "no_faces"


def process_image(image_path, known_faces, ignored_faces, config):
    attempt_results = preprocess_image(image_path, known_faces, ignored_faces, config, max_attempts=1)

    return main_process_image_loop(image_path, known_faces, ignored_faces, config, attempt_results)


def extract_prefix_suffix(fname):
    """
    Returnera (prefix, suffix) där prefix = YYMMDD_HHMMSS eller YYMMDD_HHMMSS-2,
    suffix = .NEF
    """
    m = re.match(r"^(\d{6}_\d{6}(?:-\d+)?)(?:_[^.]*)?(\.NEF)$", fname, re.IGNORECASE)
    if not m:
        return None, None
    return m.group(1), m.group(2)

def is_unrenamed(fname):
    """Returnera True om filnamn är YYMMDD_HHMMSS.NEF eller YYMMDD_HHMMSS-1.NEF etc."""
    prefix, suffix = extract_prefix_suffix(fname)
    return bool(prefix and suffix)

def collect_persons_for_files(filelist, known_faces):
    """
    Gå igenom processade stats och returnera en dict:
    { filename: [namn, ...] }
    """
    log = load_attempt_log()
    result = {}
    # Gör om till map: filename → senaste 'labels_per_attempt' med review_result OK
    stats_map = {}
    for entry in log:
        fn = Path(entry.get("filename", "")).name
        # Sök efter "used_attempt" och review_results
        if entry.get("used_attempt") is not None and entry.get("review_results"):
            idx = entry["used_attempt"]
            if idx < len(entry.get("labels_per_attempt", [])):
                res = entry["review_results"][idx]
                labels = entry["labels_per_attempt"][idx]
                if res == "ok" and labels:
                    stats_map[fn] = labels
    for fname in filelist:
        persons = []
        labels = stats_map.get(Path(fname).name)
        if labels:
            for lbl in labels:
                label = lbl["label"] if isinstance(lbl, dict) else lbl
                # Plocka ut namn ur label: "#1\nNamn", etc
                if "\n" in label:
                    namn = label.split("\n", 1)[1]
                    if namn.lower() not in ("ignorerad", "ign", "okänt", "okant"):
                        persons.append(namn)
        result[Path(fname).name] = persons
    return result

def normalize_name(name):
    # Tar bort diakritik och konverterar t.ex. Källa → Kalla, François → Francois
    n = unicodedata.normalize('NFKD', name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    # Om du vill: ta även bort andra icke-bokstäver (ej nödvändigt om du vill ha ÅÄÖ → AAOO, etc)
    return n

def split_fornamn_efternamn(namn):
    # "Edvin Twedmark" => "Edvin", "Twedmark"
    parts = namn.strip().split()
    if len(parts) < 2:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])

def resolve_fornamn_dubletter(all_persons):
    """
    all_persons: lista av alla personnamn (kan förekomma flera gånger)
    Returnerar dict namn → kortnamn (bara förnamn, eller förnamn+efternamnsbokstav om flera delar efternamn).
    """
    # Skapa map förnamn -> set av fulla namn (dvs. efternamn)
    fornamn_map = {}
    namn_map = {}
    for namn in set(all_persons):
        fornamn, efternamn = split_fornamn_efternamn(namn)
        if fornamn not in fornamn_map:
            fornamn_map[fornamn] = set()
        fornamn_map[fornamn].add(efternamn)
        namn_map[namn] = (fornamn, efternamn)
    # Bestäm för varje namn: bara förnamn om unikt, annars förnamn+efternamnsbokstav(ar)
    kortnamn = {}
    for namn, (fornamn, efternamn) in namn_map.items():
        efternamnset = fornamn_map[fornamn] - {""}
        if len(efternamnset) <= 1:
            # Endast ett efternamn för detta förnamn → endast förnamn behövs
            kortnamn[namn] = fornamn
        else:
            # Flera olika efternamn: bygg så många tecken från efternamn som krävs
            andra_efternamn = sorted(efternamnset - {efternamn})
            prefixlen = 1
            while any(efternamn[:prefixlen] == andra[:prefixlen] for andra in andra_efternamn):
                prefixlen += 1
            kortnamn[namn] = fornamn + (efternamn[:prefixlen] if efternamn else "")
    return kortnamn

def build_new_filename(fname, personer, namnmap):
    prefix, suffix = extract_prefix_suffix(fname)
    if not (prefix and suffix):
        return None
    fornamn_lista = []
    for namn in personer:
        kort = namnmap.get(namn)
        if kort:
            fornamn_lista.append(normalize_name(kort))
    if not fornamn_lista:
        return None
    namnstr = ",_".join(fornamn_lista)
    return f"{prefix}_{namnstr}{suffix}"

def is_file_processed(path, processed_files):
    """Kolla om filen redan är processad, genom namn eller hash."""
    path_name = path.name
    path_hash = None
    try:
        with open(path, "rb") as f:
            import hashlib
            path_hash = hashlib.sha1(f.read()).hexdigest()
    except Exception:
        pass
    for entry in processed_files:
        ename = entry.get("name") if isinstance(entry, dict) else entry
        ehash = entry.get("hash") if isinstance(entry, dict) else None
        if path_hash and ehash and ehash == path_hash:
            return True
        if ename == path_name:
            return True
    return False

def rename_files(filelist, known_faces, processed_files, simulate=True, allow_renamed=False, only_processed=False):
    # Filtrera enligt regler
    out_files = []
    for f in filelist:
        fname = Path(f).name
        # Endast tillåt filen om:
        if only_processed and not is_file_processed(fname, processed_files):
            continue
        if not allow_renamed and not is_unrenamed(fname):
            continue
        out_files.append(f)
    if not out_files:
        print("Inga filer att byta namn på enligt villkor.")
        return
    # Samla alla personer för alla filer
    persons_per_file = collect_persons_for_files(out_files, known_faces)
    all_persons = [namn for pers in persons_per_file.values() for namn in pers]
    # Bygg förnamn/initialmap
    namnmap = resolve_fornamn_dubletter(all_persons)
    # För varje fil, bygg nytt namn
    for orig in out_files:
        fname = Path(orig).name
        personer = persons_per_file.get(fname, [])
        if not personer:
            print(f"Ingen person hittades för {fname}; hoppar över.")
            continue
        nytt = build_new_filename(fname, personer, namnmap)
        if not nytt or nytt == fname:
            print(f"{fname}: inget nytt namn att sätta.")
            continue
        # Sätt inte samma namn igen, inte heller om nytt redan finns
        dest = str(Path(orig).parent / nytt)
        if Path(dest).exists() and Path(dest) != Path(orig):
            print(f"⚠️  {dest} finns redan, hoppar över!")
            continue
        if simulate:
            print(f"[SIMULATE] {os.path.basename(orig)} → {os.path.basename(dest)}")
        else:
            print(f"{os.path.basename(orig)} → {os.path.basename(dest)}")
            os.rename(orig, dest)

# === Graceful Exit ===
def signal_handler(sig, frame):
    print("\n⏹ Avbruten. Programmet avslutas.")
    sys.exit(0)

def print_help():
    print(
        """
hitta_ansikten.py - Ansiktsigenkänning och filnamnsbatchning

Användning:
  hitta_ansikten.py [ALTERNATIV] [FILGLOBBER ELLER KATALOGER]

Standardläge:
  Processar angivna bilder och bygger/uppdaterar ansiktsdatabas.

Flaggor:

  -h, --help          Visa denna hjälptext och avsluta.

  --archive           Arkivera och rotera statistiklogg.

  --fix <GLOBB>       Ta bort tidigare ansiktsmappningar för filen/filerna och bearbeta om dem.

  --rename, -r        Byt namn på filer enligt identifierade personer (kräver bearbetning först).
  --simulate, -s      Simulera omdöpning, inga filer ändras på disk.
  --rename-named      Tillåt omdöpning av redan omdöpta filer.
  --processed         Endast omdöpning av redan processade filer (inga nya bearbetas).

Exempel:

  hitta_ansikten.py 250612*.NEF
      Bearbetar alla NEF-bilder som matchar mönstret 250612*.

  hitta_ansikten.py --rename 250612*.NEF
      Bearbetar först ej processade bilder och döper sedan om alla matchande filer efter personnamn.

  hitta_ansikten.py --rename --simulate 250612*.NEF
      Visar vad som skulle döpas om – ändrar inget på disk.

  hitta_ansikten.py --fix 250612_153040.NEF
      Nollställer all mappning för filen, och bearbetar om den från början.

Notera:  
- Filnamnformat som förväntas: YYMMDD_HHMMSS[ev. -N][ev. _namn].NEF  
- Personnamn extraheras från ansiktsdatabasen, och omdöpning utförs först när hela batchen är processad.

"""
    )
signal.signal(signal.SIGINT, signal_handler)


def add_to_processed_files(path, processed_files):
    """Lägg till en ny fil sist i listan, med både hash och namn."""
    import hashlib
    try:
        with open(path, "rb") as f:
            h = hashlib.sha1(f.read()).hexdigest()
    except Exception:
        h = None
    processed_files.append({"name": path.name, "hash": h})

def preprocess_worker(
    known_faces, ignored_faces, images_to_process,
    config, max_possible_attempts,
    preprocessed_queue, preprocess_done
):
    try:
        # Skapa kopior av face-dictarna för bakgrundstråden
        copy.deepcopy(known_faces)
        copy.deepcopy(ignored_faces)
        for path in images_to_process:
            logging.debug(f"[PREPROCESS] Startar för {path.name}")
            attempt_results = []
            for attempt_idx in range(1, max_possible_attempts + 1):
                # Hämta försök upp till attempt_idx (alltid inkluderar alla tidigare)
                partial_results = preprocess_image(
                    path, known_faces, ignored_faces, config, max_attempts=attempt_idx
                )
                # Lägg endast till nya attempts (de som inte redan finns)
                new_attempts = partial_results[len(attempt_results):]
                attempt_results.extend(new_attempts)
                logging.debug(
                    f"[PREPROCESS][ATTEMPT {attempt_idx}] För {path.name}: "
                    f"nytt antal attempts: {len(attempt_results)}"
                )
                # Om senaste attempt gav ansikten, avbryt attempts för denna bild
                if new_attempts and new_attempts[-1]["faces_found"] > 0:
                    break
            logging.debug(
                f"[PREPROCESS][RESULT] {path.name}, total attempts: {len(attempt_results)}"
            )
            logging.debug(
                f"[PREPROCESS][QUEUE PUT] Lägger till i kö: {path.name} Antal attempts: {len(attempt_results)}"
            )
            preprocessed_queue.put((path, attempt_results))
        preprocess_done.set()
    except Exception as e:
        logging.debug(f"[PREPROCESS][ERROR] {e}")
        import traceback
        traceback.print_exc()

# === Entry point ===
def main():
    if any(arg in ("-h", "--help") for arg in sys.argv[1:]):
        print_help()
        sys.exit(0)

    if len(sys.argv) >= 2 and sys.argv[1] == "--archive":
        config = load_config()
        rgb_down = np.zeros((config["max_downsample_px"], config["max_downsample_px"], 3), dtype=np.uint8)
        rgb_mid = np.zeros((config["max_midsample_px"], config["max_midsample_px"], 3), dtype=np.uint8)
        rgb_full = np.zeros((config["max_fullres_px"], config["max_fullres_px"], 3), dtype=np.uint8)
        attempt_settings = get_attempt_settings(config, rgb_down, rgb_mid, rgb_full)
        current_sig = get_settings_signature(attempt_settings)
        archive_stats_if_needed(current_sig, force=True)
        print("Arkivering utförd.")
        sys.exit(0)
    # Renamelogik
    rename_mode = False
    simulate = False
    allow_renamed = False
    only_processed = False

    args = sys.argv[1:]
    to_remove = []
    if "--rename" in args or "-r" in args:
        rename_mode = True
        to_remove += ["--rename", "-r"]
    if "--simulate" in args or "-s" in args:
        simulate = True
        to_remove += ["--simulate", "-s"]
    if "--rename-named" in args:
        allow_renamed = True
        to_remove.append("--rename-named")
    if "--processed" in args:
        only_processed = True
        to_remove.append("--processed")

    for flag in to_remove:
        if flag in args:
            args.remove(flag)

    config = load_config()
    known_faces, ignored_faces, processed_files = load_database()
    max_possible_attempts = config.get("max_attempts", MAX_ATTEMPTS)
    max_queue = config.get("max_queue", MAX_QUEUE)



    # --------- HUVUDFALL: RENAME (BATCH-FLODE) ---------
    if rename_mode:
        input_paths = list(parse_inputs(args, SUPPORTED_EXT))
        if not input_paths:
            print("Ingen fil att byta namn på!")
            return

        # 1. Processa alla som inte är processade än (alltid, om --processed ej anges)
        to_process = []
        if not only_processed:
            for path in input_paths:
                if not is_file_processed(path, processed_files):
                    to_process.append(path)
            if to_process:
                print(f"\nBearbetar {len(to_process)} nya filer innan omdöpning...")
            for path in to_process:
                print(f"\n=== Bearbetar: {path.name} ===")
                result = process_image(path, known_faces, ignored_faces, config)
                if result is True or result == "skipped":
                    add_to_processed_files(path, processed_files)
                    save_database(known_faces, ignored_faces, processed_files)
        else:
            not_proc = [p for p in input_paths if not is_file_processed(p, processed_files)]
            if not_proc:
                print("⚠️  Dessa filer har ej processats än och kommer inte döpas om:")
                for p in not_proc:
                    print(f"  - {p.name}")
            # Fortsätt ändå, men rename_files hanterar detta

        # 2. Ladda om databasen och processed_files
        known_faces, ignored_faces, processed_files = load_database()

        # 3. Kör omdöpning på *alla* input_paths, nu med rätt och uppdaterad namnmap
        rename_files(
            input_paths, known_faces, processed_files,
            simulate=simulate,
            allow_renamed=allow_renamed,
            only_processed=only_processed
        )
        return

    # --------- HUVUDFALL: --fix ---------
    fix_mode = len(args) >= 1 and args[0] == "--fix"
    if fix_mode:
        arglist = args[1:]
        if not arglist:
            print("Ange fil(er) att fixa, t.ex. --fix 2024*.NEF")
            sys.exit(1)
        input_paths = list(parse_inputs(arglist, SUPPORTED_EXT))
        n_found = 0
        for path in input_paths:
            n_found += 1
            print(f"\n=== FIXAR: {path.name} ===")
            removed = remove_encodings_for_file(known_faces, ignored_faces, path.name)
            if removed:
                print(f"  ➤ Tog bort {removed} encodings för tidigare mappningar.")
            result = process_image(path, known_faces, ignored_faces, config)
            if result is True or result == "skipped":
                add_to_processed_files(path, processed_files)
                save_database(known_faces, ignored_faces, processed_files)
        if n_found == 0:
            print("Inga matchande bildfiler hittades.")
            sys.exit(1)
        return

    # --------- HUVUDFALL: BEARBETA ALLA EJ BEARBETADE ---------
    input_paths = list(parse_inputs(sys.argv[1:], SUPPORTED_EXT))
    n_found = 0
    images_to_process = []
    for path in input_paths:
        if not path.exists():
            continue
        n_found += 1
        if is_file_processed(path, processed_files):
            print(f"⏭ Hoppar över tidigare behandlad fil: {path.name}")
            continue
        images_to_process.append(path)
    if n_found == 0 or not images_to_process:
        print("Inga matchande bildfiler hittades.")
        sys.exit(1)

    # === STEG 1: Starta preprocess-kö i separat tråd ===
    preprocessed_queue = multiprocessing.Queue(maxsize=max_queue)  # Liten kö, lagom för "köad1"
    preprocess_done = multiprocessing.Event()



    # t = threading.Thread(target=preprocess_worker, daemon=True)
    # t.start()
    p = multiprocessing.Process(
        target=preprocess_worker,
        args=(
            known_faces,
            ignored_faces,
            images_to_process,
            config,
            max_possible_attempts,
            preprocessed_queue,
            preprocess_done
        )
    )
    p.start()

    # === STEG 2: Review-bearbeta, så fort en bild är klar ===
    for _ in range(len(images_to_process)):
        path, attempt_results = preprocessed_queue.get()  # Väntar tills preprocess klar för denna
        logging.debug(f"[QUEUE GET] Hämtar från kö: {path.name} Antal attempts: {len(attempt_results)}")
        print(f"\n=== Bearbetar: {path.name} ===")
        result = main_process_image_loop(path, known_faces, ignored_faces, config, attempt_results)
        if result in (True, "skipped", "no_faces"):
            add_to_processed_files(path, processed_files)
            save_database(known_faces, ignored_faces, processed_files)

    print("✅ Alla bilder färdigbehandlade.")

    if n_found == 0:
        print("Inga matchande bildfiler hittades.")
        sys.exit(1)


if __name__ == "__main__":
    main()
