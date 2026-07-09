"""
config.py - Configuration and settings for Ansikten CLI

Contains:
- Default configuration
- Constants
- Config loading/saving
- Attempt settings management
- Logging initialization
"""

from __future__ import annotations

import hashlib
import json
import logging
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from core.db import ARCHIVE_DIR, ATTEMPT_SETTINGS_SIG, BASE_DIR, CONFIG_PATH, LOGGING_PATH

if TYPE_CHECKING:
    import numpy as np

    from face_backends import FaceBackend


# === CONSTANTS === #
# On macOS use /private/tmp: the packaged app whitelists /tmp and /private/tmp
# but not the system temp dir (/var/folders/...). /private/tmp does not exist on
# other platforms (e.g. Linux CI), so fall back to the standard temp dir there.
if sys.platform == "darwin":
    _TEMP_BASE = Path("/private/tmp")
else:
    _TEMP_BASE = Path(tempfile.gettempdir())
TEMP_DIR = _TEMP_BASE / "ansikten"
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


# Config schema version. Incremented when a structural migration is added to
# _migrate_config(). v2 moved match/ignore/hard-negative thresholds out of the
# top-level flat keys into backend_thresholds.<backend>. v3 raised the canonical
# InsightFace match_threshold 0.40 -> 0.45 (face-recognition audit 2026-07) for
# configs still pinned to the audit-era 0.40.
CONFIG_VERSION = 3

# Audit-era (v2) canonical InsightFace match_threshold. The v3 migration lifts
# exactly this value to the current canonical default; any other (user-customized)
# value is left untouched.
_V2_INSIGHTFACE_MATCH_THRESHOLD = 0.4

# Legacy euclidean-era (dlib) threshold keys that older configs kept at the top
# level. They must not drive InsightFace (cosine) matching; _migrate_config()
# rewrites them into a correct-metric backend_thresholds block and drops them.
_LEGACY_FLAT_THRESHOLD_KEYS = (
    "match_threshold",
    "ignore_distance",
    "hard_negative_distance",
)


# === Default Configuration ===
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
    # App som används för att visa bilder, t.ex. "Ansikten" eller "feh"
    "image_viewer_app": "Ansikten",
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
    # Match/ignore/hard-negative-trösklarna bor i backend_thresholds nedan
    # (en källa till sanning, per backend och distansmetrik). De gamla platta
    # nycklarna match_threshold/ignore_distance har tagits bort — de var
    # euklidiska (dlib) värden som inte gäller InsightFace cosinus-distans.
    # Minsta "confidence" för att visa namn (0.0–1.0, högre = striktare)
    "min_confidence": 0.5,
    # Namn måste vara så här mycket bättre än ignore för att vinna automatiskt
    "prefer_name_margin": 0.15,

    # === Tvilling-disambiguering (bekräftat-olika par, t.ex. tvillingar) ===
    # När topp-2-kandidaterna är ett registrerat "distinct"-par och deras
    # avstånd till proben skiljer mindre än detta, bryt oavgjort med k-NN-röstning
    # över parets bekräftade ansikten istället för enbart närmaste granne.
    "twin_margin": 0.1,
    # Antal grannar i k-NN-röstningen (faktiskt k = min(detta, antal per person)).
    "twin_knn_k": 5,

    # === Backend configuration (face recognition engine) ===
    # NOTE: dlib backend is DEPRECATED and no longer supported.
    # Only "insightface" should be used. Existing dlib encodings will be removed.
    "backend": {
        "type": "insightface",  # Backend to use: only "insightface" is supported
        "insightface": {
            "model_name": "buffalo_l",  # Model: buffalo_s (fast), buffalo_m, buffalo_l (accurate)
            "ctx_id": -1,  # -1 = CPU, 0+ = GPU device ID
            # Detection input size (letterbox target the whole image is resized to
            # before SCRFD detection). Larger can surface smaller faces (team/wide
            # shots) at ~quadratic detection cost — a supported knob. Measured
            # locally (7 full-frame event photos), 640 vs 1280 was recall-neutral
            # at 1.2-1.75x wall time, so the default stays 640 until the benchmark
            # track (B3) provides ground truth. Accepts [w, h] or a single int
            # (square).
            "det_size": [640, 640]
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
            "match_threshold": 0.45,  # Cosine distance threshold (typically lower)
            "ignore_distance": 0.35,
            "hard_negative_distance": 0.32
        }
    },

    # === App trash (Gallra) ===
    # Auto-purge trashed files older than this many days. 0 = keep forever.
    "trash_retention_days": 30,

    # Schema version. Bumped by migrations in _migrate_config(); a fresh config
    # is written at the current version and never needs migrating.
    "config_version": CONFIG_VERSION,
}


def init_logging(
    level: int = logging.INFO,
    logfile: Path = LOGGING_PATH,
    replace_handlers: bool = False
) -> None:
    """
    Initialize logging for Ansikten.

    Args:
        level: Logging level
        logfile: Path to log file
        replace_handlers: If True, clear existing handlers (CLI mode).
                         If False, add file handler without clearing (API mode).
    """
    logger = logging.getLogger()
    try:
        logging.getLogger("matplotlib.font_manager").setLevel(logging.WARNING)
    except Exception:
        pass  # matplotlib may not be available; ignore silently
    logger.setLevel(level)

    if replace_handlers:
        logger.handlers.clear()

    file_handler_exists = any(
        isinstance(h, logging.FileHandler) and h.baseFilename == str(logfile)
        for h in logger.handlers
    )
    if not file_handler_exists:
        # Ensure the data dir exists — init_logging can run at import time,
        # before load_config() has created BASE_DIR (e.g. a fresh machine/CI).
        Path(logfile).parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(logfile, mode="a", encoding="utf-8")
        handler.setLevel(logging.INFO)
        formatter = logging.Formatter(
            "%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)


def _migrate_config(raw: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Apply one-time, idempotent migrations to a persisted config dict.

    v2 threshold migration: if the config still carries legacy top-level flat
    threshold keys but has no ``backend_thresholds.insightface`` block, pin the
    canonical InsightFace cosine thresholds and drop the flat keys. The stale
    flat values (euclidean-era, e.g. match_threshold=0.6) are deliberately NOT
    copied forward — they are wrong-metric for InsightFace and would match far
    too loosely. A config that already has ``backend_thresholds.insightface`` is
    left untouched by this step, so re-running is a no-op.

    v3 threshold migration: if the config's
    ``backend_thresholds.insightface.match_threshold`` is exactly the audit-era
    0.40, raise it to the current canonical 0.45 (face-recognition audit 2026-07).
    Only the exact 0.40 default is lifted — a user-customized value (e.g. 0.42) is
    left untouched. Idempotent: a config already at 0.45 is a no-op.

    Args:
        raw: Config dict as read from disk (mutated in place).

    Returns:
        (config, changed) — ``changed`` is True when a migration ran.
    """
    changed = False

    backend_thresholds = raw.get("backend_thresholds")
    has_insightface_block = (
        isinstance(backend_thresholds, dict) and "insightface" in backend_thresholds
    )
    has_flat_keys = any(k in raw for k in _LEGACY_FLAT_THRESHOLD_KEYS)

    if has_flat_keys and not has_insightface_block:
        canonical = dict(DEFAULT_CONFIG["backend_thresholds"]["insightface"])
        merged = dict(backend_thresholds) if isinstance(backend_thresholds, dict) else {}
        merged["insightface"] = canonical
        raw["backend_thresholds"] = merged
        for key in _LEGACY_FLAT_THRESHOLD_KEYS:
            raw.pop(key, None)
        raw["config_version"] = CONFIG_VERSION
        changed = True
        logging.info(
            "Config migration: pinned canonical InsightFace cosine thresholds "
            "(match=%.2f ignore=%.2f hard_negative=%.2f) and removed legacy flat "
            "threshold keys.",
            canonical["match_threshold"],
            canonical["ignore_distance"],
            canonical["hard_negative_distance"],
        )
    else:
        # v3: lift an existing insightface block still pinned to the audit-era
        # 0.40 default up to the new canonical 0.45. Runs only when the v2 step
        # above did not (a v2 rewrite already writes the current 0.45 canonical).
        insightface = (
            backend_thresholds.get("insightface")
            if isinstance(backend_thresholds, dict)
            else None
        )
        if (
            isinstance(insightface, dict)
            and insightface.get("match_threshold") == _V2_INSIGHTFACE_MATCH_THRESHOLD
        ):
            new_threshold = DEFAULT_CONFIG["backend_thresholds"]["insightface"][
                "match_threshold"
            ]
            insightface["match_threshold"] = new_threshold
            raw["config_version"] = CONFIG_VERSION
            changed = True
            logging.info(
                "Config migration v3: raised InsightFace match_threshold %.2f -> "
                "%.2f (face-recognition audit 2026-07); a user-customized value "
                "would have been left untouched.",
                _V2_INSIGHTFACE_MATCH_THRESHOLD,
                new_threshold,
            )

    return raw, changed


def load_config() -> dict[str, Any]:
    """Load configuration from file or create default.

    Runs one-time migrations (see _migrate_config) and persists them back to
    disk before merging over DEFAULT_CONFIG.
    """
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r") as f:
                raw = json.load(f)
        except Exception:
            raw = None  # Invalid JSON or read error; fall through to create default
        if raw is not None:
            migrated, changed = _migrate_config(raw)
            if changed:
                try:
                    with open(CONFIG_PATH, "w") as f:
                        json.dump(migrated, f, indent=2)
                except Exception:
                    logging.warning("Failed to persist migrated config; continuing in memory")
            return {**DEFAULT_CONFIG, **migrated}
    with open(CONFIG_PATH, "w") as f:
        json.dump(DEFAULT_CONFIG, f, indent=2)
    return DEFAULT_CONFIG


def save_config(updates: dict[str, Any]) -> dict[str, Any]:
    """Merge `updates` into the persisted config and write it back.

    Loads the current config (defaults + file), applies a shallow update, and
    writes the result to CONFIG_PATH. Returns the merged config.
    """
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    config = load_config()
    config.update(updates)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
    return config


def get_attempt_setting_defs(
    config: dict[str, Any],
    backend: FaceBackend | None = None
) -> list[dict[str, Any]]:
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

    # Dlib: Behåll alla variationer med model och upsample (deprecated)
    return [
        {"model": "cnn", "upsample": 0, "scale_label": "down", "scale_px": config["max_downsample_px"]},
        {"model": "cnn", "upsample": 0, "scale_label": "mid",  "scale_px": config["max_midsample_px"]},
        {"model": "cnn", "upsample": 1, "scale_label": "down", "scale_px": config["max_downsample_px"]},
        {"model": "hog", "upsample": 0, "scale_label": "full", "scale_px": config["max_fullres_px"]},
        {"model": "cnn", "upsample": 0, "scale_label": "full", "scale_px": config["max_fullres_px"]},
        {"model": "cnn", "upsample": 1, "scale_label": "mid",  "scale_px": config["max_midsample_px"]},
        {"model": "cnn", "upsample": 1, "scale_label": "full", "scale_px": config["max_fullres_px"]},
    ]


def get_attempt_settings(
    config: dict[str, Any],
    rgb_down: np.ndarray,
    rgb_mid: np.ndarray,
    rgb_full: np.ndarray,
    backend: FaceBackend | None = None
) -> list[dict[str, Any]]:
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


def get_max_possible_attempts(
    config: dict[str, Any],
    backend: FaceBackend | None = None
) -> int:
    """Returns max number of attempts for current backend."""
    return len(get_attempt_setting_defs(config, backend))


def get_settings_signature(attempt_settings: list[dict[str, Any]]) -> str:
    """Generate a signature hash for attempt settings (for cache invalidation)."""
    # Serialiserbar och ordningsoberoende
    as_json = json.dumps([
        {k: v for k, v in s.items() if k != "rgb_img"}
        for s in attempt_settings
    ], sort_keys=True)
    return hashlib.md5(as_json.encode("utf-8")).hexdigest()


def archive_stats_if_needed(current_sig: str, force: bool = False) -> None:
    """Archive attempt stats file if settings signature has changed."""
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


def hash_encoding(enc: dict[str, Any] | np.ndarray | None) -> str | None:
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
