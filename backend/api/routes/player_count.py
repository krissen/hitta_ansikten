"""Player Count API Routes

GUI surface for the rakna_spelare CLI: count images per named person across a
folder/glob/date-span selection.
"""

import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.player_count_service import get_player_count_service

logger = logging.getLogger(__name__)

router = APIRouter()


class PlayerCountRequest(BaseModel):
    """Folder/glob/date-span selection plus counting options."""

    roots: List[str] = []
    globs: List[str] = []
    extension_preset: Optional[str] = None  # 'jpg' | 'nef' | 'raw' | 'images' | 'all'
    extensions: Optional[List[str]] = None  # explicit override, e.g. ['.jpg']
    recursive: bool = True
    date_from: Optional[str] = None  # YYYY-MM-DD or YYMMDD
    date_to: Optional[str] = None
    gap_minutes: int = 30
    baseline: Literal["median", "mean"] = "median"
    min_images: int = 3
    per_match: bool = False
    tranare: Optional[List[str]] = None  # override coach exclusion list
    publik: Optional[List[str]] = None  # override audience exclusion list


class ExclusionConfigRequest(BaseModel):
    """Exclusion lists to persist as the new defaults.

    ``tranare``/``publik`` are required (no defaults): a partial/empty payload
    like ``{}`` must fail validation rather than silently persist empty lists and
    wipe the config. An explicit ``{"tranare": [], "publik": []}`` still clears.
    ``grupp`` and the always-marker lists are optional — ``null``/omitted leaves
    them unchanged.
    """

    tranare: List[str]
    publik: List[str]
    grupp: Optional[List[str]] = None
    always_grupp: Optional[List[str]] = None
    always_publik: Optional[List[str]] = None


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
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Player count failed")
        raise HTTPException(status_code=500, detail=str(e))
