"""
Encoding Refinement API Routes

Provides endpoints for filtering outlier encodings and repairing
shape inconsistencies in the face database.

Only InsightFace encodings are supported. dlib encodings are deprecated.
"""

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..services.refinement_service import refinement_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Request/Response Models ============


class DistanceStats(BaseModel):
    """Statistics for distances in a preview."""
    min_dist: float
    max_dist: float
    mean_dist: float
    std_dist: float


class PreviewEntry(BaseModel):
    """Preview result for one person."""
    person: str
    total: int
    keep: int
    remove: int
    remove_indices: list[int]
    reason: str
    stats: DistanceStats | None = None


class PreviewSummary(BaseModel):
    """Summary of preview results."""
    total_people: int
    affected_people: int
    total_remove: int


class PreviewResponse(BaseModel):
    """Response for preview endpoint."""
    preview: list[PreviewEntry]
    summary: PreviewSummary


class ApplyRequest(BaseModel):
    """Request to apply filtering."""
    mode: str = "std"
    persons: list[str] | None = None
    std_threshold: float = 2.0
    cluster_dist: float = 0.35
    cluster_min: int = 6
    mahalanobis_threshold: float = 3.0
    min_encodings: int = 8
    dry_run: bool = False


class ApplyResponse(BaseModel):
    """Response for apply endpoint."""
    status: str
    dry_run: bool
    removed: int
    by_person: dict[str, int]


class RepairShapesRequest(BaseModel):
    """Request to repair shapes."""
    persons: list[str] | None = None
    dry_run: bool = False


class RepairedEntry(BaseModel):
    """Details of shape repair for one person."""
    person: str
    removed: int
    total: int
    kept_shape: list[int]
    removed_shapes: list[list[int]]


class RepairShapesResponse(BaseModel):
    """Response for repair-shapes endpoint."""
    status: str
    dry_run: bool
    total_removed: int
    repaired: list[RepairedEntry]


class RemoveDlibRequest(BaseModel):
    """Request to remove dlib encodings."""
    dry_run: bool = False


class RemoveDlibResponse(BaseModel):
    """Response for remove-dlib endpoint."""
    status: str
    dry_run: bool
    total_removed: int
    by_person: dict[str, int]
    people_affected: int


# ============ API Endpoints ============


@router.get("/refinement/preview", response_model=PreviewResponse)
async def preview_refinement(
    person: str | None = Query(None, description="Person name or * for all"),
    mode: str = Query("std", description="Filter mode: std, cluster, mahalanobis, or shape"),
    std_threshold: float = Query(2.0, description="Standard deviations for outlier detection"),
    cluster_dist: float = Query(0.35, description="Max cosine distance from centroid"),
    cluster_min: int = Query(6, description="Minimum cluster size"),
    mahalanobis_threshold: float = Query(3.0, description="Mahalanobis distance threshold"),
    min_encodings: int = Query(8, description="Skip filtering if fewer encodings")
):
    """
    Preview what encodings would be removed.

    Returns per-person breakdown with distance statistics.
    Does not modify the database. Only processes InsightFace encodings.

    Modes:
    - std: Remove encodings > N standard deviations from centroid
    - cluster: Keep only tight cluster around centroid
    - mahalanobis: Covariance-aware outlier detection (better for high-dim data)
    - shape: Remove encodings with non-majority shape
    """
    try:
        logger.info(f"[Refinement] Preview: person={person}, mode={mode}")
        result = await refinement_service.preview(
            person=person,
            mode=mode,
            std_threshold=std_threshold,
            cluster_dist=cluster_dist,
            cluster_min=cluster_min,
            mahalanobis_threshold=mahalanobis_threshold,
            min_encodings=min_encodings
        )

        # Convert preview entries
        preview_entries = []
        for p in result["preview"]:
            entry = PreviewEntry(
                person=p["person"],
                total=p["total"],
                keep=p["keep"],
                remove=p["remove"],
                remove_indices=p["remove_indices"],
                reason=p["reason"],
                stats=DistanceStats(**p["stats"]) if p.get("stats") else None
            )
            preview_entries.append(entry)

        return PreviewResponse(
            preview=preview_entries,
            summary=PreviewSummary(**result["summary"])
        )

    except Exception as e:
        logger.exception(f"[Refinement] Error in preview: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refinement/apply", response_model=ApplyResponse)
async def apply_refinement(request: ApplyRequest):
    """
    Apply filtering to remove outlier encodings.

    Uses cosine distance for InsightFace encodings.
    Set dry_run=true to preview without saving.

    Modes:
    - std: Standard deviation filter
    - cluster: Distance-based cluster filter
    - mahalanobis: Covariance-aware outlier filter
    """
    try:
        logger.info(f"[Refinement] Apply: mode={request.mode}, dry_run={request.dry_run}")
        result = await refinement_service.apply(
            mode=request.mode,
            persons=request.persons,
            std_threshold=request.std_threshold,
            cluster_dist=request.cluster_dist,
            cluster_min=request.cluster_min,
            mahalanobis_threshold=request.mahalanobis_threshold,
            min_encodings=request.min_encodings,
            dry_run=request.dry_run
        )
        return ApplyResponse(**result)

    except ValueError as e:
        logger.error(f"[Refinement] Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"[Refinement] Error applying refinement: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refinement/repair-shapes", response_model=RepairShapesResponse)
async def repair_shapes(request: RepairShapesRequest):
    """
    Repair inconsistent encoding shapes.

    For each person, finds the most common shape and removes
    encodings with different shapes.
    """
    try:
        logger.info(f"[Refinement] Repair shapes: dry_run={request.dry_run}")
        result = await refinement_service.repair_shapes(
            persons=request.persons,
            dry_run=request.dry_run
        )
        return RepairShapesResponse(
            status=result["status"],
            dry_run=result["dry_run"],
            total_removed=result["total_removed"],
            repaired=[RepairedEntry(**r) for r in result["repaired"]]
        )

    except ValueError as e:
        logger.error(f"[Refinement] Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"[Refinement] Error repairing shapes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refinement/remove-dlib", response_model=RemoveDlibResponse)
async def remove_dlib_encodings(request: RemoveDlibRequest):
    """
    Remove ALL dlib encodings from the database.

    dlib backend is deprecated. Only InsightFace is supported.
    This permanently removes all dlib (128-dim) encodings.

    Set dry_run=true to preview without saving.
    """
    try:
        logger.info(f"[Refinement] Remove dlib: dry_run={request.dry_run}")
        result = await refinement_service.remove_dlib_encodings(
            dry_run=request.dry_run
        )
        return RemoveDlibResponse(**result)

    except Exception as e:
        logger.exception(f"[Refinement] Error removing dlib encodings: {e}")
        raise HTTPException(status_code=500, detail=str(e))
