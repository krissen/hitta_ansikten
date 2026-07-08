"""
Database Management API Routes

Provides database management operations for the workspace.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..services.management_service import management_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Request/Response Models ============


class PersonEntry(BaseModel):
    name: str
    encoding_count: int
    encodings_by_backend: Optional[dict] = None


class DatabaseState(BaseModel):
    people: List[PersonEntry]
    ignored_count: int
    ignored_by_backend: Optional[dict] = None
    hard_negatives_count: int
    processed_files_count: int
    backends_in_use: Optional[List[str]] = None


class RenamePersonRequest(BaseModel):
    """Request to rename person"""
    old_name: str
    new_name: str


class MergePeopleRequest(BaseModel):
    source_names: List[str]
    target_name: str
    backend_filter: Optional[str] = None


class DeletePersonRequest(BaseModel):
    name: str


class MoveToIgnoreRequest(BaseModel):
    name: str
    backend_filter: Optional[str] = None


class MoveFromIgnoreRequest(BaseModel):
    count: int
    target_name: str
    backend_filter: Optional[str] = None


class UndoFileRequest(BaseModel):
    filename_pattern: str


class PurgeEncodingsRequest(BaseModel):
    name: str
    count: int
    backend_filter: Optional[str] = None


class OperationResponse(BaseModel):
    status: str
    message: str
    warning: Optional[str] = None
    encodings_by_backend: Optional[dict] = None
    moved_by_backend: Optional[dict] = None
    purged_by_backend: Optional[dict] = None
    new_state: Optional[DatabaseState] = None
    files_undone: Optional[List[str]] = None
    removed_per_person: Optional[dict] = None
    total_removed: Optional[int] = None


class DuplicatePair(BaseModel):
    name_a: str
    name_b: str
    distance: float
    count_a: int
    count_b: int
    separability: Optional[float] = None
    margin: Optional[float] = None
    likely_distinct: bool = False


class FindDuplicatesResponse(BaseModel):
    pairs: List[DuplicatePair]
    threshold: float
    people_compared: int


class DistinctPairRequest(BaseModel):
    name_a: str
    name_b: str


class DistinctPairEntry(BaseModel):
    name_a: str
    name_b: str


class DistinctPairsResponse(BaseModel):
    pairs: List[DistinctPairEntry]
    count: int


class PersonRedundancy(BaseModel):
    name: str
    total: int
    redundant: int
    kept: int


class RedundantEncodingsResponse(BaseModel):
    people: List[PersonRedundancy]
    threshold: float
    total_redundant: int


class DedupPeopleRequest(BaseModel):
    names: List[str]
    threshold: float = 0.0
    dry_run: bool = False


class DistinctPairOperationResponse(BaseModel):
    status: str
    count: int


class RecentFile(BaseModel):
    """Recently processed file"""
    name: str
    hash: Optional[str] = None  # Some legacy entries may lack hash


class StatsResponse(BaseModel):
    """Quick stats for UI display"""
    unique_persons: int
    total_encodings: int
    ignored_count: int
    processed_files_count: int


# ============ API Endpoints ============


@router.get("/management/stats", response_model=StatsResponse)
async def get_stats():
    """
    Get quick database statistics for UI display

    Returns:
    - unique_persons: Number of distinct people in database
    - total_encodings: Total number of face encodings
    - ignored_count: Number of ignored encodings
    - processed_files_count: Number of processed files
    """
    try:
        state = await management_service.get_database_state()
        total_encodings = sum(p['encoding_count'] for p in state['people'])
        return StatsResponse(
            unique_persons=len(state['people']),
            total_encodings=total_encodings,
            ignored_count=state['ignored_count'],
            processed_files_count=state['processed_files_count']
        )

    except Exception as e:
        logger.error(f"[Management] Error getting stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


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


@router.get("/management/find-duplicates", response_model=FindDuplicatesResponse)
async def find_duplicates(threshold: float = Query(0.35, ge=0, le=2)):
    """
    Find pairs of distinctly-named people whose faces look like the same person.

    Returns centroid-distance candidate pairs (closest first) for review and
    merge. `threshold` is a cosine distance (lower = stricter; default 0.35).
    """
    try:
        logger.info(f"[Management] Finding duplicate people (threshold={threshold})")
        result = await management_service.find_duplicate_people(threshold)
        return FindDuplicatesResponse(**result)

    except Exception as e:
        logger.error(f"[Management] Error finding duplicates: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/management/distinct-pairs", response_model=DistinctPairsResponse)
async def list_distinct_pairs():
    """List confirmed-distinct name-pairs (excluded from duplicate suggestions)."""
    try:
        result = await management_service.list_distinct_pairs()
        return DistinctPairsResponse(**result)
    except Exception as e:
        logger.error(f"[Management] Error listing distinct pairs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/management/distinct-pair", response_model=DistinctPairOperationResponse)
async def add_distinct_pair(request: DistinctPairRequest):
    """Mark a name-pair as confirmed-distinct (not a duplicate); the scanner skips it."""
    try:
        result = await management_service.add_distinct_pair(request.name_a, request.name_b)
        return DistinctPairOperationResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Management] Error adding distinct pair: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/management/redundant-encodings", response_model=RedundantEncodingsResponse)
async def redundant_encodings(threshold: float = Query(0.0, ge=0, le=2)):
    """Per-person count of redundant encodings (exact, plus near at threshold>0)."""
    try:
        result = await management_service.find_redundant_encodings(threshold)
        return RedundantEncodingsResponse(**result)
    except Exception as e:
        logger.error(f"[Management] Error scanning redundant encodings: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/management/dedup-people", response_model=OperationResponse)
async def dedup_people(request: DedupPeopleRequest):
    """Remove redundant encodings from the named people (keeps one per group)."""
    try:
        result = await management_service.dedup_people(
            request.names, threshold=request.threshold, dry_run=request.dry_run
        )
        return OperationResponse(**result)
    except Exception as e:
        logger.error(f"[Management] Error deduping people: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/management/distinct-pair/remove", response_model=DistinctPairOperationResponse)
async def remove_distinct_pair(request: DistinctPairRequest):
    """Remove a confirmed-distinct pair (undo) so it can be suggested again."""
    try:
        result = await management_service.remove_distinct_pair(request.name_a, request.name_b)
        return DistinctPairOperationResponse(**result)
    except Exception as e:
        logger.error(f"[Management] Error removing distinct pair: {e}", exc_info=True)
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
    Merge multiple people into target name.

    Deduplicates encodings by encoding_hash.
    Target name can be one of source_names or a new name.
    Optional backend_filter to only merge encodings from specific backend.
    Returns warning if mixing backends.
    """
    try:
        logger.info(f"[Management] Merging {request.source_names} into '{request.target_name}'")
        result = await management_service.merge_people(
            request.source_names,
            request.target_name,
            backend_filter=request.backend_filter
        )
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
    Move person's encodings to ignored list.

    Removes person from database and adds their encodings to ignored.
    Optional backend_filter to only move encodings from specific backend.
    """
    try:
        logger.info(f"[Management] Moving '{request.name}' to ignored")
        result = await management_service.move_to_ignore(
            request.name,
            backend_filter=request.backend_filter
        )
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
    Move encodings from ignored to person.

    Args:
    - count: Number to move (or -1 for all matching)
    - target_name: Person name to receive encodings
    - backend_filter: Optional, only move encodings from this backend
    """
    try:
        logger.info(f"[Management] Moving {request.count} from ignored to '{request.target_name}'")
        result = await management_service.move_from_ignore(
            request.count,
            request.target_name,
            backend_filter=request.backend_filter
        )
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
    Remove last X encodings from person or ignore.

    Args:
    - name: Person name or "ignore"
    - count: Number to remove from end
    - backend_filter: Optional, only purge encodings from this backend
    """
    try:
        logger.info(f"[Management] Purging {request.count} encodings from '{request.name}'")
        result = await management_service.purge_encodings(
            request.name,
            request.count,
            backend_filter=request.backend_filter
        )
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
