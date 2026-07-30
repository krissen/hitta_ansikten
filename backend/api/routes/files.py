"""
File Routes

Endpoints for file operations including rename functionality.
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from faceid_db import get_file_hash

from ..services.manual_suffix_service import (
    get_manual_suffix,
    normalize_suffix,
    set_manual_suffix,
)
from ..services.rename_service import rename_service, validate_path_security

logger = logging.getLogger(__name__)
router = APIRouter()


# Request/Response models

class RenameConfig(BaseModel):
    """Configuration for rename operations."""
    # Prefix source: 'filename', 'exif', 'filedate'
    prefixSource: str | None = None
    # Fallback if EXIF missing: 'filedate', 'skip', 'original'
    exifFallback: str | None = None
    # Date pattern for formatting (Python strftime)
    datePattern: str | None = None
    # Filename pattern template with variables: {prefix}, {names}, {ext}, {original}, {date}, {time}
    filenamePattern: str | None = None
    # Name formatting
    useFirstNameOnly: bool | None = None
    nameSeparator: str | None = None
    removeDiacritics: bool | None = None
    # Disambiguation
    disambiguationStyle: str | None = None  # 'initial' or 'full'
    alwaysIncludeSurname: bool | None = None
    # File handling
    allowAlreadyRenamed: bool | None = None
    includeIgnoredFaces: bool | None = None
    # Sidecar files
    renameSidecars: bool | None = None  # Also rename associated sidecar files (XMP, etc)
    sidecarExtensions: list[str] | None = None  # Extensions to look for (case insensitive)


class RenamePreviewRequest(BaseModel):
    file_paths: list[str]
    allow_renamed: bool = False
    config: RenameConfig | None = None


class RenamePreviewItem(BaseModel):
    original_path: str
    original_name: str
    new_name: str | None = None
    persons: list[str]
    status: str  # 'ok', 'no_persons', 'already_renamed', 'conflict', 'file_not_found', 'build_failed'
    conflict_with: str | None = None
    sidecars: list[str] = []  # List of sidecar files that will be renamed


class RenamePreviewResponse(BaseModel):
    items: list[RenamePreviewItem]
    name_map: dict[str, str]  # full_name -> short_name mapping


class RenameExecuteRequest(BaseModel):
    file_paths: list[str]
    allow_renamed: bool = False
    config: RenameConfig | None = None


class SidecarRenameResult(BaseModel):
    original: str
    new: str


class RenameResult(BaseModel):
    original: str
    new: str
    sidecars: list[SidecarRenameResult] = []  # Sidecar files that were renamed


class SkippedFile(BaseModel):
    path: str
    reason: str


class ErrorFile(BaseModel):
    path: str
    error: str


class RenameExecuteResponse(BaseModel):
    renamed: list[RenameResult]
    skipped: list[SkippedFile]
    errors: list[ErrorFile]
    db_entries_updated: int = 0  # Number of database entries updated to reflect new paths


class RenameConfigResponse(BaseModel):
    """Response containing default rename configuration."""
    config: dict[str, Any]
    presets: dict[str, dict[str, str]]


class ManualSuffixRequest(BaseModel):
    """Set/clear a free-text filename suffix for a single image."""
    image_path: str
    suffix: str


class ManualSuffixResponse(BaseModel):
    """Stored suffix state plus the normalized preview."""
    hash: str | None = None
    suffix: str  # normalized (filesystem-safe) form
    raw: str     # stored raw text (empty when cleared)


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
        logger.exception(f"[Files] Error generating rename preview: {e}")
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
        logger.exception(f"[Files] Error executing rename: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/manual-suffix", response_model=ManualSuffixResponse)
async def get_manual_suffix_endpoint(image_path: str):
    """
    Get the stored free-text filename suffix for an image (for UI prefill).

    Returns the raw stored text and its normalized preview. Never touches the
    face database.
    """
    is_valid, error = validate_path_security(image_path)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)

    # Hashing a (possibly large) NEF is blocking I/O — keep it off the loop.
    file_hash = await asyncio.to_thread(get_file_hash, image_path)
    raw = (get_manual_suffix(file_hash) or "") if file_hash else ""
    return ManualSuffixResponse(hash=file_hash, suffix=normalize_suffix(raw), raw=raw)


@router.post("/files/manual-suffix", response_model=ManualSuffixResponse)
async def set_manual_suffix_endpoint(request: ManualSuffixRequest):
    """
    Set or clear the free-text filename suffix for an image.

    An empty (or path/whitespace-only) suffix clears the entry. The suffix is
    stored keyed by content hash (stable across rename) and is NOT a person
    name — it never reaches encodings.pkl, autocomplete, or the person pipeline.
    """
    is_valid, error = validate_path_security(request.image_path)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)

    # Hashing a (possibly large) NEF is blocking I/O — keep it off the loop.
    file_hash = await asyncio.to_thread(get_file_hash, request.image_path)
    if not file_hash:
        raise HTTPException(status_code=500, detail="Could not hash file")

    raw = request.suffix or ""
    set_manual_suffix(file_hash, raw)
    normalized = normalize_suffix(raw)
    stored = raw.strip() if normalized else ""
    return ManualSuffixResponse(hash=file_hash, suffix=normalized, raw=stored)
