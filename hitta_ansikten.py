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
import math
import multiprocessing
import os
import pickle
import queue
import re
import shutil
import signal
import sys
import tempfile
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import matplotlib.font_manager as fm
import numpy as np
import rawpy
from PIL import Image, ImageDraw, ImageFont
from prompt_toolkit import prompt
from prompt_toolkit.completion import WordCompleter

from faceid_db import (ARCHIVE_DIR, ATTEMPT_SETTINGS_SIG, BASE_DIR,
                       CONFIG_PATH, LOGGING_PATH, SUPPORTED_EXT, get_file_hash,
                       load_attempt_log, load_database, save_database, safe_pickle_load)
from face_backends import create_backend, FaceBackend


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
# Use system temp directory for cross-platform compatibility
TEMP_DIR = Path(tempfile.gettempdir()) / "hitta_ansikten"
TEMP_DIR.mkdir(exist_ok=True, parents=True)
ORDINARY_PREVIEW_PATH = str(TEMP_DIR / "preview.jpg")
MAX_ATTEMPTS = 2
MAX_QUEUE = 10
CACHE_DIR = Path("./preprocessed_cache")

# Reserved command shortcuts that cannot be used as person names
RESERVED_COMMANDS = {"i", "a", "r", "n", "o", "m", "x"}

# Face detection and processing constants
FACE_BOX_OVERLAP_BUFFER = 40  # pixels - buffer for detecting overlapping face boxes
MAX_WORKER_WAIT_TIME = 90  # seconds - max time to wait for worker preprocessing
QUEUE_GET_TIMEOUT = 1  # seconds - timeout for queue.get() operations
WORKER_JOIN_TIMEOUT = 30  # seconds - timeout for worker process join
WORKER_TERMINATE_TIMEOUT = 5  # seconds - timeout after terminate before kill


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
    # Antal worker-processer för förbehandling
    "num_workers": 1,
    # Maxlängd på kön mellan workers och huvudtråd
    "max_queue": MAX_QUEUE,

    # === Utseende: etiketter & fönster ===
    # Skalningsfaktor för etikett-textstorlek
    "font_size_factor": 45,
    # App som används för att visa bilder, t.ex. "Bildvisare" eller "feh"
    "image_viewer_app": "Bildvisare",
    # Sökväg för temporär förhandsvisningsbild (will use system temp dir)
    "temp_image_path": None,  # Computed at runtime using ORDINARY_PREVIEW_PATH
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

    # === Backend configuration (face recognition engine) ===
    "backend": {
        "type": "dlib",  # Backend to use: "dlib" or "insightface"
        "dlib": {
            "model": "large"  # Currently unused by DlibBackend; kept for compatibility/future use
        },
        "insightface": {
            "model_name": "buffalo_l",  # Model: buffalo_s (fast), buffalo_m, buffalo_l (accurate)
            "ctx_id": -1,  # -1 = CPU, 0+ = GPU device ID
            "det_size": [640, 640]  # Detection input size
        }
    },

    # Threshold mode: "auto" uses match_threshold/ignore_distance for active backend
    # "manual" uses backend-specific thresholds below
    "threshold_mode": "auto",

    # Backend-specific distance thresholds (used if threshold_mode="manual")
    "backend_thresholds": {
        "dlib": {
            "match_threshold": 0.54,  # Euclidean distance threshold
            "ignore_distance": 0.48,
            "hard_negative_distance": 0.45
        },
        "insightface": {
            "match_threshold": 0.4,  # Cosine distance threshold (typically lower)
            "ignore_distance": 0.35,
            "hard_negative_distance": 0.32
        }
    },
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

def get_attempt_setting_defs(config, backend=None):
    """
    Returnerar alla attempt settings utan rgb_img.

    Args:
        config: Configuration dict
        backend: FaceBackend instance (optional, för backend-specifika nivåer)

    Returns:
        List of attempt setting dicts
    """
    # InsightFace: Enklare nivåer (model/upsample ignoreras ändå)
    # Bara variera upplösning - InsightFace är bra nog att klara de flesta fall
    if backend and backend.backend_name == 'insightface':
        # Use actual model name from backend for clarity in logs/stats
        model_name = backend.get_model_info().get('model', 'buffalo_l')
        return [
            {"model": model_name, "upsample": 0, "scale_label": "mid",  "scale_px": config["max_midsample_px"]},
            {"model": model_name, "upsample": 0, "scale_label": "full", "scale_px": config["max_fullres_px"]},
            {"model": model_name, "upsample": 0, "scale_label": "down", "scale_px": config["max_downsample_px"]},
        ]

    # Dlib: Behåll alla variationer med model och upsample
    return [
        {"model": "cnn", "upsample": 0, "scale_label": "down", "scale_px": config["max_downsample_px"]},
        {"model": "cnn", "upsample": 0, "scale_label": "mid",  "scale_px": config["max_midsample_px"]},
        {"model": "cnn", "upsample": 1, "scale_label": "down", "scale_px": config["max_downsample_px"]},
        {"model": "hog", "upsample": 0, "scale_label": "full", "scale_px": config["max_fullres_px"]},
        {"model": "cnn", "upsample": 0, "scale_label": "full", "scale_px": config["max_fullres_px"]},
        {"model": "cnn", "upsample": 1, "scale_label": "mid",  "scale_px": config["max_midsample_px"]},
        {"model": "cnn", "upsample": 1, "scale_label": "full", "scale_px": config["max_fullres_px"]},
    ]

def get_attempt_settings(config, rgb_down, rgb_mid, rgb_full, backend=None):
    """
    Kopplar rgb_img enligt scale_label.

    Args:
        config: Configuration dict
        rgb_down, rgb_mid, rgb_full: Preprocessed images at different resolutions
        backend: FaceBackend instance (optional, för backend-specifika nivåer)
    """
    arr_map = {
        "down": rgb_down,
        "mid": rgb_mid,
        "full": rgb_full,
    }
    settings = []
    for item in get_attempt_setting_defs(config, backend):
        item_with_img = dict(item)  # kopiera!
        item_with_img["rgb_img"] = arr_map[item["scale_label"]]
        settings.append(item_with_img)
    return settings

def get_max_possible_attempts(config, backend=None):
    """Returns max number of attempts for current backend."""
    return len(get_attempt_setting_defs(config, backend))

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
    """
    Hash an encoding, handling both dict and ndarray formats.

    Returns None for corrupted or invalid encodings.
    """
    # Hantera både dict och ndarray
    if isinstance(enc, dict) and "encoding" in enc:
        enc = enc["encoding"]

    # Handle None encodings (corrupted or missing data)
    if enc is None:
        return None

    # Validate encoding can be hashed
    try:
        return hashlib.sha1(enc.tobytes()).hexdigest()
    except (AttributeError, ValueError, TypeError) as e:
        logging.error(f"Failed to hash encoding: {type(enc).__name__}: {e}")
        return None

def export_and_show_original(image_path, config):
    """
    Exporterar NEF-filen till högupplöst JPG och skriver en statusfil för Bildvisare-appen.
    Visar bilden i bildvisaren (om du vill).
    """
    import json
    from pathlib import Path

    import rawpy
    from PIL import Image

    export_path = TEMP_DIR / "original.jpg"

    try:
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
        with open(status_path, "w", encoding="utf-8") as f:
            json.dump(status, f, indent=2)
    except FileNotFoundError:
        logging.error(f"[EXPORT] File not found: {image_path}")
        print(f"⚠️  Kunde inte hitta filen: {image_path}")
    except Exception as e:
        logging.error(f"[EXPORT] Failed to export {image_path}: {e}")
        print(f"⚠️  Kunde inte exportera bild: {e}")

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
            current_file = status.get("file_path", "")

            if app_status == "running":
                # Check if Bildvisare is showing the correct file
                try:
                    if current_file and os.path.samefile(current_file, expected_path):
                        # Already showing the right file - trust file watching for updates
                        should_open = False
                        logging.debug(f"[BILDVISARE] Bildvisaren visar redan rätt fil: {expected_path}")
                    else:
                        # Running but showing different/no file - open the preview
                        should_open = True
                        logging.debug(f"[BILDVISARE] Bildvisaren kör men visar annan fil ({current_file}), öppnar {expected_path}")
                except (OSError, ValueError):
                    # File doesn't exist or can't compare - open it
                    should_open = True
                    logging.debug(f"[BILDVISARE] Kan inte jämföra filer, öppnar {expected_path}")

            elif app_status == "exited":
                logging.debug(f"[BILDVISARE] Bildvisaren har avslutats, kommer öppna bild")
                should_open = True
            else:
                logging.debug(f"[BILDVISARE] Bildvisar-status: {app_status} inte behandlad, kommer öppna bild")
                should_open = True
        except Exception as e:
            logging.debug(f"[BILDVISARE] Misslyckades läsa statusfilen: {status_path} ({e}), kommer öppna bild")
            should_open = True

    if should_open:
        # Validate viewer_app to prevent command injection
        # Allow alphanumeric, spaces, hyphens, underscores, dots
        safe_chars = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_.")
        if not viewer_app or not all(c in safe_chars for c in viewer_app):
            logging.error(f"[SECURITY] Invalid viewer app name: {viewer_app}")
            print(f"⚠️  Säkerhetsvarning: Ogiltig bildvisarapp '{viewer_app}', hoppar över", file=sys.stderr)
            return

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
                                ignored_faces, hard_negatives, config, backend):
    """
    Label face encodings with matches. Uses optimized filtering for batch processing.
    """
    # Pre-filter database once for all faces (optimization for multiple faces)
    filtered_known, filtered_ignored, filtered_hard_negs = filter_database_by_backend(
        known_faces, ignored_faces, hard_negatives, backend
    )

    labels = []
    for i, encoding in enumerate(face_encodings):
        # Use optimized filtered matching
        (best_name, best_name_dist), (best_ignore, best_ignore_dist) = best_matches_filtered(
            encoding, filtered_known, filtered_ignored, filtered_hard_negs, config, backend
        )
        name_conf = int((1 - best_name_dist) * 100) if best_name_dist is not None else None
        ign_conf = int((1 - best_ignore_dist) * 100) if best_ignore_dist is not None else None
        label, _ = get_match_label(i, best_name, best_name_dist, name_conf, best_ignore, best_ignore_dist, ign_conf, config)
        labels.append(label)
    return labels

def handle_manual_add(known_faces, image_path, file_hash, input_name_func, backend, labels=None):
    """
    Lägg till manuell person – även med file och hash.
    Om labels ges (lista), addera ett label-objekt, annars returnera namn och label.

    Args:
        backend: FaceBackend instance (for metadata, even though encoding is None)
    """
    while True:
        namn = input_name_func(list(known_faces.keys()), "Manuellt tillägg – ange namn: ")
        # Validera att namnet inte är ett reserverat kommando
        if namn and namn.lower() in RESERVED_COMMANDS:
            print(f"⚠️  '{namn}' är ett reserverat kommando och kan inte användas som namn. Ange ett annat namn.")
            continue
        break

    if namn and namn not in known_faces:
        known_faces[namn] = []
    # Spara dummy-encoding med backend metadata
    known_faces[namn].append({
        "encoding": None,
        "file": str(image_path.name) if image_path is not None and hasattr(image_path, "name") else str(image_path),
        "hash": file_hash,
        "backend": backend.backend_name,
        "backend_version": backend.get_model_info().get('model', 'unknown'),
        "created_at": datetime.now().isoformat(),
        "encoding_hash": None  # No encoding for manual add
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

def add_hard_negative(hard_negatives, person, encoding, backend, image_path=None, file_hash=None):
    """Add a hard negative example for a person with full metadata."""
    if person not in hard_negatives:
        hard_negatives[person] = []
    normalized_encoding = backend.normalize_encoding(encoding)
    hard_negatives[person].append({
        "encoding": normalized_encoding,
        "file": str(image_path.name) if image_path and hasattr(image_path, "name") else str(image_path) if image_path else None,
        "hash": file_hash,
        "backend": backend.backend_name,
        "backend_version": backend.get_model_info().get('model', 'unknown'),
        "created_at": datetime.now().isoformat(),
        "encoding_hash": hashlib.sha1(normalized_encoding.tobytes()).hexdigest()
    })

def validate_action(action: str, ans: str, relevant_actions: set, best_name: str | None) -> tuple[bool, str | None]:
    """
    Validate if an action is allowed in the current context.

    Args:
        action: The action to validate
        ans: User's raw input
        relevant_actions: Set of allowed action keys for this case
        best_name: Current best match name (None if no match)

    Returns:
        (is_valid: bool, error_message: str | None)
        error_message is None if valid
    """
    # Validate that action is a known action
    VALID_ACTIONS = {"ignore", "accept_suggestion", "edit", "retry", "show_original", "manual", "skip", "name"}
    if action not in VALID_ACTIONS:
        return False, f"Internt fel: Okänd action '{action}'"

    # Validate accept_suggestion requires best_name (do this before relevance check for better error message)
    if action == "accept_suggestion" and not best_name:
        cmd_name = f"'{ans.lower()}'" if ans else "acceptera förslag"
        return False, f"Kommandot {cmd_name} kan inte användas - det finns inget förslag."

    # Check if command is relevant for this case
    if ans and ans.lower() in RESERVED_COMMANDS:
        if ans.lower() not in relevant_actions:
            return False, f"Kommandot '{ans.lower()}' är inte tillgängligt i detta läge."

    return True, None


def get_validated_user_input(
    prompt_txt: str,
    case: str,
    base_actions: dict,
    relevant_actions: set,
    default_action: str,
    best_name: str | None,
    known_faces: dict
) -> tuple[str, str, str | None]:
    """
    Get and validate user input for face review.

    Args:
        prompt_txt: Prompt to show user
        case: Current case (name, ign, uncertain_name, uncertain_ign, unknown)
        base_actions: Dict mapping commands to actions
        relevant_actions: Set of allowed commands for this case
        default_action: Action to use if user presses Enter
        best_name: Current best match (None if no match)
        known_faces: Dict of known faces (for name autocomplete)

    Returns:
        (action: str, raw_answer: str, new_name: str | None)
        - action: The validated action to take
        - raw_answer: User's raw input (for logging)
        - new_name: New name if action is "edit", otherwise None
    """
    # Validate case parameter (depends on categorization in user_review_encodings)
    VALID_CASES = {"name", "ign", "uncertain_name", "uncertain_ign", "unknown"}
    assert case in VALID_CASES, f"Unexpected case '{case}'. Expected one of: {sorted(VALID_CASES)}"

    while True:
        # Determine input method based on case (more robust than string matching)
        is_name_input = (case == "unknown")

        if is_name_input:
            ans = input_name(list(known_faces.keys()), prompt_txt).strip()

            # User entered something that matches a base command
            # (validation of relevance happens later in validate_action)
            if ans.lower() in base_actions:
                action = base_actions[ans.lower()]
                new_name = None
            # User entered a new name
            elif ans:
                action = "edit"
                new_name = ans
            # User pressed Enter without input: re-prompt
            else:
                print("⚠️  Du måste ange ett namn eller ett kommando.")
                continue
        else:
            ans = safe_input(prompt_txt).strip().lower()
            # Handle answer: empty -> default, otherwise lookup in base_actions
            if ans == "":
                action = default_action
            else:
                action = base_actions.get(ans, default_action)
            new_name = None

        # Validate the action
        is_valid, error_msg = validate_action(action, ans, relevant_actions, best_name)
        if not is_valid:
            print(f"⚠️  {error_msg}")
            continue

        return action, ans, new_name


def user_review_encodings(
    face_encodings, known_faces, ignored_faces, hard_negatives, config, backend,
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
            encoding, known_faces, ignored_faces, hard_negatives, config, backend
        )
        name_confidence = int((1 - best_name_dist) * 100) if best_name_dist is not None else None
        ignore_confidence = int((1 - best_ignore_dist) * 100) if best_ignore_dist is not None else None

        # Alla kommandon är alltid tillgängliga (base_actions)
        # Vi håller koll på vilka som är *relevanta* för att ge felmeddelanden
        base_actions = {
            "i": "ignore",
            "a": "accept_suggestion",
            "r": "edit",
            "n": "retry",
            "o": "show_original",
            "m": "manual",
            "x": "skip",
        }

        # Centraliserad logik
        label_txt, case = get_face_match_status(
            i, best_name, best_name_dist, name_confidence,
            best_ignore, best_ignore_dist, ignore_confidence, config
        )

        # Bestäm vilka actions som är relevanta för detta case
        if case == "uncertain_name":
            prompt_txt = (
                f"↪ Osäkert: {best_name} ({name_confidence}%) / ign ({ignore_confidence}%)\n"
                "[Enter/a = bekräfta namn, i = ignorera, r = rätta, n = försök igen, "
                "o = öppna original, m = manuell tilldelning, x = skippa bild] › "
            )
            relevant_actions = {"i", "a", "r", "n", "o", "m", "x"}
            default_action = "name"

        elif case == "uncertain_ign":
            prompt_txt = (
                f"↪ Osäkert: ign ({ignore_confidence}%) / {best_name} ({name_confidence}%)\n"
                "[Enter = bekräfta ignorera, a = acceptera namn, i = ignorera, r = rätta, n = försök igen, "
                "o = öppna original, m = manuell tilldelning, x = skippa bild] › "
            )
            relevant_actions = {"i", "a", "r", "n", "o", "m", "x"}
            default_action = "ignore"

        elif case == "name":
            prompt_txt = (
                f"↪ Föreslaget: {best_name} ({name_confidence}%)\n"
                "[Enter = bekräfta, a = acceptera förslag, r = rätta, n = försök igen, i = ignorera, "
                "o = öppna original, m = manuell tilldelning, x = skippa bild] › "
            )
            relevant_actions = {"a", "r", "n", "i", "o", "m", "x"}
            default_action = "name"

        elif case == "ign":
            prompt_txt = (
                f"↪ Ansiktet liknar ett tidigare ignorerat ({ignore_confidence}%).\n"
                "[Enter = bekräfta ignorera, a = acceptera namn, i = ignorera, r = rätta, n = försök igen, "
                "o = öppna original, m = manuell tilldelning, x = skippa bild] › "
            )
            relevant_actions = {"a", "r", "n", "i", "o", "m", "x"}
            default_action = "ignore"

        else:  # "unknown"
            prompt_txt = (
                "↪ Okänt ansikte. Ange namn (eller 'i' för ignorera, a = acceptera förslag, r = rätta, n = försök igen, "
                "m = manuell tilldelning, o = öppna original, x = skippa bild) › "
            )
            relevant_actions = {"i", "r", "n", "o", "m", "x", "a"}  # 'a' ger felmeddelande
            default_action = "edit"

        # Initialize action as None to get user input on first iteration
        action = None
        ans = None
        new_name = None

        while True:
            # Get validated user input (skip if we have a pending action from nested handler)
            if action is None:
                action, ans, new_name = get_validated_user_input(
                    prompt_txt=prompt_txt,
                    case=case,
                    base_actions=base_actions,
                    relevant_actions=relevant_actions,
                    default_action=default_action,
                    best_name=best_name,
                    known_faces=known_faces
                )

            # Execute action (clean separation of concerns)
            if action == "show_original":
                if image_path is not None:
                    export_and_show_original(image_path, config)
                elif preview_path is not None:
                    show_temp_image(preview_path, config, image_path)
                action = None  # Reset to get new input on next iteration
                continue
            elif action == "manual":
                handle_manual_add(known_faces, image_path, file_hash, input_name, backend, labels)
                all_ignored = False
                action = None  # Reset to get new input on next iteration
                continue
            elif action == "skip":
                return "skipped", []
            elif action == "retry":
                retry_requested = True
                break
            elif action == "accept_suggestion":
                # 'a' command - accept best_name (already validated by get_validated_user_input)
                name = best_name
                all_ignored = False
                break
            elif action == "edit":
                # If new_name is None, user pressed 'r' (edit) from a non-edit case
                # We need to prompt for the corrected name
                if new_name is None:
                    # Keep prompting until we get a valid name or valid command
                    # This maintains the name correction context instead of jumping back to main prompt
                    while True:
                        new_name = input_name(list(known_faces.keys()))

                        # Handle if user entered a command instead of a name
                        if new_name.lower() in base_actions:
                            cmd_action = base_actions[new_name.lower()]

                            # Validate the command (reuse centralized validation)
                            is_valid, error_msg = validate_action(cmd_action, new_name.lower(), relevant_actions, best_name)
                            if not is_valid:
                                print(f"⚠️  {error_msg}")
                                # Stay in name correction context - re-prompt for name
                                continue

                            # Valid command - execute by looping back to main handler
                            # This avoids duplicating all the action execution logic
                            action = cmd_action
                            new_name = None
                            break  # Break out of name input loop to execute command

                        # Valid name entered (reserved commands already handled above in base_actions check)
                        break

                    # If a command was entered (action changed), execute it via main handler
                    if action != "edit":
                        continue  # Loop back to main handler to execute the command

                # Now we have a valid name
                if new_name is not None:
                    name = new_name
                    all_ignored = False
                    # Hard negative: Save encoding as hard negative for best_name if incorrectly suggested
                    if best_name and name != best_name:
                        add_hard_negative(hard_negatives, best_name, encoding, backend, image_path, file_hash)
                    break
            elif action == "ignore":
                normalized_encoding = backend.normalize_encoding(encoding)
                ignored_faces.append({
                    "encoding": normalized_encoding,
                    "file": str(image_path.name) if image_path and hasattr(image_path, "name") else str(image_path),
                    "hash": file_hash,
                    "backend": backend.backend_name,
                    "backend_version": backend.get_model_info().get('model', 'unknown'),
                    "created_at": datetime.now().isoformat(),
                    "encoding_hash": hashlib.sha1(normalized_encoding.tobytes()).hexdigest()
                })
                labels.append({"label": f"#{i+1}\nignorerad", "hash": hashlib.sha1(normalized_encoding.tobytes()).hexdigest()})
                break
            elif action == "name":
                name = best_name if best_name else input_name(list(known_faces.keys()))
                # Kontrollera om namnet är ett reserverat kommando
                if name and name.lower() in RESERVED_COMMANDS:
                    print(f"⚠️  '{name}' är ett reserverat kommando och kan inte användas som namn. Ange ett annat namn.")
                    action = None  # Reset to get new input on next iteration
                    name = None  # Reset name to avoid keeping an invalid reserved command
                    continue
                all_ignored = False
                break

        if retry_requested:
            break
        if name is not None and name.lower() not in RESERVED_COMMANDS:
            if name not in known_faces:
                known_faces[name] = []
            normalized_encoding = backend.normalize_encoding(encoding)
            known_faces[name].append({
                "encoding": normalized_encoding,
                "file": str(image_path.name) if image_path is not None and hasattr(image_path, "name") else str(image_path),
                "hash": file_hash,
                "backend": backend.backend_name,
                "backend_version": backend.get_model_info().get('model', 'unknown'),
                "created_at": datetime.now().isoformat(),
                "encoding_hash": hashlib.sha1(normalized_encoding.tobytes()).hexdigest()
            })
            labels.append({"label": f"#{i+1}\n{name}", "hash": hashlib.sha1(normalized_encoding.tobytes()).hexdigest()})

    if retry_requested:
        logging.debug(f"[REVIEW] Retry ombett, återgår till anropare")
        return "retry", []
    if all_ignored:
        logging.debug(f"[REVIEW] Alla ansikten ignorerade; returnerar 'all_ignored'.")
        return "all_ignored", []
    logging.debug(f"[REVIEW] Alla ansikten granskade, returnerar 'ok'.")
    return "ok", labels

def box_overlaps_with_buffer(b1, b2, buffer=FACE_BOX_OVERLAP_BUFFER):
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

    temp_dir = str(TEMP_DIR)
    temp_prefix = "hitta_ansikten_preview"
    temp_suffix = f"{suffix}.jpg" if suffix else ".jpg"

    with tempfile.NamedTemporaryFile(prefix=temp_prefix, suffix=temp_suffix, dir=temp_dir, delete=False) as tmp:
        canvas.save(tmp.name, format="JPEG")
        return tmp.name

# === Backend threshold helper ===
def _get_backend_thresholds(config, backend):
    """
    Get appropriate thresholds for current backend.

    Args:
        config: Full config dict
        backend: FaceBackend instance

    Returns:
        Dict with 'match_threshold', 'ignore_distance', 'hard_negative_distance'
    """
    threshold_mode = config.get('threshold_mode', 'auto')

    if threshold_mode == 'manual':
        # Use backend-specific thresholds when available
        backend_thresholds = config.get('backend_thresholds', {})
        if backend.backend_name in backend_thresholds:
            return backend_thresholds[backend.backend_name]

        # Fallback: log warning and use top-level config values
        logging.warning(
            f"Manual threshold mode: no thresholds configured for backend '{backend.backend_name}'; "
            f"falling back to top-level threshold values which may not match this "
            f"backend's distance metric."
        )
        return {
            'match_threshold': config.get('match_threshold', 0.6),
            'ignore_distance': config.get('ignore_distance', 0.5),
            'hard_negative_distance': config.get('hard_negative_distance', 0.45)
        }
    else:
        # Auto mode: prefer backend-specific thresholds, then adjust by distance metric
        backend_thresholds = config.get('backend_thresholds', {})
        backend_specific = backend_thresholds.get(backend.backend_name)
        if backend_specific is not None:
            return backend_specific

        # Fallback based on backend distance metric
        distance_metric = getattr(backend, 'distance_metric', 'euclidean')

        # Default thresholds for Euclidean-like metrics (preserves existing behavior)
        default_match = 0.6
        default_ignore = 0.5
        default_hard_negative = 0.45

        # For cosine distance, typical thresholds are lower (e.g. ~0.4)
        if isinstance(distance_metric, str) and 'cos' in distance_metric.lower():
            default_match = 0.4
            default_ignore = 0.35
            default_hard_negative = 0.32

        return {
            'match_threshold': config.get('match_threshold', default_match),
            'ignore_distance': config.get('ignore_distance', default_ignore),
            'hard_negative_distance': config.get('hard_negative_distance', default_hard_negative)
        }


# === Beräkna avstånd till kända encodings ===
def validate_encoding_dimension(encoding, backend, context=""):
    """
    Validate that encoding dimension matches backend's expected dimension.

    Args:
        encoding: Numpy array encoding to validate
        backend: FaceBackend instance
        context: Optional context string for logging (e.g., "known_faces:PersonName")

    Returns:
        True if valid, False if dimension mismatch
    """
    if encoding is None:
        return False

    if not hasattr(encoding, '__len__'):
        logging.warning(f"[VALIDATION] Invalid encoding type {type(encoding).__name__} {context}")
        return False

    expected_dim = backend.encoding_dim
    actual_dim = len(encoding)

    if actual_dim != expected_dim:
        logging.warning(
            f"[VALIDATION] Encoding dimension mismatch for {backend.backend_name} backend: "
            f"expected {expected_dim}, got {actual_dim} {context}"
        )
        return False

    return True


def filter_database_by_backend(known_faces, ignored_faces, hard_negatives, backend):
    """
    Pre-filter all database structures by backend for efficient batch processing.

    This optimization reduces redundant filtering when processing multiple faces
    from the same image. Call once per image, then reuse filtered results.

    Args:
        known_faces: Dict of {name: [encoding_entries]}
        ignored_faces: List of encoding entries
        hard_negatives: Dict of {name: [hard_negative_entries]}
        backend: FaceBackend instance

    Returns:
        Tuple of (filtered_known, filtered_ignored, filtered_hard_negs)
        where encodings are pre-filtered and validated for the backend
    """
    import numpy as np

    # Filter known_faces
    filtered_known = {}
    for name, entries in known_faces.items():
        encs = []
        for entry in entries:
            if isinstance(entry, dict):
                entry_enc = entry.get("encoding")
                entry_backend = entry.get("backend", "dlib")
            else:
                entry_enc = entry
                entry_backend = "dlib"

            if entry_enc is not None and entry_backend == backend.backend_name:
                if isinstance(entry_enc, np.ndarray):
                    if validate_encoding_dimension(entry_enc, backend, f"known_faces:{name}"):
                        encs.append(entry_enc)

        if encs:
            filtered_known[name] = np.array(encs)

    # Filter ignored_faces
    filtered_ignored = []
    for entry in ignored_faces:
        if isinstance(entry, dict):
            entry_enc = entry.get("encoding")
            entry_backend = entry.get("backend", "dlib")
        else:
            entry_enc = entry
            entry_backend = "dlib"

        if entry_enc is not None and entry_backend == backend.backend_name:
            if isinstance(entry_enc, np.ndarray):
                if validate_encoding_dimension(entry_enc, backend, "ignored_faces"):
                    filtered_ignored.append(entry_enc)

    filtered_ignored = np.array(filtered_ignored) if filtered_ignored else None

    # Filter hard_negatives
    filtered_hard_negs = {}
    for name, entries in hard_negatives.items():
        negs = []
        for entry in entries:
            if isinstance(entry, dict):
                entry_enc = entry.get("encoding")
                entry_backend = entry.get("backend", "dlib")
            else:
                entry_enc = entry
                entry_backend = "dlib"

            if entry_enc is not None and entry_backend == backend.backend_name:
                if isinstance(entry_enc, np.ndarray):
                    if validate_encoding_dimension(entry_enc, backend, f"hard_negatives:{name}"):
                        negs.append(entry_enc)

        if negs:
            filtered_hard_negs[name] = np.array(negs)

    return filtered_known, filtered_ignored, filtered_hard_negs


def best_matches_filtered(encoding, filtered_known, filtered_ignored, filtered_hard_negs, config, backend):
    """
    Find best matching person using pre-filtered encodings (optimized version).

    This is an optimized version of best_matches() that accepts pre-filtered
    numpy arrays instead of raw database structures. Use filter_database_by_backend()
    to prepare the inputs. This avoids redundant filtering when processing
    multiple faces from the same image.

    Args:
        encoding: Face encoding to match
        filtered_known: Dict of {name: np.array of encodings} (pre-filtered)
        filtered_ignored: np.array of ignored encodings or None (pre-filtered)
        filtered_hard_negs: Dict of {name: np.array of hard negs} (pre-filtered)
        config: Config dict
        backend: FaceBackend instance

    Returns:
        (best_name, best_name_dist), (best_ignore_idx, best_ignore_dist)
    """
    import numpy as np

    best_name = None
    best_name_dist = None
    best_ignore_idx = None
    best_ignore_dist = None

    # Get backend-appropriate thresholds
    thresholds = _get_backend_thresholds(config, backend)
    hard_negative_thr = thresholds.get('hard_negative_distance', 0.45)

    # Match against known faces (already filtered)
    for name, encs in filtered_known.items():
        # Check hard negatives for this person
        is_hard_negative = False
        if filtered_hard_negs and name in filtered_hard_negs:
            hard_negs = filtered_hard_negs[name]
            neg_dists = backend.compute_distances(hard_negs, encoding)
            if np.min(neg_dists) < hard_negative_thr:
                is_hard_negative = True

        if is_hard_negative:
            continue

        # Compute distances
        dists = backend.compute_distances(encs, encoding)
        min_dist = np.min(dists)

        if best_name_dist is None or min_dist < best_name_dist:
            best_name_dist = min_dist
            best_name = name

    # Match against ignored faces (already filtered)
    if filtered_ignored is not None and len(filtered_ignored) > 0:
        dists = backend.compute_distances(filtered_ignored, encoding)
        min_dist = np.min(dists)
        best_ignore_dist = min_dist
        best_ignore_idx = int(np.argmin(dists))
    else:
        best_ignore_dist = None
        best_ignore_idx = None

    return (best_name, best_name_dist), (best_ignore_idx, best_ignore_dist)


def best_matches(encoding, known_faces, ignored_faces, hard_negatives, config, backend: FaceBackend):
    """
    Find best matching person and ignore candidate using backend.

    Args:
        encoding: Face encoding to match
        known_faces: Dict of {name: [encoding_entries]}
        ignored_faces: List of ignored encoding entries
        hard_negatives: Dict of {name: [hard_negative_entries]}
        config: Config dict
        backend: FaceBackend instance

    Returns:
        (best_name, best_name_dist), (best_ignore_idx, best_ignore_dist)
    """
    import numpy as np

    best_name = None
    best_name_dist = None
    best_ignore_idx = None
    best_ignore_dist = None

    # Get backend-appropriate thresholds
    thresholds = _get_backend_thresholds(config, backend)
    hard_negative_thr = thresholds.get('hard_negative_distance', 0.45)

    # Match against known faces (with backend filtering)
    for name, entries in known_faces.items():
        # Filter encodings by backend
        encs = []
        for entry in entries:
            if isinstance(entry, dict):
                entry_enc = entry.get("encoding")
                entry_backend = entry.get("backend", "dlib")
            else:
                # Legacy numpy array
                entry_enc = entry
                entry_backend = "dlib"

            # Only match against same backend with correct dimensions
            if entry_enc is not None and entry_backend == backend.backend_name:
                if isinstance(entry_enc, np.ndarray):
                    if validate_encoding_dimension(entry_enc, backend, f"known_faces:{name}"):
                        encs.append(entry_enc)

        if not encs:
            continue  # No encodings for this backend

        # Check hard negatives (same backend filtering)
        hard_negs = []
        if hard_negatives and name in hard_negatives:
            for neg in hard_negatives[name]:
                if isinstance(neg, dict):
                    neg_enc = neg.get("encoding")
                    neg_backend = neg.get("backend", "dlib")
                else:
                    neg_enc = neg
                    neg_backend = "dlib"

                if neg_enc is not None and neg_backend == backend.backend_name:
                    if isinstance(neg_enc, np.ndarray):
                        if validate_encoding_dimension(neg_enc, backend, f"hard_negatives:{name}"):
                            hard_negs.append(neg_enc)

        # Check if encoding matches hard negatives
        is_hard_negative = False
        if hard_negs:
            neg_dists = backend.compute_distances(np.array(hard_negs), encoding)
            if np.min(neg_dists) < hard_negative_thr:
                is_hard_negative = True

        if is_hard_negative:
            continue  # Skip this person

        # Compute distances using backend
        dists = backend.compute_distances(np.array(encs), encoding)
        min_dist = np.min(dists)

        if best_name_dist is None or min_dist < best_name_dist:
            best_name_dist = min_dist
            best_name = name

    # Match against ignored faces (with backend filtering)
    ignored_encs = []
    for entry in ignored_faces:
        if isinstance(entry, dict):
            entry_enc = entry.get("encoding")
            entry_backend = entry.get("backend", "dlib")
        else:
            entry_enc = entry
            entry_backend = "dlib"

        if entry_enc is not None and entry_backend == backend.backend_name:
            if isinstance(entry_enc, np.ndarray):
                if validate_encoding_dimension(entry_enc, backend, "ignored_faces"):
                    ignored_encs.append(entry_enc)

    if ignored_encs:
        dists = backend.compute_distances(np.array(ignored_encs), encoding)
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

def face_detection_attempt(rgb, model, upsample, backend: FaceBackend):
    """
    Detect faces using configured backend.

    Args:
        rgb: RGB image array
        model: Detection model hint ('hog', 'cnn')
        upsample: Upsampling factor
        backend: FaceBackend instance

    Returns:
        (face_locations, face_encodings)
    """
    t0 = time.time()
    logging.debug(f"[FACEDETECT] begins: backend={backend.backend_name}, model={model}, upsample={upsample}")

    face_locations, face_encodings = backend.detect_faces(rgb, model, upsample)

    t1 = time.time()
    logging.debug(f"[FACEDETECT] Complete: {len(face_locations)} faces found in {t1-t0:.2f}s")

    return face_locations, face_encodings

def input_name(known_names, prompt_txt="Ange namn (eller 'i' för ignorera, n = försök igen, x = skippa bild) › "):
    """
    Ber användaren om ett namn med autocomplete.
    Reserverade kommandon (i, a, r, n, o, m, x) returneras som är för vidare hantering.
    """
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
            enc_hash = hash_encoding(enc)
            # Skip corrupted encodings (None hash)
            if enc_hash is not None and enc_hash == hashval:
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
                enc_hash = hash_encoding(enc)
                # Skip corrupted encodings (None hash)
                if enc_hash is not None and enc_hash == hashval:
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
    backend,
    max_attempts=3,
    attempts_so_far=None
):
    """
    Förbehandlar en bild och returnerar en lista av attempt-resultat.
    Om attempts_so_far anges (lista), används befintliga attempts och endast saknade attempts (index >= len(attempts_so_far)) körs.

    Args:
        backend: FaceBackend instance for face detection and encoding
    """
    fname = str(image_path)
    logging.debug(f"[PREPROCESS image][{fname}] start")

    # Check if file exists before preprocessing
    if not Path(image_path).exists():
        logging.warning(f"[PREPROCESS image][SKIP][{fname}] File does not exist, skipping")
        return []

    try:
        max_down = config.get("max_downsample_px")
        max_mid = config.get("max_midsample_px")
        max_full = config.get("max_fullres_px")
        rgb_down = load_and_resize_raw(image_path, max_down)
        rgb_mid = load_and_resize_raw(image_path, max_mid)
        rgb_full = load_and_resize_raw(image_path, max_full)

        attempt_settings = get_attempt_settings(config, rgb_down, rgb_mid, rgb_full, backend)
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
            rgb, setting["model"], setting["upsample"], backend
        )
        logging.debug(f"[PREPROCESS image][{fname}] Attempt {attempt_idx}: label_preview_for_encodings")
        preview_labels = label_preview_for_encodings(
            face_encodings, known_faces, ignored_faces, hard_negatives, config, backend
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
            "backend": backend.backend_name,
            "backend_version": backend.get_model_info().get('model', 'unknown'),
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
                            config, backend, attempt_results):
    """
    Review-loop för EN attempt (sista) för en redan preprocessad bild.

    Args:
        backend: FaceBackend instance
    """
    # Check if file exists before review
    if not Path(image_path).exists():
        logging.warning(f"[REVIEW][SKIP][{image_path}] File does not exist, skipping review")
        return "skipped"
    
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
        "backend": backend.backend_name,
        "backend_version": backend.get_model_info().get('model', 'unknown'),
        "upsample": res["upsample"],
        "scale_label": res["scale_label"],
        "scale_px": res["scale_px"],
        "time_seconds": elapsed,
        "faces_found": len(face_encodings),
    })

    import shutil
    ordinary_preview_path = config.get("ordinary_preview_path") or ORDINARY_PREVIEW_PATH
    try:
        shutil.copy(preview_path, ordinary_preview_path)
    except Exception as e:
        print(f"[WARN] Kunde inte kopiera preview till {ordinary_preview_path}: {e}")
    show_temp_image(ordinary_preview_path, config, image_path)

    if face_encodings:
        review_result, labels = user_review_encodings(
            face_encodings, known_faces, ignored_faces, hard_negatives, config, backend,
            image_path, preview_path, file_hash
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
            handle_manual_add(known_faces, image_path, file_hash, input_name, backend)
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

def process_image(image_path, known_faces, ignored_faces, hard_negatives, config, backend):
    """Single-image processing wrapper."""
    attempt_results = preprocess_image(image_path, known_faces, ignored_faces,
                                       hard_negatives, config, backend, max_attempts=1)

    return main_process_image_loop(image_path, known_faces, ignored_faces, hard_negatives,
                                   config, backend, attempt_results)


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
    """
    Normalize name by removing diacritics and sanitizing for safe filename use.

    Security: Replaces path separators and null bytes to prevent path traversal.
    """
    # Remove diacritics (Källa → Kalla, François → Francois)
    n = unicodedata.normalize('NFKD', name)
    n = "".join(c for c in n if not unicodedata.combining(c))

    # Sanitize for filesystem safety: remove path separators and null bytes
    # Replace / and \ with _ to prevent directory traversal
    n = n.replace('/', '_').replace('\\', '_').replace('\0', '_')

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
    """
    Build new filename with person names.

    Security: Validates against path traversal attempts.
    """
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
    new_name = f"{prefix}_{namnstr}{suffix}"

    # Security: Validate no path traversal attempts
    if '..' in new_name or '/' in new_name or '\\' in new_name or '\0' in new_name:
        logging.error(f"[SECURITY] Rejected unsafe filename: {new_name}")
        return None

    return new_name

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
    """Clean up temporary preview files from TEMP_DIR."""
    if not TEMP_DIR.exists():
        return
    for path in TEMP_DIR.glob("hitta_ansikten_*"):
        try:
            path.unlink()
        except Exception as e:
            logging.debug(f"Failed to remove temp file {path}: {e}")
            pass  # Ignorera ev. misslyckanden

# === Graceful Exit ===
def signal_handler(sig, frame):
    print("\n⏹ Avbruten. Programmet avslutas.")
    cleanup_tmp_previews()
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
            # Only copy if source and destination are different files
            prev_path = Path(prev).resolve()
            dest_path = dest.resolve()
            if prev_path != dest_path:
                shutil.copy(prev, dest)
            entry["preview_path"] = str(dest)
        cached.append(entry)
    try:
        with open(cache_path, "wb") as f:
            pickle.dump((str(path), cached), f)
    except Exception as e:
        logging.error(f"[CACHE] Failed to save cache to {cache_path}: {e}")
    return cached


def load_preprocessed_cache(queue):
    """Load any cached preprocessing results into the queue."""
    if not CACHE_DIR.exists():
        return
    for file in CACHE_DIR.glob("*.pkl"):
        try:
            with open(file, "rb") as f:
                path, attempt_results = safe_pickle_load(f)
            # Check if the original image file still exists before loading into queue
            if not Path(path).exists():
                logging.warning(f"[CACHE] File {path} no longer exists, removing cache")
                # Remove the cache file and associated preview images
                file.unlink()
                h = hashlib.sha1(str(path).encode()).hexdigest()
                for img in CACHE_DIR.glob(f"{h}_a*.jpg"):
                    try:
                        img.unlink()
                    except Exception:
                        # Ignore errors (file already deleted, permission issues, etc.)
                        pass
                continue
            queue.put((path, attempt_results))
        except (FileNotFoundError, pickle.UnpicklingError, OSError) as e:
            logging.warning(f"[CACHE] Failed to load {file}: {e}")


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
            # Ignore errors (file already deleted, permission issues, etc.)
            pass

def preprocess_worker(
    known_faces, ignored_faces, hard_negatives, images_to_process,
    config, max_possible_attempts,
    preprocessed_queue, preprocess_done
):
    """
    Worker process for preprocessing images in background.

    Initializes its own backend instance from config.
    """
    import os
    logging.debug(f"[WORKER] Process started, PID={os.getpid()}, processing {len(images_to_process)} images")
    try:
        # Initialize backend in worker process
        from face_backends import create_backend
        logging.debug(f"[WORKER] About to create backend from config")
        backend = create_backend(config)
        logging.debug(f"[WORKER] Initialized backend: {backend.backend_name}")

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
                # Check if file still exists before processing
                if not Path(path).exists():
                    logging.warning(f"[PREPROCESS worker][SKIP][{path.name}] File no longer exists, removing from queue")
                    active_paths.remove(path)
                    if path in attempt_map:
                        del attempt_map[path]
                    continue
                
                logging.debug(f"[PREPROCESS worker] Attempt {attempt_idx} for {path.name}")
                current_attempts = attempt_map[path]
                partial_results = preprocess_image(
                    path,
                    faces_copy,
                    ignored_copy,
                    hard_negatives_copy,
                    config,
                    backend,
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
    except Exception as e:
        logging.error(f"[PREPROCESS worker][ERROR] {e}")
        import traceback
        # Print error to stderr so it's visible to user
        print(f"\n⚠️  KRITISKT FEL: Worker-processen kraschade!", file=sys.stderr)
        print(f"⚠️  Fel: {type(e).__name__}: {e}", file=sys.stderr)
        print(f"⚠️  Main-processen kommer att fortsätta utan parallell preprocessing.", file=sys.stderr)
        print(f"⚠️  Se hitta_ansikten.log för detaljer.\n", file=sys.stderr)
        traceback.print_exc()
    finally:
        # Always signal completion, even on error, to unblock main loop
        preprocess_done.set()
        logging.debug("[PREPROCESS worker] Done")

# === Entry point ===
def main():
    if any(arg in ("-h", "--help") for arg in sys.argv[1:]):
        print_help()
        sys.exit(0)

    if len(sys.argv) >= 2 and sys.argv[1] == "--archive":
        config = load_config()
        backend = create_backend(config)
        rgb_down = np.zeros((config["max_downsample_px"], config["max_downsample_px"], 3), dtype=np.uint8)
        rgb_mid = np.zeros((config["max_midsample_px"], config["max_midsample_px"], 3), dtype=np.uint8)
        rgb_full = np.zeros((config["max_fullres_px"], config["max_fullres_px"], 3), dtype=np.uint8)
        attempt_settings = get_attempt_settings(config, rgb_down, rgb_mid, rgb_full, backend)
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

    # Initialize face recognition backend
    try:
        backend = create_backend(config)
        logging.info(f"[BACKEND] Initialized: {backend.backend_name}")
        model_info = backend.get_model_info()
        logging.info(f"[BACKEND] Model info: {model_info}")
    except Exception as e:
        logging.error(f"[BACKEND] Failed to initialize backend: {e}")
        print(f"Error: Could not initialize face recognition backend: {e}")

        # Provide backend-specific installation hints
        backend_type = config.get("backend", {}).get("type", "unknown")
        if backend_type == "dlib":
            print("Hint: For the 'dlib' backend, install the required package:")
            print("  pip install face_recognition")
        elif backend_type == "insightface":
            print("Hint: For the 'insightface' backend, install the required packages:")
            print("  pip install insightface onnxruntime")
        else:
            print("Check that all required dependencies for the selected backend are installed.")

        sys.exit(1)

    known_faces, ignored_faces, hard_negatives, processed_files = load_database()
    max_auto_attempts = config.get("max_attempts", MAX_ATTEMPTS)
    max_possible_attempts = get_max_possible_attempts(config, backend)
    max_queue = config.get("max_queue", MAX_QUEUE)
    num_workers = max(1, int(config.get("num_workers", 1)))

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
                result = process_image(path, known_faces, ignored_faces, hard_negatives, config, backend)
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

        # Remove encodings for all files first, then process with workers
        print("\n=== FIXAR: Tar bort gamla encodings ===")
        images_to_process = []
        for path in input_paths:
            if not path.exists():
                logging.warning(f"[FIX][SKIP][{path}] File does not exist")
                print(f"⏭ Hoppar över {path.name} (filen finns inte längre)")
                continue

            print(f"  ➤ {path.name}")
            removed = remove_encodings_for_file(known_faces, ignored_faces, hard_negatives, path.name)
            if removed:
                print(f"     (Tog bort {removed} encodings)")
            images_to_process.append(path)

        if not images_to_process:
            print("Inga matchande bildfiler hittades.")
            sys.exit(1)

        print(f"\n=== Reprocessar {len(images_to_process)} fil(er) med workers ===\n")
        # Fall through to normal worker-based processing below
    else:
        # --------- HUVUDFALL: BEARBETA ALLA EJ BEARBETADE ---------
        input_paths = list(parse_inputs(sys.argv[1:], SUPPORTED_EXT))
        n_found = 0
        images_to_process = []
        for path in input_paths:
            if not path.exists():
                logging.warning(f"[MAIN][SKIP][{path}] File does not exist")
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
    preprocessed_queue = multiprocessing.Queue(maxsize=max_queue)
    preprocess_done = multiprocessing.Event()

    workers = []
    chunk_size = max(1, math.ceil(len(images_to_process) / num_workers))
    logging.debug(f"[MAIN] Starting {num_workers} workers, chunk_size={chunk_size}, {len(images_to_process)} images")
    for i in range(num_workers):
        chunk = images_to_process[i * chunk_size:(i + 1) * chunk_size]
        logging.debug(f"[MAIN] Worker {i}: chunk size = {len(chunk)}")
        if not chunk:
            continue
        p = multiprocessing.Process(
            target=preprocess_worker,
            args=(
                known_faces,
                ignored_faces,
                hard_negatives,
                chunk,
                config,
                max_auto_attempts,
                preprocessed_queue,
                preprocess_done,
            ),
        )
        p.daemon = True
        p.start()
        workers.append(p)
        logging.debug(f"[MAIN] Started worker {i} (PID will be {p.pid})")

    # Check if workers crashed immediately
    import time
    time.sleep(0.1)  # Give workers a moment to start
    if preprocess_done.is_set() and preprocessed_queue.empty():
        print(f"\n⚠️  VARNING: Worker-processen avslutades omedelbart!", file=sys.stderr)
        print(f"⚠️  Detta tyder på ett fel i worker-processen.", file=sys.stderr)
        print(f"⚠️  Preprocessing kommer att göras i main-processen istället (långsammare).\n", file=sys.stderr)

    # === STEG 2: Bild-för-bild, attempt-för-attempt ===
    done_images = set()
    for path in images_to_process:
        # Check if file still exists before processing
        if not path.exists():
            logging.warning(f"[MAIN][SKIP][{path.name}] File no longer exists, skipping")
            done_images.add(path)
            remove_preprocessed_cache(path)
            continue
        
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
                if attempt_idx > 0 and not worker_wait_msg_printed:
                    print(f"(⏳ Väntar på nivå {attempt_idx+1} för {path.name}...)", flush=True)
                    worker_wait_msg_printed = True

                while not fetched:
                    # logging.debug(f"[MAIN] Väntar på attempt {attempt_idx+1} för {path.name}")
                    try:
                        qpath, attempt_results = preprocessed_queue.get(timeout=QUEUE_GET_TIMEOUT)
                        if str(qpath) != path_key:
                            preprocessed_queue.put((qpath, attempt_results))
                            continue
                        attempts_so_far = attempt_results
                        fetched = True
                    except queue.Empty:
                        # Check if worker is done - if so, we won't get any more results
                        if preprocess_done.is_set():
                            logging.debug(f"[MAIN] Worker finished but no attempt {attempt_idx+1} for {path.name}")
                            # No more preprocessing will happen, break out
                            fetched = True
                            # We need to generate this attempt ourselves
                            if len(attempts_so_far) < attempt_idx + 1:
                                logging.debug(f"[MAIN] Generating attempt {attempt_idx+1} manually for {path.name}")
                                attempts_so_far = preprocess_image(
                                    path, known_faces, ignored_faces, hard_negatives, config, backend,
                                    max_attempts=attempt_idx + 1,
                                    attempts_so_far=attempts_so_far
                                )
                        # Otherwise, keep waiting

                logging.debug(f"[MAIN] {path.name}: mottagit {len(attempts_so_far)} attempts")
                if attempt_idx > 0:
                    print(f"(✔️  Nivå {attempt_idx+1} klar för {path.name})", flush=True)
                worker_wait_msg_printed = False

            logging.debug(f"[MAIN][QUEUE GET] {path.name}: hämtar attempt {attempt_idx+1}")

            result = main_process_image_loop(
                path, known_faces, ignored_faces, hard_negatives, config, backend, attempts_so_far
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
                max_wait = MAX_WORKER_WAIT_TIME
                waited = 0
                got_new_attempt = False
                if len(attempts_so_far) < attempt_idx + 1:
                    if not worker_wait_msg_printed:
                        print(f"(⏳ Väntar på nivå {attempt_idx+1} för {path.name}...)", flush=True)
                        worker_wait_msg_printed = True
                    while waited < max_wait:
                        try:
                            qpath, attempt_results = preprocessed_queue.get(timeout=QUEUE_GET_TIMEOUT)
                            if str(qpath) == path_key:
                                attempts_so_far = attempt_results
                                got_new_attempt = True
                                print(f"(✔️  Nivå {attempt_idx+1} klar för {path.name})", flush=True)
                                worker_wait_msg_printed = False
                                break
                            else:
                                preprocessed_queue.put((qpath, attempt_results))
                        except queue.Empty:
                            # Check if worker is done
                            if preprocess_done.is_set():
                                logging.debug(f"[MAIN] Worker finished, no more attempts coming for {path.name}")
                                break
                        waited += 1
                    # Om worker ändå inte levererat: skapa nytt attempt manuellt
                    if not got_new_attempt:
                        logging.debug(f"[MAIN] {path.name}: skapar manuellt nytt attempt {attempt_idx+1}")
                        extra_attempts = preprocess_image(
                            path, known_faces, ignored_faces, hard_negatives, config, backend,
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

    # Clean up workers with timeout to prevent deadlock
    for p in workers:
        p.join(timeout=WORKER_JOIN_TIMEOUT)
        if p.is_alive():
            logging.error(f"Worker {p.pid} did not finish within timeout, terminating")
            print(f"⚠️  Worker {p.pid} hängde, tvångsavslutar...", file=sys.stderr)
            p.terminate()
            p.join(timeout=WORKER_TERMINATE_TIMEOUT)
            if p.is_alive():
                logging.error(f"Worker {p.pid} did not terminate, killing")
                p.kill()
                p.join()

    preprocessed_queue.close()
    preprocessed_queue.join_thread()

    print("✅ Alla bilder färdigbehandlade.")
    cleanup_tmp_previews()


if __name__ == "__main__":
    main()
