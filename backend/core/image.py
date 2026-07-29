"""
image.py - Image utilities for Ansikten CLI

Contains:
- Image loading and resizing
- Labeled preview image creation
- Image display utilities
"""

import json
import logging
import math
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import numpy as np
import rawpy
from numpy.typing import NDArray
from PIL import Image, ImageDraw, ImageFont
from PIL.ImageFont import FreeTypeFont

from core.config import TEMP_DIR


def load_and_resize_raw(image_path: str | Path, max_dim: int | None = None) -> NDArray[np.uint8]:
    """
    Läser och eventuellt nedskalar RAW-bild till max_dim (längsta sida).
    Om max_dim=None returneras full originalstorlek.
    """
    with rawpy.imread(str(image_path)) as raw:
        rgb = raw.postprocess()
    if max_dim and max(rgb.shape[0], rgb.shape[1]) > max_dim:
        scale = max_dim / max(rgb.shape[0], rgb.shape[1])
        rgb = (Image.fromarray(rgb)
               .resize((int(rgb.shape[1] * scale), int(rgb.shape[0] * scale)), Image.Resampling.LANCZOS))
        rgb = np.array(rgb)
    return rgb


def box_overlaps_with_buffer(
    b1: tuple[int, int, int, int],
    b2: tuple[int, int, int, int],
    buffer: int = 40,
) -> bool:
    """Check if two boxes overlap with a buffer zone."""
    l1, t1, r1, b1_ = b1
    l2, t2, r2, b2_ = b2
    return not (r1 + buffer <= l2 - buffer or
                l1 - buffer >= r2 + buffer or
                b1_ + buffer <= t2 - buffer or
                t1 - buffer >= b2_ + buffer)


def robust_word_wrap(
    label_text: str,
    max_label_width: int,
    draw: ImageDraw.ImageDraw,
    font: FreeTypeFont,
) -> list[str]:
    """Wrap text to fit within max_label_width."""
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


def create_labeled_image(
    rgb_image: NDArray[np.uint8],
    face_locations: list[tuple[int, int, int, int]],
    labels: list[str],
    config: dict[str, Any],
    suffix: str = "",
) -> str:
    """
    Create a preview image with face boxes and labels.

    Args:
        rgb_image: RGB numpy array
        face_locations: List of (top, right, bottom, left) tuples
        labels: List of label strings for each face
        config: Configuration dict
        suffix: Optional suffix for temp file name

    Returns:
        Path to the created preview image
    """
    import matplotlib.font_manager as fm

    font_size = int(max(10, rgb_image.shape[1] // config.get("font_size_factor", 45)))
    font_path = fm.findfont(fm.FontProperties(family="DejaVu Sans"))
    font = ImageFont.truetype(font_path, font_size)
    bg_color = tuple(config.get("label_bg_color", [0, 0, 0, 192]))
    text_color = tuple(config.get("label_text_color", [255, 255, 0]))

    orig_height, orig_width = rgb_image.shape[0:2]
    max_label_width = orig_width // 3
    margin = 50
    buffer = 40  # px skyddszon runt alla lådor

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
        text_width = int(max(b[2] - b[0] for b in line_sizes) + 10)
        text_height = int(font_size * len(lines) + 4)

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
        cx = (left + right) // 2
        cy = (top + bottom) // 2
        lx = -text_width - margin
        ly = -text_height - margin
        label_box: tuple[int, int, int, int] = (lx, ly, lx + text_width, ly + text_height)
        for radius in range(max((bottom-top), (right-left)) + margin, max(orig_width, orig_height) * 2, 25):
            for angle in range(0, 360, 10):
                radians = math.radians(angle)
                lx = int(cx + radius * math.cos(radians) - text_width // 2)
                ly = int(cy + radius * math.sin(radians) - text_height // 2)
                label_box = (lx, ly, lx + text_width, ly + text_height)
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

    # Beräkna nödvändigt canvas-storlek
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

    # Rita allt på canvasen
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
    temp_prefix = "ansikten_preview"
    temp_suffix = f"{suffix}.jpg" if suffix else ".jpg"

    with tempfile.NamedTemporaryFile(prefix=temp_prefix, suffix=temp_suffix, dir=temp_dir, delete=False) as tmp:
        canvas.save(tmp.name, format="JPEG")
        return tmp.name


def export_and_show_original(image_path: str | Path, config: dict[str, Any]) -> None:
    """
    Exporterar NEF-filen till högupplöst JPG och skriver en statusfil för Ansikten-appen.
    """
    export_path = TEMP_DIR / "original.jpg"

    try:
        with rawpy.imread(str(image_path)) as raw:
            rgb = raw.postprocess()

        img = Image.fromarray(rgb)
        img.save(export_path, format="JPEG", quality=98)

        status_path = Path.home() / "Library" / "Application Support" / "ansikten" / "original_status.json"
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


def show_temp_image(
    preview_path: str | Path,
    config: dict[str, Any],
    image_path: str | Path | None = None,
    # Deliberate mutable default: the one-slot list is call-to-call state, not a
    # value. No caller passes it, so every call shares the same list and the last
    # path shown survives between calls. Nothing reads it back today — it is only
    # written at the end of this function — but the shared list is the point, so
    # do not "fix" it into `None`.
    last_shown: list[str | None] = [None],
) -> None:
    """
    Display a preview image in the configured viewer app.
    """
    viewer_app = config.get("image_viewer_app")
    status_path = Path.home() / "Library" / "Application Support" / "ansikten" / "status.json"
    expected_path = str(Path(preview_path).resolve())

    should_open = True

    # Skriv original_status.json
    orig_path = str(image_path) if image_path else str(preview_path)
    status_origjson_path = Path.home() / "Library" / "Application Support" / "ansikten" / "original_status.json"
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
                try:
                    if current_file and os.path.samefile(current_file, expected_path):
                        should_open = False
                        logging.debug(f"[ANSIKTEN] Appen visar redan rätt fil: {expected_path}")
                    else:
                        should_open = True
                        logging.debug(f"[ANSIKTEN] Appen kör men visar annan fil ({current_file}), öppnar {expected_path}")
                except (OSError, ValueError):
                    should_open = True
                    logging.debug(f"[ANSIKTEN] Kan inte jämföra filer, öppnar {expected_path}")

            elif app_status == "exited":
                logging.debug("[ANSIKTEN] Appen har avslutats, kommer öppna bild")
                should_open = True
            else:
                logging.debug(f"[ANSIKTEN] App-status: {app_status} inte behandlad, kommer öppna bild")
                should_open = True
        except Exception as e:
            logging.debug(f"[ANSIKTEN] Misslyckades läsa statusfilen: {status_path} ({e}), kommer öppna bild")
            should_open = True

    if should_open:
        # Validate viewer_app to prevent command injection
        safe_chars = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_.")
        if not viewer_app or not all(c in safe_chars for c in viewer_app):
            logging.error(f"[SECURITY] Invalid viewer app name: {viewer_app}")
            print(f"⚠️  Säkerhetsvarning: Ogiltig bildvisarapp '{viewer_app}', hoppar över", file=sys.stderr)
            return

        logging.debug(f"[ANSIKTEN] Öppnar bild i visare: {expected_path}")
        cmd = ["open", "-a", viewer_app, expected_path]
        logging.debug(f"[ANSIKTEN] Kör kommando: {' '.join(cmd)}")
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            logging.debug(f"[ANSIKTEN] Subprocess startad, PID: {proc.pid}")
        except Exception as e:
            logging.error(f"[ANSIKTEN] Fel vid start av extern bildvisare: {e}")
            print(f"⚠️  Kunde inte öppna extern bildvisare: {e}", file=sys.stderr)
        last_shown[0] = expected_path
    else:
        logging.debug("[ANSIKTEN] Hoppar över open")
        last_shown[0] = str(preview_path)
