import fnmatch
import json
import math
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
  "auto_ignore": False,
  "auto_ignore_on_fix": True,
  "detection_model": "hog",
  "font_size_factor": 45,
  "ignore_distance": 0.5,
  "image_viewer_app": "Bildvisare",
  "label_bg_color": [0, 0, 0, 192],
  "label_text_color": [255, 255, 0],
  "prefer_name_margin": 0.10,  # Namn måste vara minst så här mycket bättre än ignore för att vinna automatiskt
  "match_threshold": 0.6,
  "max_downsample_px": 2500,
  "max_fullres_px": 6000,
  "min_confidence": 0.4,
  "padding": 15,
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

def show_temp_image(preview_path, config, last_shown=[None]):
    viewer_app = config.get("image_viewer_app", "Bildvisare")
    status_path = Path.home() / "Library" / "Application Support" / "bildvisare" / "status.json"
    expected_path = str(Path(preview_path).resolve())

    should_open = True  # Default: öppna om osäkert

    if status_path.exists():
        try:
            with open(status_path, "r") as f:
                status = json.load(f)
            if status.get("app_status") == "running" and os.path.samefile(status.get("file_path", ""), expected_path):
                should_open = False  # Bildvisare kör redan och visar rätt fil
            elif status.get("app_status") == "exited":
                should_open = True
            else:
                should_open = True
        except Exception as e:
            print(f"    [DEBUG] Kunde inte läsa/parsea bildvisarens status.json: {e}")
            should_open = True

    if should_open:
        os.system(f"open -a '{viewer_app}' '{preview_path}'")
        last_shown[0] = preview_path
    else:
        last_shown[0] = preview_path

def save_database(known_faces, ignored_faces, processed_files):
    with open(ENCODING_PATH, "wb") as f:
        pickle.dump(known_faces, f)
    with open(IGNORED_PATH, "wb") as f:
        pickle.dump(ignored_faces, f)
    with open(PROCESSED_PATH, "w") as f:
        f.writelines(f"{name}\n" for name in sorted(processed_files))

def parse_inputs(args, supported_ext):
    """
    Tar en lista av input-argument och returnerar en lista av Path-objekt för bilder som ska behandlas.
    Args:
        args: lista av strängar (filnamn, globs, mappar, '.' etc)
        supported_ext: lista med filändelser (t.ex. [".nef", ".NEF"])
    Returns:
        paths: sorterad lista med Path-objekt
    """
    files = set()
    for arg in args:
        path = Path(arg)
        if path.is_dir():
            # Alla filer rekursivt i mappen
            for f in path.rglob("*"):
                if f.suffix in supported_ext and f.is_file():
                    files.add(f.resolve())
        elif "*" in arg or "?" in arg or "[" in arg:
            # Globmönster (t.ex. 2601* eller ./bilder/2024-0[123]*.nef)
            for f in Path(".").glob(arg):
                if f.suffix in supported_ext and f.is_file():
                    files.add(f.resolve())
        elif arg == ".":
            # Punkt: nuvarande katalog
            for f in Path(".").rglob("*"):
                if f.suffix in supported_ext and f.is_file():
                    files.add(f.resolve())
        elif path.is_file() and path.suffix in supported_ext:
            files.add(path.resolve())
        else:
            # Om inget hittas – prova fnmatch på hela filesystemet från current dir (undantagsvis)
            for f in Path(".").rglob("*"):
                if fnmatch.fnmatch(f.name, arg) and f.suffix in supported_ext and f.is_file():
                    files.add(f.resolve())
    return sorted(files)


def log_attempt_stats(image_path, attempts, used_attempt_idx, base_dir=None, log_name="attempt_stats.jsonl"):
    """
    Spara attempts-statistik för en bild till en JSONL-fil i base_dir.
    :param image_path: Path till bilden.
    :param attempts: Lista med dict för varje attempt.
    :param used_attempt_idx: Index (int) för attempt som blev det faktiska valet (eller None om ingen).
    :param base_dir: Path till katalogen där loggfilen ska finnas (om None: '.').
    :param log_name: Filnamn på loggfilen.
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
    log_path = Path(base_dir) / log_name
    Path(base_dir).mkdir(parents=True, exist_ok=True)
    with open(log_path, "a") as f:
        f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")

# === Funktion för att skapa tempbild med etiketter ===
def create_labeled_image(rgb_image, face_locations, labels, config):
    import math
    import tempfile

    import matplotlib.font_manager as fm
    from PIL import Image, ImageDraw, ImageFont

    font_size = max(10, rgb_image.shape[1] // config.get("font_size_factor", 45))
    font_path = fm.findfont(fm.FontProperties(family="DejaVu Sans"))
    font = ImageFont.truetype(font_path, font_size)
    bg_color = tuple(config.get("label_bg_color", [0, 0, 0, 192]))
    text_color = tuple(config.get("label_text_color", [255, 255, 0]))

    orig_height, orig_width = rgb_image.shape[0:2]
    max_label_width = orig_width // 3
    margin = 100
    buffer = 80  # px skyddszon runt alla lådor

    # Hjälpfunktioner
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

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        temp_name = config.get("temp_image_path", "/tmp/hitta_ansikten_preview.jpg")
        canvas.save(temp_name, format="JPEG")
        return temp_name

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
        (best_name, best_name_dist), (best_ignore, best_ignore_dist) = best_matches(
            encoding, known_faces, ignored_faces, config
        )
        name_thr = config.get("match_threshold", 0.6)
        ignore_thr = config.get("ignore_distance", 0.5)
        margin = config.get("prefer_name_margin", 0.10)

        if (
            best_name is not None
            and best_name_dist is not None
            and best_name_dist < name_thr
            and (best_ignore_dist is None or best_name_dist < best_ignore_dist - margin)
        ):
            # Namn vinner klart över ignore
            label = "#{}\n{}".format(i + 1, best_name)
        elif (
            best_ignore_dist is not None
            and best_ignore_dist < ignore_thr
            and (best_name_dist is None or best_ignore_dist < best_name_dist - margin)
        ):
            label = "#{}\nIGN?".format(i + 1)
        elif (
            best_name is not None
            and best_name_dist is not None
            and best_name_dist < name_thr
            and best_ignore_dist is not None
            and abs(best_name_dist - best_ignore_dist) < margin
        ):
            # Osäkert: lika nära namn som ignore
            label = "#{}\n{} / IGN?".format(i + 1, best_name)
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
        (best_name, best_name_dist), (best_ignore, best_ignore_dist) = best_matches(
            encoding, known_faces, ignored_faces, config
        )
        name_thr = config.get("match_threshold", 0.6)
        ignore_thr = config.get("ignore_distance", 0.5)
        margin = config.get("prefer_name_margin", 0.10)

        # Case: namn-match vinner tydligt
        if (
            best_name is not None
            and best_name_dist is not None
            and best_name_dist < name_thr
            and (best_ignore_dist is None or best_name_dist < best_ignore_dist - margin)
        ):
            confidence = int((1 - best_name_dist) * 100)
            prompt_txt = "↪ Föreslaget: {} ({}%)\n[Enter = bekräfta, r = rätta, n = försök igen, i = ignorera, x = skippa bild] › ".format(
                best_name, confidence
            )
            val = input(prompt_txt).strip().lower()
            if val == "x":
                return "skipped", []
            if val == "n":
                retry_requested = True
                break
            if val == "":
                name = best_name
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

        # Case: ignore vinner tydligt
        elif (
            best_ignore_dist is not None
            and best_ignore_dist < ignore_thr
            and (best_name_dist is None or best_ignore_dist < best_name_dist - margin)
        ):
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

        # Case: osäker, visa båda
        elif (
            best_name is not None
            and best_name_dist is not None
            and best_ignore_dist is not None
            and abs(best_name_dist - best_ignore_dist) < margin
        ):
            # Visa båda förslag
            confidence = int((1 - best_name_dist) * 100) if best_name_dist is not None else 0
            ans = input(
                f"↪ Osäkert: {best_name} ({confidence}%) eller ignorera?\n[Enter = bekräfta {best_name}, i = ignorera, r = rätta, n = försök igen, x = skippa bild] › "
            ).strip().lower()
            if ans == "x":
                return "skipped", []
            if ans == "n":
                retry_requested = True
                break
            if ans == "" or ans == "y":
                name = best_name
                all_ignored = False
            elif ans == "i":
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

        # Ingen match – okänd
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
    try:
        rgb_down = load_and_resize_raw(image_path, max_down)
    except Exception as e:
        msg = str(e)
        if hasattr(e, 'args') and len(e.args) > 0 and isinstance(e.args[0], bytes):
            msg = e.args[0].decode(errors="ignore")
        print(f"⏭ Hoppar över {image_path.name}: {msg}")
        return "skipped"

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
                try:
                    rgb_full = load_and_resize_raw(image_path, max_full if max_full > 0 else None)
                except Exception as e:
                    print(f"⏭ Hoppar över {image_path.name} (vid helres): {e}")
                    return "skipped"
            rgb = rgb_full

        t0 = time.time()
        if attempt_idx > 0:
            print(
                "⚙️  Försök {}: model={}, upsample={}, highres={}".format(
                    attempt_idx + 1, setting["model"], setting["upsample"], setting["highres"]
                )
            )

        face_locations, face_encodings = face_detection_attempt(
            rgb, setting["model"], setting["upsample"]
        )
        elapsed = time.time() - t0
        print(
            f"    [DEBUG] Försök {attempt_idx + 1}: {setting['model']}, upsample={setting['upsample']}, tid: {elapsed:.2f} s, antal ansikten: {len(face_locations)}"
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
            show_temp_image(preview_path, config)

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
            show_temp_image(temp_path, config)
            shown_image = True
            ans = input("⚠️  Fortsätta försöka? [Enter = ja, x = hoppa över] › ").strip().lower()
            if ans == "x":
                log_attempt_stats(image_path, attempts_stats, used_attempt, BASE_DIR)
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
    if len(sys.argv) < 2:
        print("Användning: python hitta_ansikten.py <fil/glob/katalog/…>")
        sys.exit(1)

    config = load_config()
    known_faces, ignored_faces, processed_files = load_database()
    # Acceptera flera input
    input_paths = parse_inputs(sys.argv[1:], SUPPORTED_EXT)
    if not input_paths:
        print("Inga matchande bildfiler hittades.")
        sys.exit(1)

    # BASE_DIR för loggning etc
    from xdg import xdg_data_home
    BASE_DIR = xdg_data_home() / "faceid"

    for path in input_paths:
        if path.name in processed_files:
            print(f"⏭ Hoppar över tidigare behandlad fil: {path.name}")
            continue

        print(f"\n=== Bearbetar: {path.name} ===")
        result = process_image(path, known_faces, ignored_faces, config)
        if result is True or result == "skipped":
            processed_files.add(path.name)
            save_database(known_faces, ignored_faces, processed_files)
        # loggning sker redan i process_image/main_process_image_loop


if __name__ == "__main__":
    main()
