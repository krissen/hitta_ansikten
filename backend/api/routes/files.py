"""
File Routes

Endpoints for file operations including rename functionality.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import logging

from ..services.rename_service import rename_service

logger = logging.getLogger(__name__)
router = APIRouter()


# Request/Response models

class RenameConfig(BaseModel):
    """Configuration for rename operations."""
    # Prefix source: 'filename', 'exif', 'filedate'
    prefixSource: Optional[str] = None
    # Fallback if EXIF missing: 'filedate', 'skip', 'original'
    exifFallback: Optional[str] = None
    # Date pattern for formatting (Python strftime)
    datePattern: Optional[str] = None
    # Filename pattern template with variables: {prefix}, {names}, {ext}, {original}, {date}, {time}
    filenamePattern: Optional[str] = None
    # Name formatting
    useFirstNameOnly: Optional[bool] = None
    nameSeparator: Optional[str] = None
    removeDiacritics: Optional[bool] = None
    # Disambiguation
    disambiguationStyle: Optional[str] = None  # 'initial' or 'full'
    alwaysIncludeSurname: Optional[bool] = None
    # File handling
    allowAlreadyRenamed: Optional[bool] = None
    includeIgnoredFaces: Optional[bool] = None


class RenamePreviewRequest(BaseModel):
    file_paths: List[str]
    allow_renamed: bool = False
    config: Optional[RenameConfig] = None


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
    config: Optional[RenameConfig] = None


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


class RenameConfigResponse(BaseModel):
    """Response containing default rename configuration."""
    config: Dict[str, Any]
    presets: Dict[str, Dict[str, str]]


# Endpoints

@router.get("/files/rename-config")
async def get_rename_config():
    """
    Get default rename configuration and available presets.

    Returns the default configuration values and preset patterns
    that can be used in the rename UI.
    """
    config = rename_service.get_default_config()

    # Define presets for common patterns
    presets = {
        "datePatterns": {
            "YYMMDD_HHMMSS": "%y%m%d_%H%M%S",
            "YYYYMMDD_HHMMSS": "%Y%m%d_%H%M%S",
            "YYYY-MM-DD_HH-MM-SS": "%Y-%m-%d_%H-%M-%S",
            "YYMMDD-HHMMSS": "%y%m%d-%H%M%S",
        },
        "filenamePatterns": {
            "{prefix}_{names}{ext}": "Standard: 250612_153040_Anna,_Bert.NEF",
            "{date}-{time}_{names}{ext}": "Dash: 250612-153040_Anna,_Bert.NEF",
            "{names}_{prefix}{ext}": "Names first: Anna,_Bert_250612_153040.NEF",
            "{original}_{names}{ext}": "Keep original: DSC_1234_Anna,_Bert.NEF",
        },
        "nameSeparators": {
            ",_": "Comma-underscore: Anna,_Bert",
            "_": "Underscore: Anna_Bert",
            "-": "Dash: Anna-Bert",
            "_och_": "Swedish 'och': Anna_och_Bert",
        }
    }

    return RenameConfigResponse(config=config, presets=presets)


@router.post("/files/rename-preview", response_model=RenamePreviewResponse)
async def rename_preview(request: RenamePreviewRequest):
    """
    Generate preview of proposed file renames.

    Returns list of files with their proposed new names, status, and any conflicts.
    Does not modify any files.
    """
    logger.info(f"[Files] Rename preview requested for {len(request.file_paths)} files")

    try:
        # Convert config to dict, excluding None values
        config_dict = None
        if request.config:
            config_dict = {k: v for k, v in request.config.model_dump().items() if v is not None}

        result = rename_service.preview_rename(
            request.file_paths,
            allow_renamed=request.allow_renamed,
            config=config_dict
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
    Format configurable via config parameter.
    """
    logger.info(f"[Files] Rename execution requested for {len(request.file_paths)} files")

    try:
        # Convert config to dict, excluding None values
        config_dict = None
        if request.config:
            config_dict = {k: v for k, v in request.config.model_dump().items() if v is not None}

        result = rename_service.execute_rename(
            request.file_paths,
            allow_renamed=request.allow_renamed,
            config=config_dict
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
