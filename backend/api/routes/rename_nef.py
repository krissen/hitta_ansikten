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
    recursive: bool = True


@router.post("/rename-nef/preview")
async def preview(request: RenameNefRequest):
    """Dry-run: show the EXIF-derived rename mapping."""
    try:
        return await get_rename_nef_service().preview(
            roots=request.roots, globs=request.globs, recursive=request.recursive,
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
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("rename-nef execute failed")
        raise HTTPException(status_code=500, detail=str(e))
