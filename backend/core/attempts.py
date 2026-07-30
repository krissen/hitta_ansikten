"""
attempts.py - Attempt-statistics logging for Ansikten.

Contains the JSONL attempt-stats logger shared by the CLI and the API.
Moved out of the hitta_ansikten monolith so the API no longer needs to
import the CLI entry point.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def log_attempt_stats(
    image_path: Path | str,
    attempts: list[dict],
    used_attempt_idx: int | None,
    base_dir: Path | str | None = None,
    log_name: str = "attempt_stats.jsonl",
    review_results: list[str] | None = None,
    labels_per_attempt: list[list[dict]] | None = None,
    file_hash: str | None = None,
) -> None:
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
        # Naive on-disk format: attempt_stats.jsonl timestamps are stored as
        # local wall clock without offset, and benchmarks/label_usage.py reads
        # them naively (string slicing and lexicographic min/max). Making these
        # tz-aware is a data-format migration, not a lint fix.
        "timestamp": datetime.now().isoformat(timespec="seconds"),  # noqa: DTZ005
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
