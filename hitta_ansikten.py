#!/usr/bin/env python
# ruff: noqa: E402

import warnings

warnings.filterwarnings("ignore", category=UserWarning, module="face_recognition_models")

import copy
import fnmatch
import glob
import hashlib
import json
import logging
import pickle
import math
import multiprocessing
import os
import re
import shutil
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
                       CONFIG_PATH, LOGGING_PATH, SUPPORTED_EXT, get_file_hash,
                       load_attempt_log, load_database, save_database)


def init_logging(level=logging.DEBUG, logfile=LOGGING_PATH):
    logger = logging.getLogger()
    logging.getLogger("matplotlib.font_manager").setLevel(logging.WARNING)
    logger.setLevel(level)
    # Ta bort eventuella gamla handlers (viktigt vid utveckling/omstart)
    logger.handlers.clear()
    handler = logging.FileHandler(logfile, mode="a", encoding="utf-8")
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)

init_logging()
 
# === CONSTANTS === #
ORDINARY_PREVIEW_PATH = "/tmp/hitta_ansikten_preview.jpg"
MAX_ATTEMPTS = 2
# 0 = unlimited size so the worker never blocks on queue.put
MAX_QUEUE = 0
CACHE_DIR = Path("preprocessed_cache")


# Global references for graceful shutdown
worker_process = None
preprocessed_queue_ref = None

# === Standardkonfiguration ===
DEFAULT_CONFIG = {
    # === Automatiska åtgärder & flöden ===
    # Ignorera ej identifierade ansikten automatiskt (manuell review krävs)
    "auto_ignore": False,
    # Vid --fix: ignoreras ansikten under tröskeln automatiskt
    "auto_ignore_on_fix": True,

    # === Modell & detektering ===
    # Modell för ansiktsdetektion: "hog" (snabb, CPU) eller "cnn" (noggrann, GPU)
    "detection_model": "hog",

    # === Bildskalor och prestanda ===
    # Max-bredd/höjd för lågupplöst försök (snabb men mindre detaljer)
    "max_downsample_px": 2800,
    # Max-bredd/höjd för mellanupplöst försök
    "max_midsample_px": 4500,
    # Max-bredd/höjd för fullupplöst försök (sista chans, långsamt)
    "max_fullres_px": 8000,

    # === Utseende: etiketter & fönster ===
    # Skalningsfaktor för etikett-textstorlek
    "font_size_factor": 45,
    # App som används för att visa bilder, t.ex. "Bildvisare" eller "feh"
    "image_viewer_app": "Bildvisare",
    # Sökväg för temporär förhandsvisningsbild
    "temp_image_path": "/tmp/hitta_ansikten_preview.jpg",
    # Bakgrundsfärg för etiketter i RGBA
    "label_bg_color": [0, 0, 0, 192],
    # Textfärg för etiketter i RGB
    "label_text_color": [255, 255, 0],
    # Marginal kring ansiktsrutor (pixlar)
    "padding": 15,
    # Linjetjocklek för markeringsruta (pixlar)
    "rectangle_thickness": 6,

    # === Matchningsparametrar (justera för träffsäkerhet) ===
    # Max-avstånd för att godkänna namn-match (lägre = striktare)
    "match_threshold": 0.54,
    # Minsta "confidence" för att visa namn (0.0–1.0, högre = striktare)
    "min_confidence": 0.5,
    # Max-avstånd för att automatiskt föreslå ignorering ("ign")
    "ignore_distance": 0.48,
    # Namn måste vara så här mycket bättre än ignore för att vinna automatiskt
    "prefer_name_margin": 0.15,
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

def get_attempt_setting_defs(config):
    # Returnerar alla settings utan rgb_img
    return [
        # {"model": "cnn", "upsample": 0, "scale_label": "down", "scale_px": config["max_downsample_px"]},
        {"model": "cnn", "upsample": 0, "scale_label": "mid",  "scale_px": config["max_midsample_px"]},
        {"model": "cnn", "upsample": 1, "scale_label": "down", "scale_px": config["max_downsample_px"]},
        {"model": "hog", "upsample": 0, "scale_label": "full", "scale_px": config["max_fullres_px"]},
        {"model": "cnn", "upsample": 0, "scale_label": "full", "scale_px": config["max_fullres_px"]},
        {"model": "cnn", "upsample": 1, "scale_label": "mid",  "scale_px": config["max_midsample_px"]},
        {"model": "cnn", "upsample": 1, "scale_label": "full", "scale_px": config["max_fullres_px"]},
    ]

def get_attempt_settings(config, rgb_down, rgb_mid, rgb_full):
    # Kopplar rgb_img enligt scale_label
    arr_map = {
        "down": rgb_down,
        "mid": rgb_mid,
        "full": rgb_full,
    }
    settings = []
    for item in get_attempt_setting_defs(config):
        item_with_img = dict(item)  # kopiera!
        item_with_img["rgb_img"] = arr_map[item["scale_label"]]
        settings.append(item_with_img)
    return settings

def get_max_possible_attempts(config):
    return len(get_attempt_setting_defs(config))

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
    # Hantera både dict och ndarray
    if isinstance(enc, dict) and "encoding" in enc:
        enc = enc["encoding"]
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
        "exported_jpg": str(export_path),
        "exported": "true"
    }
    with open(status_path, "w") as f:
        json.dump(status, f, indent=2)

    # Visa bilden (eller låt bildvisaren själv ladda in statusfilen)
    # os.system(f"open -a '{config.get('image_viewer_app', 'Bildvisare')}' '{export_path}'")


def show_temp_image(preview_path, config, image_path=None, last_shown=[None]):
    import subprocess
    viewer_app = config.get("image_viewer_app")
    status_path = Path.home() / "Library" / "Application Support" / "bildvisare" / "status.json"
    expected_path = str(Path(preview_path).resolve())

    should_open = True  # Default: öppna om osäkert

    # Använd image_path om det finns, annars preview_path
    orig_path = str(image_path) if image_path else str(preview_path)
    status_origjson_path = Path.home() / "Library" / "Application Support" / "bildvisare" / "original_status.json"
    status_origjson = {
        "timestamp": time.time(),
        "source_nef": orig_path,
        "exported_jpg": None,
        "exported": "false"
    }
    with open(status_origjson_path, "w") as f:
        json.dump(status_origjson, f, indent=2)


    if status_path.exists():
        try:
            with open(status_path, "r") as f:
                status = json.load(f)
            app_status = status.get("app_status", "unknown")
            if app_status == "running" and os.path.samefile(status.get("file_path", ""), expected_path):
                should_open = False  # Bildvisare kör redan och visar rätt fil
                logging.debug(f"[BILDVISARE] Bildvisaren visar redan rätt fil: {expected_path}")

            elif app_status == "exited":
                logging.debug(f"[BILDVISARE] Bildvisaren har avslutats, kommer öppna bild")
                should_open = True
            else:
                logging.debug(f"[BILDVISARE] Bildvisar-status: {app_status} inte behandlad, kommer öppna bild")
                should_open = True
        except Exception:
            logging.debug(f"[BILDVISARE] Misslyckades läsa statusfilen: {status_path}, kommer öppna bild")
            should_open = True

    if should_open:
        logging.debug(f"[BILDVISARE] Öppnar bild i visare: {expected_path}")
        subprocess.Popen(["open", "-a", viewer_app, preview_path])
        last_shown[0] = preview_path
    else:
        logging.debug(f"[BILDVISARE] Hoppar över open")
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
        graceful_exit()

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
    labels_per_attempt=None,
    file_hash=None,
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
    :param file_hash: (str, optional) SHA1-hash av filen som behandlas.
    """
    from pathlib import Path
    if base_dir is None:
        base_dir = Path(".")
    log_entry = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "filename": str(image_path),
        "file_hash": file_hash,
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
    return get_face_match_status(i, best_name, best_name_dist, name_conf, best_ignore, best_ignore_dist, ign_conf, config)

def label_preview_for_encodings(face_encodings, known_faces,
                                ignored_faces, hard_negatives, config):
    labels = []
    for i, encoding in enumerate(face_encodings):
        (best_name, best_name_dist), (best_ignore, best_ignore_dist) = best_matches(
            encoding, known_faces, ignored_faces, hard_negatives, config
        )
        name_conf = int((1 - best_name_dist) * 100) if best_name_dist is not None else None
        ign_conf = int((1 - best_ignore_dist) * 100) if best_ignore_dist is not None else None
        label, _ = get_match_label(i, best_name, best_name_dist, name_conf, best_ignore, best_ignore_dist, ign_conf, config)
        labels.append(label)
    return labels

def handle_manual_add(known_faces, image_path, file_hash, input_name_func, labels=None):
    """
    Lägg till manuell person – även med file och hash.
    Om labels ges (lista), addera ett label-objekt, annars returnera namn och label.
    """
    namn = input_name_func(list(known_faces.keys()), "Manuellt tillägg – ange namn: ")
    if namn and namn not in known_faces:
        known_faces[namn] = []
    # Spara dummy-encoding och korrekt hash+file
    known_faces[namn].append({
        "encoding": None,
        "file": str(image_path.name) if image_path is not None and hasattr(image_path, "name") else str(image_path),
        "hash": file_hash
    })
    label_obj = {"label": f"#manuell\n{namn}", "hash": None}
    if labels is not None:
        labels.append(label_obj)
    return namn, label_obj

def get_face_match_status(i, best_name, best_name_dist, name_conf, best_ignore, best_ignore_dist, ign_conf, config):
    name_thr = config.get("match_threshold", 0.6)
    ignore_thr = config.get("ignore_distance", 0.5)
    margin = config.get("prefer_name_margin", 0.10)
    min_conf = config.get("min_confidence", 0.4)

    # Confidence-filter
    if (
        (name_conf is not None and name_conf / 100 < min_conf) and
        (ign_conf is not None and ign_conf / 100 < min_conf)
    ):
        return "#%d\nOkänt" % (i + 1), "unknown"

    # Osäker mellan namn och ignore
    if (
        best_name is not None and best_name_dist is not None and best_name_dist < name_thr and
        best_ignore_dist is not None and best_ignore_dist < ignore_thr and
        abs(best_name_dist - best_ignore_dist) < margin
    ):
        if best_name_dist < best_ignore_dist:
            return f"#%d\n{best_name} / ign" % (i + 1), "uncertain_name"
        else:
            return f"#%d\nign / {best_name}" % (i + 1), "uncertain_ign"

    # Namn vinner klart
    elif (
        best_name is not None and best_name_dist is not None and best_name_dist < name_thr and
        (best_ignore_dist is None or best_name_dist < best_ignore_dist - margin)
    ):
        return f"#%d\n{best_name}" % (i + 1), "name"

    # Ign vinner klart
    elif (
        best_ignore_dist is not None and best_ignore_dist < ignore_thr and
        (best_name_dist is None or best_ignore_dist < best_name_dist - margin)
    ):
        return "#%d\nign" % (i + 1), "ign"

    # Ingen tillräckligt nära
    else:
        return "#%d\nOkänt" % (i + 1), "unknown"

def add_hard_negative(hard_negatives, person, encoding):
    if person not in hard_negatives:
        hard_negatives[person] = []
    hard_negatives[person].append(encoding)

def user_review_encodings(
    face_encodings, known_faces, ignored_faces, hard_negatives, config,
    image_path=None, preview_path=None, file_hash=None
):
    """
    Terminal-review av hittade ansikten
    """

    if file_hash is None and image_path is not None:
        file_hash = get_file_hash(image_path)

    labels = []
    all_ignored = True
    retry_requested = False
    margin = config["prefer_name_margin"]
    name_thr = config["match_threshold"]
    ignore_thr = config["ignore_distance"]

    def handle_answer(ans, actions, default=None):
        if ans in ("", "enter"):
            return default
        return actions.get(ans)

    for i, encoding in enumerate(face_encodings):
        name = None
        print(f"\nAnsikte #{i + 1}:")
        (best_name, best_name_dist), (best_ignore, best_ignore_dist) = best_matches(
            encoding, known_faces, ignored_faces, hard_negatives, config
        )
        name_confidence = int((1 - best_name_dist) * 100) if best_name_dist is not None else None
        ignore_confidence = int((1 - best_ignore_dist) * 100) if best_ignore_dist is not None else None

        base_actions = {
            "o": "show_original",
            "m": "manual",
            "x": "skip",
            "n": "retry",
        }

        # Centraliserad logik
        label_txt, case = get_face_match_status(
            i, best_name, best_name_dist, name_confidence,
            best_ignore, best_ignore_dist, ignore_confidence, config
        )

        if case == "uncertain_name":
            prompt_txt = (
                f"↪ Osäkert: {best_name} ({name_confidence}%) / ign ({ignore_confidence}%)\n"
                "[Enter = bekräfta namn, i = ignorera, r = rätta, n = försök igen, "
                "o = öppna original, m = manuell tilldelning, x = skippa bild] › "
            )
            actions = {**base_actions, "i": "ignore", "r": "edit"}
            default_action = "name"

        elif case == "uncertain_ign":
            prompt_txt = (
                f"↪ Osäkert: ign ({ignore_confidence}%) / {best_name} ({name_confidence}%)\n"
                "[Enter = bekräfta ignorera, a = acceptera namn, r = rätta, n = försök igen, "
                "o = öppna original, m = manuell tilldelning, x = skippa bild] › "
            )
            actions = {**base_actions, "a": "name", "r": "edit", "i": "ignore"}
            default_action = "ignore"

        elif case == "name":
            prompt_txt = (
                f"↪ Föreslaget: {best_name} ({name_confidence}%)\n"
                "[Enter = bekräfta, r = rätta, n = försök igen, i = ignorera, "
                "o = öppna original, m = manuell tilldelning, x = skippa bild] › "
            )
            actions = {**base_actions, "r": "edit", "i": "ignore"}
            default_action = "name"

        elif case == "ign":
            prompt_txt = (
                f"↪ Ansiktet liknar ett tidigare ignorerat ({ignore_confidence}%).\n"
                "[Enter = bekräfta ignorera, a = acceptera namn, r = rätta, n = försök igen, "
                "o = öppna original, m = manuell tilldelning, x = skippa bild] › "
            )
            actions = {**base_actions, "a": "name", "r": "edit", "i": "ignore"}
            default_action = "ignore"

        else:  # "unknown"
            prompt_txt = (
                "↪ Okänt ansikte. Ange namn (eller 'i' för ignorera, n = försök igen, "
                "m = manuell tilldelning, o = öppna original, x = skippa bild) › "
            )
            actions = {**base_actions, "i": "ignore"}
            default_action = "edit"

        while True:
            if default_action == "edit" and prompt_txt.startswith("↪ Okänt ansikte."):
                new_name = input_name(list(known_faces.keys()), prompt_txt)
                ans = new_name.strip()
                # Om användaren skrivit en specialaction istället för namn:
                if ans.lower() in actions:
                    action = actions[ans.lower()]
                elif ans:
                    action = "edit"
                else:
                    action = default_action
            else:
                ans = safe_input(prompt_txt).strip().lower()
                action = handle_answer(ans, actions, default=default_action)

            if action == "show_original":
                if image_path is not None:
                    export_and_show_original(image_path, config)
                elif preview_path is not None:
                    show_temp_image(preview_path, config, image_path)
                continue
            elif action == "manual":
                handle_manual_add(known_faces, image_path, file_hash, input_name, labels)
                all_ignored = False
                continue
            elif action == "skip":
                return "skipped", []
            elif action == "retry":
                retry_requested = True
                break
            elif action == "edit":
                if not (default_action == "edit" and prompt_txt.startswith("↪ Okänt ansikte.")):
                    new_name = input_name(list(known_faces.keys()))
                if new_name.lower() == "x":
                    return "skipped", []
                if new_name.lower() == "n":
                    retry_requested = True
                    break
                if new_name.lower() == "i":
                    ignored_faces.append(encoding)
                    labels.append({"label": f"#{i+1}\nignorerad", "hash": hash_encoding(encoding)})
                    break
                if new_name:
                    name = new_name
                    all_ignored = False
                    # --- Hard negative: Spara encoding som hard negative för best_name om den felaktigt föreslogs! ---
                    if best_name and name != best_name:
                        add_hard_negative(hard_negatives, best_name, encoding)
                    break
            elif action == "ignore":
                ignored_faces.append(encoding)
                labels.append({"label": f"#{i+1}\nignorerad", "hash": hash_encoding(encoding)})
                break
            elif action == "name":
                name = best_name if best_name else input_name(list(known_faces.keys()))
                all_ignored = False
                break

        if retry_requested:
            break
        if name is not None and name.lower() not in {"i", "x", "n", "o"}:
            if name not in known_faces:
                known_faces[name] = []
            known_faces[name].append({
                "encoding": encoding,
                "file": str(image_path.name) if image_path is not None and hasattr(image_path, "name") else str(image_path),
                "hash": file_hash
            })
            labels.append({"label": f"#{i+1}\n{name}", "hash": hash_encoding(encoding)})

    if retry_requested:
        logging.debug(f"[REVIEW] Retry ombett, återgår till anropare")
        return "retry", []
    if all_ignored:
        logging.debug(f"[REVIEW] Alla ansikten ignorerade; returnerar 'all_ignored'.")
        return "all_ignored", []
    logging.debug(f"[REVIEW] Alla ansikten granskade, returnerar 'ok'.")
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
def best_matches(encoding, known_faces, ignored_faces, hard_negatives, config):
    """
    Returnerar:
        (best_name, best_name_dist), (best_ignore_idx, best_ignore_dist)
    Nu med stöd för hard negatives per person – om encoding ligger nära en hard negative för ett namn,
    ska det inte föreslås det namnet (eller ges mycket dåligt score).
    """
    import face_recognition
    import numpy as np

    best_name = None
    best_name_dist = None
    best_ignore = None
    best_ignore_dist = None

    name_thr = config.get("match_threshold", 0.6)
    # Om encoding ligger närmare en hard negative än en vanlig encoding, skippa detta namn.
    hard_negative_thr = config.get("hard_negative_distance", 0.45)  # justerbar, gärna < ignore_thr

    for name, entries in known_faces.items():
        # Samla alla numpy-arrayer för encodings
        encs = []
        for entry in entries:
            if isinstance(entry, dict) and "encoding" in entry:
                enc = entry["encoding"]
                if isinstance(enc, np.ndarray):
                    encs.append(enc)
            elif isinstance(entry, np.ndarray):
                encs.append(entry)
        if not encs:
            continue  # Skippa namn utan encodings

        # Kolla mot personens hard negatives – om encoding ligger för nära någon, ignorera
        hard_negs = []
        if hard_negatives and name in hard_negatives:
            for neg in hard_negatives[name]:
                if isinstance(neg, dict) and "encoding" in neg:
                    neg_enc = neg["encoding"]
                else:
                    neg_enc = neg
                if isinstance(neg_enc, np.ndarray):
                    hard_negs.append(neg_enc)
        # Om någon hard negative är nära: ignorera denna person helt
        is_hard_negative = False
        if hard_negs:
            neg_dists = face_recognition.face_distance(np.array(hard_negs), encoding)
            if np.min(neg_dists) < hard_negative_thr:
                is_hard_negative = True

        if is_hard_negative:
            continue

        dists = face_recognition.face_distance(encs, encoding)
        min_dist = np.min(dists)
        if best_name_dist is None or min_dist < best_name_dist:
            best_name_dist = min_dist
            best_name = name

    # Ignore-match (oförändrad)
    ignored_encs = []
    for entry in ignored_faces:
        if isinstance(entry, dict) and "encoding" in entry:
            enc = entry["encoding"]
            if isinstance(enc, np.ndarray):
                ignored_encs.append(enc)
        elif isinstance(entry, np.ndarray):
            ignored_encs.append(entry)
    best_ignore_idx = None
    if ignored_encs:
        dists = face_recognition.face_distance(ignored_encs, encoding)
        min_dist = np.min(dists)
        best_ignore_dist = min_dist
        best_ignore_idx = int(np.argmin(dists))
    else:
        best_ignore_dist = None
        best_ignore_idx = None

    return (best_name, best_name_dist), (best_ignore_idx, best_ignore_dist)

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


def remove_encodings_for_file(known_faces, ignored_faces, hard_negatives, identifier):
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
        entry_hash = entry.get("file_hash")
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

def preprocess_image(
    image_path,
    known_faces,
    ignored_faces,
    hard_negatives,
    config,
    max_attempts=3,
    attempts_so_far=None
):
    """
    Förbehandlar en bild och returnerar en lista av attempt-resultat.
    Om attempts_so_far anges (lista), används befintliga attempts och endast saknade attempts (index >= len(attempts_so_far)) körs.
    """
    fname = str(image_path)
    logging.debug(f"[PREPROCESS image][{fname}] start")

    try:
        max_down = config.get("max_downsample_px")
        max_mid = config.get("max_midsample_px")
        max_full = config.get("max_fullres_px")
        rgb_down = load_and_resize_raw(image_path, max_down)
        rgb_mid = load_and_resize_raw(image_path, max_mid)
        rgb_full = load_and_resize_raw(image_path, max_full)

        attempt_settings = get_attempt_settings(config, rgb_down, rgb_mid, rgb_full)
    except Exception as e:
        logging.warning(f"[RAWREAD][SKIP][{fname}] Kunde inte öppna {fname}: {e}")
        return []

    if attempts_so_far is None:
        attempts_so_far = []

    attempt_results = list(attempts_so_far)  # Kopiera så vi inte muterar input
    start_idx = len(attempt_results)
    total_attempts = min(max_attempts, len(attempt_settings))

    for attempt_idx in range(start_idx, total_attempts):
        setting = attempt_settings[attempt_idx]
        rgb = setting["rgb_img"]
        t0 = time.time()
        logging.debug(f"[PREPROCESS image][{fname}] Attempt {attempt_idx}: start")
        logging.debug(f"[PREPROCESS image][{fname}] Attempt {attempt_idx}: face_detection_attempt")
        face_locations, face_encodings = face_detection_attempt(
            rgb, setting["model"], setting["upsample"]
        )
        logging.debug(f"[PREPROCESS image][{fname}] Attempt {attempt_idx}: label_preview_for_encodings")
        preview_labels = label_preview_for_encodings(
            face_encodings, known_faces, ignored_faces, hard_negatives, config
        )
        logging.debug(f"[PREPROCESS image][{fname}] Attempt {attempt_idx}: create_labeled_image")
        preview_path = create_labeled_image(
            rgb, face_locations, preview_labels, config, suffix=f"_preview_{attempt_idx}"
        )
        elapsed = time.time() - t0
        logging.debug(f"[PREPROCESS image][{fname}] Attempt {attempt_idx}: done ({elapsed:.2f}s)")

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

    logging.debug(f"[PREPROCESS image][{fname}]: end")
    return attempt_results


def main_process_image_loop(image_path, known_faces, ignored_faces, hard_negatives,
                            config, attempt_results):
    """
    Review-loop för EN attempt (sista) för en redan preprocessad bild.
    """
    attempt_idx = len(attempt_results) - 1
    attempts_stats = []
    used_attempt = None
    review_results = []
    labels_per_attempt = []
    file_hash = get_file_hash(image_path)
    max_possible_attempts = config.get("max_attempts", MAX_ATTEMPTS)

    res = attempt_results[attempt_idx]
    print(
        f"⚙️  Försök {attempt_idx + 1}: model={res['model']}, upsample={res['upsample']}, "
        f"scale={res['scale_label']} ({res['scale_px']}px)"
    )
    face_encodings = res["face_encodings"]
    face_locations = res["face_locations"]
    preview_path = res["preview_path"]
    elapsed = res["time_seconds"]

    logging.debug(
        f"[ATTEMPT] Försök {attempt_idx + 1}: {res['model']}, upsample={res['upsample']}, "
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

    ORDINARY_PREVIEW_PATH = config.get("ordinary_preview_path", "/tmp/hitta_ansikten_preview.jpg")
    try:
        shutil.copy(preview_path, ORDINARY_PREVIEW_PATH)
    except Exception as e:
        print(f"[WARN] Kunde inte kopiera preview till {ORDINARY_PREVIEW_PATH}: {e}")
    show_temp_image(ORDINARY_PREVIEW_PATH, config, image_path)

    if face_encodings:
        review_result, labels = user_review_encodings(
            face_encodings, known_faces, ignored_faces, hard_negatives, config, image_path,
            preview_path, file_hash
        )
        review_results.append(review_result)
        labels_per_attempt.append(labels)

        if review_result == "skipped":
            log_attempt_stats(
                image_path, attempts_stats, used_attempt, BASE_DIR,
                review_results=review_results, labels_per_attempt=labels_per_attempt,
                file_hash=file_hash
            )
            return "skipped"
        if review_result == "retry":
            # main() kommer anropa denna igen vid nästa attempt
            return "retry"
        if review_result == "all_ignored":
            return "all_ignored"
        if review_result == "ok":
            used_attempt = attempt_idx
            log_attempt_stats(
                image_path, attempts_stats, used_attempt, BASE_DIR,
                review_results=review_results,
                labels_per_attempt=labels_per_attempt,
                file_hash=file_hash
            )
            return "ok"
    else:
        # Inga ansikten i detta försök
        review_results.append("no_faces")
        labels_per_attempt.append([])

        ans = safe_input("⚠️  Fortsätta försöka? [Enter = ja, n = försök nästa nivå, x = hoppa över, m = manuell tilldelning] › ").strip().lower()
        if ans == "x":
            log_attempt_stats(
                image_path, attempts_stats, used_attempt, BASE_DIR,
                review_results=review_results,
                labels_per_attempt=labels_per_attempt,
                file_hash=file_hash
            )
            return "skipped"
        elif ans == "m":
            namn, label_obj = handle_manual_add(known_faces, image_path, file_hash, input_name)
            review_results.append("ok")
            log_attempt_stats(
                image_path, attempts_stats, used_attempt, BASE_DIR,
                review_results=review_results,
                labels_per_attempt=labels_per_attempt,
                file_hash=file_hash
            )
            # processed_files läggs till i main()
            return "ok"
        elif ans == "n" or ans == "":
            # main() kommer anropa denna igen vid nästa attempt
            return "retry"

    # Om attempts är slut (main() kan tolka detta som "gå vidare")
    if attempt_idx + 1 == max_possible_attempts:
        print(f"⏭ Inga ansikten kunde hittas i {image_path.name} , hoppar över.")
        log_attempt_stats(
            image_path, attempts_stats, None, BASE_DIR,
            review_results=review_results,
            labels_per_attempt=labels_per_attempt,
            file_hash=file_hash
        )
        return "no_faces"
    return "retry"

def process_image(image_path, known_faces, ignored_faces, hard_negatives, config):
    attempt_results = preprocess_image(image_path, known_faces, ignored_faces,
                                       hard_negatives, config, max_attempts=1)

    return main_process_image_loop(image_path, known_faces, ignored_faces, hard_negatives,
                                   config, attempt_results)


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

def collect_persons_for_files(filelist, known_faces, processed_files=None, attempt_log=None):
    """
    Returnera dict: { filename: [namn, ...] }
    1) Primärt: encodings.pkl – direkt filmatchning (och/eller hash om fil ej hittas)
    2) Sekundärt: encodings.pkl – hashmatchning
    3) Tertiärt: attempt_stats – som fallback
    """
    import hashlib
    from pathlib import Path

    # --- Bygg index för encodings.pkl: filnamn→namn, hash→namn ---
    file_to_persons = {}    # filnamn (basename) → [namn, ...]
    hash_to_persons = {}    # hash → [namn, ...]

    # Först, indexera encodings.pkl på både 'file' och 'hash'
    for name, entries in known_faces.items():
        for entry in entries:
            if isinstance(entry, dict):
                f = entry.get("file")
                h = entry.get("hash")
                if f:
                    f = Path(f).name  # endast basename
                    file_to_persons.setdefault(f, []).append(name)
                if h:
                    hash_to_persons.setdefault(h, []).append(name)
            # gamla formatet (np.ndarray) kan ej kopplas

    # --- Bygg hash-mapp för aktuella filer ---
    filehash_map = {}  # fname (basename) → hash
    for f in filelist:
        fpath = Path(f)
        h = get_file_hash(fpath)
        filehash_map[fpath.name] = h

    # --- Index för processed_files (kan ge extra säkerhet) ---
    if processed_files is None:
        processed_files = []
    processed_name_to_hash = {Path(x['name']).name: x.get('hash') for x in processed_files if isinstance(x, dict) and x.get('name')}

    # --- Ladda attempts-logg för fallback ---
    if attempt_log is None:
        attempt_log = load_attempt_log()

    # --- Ladda attempts som fallback: filename→labels ---
    stats_map = {}
    for entry in attempt_log:
        fn = Path(entry.get("filename", "")).name
        if entry.get("used_attempt") is not None and entry.get("review_results"):
            idx = entry["used_attempt"]
            if idx < len(entry.get("labels_per_attempt", [])):
                res = entry["review_results"][idx]
                labels = entry["labels_per_attempt"][idx]
                if res == "ok" and labels:
                    # Personnamn ur label: "#1\nNamn"
                    persons = []
                    for lbl in labels:
                        label = lbl["label"] if isinstance(lbl, dict) else lbl
                        if "\n" in label:
                            namn = label.split("\n", 1)[1]
                            if namn.lower() not in ("ignorerad", "ign", "okänt", "okant"):
                                persons.append(namn)
                    if persons:
                        stats_map[fn] = persons

    # --- Samla personer för varje fil ---
    result = {}
    for f in filelist:
        fname = Path(f).name
        h = filehash_map.get(fname) or processed_name_to_hash.get(fname)
        # 1. Försök filnamn (encodings.pkl)
        persons = file_to_persons.get(fname, [])
        # 2. Annars försök hash (encodings.pkl)
        if not persons and h:
            persons = hash_to_persons.get(h, [])
        # 3. Annars försök attempts-logg (fallback)
        if not persons:
            persons = stats_map.get(fname, [])
        result[fname] = persons
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
    """Kolla om filen redan är processad, via namn ELLER hash."""
    path_name = Path(path).name if not isinstance(path, str) else path
    path_hash = None
    # Snabbt: finns namn redan?
    for entry in processed_files:
        ename = entry.get("name") if isinstance(entry, dict) else entry
        if ename == path_name:
            return True
    # Kolla mot hash om inte namn matchade
    try:
        with open(path, "rb") as f:
            import hashlib
            path_hash = hashlib.sha1(f.read()).hexdigest()
    except Exception:
        pass
    if path_hash:
        for entry in processed_files:
            ehash = entry.get("hash") if isinstance(entry, dict) else None
            if ehash and ehash == path_hash:
                return True
    return False

def rename_files(filelist, known_faces, processed_files, simulate=True, allow_renamed=False, only_processed=False):
    # Filtrera enligt regler
    out_files = []
    for f in filelist:
        # Här: använd alltid path, inte bara namn!
        if only_processed and not is_file_processed(f, processed_files):
            continue
        fname = Path(f).name
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
        dest = str(Path(orig).parent / nytt)
        if Path(dest).exists() and Path(dest) != Path(orig):
            print(f"⚠️  {dest} finns redan, hoppar över!")
            continue
        if simulate:
            print(f"[SIMULATE] {os.path.basename(orig)} → {os.path.basename(dest)}")
        else:
            print(f"{os.path.basename(orig)} → {os.path.basename(dest)}")
            os.rename(orig, dest)

def cleanup_tmp_previews():
    for path in glob.glob("/tmp/hitta_ansikten_*"):
        try:
            os.remove(path)
        except Exception:
            pass  # Ignorera ev. misslyckanden

# === Graceful Exit ===
def graceful_exit():
    print("\n⏹ Avbruten. Programmet avslutas.")
    if worker_process and worker_process.is_alive():
        worker_process.terminate()
        worker_process.join(timeout=1)
    if preprocessed_queue_ref is not None:
        try:
            preprocessed_queue_ref.close()
            preprocessed_queue_ref.join_thread()
        except Exception:
            pass
    cleanup_tmp_previews()
    os._exit(0)


def signal_handler(sig, frame):
    graceful_exit()

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


def _cache_file(path):
    """Return the cache file path for a given image path."""
    CACHE_DIR.mkdir(exist_ok=True)
    h = hashlib.sha1(str(path).encode()).hexdigest()
    return CACHE_DIR / f"{h}.pkl"


def save_preprocessed_cache(path, attempt_results):
    """Persist preprocessing results so a run can resume after restart.

    Preview images are copied to the cache directory so they exist on restart.
    Returns a list with updated preview paths suitable for queuing.
    """
    cache_path = _cache_file(path)
    h = hashlib.sha1(str(path).encode()).hexdigest()
    cached = []
    for res in attempt_results:
        entry = res.copy()
        prev = entry.get("preview_path")
        if prev and Path(prev).exists():
            dest = CACHE_DIR / f"{h}_a{entry['attempt_index']}.jpg"
            shutil.copy(prev, dest)
            entry["preview_path"] = str(dest)
        cached.append(entry)
    with open(cache_path, "wb") as f:
        pickle.dump((str(path), cached), f)
    return cached


def load_preprocessed_cache(queue):
    """Load any cached preprocessing results into the queue."""
    if not CACHE_DIR.exists():
        return
    for file in CACHE_DIR.glob("*.pkl"):
        try:
            with open(file, "rb") as f:
                path, attempt_results = pickle.load(f)
            queue.put((Path(path), attempt_results))
        except Exception:
            logging.debug(f"[CACHE] Failed to load {file}")


def remove_preprocessed_cache(path):
    """Remove cached preprocessing data for a path."""
    cache_path = _cache_file(path)
    if cache_path.exists():
        cache_path.unlink()
    h = hashlib.sha1(str(path).encode()).hexdigest()
    for img in CACHE_DIR.glob(f"{h}_a*.jpg"):
        try:
            img.unlink()
        except Exception:
            pass

def preprocess_worker(
    known_faces, ignored_faces, hard_negatives, images_to_process,
    config, max_possible_attempts,
    preprocessed_queue, preprocess_done
):
    try:
        faces_copy = copy.deepcopy(known_faces)
        ignored_copy = copy.deepcopy(ignored_faces)
        hard_negatives_copy = copy.deepcopy(hard_negatives)

        # Track attempts per image and keep processing order deterministic
        attempt_map = {path: [] for path in images_to_process}
        active_paths = list(images_to_process)

        # Breadth-first processing: handle attempt 1 for all images, then attempt 2, etc.
        for attempt_idx in range(1, max_possible_attempts + 1):
            if not active_paths:
                break
            for path in active_paths[:]:
                logging.debug(f"[PREPROCESS worker] Attempt {attempt_idx} for {path.name}")
                current_attempts = attempt_map[path]
                partial_results = preprocess_image(
                    path,
                    faces_copy,
                    ignored_copy,
                    hard_negatives_copy,
                    config,
                    max_attempts=attempt_idx,
                    attempts_so_far=current_attempts,
                )
                if len(partial_results) > len(current_attempts):
                    cached = save_preprocessed_cache(path, partial_results)
                    attempt_map[path] = cached
                    logging.debug(
                        f"[PREPROCESS worker][QUEUE PUT] {path.name}: attempts {len(cached)}"
                    )
                    preprocessed_queue.put((path, cached[:]))
                    # Stop processing this image if faces were found
                    if cached[-1]["faces_found"] > 0:
                        active_paths.remove(path)
        preprocess_done.set()
    except Exception as e:
        logging.debug(f"[PREPROCESS worker][ERROR] {e}")
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
    known_faces, ignored_faces, hard_negatives, processed_files = load_database()
    max_auto_attempts = config.get("max_attempts", MAX_ATTEMPTS)
    max_possible_attempts = get_max_possible_attempts(config)
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
                result = process_image(path, known_faces, ignored_faces, hard_negatives, config)
                if result is True or result == "skipped":
                    add_to_processed_files(path, processed_files)
                    save_database(known_faces, ignored_faces, hard_negatives, processed_files)

        else:
            not_proc = [p for p in input_paths if not is_file_processed(p, processed_files)]
            if not_proc:
                print("⚠️  Dessa filer har ej processats än och kommer inte döpas om:")
                for p in not_proc:
                    print(f"  - {p.name}")
            # Fortsätt ändå, men rename_files hanterar detta

        # 2. Ladda om databasen och processed_files
        known_faces, ignored_faces, hard_negatives, processed_files = load_database()

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
            removed = remove_encodings_for_file(known_faces, ignored_faces, hard_negatives, path.name)
            if removed:
                print(f"  ➤ Tog bort {removed} encodings för tidigare mappningar.")

            # NYTT: Kör attempts-loop precis som i batch-läget
            max_possible_attempts = get_max_possible_attempts(config)
            attempts_so_far = []
            attempt_idx = 0
            result = None
            while attempt_idx < max_possible_attempts:
                if attempt_idx == 0:
                    # Kör första attempt
                    attempts_so_far = preprocess_image(
                        path, known_faces, ignored_faces, hard_negatives, config,
                        max_attempts=1, attempts_so_far=[]
                    )
                else:
                    # Lägg till ett till attempt
                    attempts_so_far = preprocess_image(
                        path, known_faces, ignored_faces, hard_negatives, config,
                        max_attempts=attempt_idx+1, attempts_so_far=attempts_so_far
                    )
                result = main_process_image_loop(
                    path, known_faces, ignored_faces, hard_negatives, config, attempts_so_far
                )
                if result == "retry":
                    attempt_idx += 1
                    continue
                elif result in (True, "ok", "manual", "skipped", "no_faces", "all_ignored"):
                    add_to_processed_files(path, processed_files)
                    save_database(known_faces, ignored_faces, hard_negatives, processed_files)
                    break
                else:
                    # Okänd return, bryt
                    break
            else:
                # Om attempts tar slut utan att vi bryter, skriv ut det
                print(f"⏭ Inga fler försök möjliga för {path.name}, hoppar över.")
                add_to_processed_files(path, processed_files)
                save_database(known_faces, ignored_faces, hard_negatives, processed_files)
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

    # === STEG 1: Starta worker-processen ===
    preprocessed_queue = multiprocessing.Queue(maxsize=max_queue or 0)
    load_preprocessed_cache(preprocessed_queue)  # Reload cached queue entries
    preprocess_done = multiprocessing.Event()

    global worker_process, preprocessed_queue_ref
    preprocessed_queue_ref = preprocessed_queue
    worker_process = multiprocessing.Process(
        target=preprocess_worker,
        args=(
            known_faces,
            ignored_faces,
            hard_negatives,
            images_to_process,
            config,
            max_auto_attempts,
            preprocessed_queue,
            preprocess_done
        )
    )
    worker_process.start()

    # === STEG 2: Bild-för-bild, attempt-för-attempt ===
    done_images = set()
    for path in images_to_process:
        logging.debug(f"[MAIN][STEG2] Bearbetar {path.name}...")
        path_key = str(path)
        attempt_idx = 0
        attempts_so_far = []
        worker_wait_msg_printed = False

        while attempt_idx < max_possible_attempts:
            logging.debug(f"[MAIN] {path.name}: försök {attempt_idx + 1}...")
            print(f"\n=== Bearbetar: {path.name} (försök {attempt_idx+1}) ===")
            # === Hämta attempts från kön om möjligt ===
            if len(attempts_so_far) < attempt_idx + 1:
                fetched = False
                # Visa endast "väntar på nästa nivå" för nivå > 1
                if attempt_idx > 0 and not worker_wait_msg_printed:
                    print(f"(⏳ Väntar på nivå {attempt_idx+1} för {path.name}...)", flush=True)
                    worker_wait_msg_printed = True

                while not fetched:
                    # logging.debug(f"[MAIN] Väntar på attempt {attempt_idx+1} för {path.name}")
                    qpath, attempt_results = preprocessed_queue.get()
                    if str(qpath) != path_key:
                        preprocessed_queue.put((qpath, attempt_results))
                        continue
                    attempts_so_far = attempt_results
                    fetched = True

                logging.debug(f"[MAIN] {path.name}: mottagit {len(attempts_so_far)} attempts")
                if attempt_idx > 0:
                    print(f"(✔️  Nivå {attempt_idx+1} klar för {path.name})", flush=True)
                worker_wait_msg_printed = False  # Återställ för ev. fler nivåer

            logging.debug(f"[MAIN][QUEUE GET] {path.name}: hämtar attempt {attempt_idx+1}")

            result = main_process_image_loop(
                path, known_faces, ignored_faces, hard_negatives, config, attempts_so_far
            )

            logging.debug(f"[MAIN] {path.name}: resultat från review-loop: {result}")

            if result == "retry":
                attempt_idx += 1
                if attempt_idx >= max_possible_attempts:
                    print(f"⏭ Inga fler försök möjliga för {path.name}, hoppar över.")
                    add_to_processed_files(path, processed_files)
                    save_database(known_faces, ignored_faces, hard_negatives, processed_files)
                    done_images.add(path)
                    break
                # --- Vänta på worker om det är sannolikt att attempt är på gång ---
                max_wait = 90  # sekunder
                waited = 0
                got_new_attempt = False
                if len(attempts_so_far) < attempt_idx + 1:
                    if not worker_wait_msg_printed:
                        print(f"(⏳ Väntar på nivå {attempt_idx+1} för {path.name}...)", flush=True)
                        worker_wait_msg_printed = True
                    import time
                    while waited < max_wait:
                        if not preprocessed_queue.empty():
                            qpath, attempt_results = preprocessed_queue.get()
                            if str(qpath) == path_key:
                                attempts_so_far = attempt_results
                                got_new_attempt = True
                                print(f"(✔️  Nivå {attempt_idx+1} klar för {path.name})", flush=True)
                                worker_wait_msg_printed = False
                                break
                            else:
                                preprocessed_queue.put((qpath, attempt_results))
                        time.sleep(1)
                        waited += 1
                    # Om worker ändå inte levererat: skapa nytt attempt manuellt
                    if not got_new_attempt:
                        logging.debug(f"[MAIN] {path.name}: skapar manuellt nytt attempt {attempt_idx+1}")
                        extra_attempts = preprocess_image(
                            path, known_faces, ignored_faces, hard_negatives, config,
                            max_attempts=attempt_idx + 1,
                            attempts_so_far=attempts_so_far
                        )
                        if len(extra_attempts) > attempt_idx:
                            attempts_so_far = extra_attempts
                            print(f"(✔️  Extra nivå {attempt_idx+1} klar för {path.name})", flush=True)
                            worker_wait_msg_printed = False
                            continue  # Kör review-loop direkt på det!
                        else:
                            print(f"⏭ Inga fler försök möjliga för {path.name}, hoppar över.")
                            add_to_processed_files(path, processed_files)
                            save_database(known_faces, ignored_faces, hard_negatives, processed_files)
                            done_images.add(path)
                            break
                    else:
                        continue  # Vi fick ett nytt attempt från worker, kör vidare
                else:
                    continue  # Allt redan klart, kör vidare

            # Bilden är klar
            if result in (True, "ok", "manual", "skipped", "no_faces", "all_ignored"):
                logging.debug(f"[MAIN] SLUTresultat för {path.name}: {result}")
                add_to_processed_files(path, processed_files)
                save_database(known_faces, ignored_faces, hard_negatives, processed_files)
                done_images.add(path)
                break
            else:
                logging.debug(f"[MAIN] {path.name}: DELresultat: {result} (försök {attempt_idx+1})")

            # Annars: next attempt (failsafe, ska ej nås)
            attempt_idx += 1

        logging.debug(f"[MAIN] {path.name}: FÄRDIG, {len(attempts_so_far)} försök totalt")
        # Cached preprocessing data is no longer needed once an image is processed
        remove_preprocessed_cache(path)
    worker_process.join()
    preprocessed_queue.close()
    preprocessed_queue.join_thread()
    worker_process = None
    preprocessed_queue_ref = None

    print("✅ Alla bilder färdigbehandlade.")
    cleanup_tmp_previews()


if __name__ == "__main__":
    main()
