#!/usr/bin/env python
# ruff: noqa: E402

import warnings

warnings.filterwarnings("ignore", category=UserWarning, module="face_recognition_models")

import copy
import fnmatch
import hashlib
import logging
import math
import multiprocessing
import os
import pickle
import queue
import shutil
import signal
import sys
import time
from collections.abc import Callable, Iterator
from datetime import datetime
from pathlib import Path
from types import FrameType
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from prompt_toolkit.completion import Completer

import numpy as np

from cli_config import (
    CACHE_DIR,
    MAX_ATTEMPTS,
    MAX_QUEUE,
    MAX_WORKER_WAIT_TIME,
    ORDINARY_PREVIEW_PATH,
    QUEUE_GET_TIMEOUT,
    RESERVED_COMMANDS,
    # Constants
    TEMP_DIR,
    WORKER_JOIN_TIMEOUT,
    WORKER_TERMINATE_TIMEOUT,
    archive_stats_if_needed,
    get_attempt_settings,
    get_max_possible_attempts,
    get_settings_signature,
    hash_encoding,
    # Config
    init_logging,
    load_config,
)
from cli_image import (
    create_labeled_image,
    export_and_show_original,
    load_and_resize_raw,
    show_temp_image,
)
from cli_matching import best_matches, get_face_match_status, label_preview_for_encodings
from core.attempts import log_attempt_stats
from core.naming import (
    build_new_filename,
    collect_persons_for_files,
    is_unrenamed,
    resolve_fornamn_dubletter,
)
from face_backends import FaceBackend, create_backend
from faceid_db import (
    BASE_DIR,
    SUPPORTED_EXT,
    get_file_hash,
    load_attempt_log,
    load_database,
    safe_pickle_load,
    save_database,
)

# Initialize logging at module load
init_logging(replace_handlers=False)


def safe_input(prompt_text: str, completer: "Completer | None" = None) -> str:
    """
    Wrapper for input() and prompt_toolkit.prompt with graceful exit.
    Uses prompt_toolkit if completer provided, otherwise standard input().
    """
    try:
        if completer is not None:
            from prompt_toolkit import prompt
            return prompt(prompt_text, completer=completer)  # type: ignore[arg-type]
        else:
            return input(prompt_text)
    except KeyboardInterrupt:
        print("\n⏹ Avbruten. Programmet avslutas.")
        sys.exit(0)


def parse_inputs(args: list[str], supported_ext: set[str] | list[str]) -> Iterator[Path]:
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


def handle_manual_add(
    known_faces: dict[str, list],
    image_path: Path | str | None,
    file_hash: str | None,
    input_name_func: Callable[[list[str], str], str],
    backend: FaceBackend,
    labels: list[dict] | None = None,
) -> tuple[str, dict]:
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
    known_faces[namn].append({
        "encoding": None,
        "file": str(image_path) if image_path else None,
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


def add_hard_negative(
    hard_negatives: dict[str, list],
    person: str,
    encoding: np.ndarray,
    backend: FaceBackend,
    image_path: Path | str | None = None,
    file_hash: str | None = None,
) -> None:
    """Add a hard negative example for a person with full metadata."""
    if person not in hard_negatives:
        hard_negatives[person] = []
    normalized_encoding = backend.normalize_encoding(encoding)
    hard_negatives[person].append({
        "encoding": normalized_encoding,
        "file": str(image_path) if image_path else None,
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
    face_encodings: list[np.ndarray],
    known_faces: dict[str, list],
    ignored_faces: list[dict],
    hard_negatives: dict[str, list],
    config: dict,
    backend: FaceBackend,
    image_path: Path | str | None = None,
    preview_path: Path | str | None = None,
    file_hash: str | None = None,
) -> tuple[str, list[dict]]:
    """
    Terminal-review av hittade ansikten
    """

    if file_hash is None and image_path is not None:
        file_hash = get_file_hash(image_path)

    labels = []
    all_ignored = True
    retry_requested = False

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
            i,
            best_name,
            best_name_dist,
            name_confidence,
            best_ignore,
            best_ignore_dist,
            ignore_confidence,
            config,
            backend
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
                    "file": str(image_path) if image_path else None,
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
                "file": str(image_path) if image_path else None,
                "hash": file_hash,
                "backend": backend.backend_name,
                "backend_version": backend.get_model_info().get('model', 'unknown'),
                "created_at": datetime.now().isoformat(),
                "encoding_hash": hashlib.sha1(normalized_encoding.tobytes()).hexdigest()
            })
            labels.append({"label": f"#{i+1}\n{name}", "hash": hashlib.sha1(normalized_encoding.tobytes()).hexdigest()})

    if retry_requested:
        logging.debug("[REVIEW] Retry ombett, återgår till anropare")
        return "retry", []
    if all_ignored:
        logging.debug("[REVIEW] Alla ansikten ignorerade; returnerar 'all_ignored'.")
        return "all_ignored", []
    logging.debug("[REVIEW] Alla ansikten granskade, returnerar 'ok'.")
    return "ok", labels


def face_detection_attempt(
    rgb: np.ndarray,
    model: str,
    upsample: int,
    backend: FaceBackend,
) -> tuple[list[tuple[int, int, int, int]], list[np.ndarray]]:
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

def input_name(
    known_names: list[str],
    prompt_txt: str = "Ange namn (eller 'i' för ignorera, n = försök igen, x = skippa bild) › ",
) -> str:
    """
    Ber användaren om ett namn med autocomplete.
    Reserverade kommandon (i, a, r, n, o, m, x) returneras som är för vidare hantering.
    """
    from prompt_toolkit import prompt
    from prompt_toolkit.completion import WordCompleter
    completer = WordCompleter(sorted(known_names), ignore_case=True, sentence=True)
    try:
        name = prompt(prompt_txt, completer=completer)
        return name.strip()
    except (KeyboardInterrupt, EOFError):
        print("\n⏹ Avbruten. Programmet avslutas.")
        sys.exit(0)


def remove_encodings_for_file(
    known_faces: dict[str, list],
    ignored_faces: list[dict],
    hard_negatives: dict[str, list],
    identifier: str | list[str],
) -> int:
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
                    if isinstance(lbl, dict):
                        lbl_id = lbl.get("hash") or lbl.get("face_id")
                        if lbl_id:
                            hashes_to_remove.append(lbl_id)
                            labelstr = lbl.get("label", "")
                            namn = labelstr.split("\n")[1] if "\n" in labelstr else None
                            labels_by_hash[lbl_id] = namn
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
    image_path: Path | str,
    known_faces: dict[str, list],
    ignored_faces: list[dict],
    hard_negatives: dict[str, list],
    config: dict,
    backend: FaceBackend,
    max_attempts: int = 3,
    attempts_so_far: list[dict] | None = None,
) -> list[dict]:
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
            "face_count": len(face_encodings),
            "face_locations": face_locations,
            "face_encodings": face_encodings,
            "preview_labels": preview_labels,
            "preview_path": preview_path,
        })

        if attempt_idx + 1 >= max_attempts:
            break

    logging.debug(f"[PREPROCESS image][{fname}]: end")
    return attempt_results


def main_process_image_loop(
    image_path: Path | str,
    known_faces: dict[str, list],
    ignored_faces: list[dict],
    hard_negatives: dict[str, list],
    config: dict,
    backend: FaceBackend,
    attempt_results: list[dict],
) -> str:
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
        "face_count": len(face_encodings),
    })

    import shutil
    ordinary_preview_path = config.get("ordinary_preview_path") or ORDINARY_PREVIEW_PATH
    try:
        shutil.copy(preview_path, ordinary_preview_path)
    except Exception as e:
        logging.warning(f"[PREVIEW] Kunde inte kopiera preview till {ordinary_preview_path}: {e}")
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

def process_image(
    image_path: Path | str,
    known_faces: dict[str, list],
    ignored_faces: list[dict],
    hard_negatives: dict[str, list],
    config: dict,
    backend: FaceBackend,
) -> str:
    """Single-image processing wrapper."""
    attempt_results = preprocess_image(image_path, known_faces, ignored_faces,
                                       hard_negatives, config, backend, max_attempts=1)

    return main_process_image_loop(image_path, known_faces, ignored_faces, hard_negatives,
                                   config, backend, attempt_results)


def is_file_processed(path: Path | str, processed_files: list[dict]) -> bool:
    """Kolla om filen redan är processad, via namn ELLER hash."""
    path_name = Path(path).name if not isinstance(path, str) else path
    path_hash = None
    # Snabbt: finns namn redan?
    for entry in processed_files:
        ename = entry.get("name") if isinstance(entry, dict) else entry
        if ename == path_name:
            return True
    # Kolla mot hash om inte namn matchade (chunked read for large files)
    try:
        sha1 = hashlib.sha1()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b''):
                sha1.update(chunk)
        path_hash = sha1.hexdigest()
    except Exception:
        pass
    if path_hash:
        for entry in processed_files:
            ehash = entry.get("hash") if isinstance(entry, dict) else None
            if ehash and ehash == path_hash:
                return True
    return False

def rename_files(
    filelist: list[Path | str],
    known_faces: dict[str, list],
    processed_files: list[dict],
    simulate: bool = True,
    allow_renamed: bool = False,
    only_processed: bool = False,
) -> None:
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
            logging.warning(f"[RENAME] Destination already exists: {dest}")
            print(f"⚠️  {dest} finns redan, hoppar över!")
            continue
        if simulate:
            print(f"[SIMULATE] {os.path.basename(orig)} → {os.path.basename(dest)}")
        else:
            print(f"{os.path.basename(orig)} → {os.path.basename(dest)}")
            os.rename(orig, dest)

def cleanup_tmp_previews() -> None:
    """Clean up temporary preview files from TEMP_DIR."""
    if not TEMP_DIR.exists():
        return
    for path in TEMP_DIR.glob("ansikten_*"):
        try:
            path.unlink()
        except Exception as e:
            logging.debug(f"Failed to remove temp file {path}: {e}")
            pass  # Ignorera ev. misslyckanden


# === Graceful Exit ===
def signal_handler(sig: int, frame: FrameType | None) -> None:
    print("\n⏹ Avbruten. Programmet avslutas.")
    cleanup_tmp_previews()
    sys.exit(0)

def print_help() -> None:
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


def add_to_processed_files(path: Path, processed_files: list[dict]) -> None:
    """Lägg till en ny fil sist i listan, med både hash och namn."""
    try:
        sha1 = hashlib.sha1()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b''):
                sha1.update(chunk)
        h = sha1.hexdigest()
    except Exception:
        h = None
    processed_files.append({"name": path.name, "hash": h})


def _cache_file(path: Path | str) -> Path:
    """Return the cache file path for a given image path."""
    CACHE_DIR.mkdir(exist_ok=True)
    h = hashlib.sha1(str(path).encode()).hexdigest()
    return CACHE_DIR / f"{h}.pkl"


def save_preprocessed_cache(path: Path | str, attempt_results: list[dict]) -> list[dict]:
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


def load_preprocessed_cache(queue: multiprocessing.Queue) -> None:
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


def remove_preprocessed_cache(path: Path | str) -> None:
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
    known_faces: dict[str, list],
    ignored_faces: list[dict],
    hard_negatives: dict[str, list],
    images_to_process: list[Path],
    config: dict,
    max_possible_attempts: int,
    preprocessed_queue: multiprocessing.Queue,
    preprocess_done: multiprocessing.Event,
) -> None:
    """
    Worker process for preprocessing images in background.

    Initializes its own backend instance from config.
    """
    import os
    logging.debug(f"[WORKER] Process started, PID={os.getpid()}, processing {len(images_to_process)} images")
    try:
        # Initialize backend in worker process
        from face_backends import create_backend
        logging.debug("[WORKER] About to create backend from config")
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
                    if cached[-1]["face_count"] > 0:
                        active_paths.remove(path)
    except Exception as e:
        logging.error(f"[PREPROCESS worker][ERROR] {e}")
        import traceback
        # Print error to stderr so it's visible to user
        print("\n⚠️  KRITISKT FEL: Worker-processen kraschade!", file=sys.stderr)
        print(f"⚠️  Fel: {type(e).__name__}: {e}", file=sys.stderr)
        print("⚠️  Main-processen kommer att fortsätta utan parallell preprocessing.", file=sys.stderr)
        print("⚠️  Se ansikten.log för detaljer.\n", file=sys.stderr)
        traceback.print_exc()
    finally:
        # Always signal completion, even on error, to unblock main loop
        preprocess_done.set()
        logging.debug("[PREPROCESS worker] Done")

# === Entry point ===
def main() -> None:
    init_logging(replace_handlers=True)
    
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
        logging.warning("[PREPROCESS] Worker exited immediately - will fall back to main process")
        print("\n⚠️  VARNING: Worker-processen avslutades omedelbart!", file=sys.stderr)
        print("⚠️  Detta tyder på ett fel i worker-processen.", file=sys.stderr)
        print("⚠️  Preprocessing kommer att göras i main-processen istället (långsammare).\n", file=sys.stderr)

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
    signal.signal(signal.SIGINT, signal_handler)
    main()
