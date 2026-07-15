"""Rename-Journal API Routes

List recent rename/move batches from the append-only journal and undo (reverse)
one. See ``undo_service`` and ``core.fs_ops``.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.undo_service import get_undo_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/rename-journal/batches")
async def batches(limit: int = 20):
    """Recent journal batches, newest first (each with an ``undoable`` flag)."""
    try:
        return get_undo_service().list_batches(limit=limit)
    except Exception as e:
        logger.exception("rename-journal batches failed")
        raise HTTPException(status_code=500, detail=str(e))


class UndoRequest(BaseModel):
    batch_id: str
    # Default off: preview (dry-run) unless the caller opts into the real revert.
    execute: bool = False


@router.post("/rename-journal/undo")
async def undo(request: UndoRequest):
    """Preview or perform the reversal of one batch's recorded moves."""
    try:
        return await get_undo_service().undo(
            batch_id=request.batch_id, execute=request.execute)
    except ValueError as e:
        # "not found" vs "not undoable" both surface as a client error; the
        # message distinguishes them for the UI.
        detail = str(e)
        status = 404 if "finns inte" in detail else 400
        raise HTTPException(status_code=status, detail=detail)
    except Exception as e:
        logger.exception("rename-journal undo failed")
        raise HTTPException(status_code=500, detail=str(e))
