"""Rename-NEF API Routes

EXIF-based NEF renaming (YYMMDD_HHMMSS.NEF) with preview/confirm. See
`rename_nef_service`.
"""

import logging
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.rename_nef_service import get_rename_nef_service

logger = logging.getLogger(__name__)

router = APIRouter()


class RenameNefRequest(BaseModel):
    roots: List[str] = []
    globs: List[str] = []
    # Default off: rename only the chosen folder's top level, not subfolders.
    recursive: bool = False
    # Default off: already-named files (timestamp + name/burst suffix) are
    # protected. Opt in to rename them anyway (strips the name suffix).
    include_named: bool = False


@router.post("/rename-nef/preview")
async def preview(request: RenameNefRequest):
    """Dry-run: show the EXIF-derived rename mapping."""
    try:
        return await get_rename_nef_service().preview(
            roots=request.roots, globs=request.globs, recursive=request.recursive,
            include_named=request.include_named,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("rename-nef preview failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rename-nef/execute")
async def execute(request: RenameNefRequest):
    """Rename the NEFs (+ sidecars) from EXIF CreateDate."""
    try:
        return await get_rename_nef_service().execute(
            roots=request.roots, globs=request.globs, recursive=request.recursive,
            include_named=request.include_named,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("rename-nef execute failed")
        raise HTTPException(status_code=500, detail=str(e))


class RestoreNamesRequest(BaseModel):
    roots: List[str] = []
    globs: List[str] = []
    recursive: bool = False


@router.post("/rename-nef/restore-names/preview")
async def restore_names_preview(request: RestoreNamesRequest):
    """Dry-run: map each NEF (by SHA1) back to its confirmed name."""
    try:
        return await get_rename_nef_service().restore_names_preview(
            roots=request.roots, globs=request.globs, recursive=request.recursive,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("restore-names preview failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rename-nef/restore-names/execute")
async def restore_names_execute(request: RestoreNamesRequest):
    """Rename each NEF (+ sidecar) back to its SHA1-matched confirmed name."""
    try:
        return await get_rename_nef_service().restore_names_execute(
            roots=request.roots, globs=request.globs, recursive=request.recursive,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("restore-names execute failed")
        raise HTTPException(status_code=500, detail=str(e))
