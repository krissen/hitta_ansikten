"""Configuration for the benchmark resolver: photo roots + data locations."""

from __future__ import annotations

import json
import os
from pathlib import Path

# All generated data (cache, reports, unresolved lists) lives here (gitignored).
DATA_DIR = Path(__file__).resolve().parent / "_data"
CACHE_PATH = DATA_DIR / "source_index.json"
REPORT_PATH = DATA_DIR / "feasibility_report.md"
UNRESOLVED_PATH = DATA_DIR / "unresolved_hashes.json"
CONFIG_PATH = DATA_DIR / "roots.json"

# Candidate photo roots to probe when no explicit roots/config are given.
# These follow the home photo pipeline (see vastushastra foto-arbetsflode):
# nerladdat (raw dump) -> framkallat (developing) -> Photos library.
DEFAULT_CANDIDATE_ROOTS: tuple[str, ...] = (
    "~/Pictures/nerladdat",
    "~/Pictures/framkallat",
    "~/Pictures/media",
    "~/Pictures/hans",
    "~/Pictures/Sparade Lightroom-foton",
)


def _expand(paths: list[str] | tuple[str, ...]) -> list[Path]:
    return [Path(os.path.expanduser(p)) for p in paths]


def resolve_roots(
    cli_roots: list[str] | None = None,
    config_path: Path | str | None = None,
) -> list[Path]:
    """Determine which photo roots to scan.

    Precedence: explicit ``cli_roots`` > ``roots.json`` config > the subset of
    ``DEFAULT_CANDIDATE_ROOTS`` that currently exists on disk.
    """
    if cli_roots:
        return _expand(cli_roots)

    cfg = Path(config_path) if config_path else CONFIG_PATH
    if cfg.exists():
        try:
            data = json.loads(cfg.read_text())
            roots = data.get("roots") if isinstance(data, dict) else data
            if roots:
                return _expand(roots)
        except (OSError, json.JSONDecodeError):
            pass

    return [p for p in _expand(DEFAULT_CANDIDATE_ROOTS) if p.exists()]


def ensure_data_dir() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR
