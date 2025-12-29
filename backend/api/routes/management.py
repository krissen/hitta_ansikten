"""
Database Management API Routes

Provides database management operations for the workspace.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.management_service import management_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Request/Response Models ============


class PersonEntry(BaseModel):
    """Person with encoding count"""
    name: str
    encoding_count: int


class DatabaseState(BaseModel):
    """Current database state"""
    people: List[PersonEntry]
    ignored_count: int
    hard_negatives_count: int
    processed_files_count: int


class RenamePersonRequest(BaseModel):
    """Request to rename person"""
    old_name: str
    new_name: str


class MergePeopleRequest(BaseModel):
    """Request to merge multiple people"""
    source_names: List[str]
    target_name: str


class DeletePersonRequest(BaseModel):
    """Request to delete person"""
    name: str


class MoveToIgnoreRequest(BaseModel):
    """Request to move person to ignored"""
    name: str


class MoveFromIgnoreRequest(BaseModel):
    """Request to move encodings from ignored"""
    count: int  # -1 for all
    target_name: str


class UndoFileRequest(BaseModel):
    """Request to undo file processing"""
    filename_pattern: str  # Exact name or glob


class PurgeEncodingsRequest(BaseModel):
    """Request to purge encodings"""
    name: str  # Person name or "ignore"
    count: int


class OperationResponse(BaseModel):
    """Response from management operation"""
    status: str
    message: str
    new_state: Optional[DatabaseState] = None
    files_undone: Optional[List[str]] = None


class RecentFile(BaseModel):
    """Recently processed file"""
    name: str
    hash: str


# ============ API Endpoints ============


@router.get("/management/database-state", response_model=DatabaseState)
async def get_database_state():
    """
    Get current database state

    Returns:
    - List of people with encoding counts
    - Ignored encoding count
    - Hard negatives count
    - Processed files count
    """
    try:
        logger.info("[Management] Getting database state")
        state = await management_service.get_database_state()
        return DatabaseState(**state)

    except Exception as e:
        logger.error(f"[Management] Error getting database state: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/management/rename-person", response_model=OperationResponse)
async def rename_person(request: RenamePersonRequest):
    """
    Rename person in database

    Validates that old_name exists and new_name doesn't exist.
    Returns new database state on success.
    """
    try:
        logger.info(f"[Management] Renaming '{request.old_name}' to '{request.new_name}'")
        result = await management_service.rename_person(request.old_name, request.new_name)
        return OperationResponse(**result)

    except ValueError as e:
        logger.error(f"[Management] Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Management] Error renaming person: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/management/merge-people", response_model=OperationResponse)
async def merge_people(request: MergePeopleRequest):
    """
    Merge multiple people into target name

    Deduplicates encodings by encoding_hash.
    Target name can be one of source_names or a new name.
    Returns new database state on success.
    """
    try:
        logger.info(f"[Management] Merging {request.source_names} into '{request.target_name}'")
        result = await management_service.merge_people(request.source_names, request.target_name)
        return OperationResponse(**result)

    except ValueError as e:
        logger.error(f"[Management] Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Management] Error merging people: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/management/delete-person", response_model=OperationResponse)
async def delete_person(request: DeletePersonRequest):
    """
    Delete person from database

    Permanently removes person and all their encodings.
    Returns new database state on success.
    """
    try:
        logger.info(f"[Management] Deleting '{request.name}'")
        result = await management_service.delete_person(request.name)
        return OperationResponse(**result)

    except ValueError as e:
        logger.error(f"[Management] Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Management] Error deleting person: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/management/move-to-ignore", response_model=OperationResponse)
async def move_to_ignore(request: MoveToIgnoreRequest):
    """
    Move person's encodings to ignored list

    Removes person from database and adds their encodings to ignored.
    Returns new database state on success.
    """
    try:
        logger.info(f"[Management] Moving '{request.name}' to ignored")
        result = await management_service.move_to_ignore(request.name)
        return OperationResponse(**result)

    except ValueError as e:
        logger.error(f"[Management] Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Management] Error moving to ignore: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/management/move-from-ignore", response_model=OperationResponse)
async def move_from_ignore(request: MoveFromIgnoreRequest):
    """
    Move encodings from ignored to person

    Args:
    - count: Number to move (or -1 for all)
    - target_name: Person name to receive encodings

    Returns new database state on success.
    """
    try:
        logger.info(f"[Management] Moving {request.count} from ignored to '{request.target_name}'")
        result = await management_service.move_from_ignore(request.count, request.target_name)
        return OperationResponse(**result)

    except ValueError as e:
        logger.error(f"[Management] Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Management] Error moving from ignore: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/management/undo-file", response_model=OperationResponse)
async def undo_file(request: UndoFileRequest):
    """
    Undo processing for file(s) matching pattern

    Supports glob patterns (e.g., "2024*.NEF").
    Removes encodings added by matching files.
    Returns list of files undone and new database state.
    """
    try:
        logger.info(f"[Management] Undoing files matching '{request.filename_pattern}'")
        result = await management_service.undo_file(request.filename_pattern)
        return OperationResponse(**result)

    except ValueError as e:
        logger.error(f"[Management] Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Management] Error undoing file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/management/purge-encodings", response_model=OperationResponse)
async def purge_encodings(request: PurgeEncodingsRequest):
    """
    Remove last X encodings from person or ignore

    Args:
    - name: Person name or "ignore"
    - count: Number to remove from end

    Returns new database state on success.
    """
    try:
        logger.info(f"[Management] Purging {request.count} encodings from '{request.name}'")
        result = await management_service.purge_encodings(request.name, request.count)
        return OperationResponse(**result)

    except ValueError as e:
        logger.error(f"[Management] Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Management] Error purging encodings: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/management/recent-files", response_model=List[RecentFile])
async def get_recent_files(n: int = 10):
    """
    Get last N processed files

    Args:
    - n: Number of files to return (default 10)

    Returns list of recent files with names and hashes.
    """
    try:
        logger.info(f"[Management] Getting {n} recent files")
        files = await management_service.get_recent_files(n=n)
        return [RecentFile(**f) for f in files]

    except Exception as e:
        logger.error(f"[Management] Error getting recent files: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
