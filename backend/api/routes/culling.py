"""Culling API Routes

Stats-driven culling workspace: list a player's image files and soft-delete /
restore them via the app-managed trash.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.culling_service import culling_service

logger = logging.getLogger(__name__)

router = APIRouter()


class CullingFilesRequest(BaseModel):
    roots: List[str] = []
    globs: List[str] = []
    extension_preset: Optional[str] = "jpg"
    recursive: bool = True
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    player: Optional[str] = None
    name_glob: Optional[str] = None


class TrashRequest(BaseModel):
    paths: List[str]


class RestoreRequest(BaseModel):
    ids: List[str]


class RenameRequest(BaseModel):
    path: str
    new_basename: str


class EmptyRequest(BaseModel):
    ids: Optional[List[str]] = None


class RetentionRequest(BaseModel):
    days: int


@router.post("/culling/files")
async def list_files(request: CullingFilesRequest):
    """List image files for the current filter, optionally restricted to a player."""
    try:
        return culling_service.list_files(
            roots=request.roots,
            globs=request.globs,
            extension_preset=request.extension_preset,
            recursive=request.recursive,
            date_from=request.date_from,
            date_to=request.date_to,
            player=request.player,
            name_glob=request.name_glob,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Culling list failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/culling/trash")
async def trash(request: TrashRequest):
    """Soft-delete files to the app trash."""
    try:
        return culling_service.trash(request.paths)
    except Exception as e:
        logger.exception("Culling trash failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/culling/rename")
async def rename(request: RenameRequest):
    """Rename a single file (+ sidecars) to a new basename in the same folder."""
    try:
        return culling_service.rename(request.path, request.new_basename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Culling rename failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/culling/trash")
async def list_trash():
    """List items currently in the app trash.

    Lazily purges items past the retention threshold before listing, so the
    trash view never shows (and never keeps) expired files.
    """
    try:
        try:
            culling_service.purge_expired()
        except Exception:
            logger.exception("Trash retention purge failed (non-fatal)")
        return culling_service.list_trash()
    except Exception as e:
        logger.exception("Culling list-trash failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/culling/retention")
async def get_retention():
    """Return the trash auto-purge threshold in days (0 = keep forever)."""
    try:
        return {"days": culling_service.get_retention_days()}
    except Exception as e:
        logger.exception("Culling get-retention failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/culling/retention")
async def set_retention(request: RetentionRequest):
    """Set the trash auto-purge threshold (days; 0 = keep forever)."""
    try:
        return culling_service.set_retention_days(request.days)
    except Exception as e:
        logger.exception("Culling set-retention failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/culling/restore")
async def restore(request: RestoreRequest):
    """Restore trashed items to their original locations."""
    try:
        return culling_service.restore(request.ids)
    except Exception as e:
        logger.exception("Culling restore failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/culling/empty")
async def empty(request: EmptyRequest):
    """Permanently delete trashed items (all, or the given ids)."""
    try:
        return culling_service.empty(request.ids)
    except Exception as e:
        logger.exception("Culling empty failed")
        raise HTTPException(status_code=500, detail=str(e))
