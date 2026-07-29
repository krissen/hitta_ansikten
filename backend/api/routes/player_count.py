"""Player Count API Routes

GUI surface for the rakna_spelare CLI: count images per named person across a
folder/glob/date-span selection.
"""

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.player_count_service import get_player_count_service

logger = logging.getLogger(__name__)

router = APIRouter()


class PlayerCountRequest(BaseModel):
    """Folder/glob/date-span selection plus counting options."""

    roots: list[str] = []
    globs: list[str] = []
    extension_preset: str | None = None  # 'jpg' | 'nef' | 'raw' | 'images' | 'all'
    extensions: list[str] | None = None  # explicit override, e.g. ['.jpg']
    recursive: bool = True
    date_from: str | None = None  # YYYY-MM-DD or YYMMDD
    date_to: str | None = None
    gap_minutes: int = 30
    baseline: Literal["median", "mean"] = "median"
    min_images: int = 3
    per_match: bool = False
    tranare: list[str] | None = None  # override coach exclusion list
    publik: list[str] | None = None  # override audience exclusion list
    grupp: list[str] | None = None  # override group-photo exclusion list
    # Session-only pins (GUI right-click moves): a pinned name is removed from
    # all exclusion sets and lands only in its pinned bucket. `spelare` also
    # bypasses min_images. Never persisted.
    spelare: list[str] | None = None
    session_tranare: list[str] | None = None
    session_publik: list[str] | None = None
    session_grupp: list[str] | None = None


class ExclusionConfigRequest(BaseModel):
    """Exclusion lists to persist as the new defaults.

    ``tranare``/``publik`` are required (no defaults): a partial/empty payload
    like ``{}`` must fail validation rather than silently persist empty lists and
    wipe the config. An explicit ``{"tranare": [], "publik": []}`` still clears.
    ``grupp`` and the always-marker lists are optional — ``null``/omitted leaves
    them unchanged.
    """

    tranare: list[str]
    publik: list[str]
    grupp: list[str] | None = None
    always_grupp: list[str] | None = None
    always_publik: list[str] | None = None


@router.get("/players/exclusions")
async def get_exclusions():
    """Return the currently resolved coach/audience/group exclusion lists."""
    return get_player_count_service().get_exclusions()


@router.post("/players/exclusions")
async def save_exclusions(request: ExclusionConfigRequest):
    """Persist coach/audience lists to the config file (make them the default)."""
    try:
        return get_player_count_service().save_exclusions(
            tranare=request.tranare,
            publik=request.publik,
            grupp=request.grupp,
            always_grupp=request.always_grupp,
            always_publik=request.always_publik,
        )
    except OSError as e:
        logger.exception("Saving exclusion config failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/players/count")
async def count_players(request: PlayerCountRequest):
    """Resolve the selection and return per-player image counts + statistics."""
    try:
        return get_player_count_service().count(
            roots=request.roots,
            globs=request.globs,
            extension_preset=request.extension_preset,
            extensions=request.extensions,
            recursive=request.recursive,
            date_from=request.date_from,
            date_to=request.date_to,
            gap_minutes=request.gap_minutes,
            baseline=request.baseline,
            min_images=request.min_images,
            per_match=request.per_match,
            tranare=request.tranare,
            publik=request.publik,
            grupp=request.grupp,
            spelare=request.spelare,
            session_tranare=request.session_tranare,
            session_publik=request.session_publik,
            session_grupp=request.session_grupp,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Player count failed")
        raise HTTPException(status_code=500, detail=str(e))
