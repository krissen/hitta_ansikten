"""
File Routes

Endpoints for file operations including rename functionality.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict
import logging

from ..services.rename_service import rename_service

logger = logging.getLogger(__name__)
router = APIRouter()


# Request/Response models

class RenamePreviewRequest(BaseModel):
    file_paths: List[str]
    allow_renamed: bool = False


class RenamePreviewItem(BaseModel):
    original_path: str
    original_name: str
    new_name: Optional[str] = None
    persons: List[str]
    status: str  # 'ok', 'no_persons', 'already_renamed', 'conflict', 'file_not_found', 'build_failed'
    conflict_with: Optional[str] = None


class RenamePreviewResponse(BaseModel):
    items: List[RenamePreviewItem]
    name_map: Dict[str, str]  # full_name -> short_name mapping


class RenameExecuteRequest(BaseModel):
    file_paths: List[str]
    allow_renamed: bool = False


class RenameResult(BaseModel):
    original: str
    new: str


class SkippedFile(BaseModel):
    path: str
    reason: str


class ErrorFile(BaseModel):
    path: str
    error: str


class RenameExecuteResponse(BaseModel):
    renamed: List[RenameResult]
    skipped: List[SkippedFile]
    errors: List[ErrorFile]
    db_entries_updated: int = 0  # Number of database entries updated to reflect new paths


# Endpoints

@router.post("/files/rename-preview", response_model=RenamePreviewResponse)
async def rename_preview(request: RenamePreviewRequest):
    """
    Generate preview of proposed file renames.

    Returns list of files with their proposed new names, status, and any conflicts.
    Does not modify any files.
    """
    logger.info(f"[Files] Rename preview requested for {len(request.file_paths)} files")

    try:
        result = rename_service.preview_rename(
            request.file_paths,
            allow_renamed=request.allow_renamed
        )

        return RenamePreviewResponse(
            items=[RenamePreviewItem(**item) for item in result["items"]],
            name_map=result["name_map"]
        )
    except Exception as e:
        logger.error(f"[Files] Error generating rename preview: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/rename", response_model=RenameExecuteResponse)
async def rename_files(request: RenameExecuteRequest):
    """
    Execute file renames based on detected faces.

    Renames files to include person names in detection order.
    Format: YYMMDD_HHMMSS_Name1,_Name2.NEF
    """
    logger.info(f"[Files] Rename execution requested for {len(request.file_paths)} files")

    try:
        result = rename_service.execute_rename(
            request.file_paths,
            allow_renamed=request.allow_renamed
        )

        return RenameExecuteResponse(
            renamed=[RenameResult(**r) for r in result["renamed"]],
            skipped=[SkippedFile(**s) for s in result["skipped"]],
            errors=[ErrorFile(**e) for e in result["errors"]],
            db_entries_updated=result.get("db_entries_updated", 0)
        )
    except Exception as e:
        logger.error(f"[Files] Error executing rename: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
