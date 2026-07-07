"""
Detection Routes

Endpoints for face detection operations.
ML libraries loaded lazily on first detection request.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

def get_detection_service():
    """Lazy import + lazy construction to avoid loading ML libs at startup"""
    from ..services.detection_service import get_detection_service as _get
    return _get()

# Request/Response models
class DetectionRequest(BaseModel):
    image_path: str
    force_reprocess: bool = False

class BoundingBox(BaseModel):
    x: int
    y: int
    width: int
    height: int

class MatchAlternative(BaseModel):
    name: str
    distance: float
    confidence: int
    is_ignored: bool = False


class DetectedFace(BaseModel):
    face_id: str
    bounding_box: BoundingBox
    confidence: float
    person_name: Optional[str] = None
    is_confirmed: bool = False
    match_case: Optional[str] = None
    ignore_distance: Optional[float] = None
    ignore_confidence: Optional[int] = None
    match_alternatives: Optional[List[MatchAlternative]] = None
    encoding_hash: Optional[str] = None
    disambiguated: Optional[Dict[str, Any]] = None

class DetectionResult(BaseModel):
    image_path: str
    faces: List[DetectedFace]
    processing_time_ms: float
    cached: bool = False
    file_hash: Optional[str] = None  # SHA1 hash of file (for reuse in mark-review-complete)

class ConfirmIdentityRequest(BaseModel):
    face_id: str
    person_name: str
    image_path: str
    suggested_name: Optional[str] = None

class IgnoreFaceRequest(BaseModel):
    face_id: str
    image_path: str

class ConfirmIdentityResponse(BaseModel):
    status: str
    person_name: str
    encodings_count: int

class IgnoreFaceResponse(BaseModel):
    status: str
    ignored_count: int

class ReloadDatabaseResponse(BaseModel):
    status: str
    people_count: int
    ignored_count: int
    cache_cleared: int


class BatchConfirmItem(BaseModel):
    face_id: str
    person_name: str
    image_path: str
    suggested_name: Optional[str] = None

class BatchIgnoreItem(BaseModel):
    face_id: str
    image_path: str

class BatchConfirmRequest(BaseModel):
    confirmations: List[BatchConfirmItem] = []
    ignores: List[BatchIgnoreItem] = []

class BatchConfirmResponse(BaseModel):
    status: str
    confirmed_count: int
    ignored_count: int
    errors: List[dict] = []


class ReviewedFace(BaseModel):
    face_index: int
    face_id: str
    encoding_hash: Optional[str] = None
    person_name: Optional[str] = None
    is_ignored: bool = False


class MarkReviewCompleteRequest(BaseModel):
    image_path: str
    reviewed_faces: List[ReviewedFace]
    file_hash: Optional[str] = None  # Optional: reuse hash from detection to avoid rehashing


class MarkReviewCompleteResponse(BaseModel):
    status: str
    message: str
    labels_count: int

@router.post("/reload-database", response_model=ReloadDatabaseResponse)
async def reload_database():
    """
    Reload face database from disk

    Useful when database has been modified externally (e.g., by the archived hantera_ansikten.py script).
    Clears detection cache to ensure fresh results with updated data.
    """
    logger.info("[Detection] Reloading database...")

    try:
        result = get_detection_service().reload_database()
        return ReloadDatabaseResponse(**result)
    except Exception as e:
        logger.error(f"[Detection] Error reloading database: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/detect-faces", response_model=DetectionResult)
async def detect_faces(request: DetectionRequest):
    """
    Detect faces in an image

    Returns list of detected faces with bounding boxes and confidence scores.
    Results are cached based on image path and modification time.
    """
    logger.info(f"[Detection] Processing image: {request.image_path}")

    try:
        # Use real detection service
        result = await get_detection_service().detect_faces(
            request.image_path,
            force_reprocess=request.force_reprocess
        )

        # Convert to response model
        return DetectionResult(
            image_path=request.image_path,
            faces=[
                DetectedFace(
                    face_id=face["face_id"],
                    bounding_box=BoundingBox(**face["bounding_box"]),
                    confidence=face["confidence"],
                    person_name=face["person_name"],
                    is_confirmed=face["is_confirmed"],
                    # New fields for ignore-awareness and match alternatives
                    match_case=face.get("match_case"),
                    ignore_distance=face.get("ignore_distance"),
                    ignore_confidence=face.get("ignore_confidence"),
                    match_alternatives=[
                        MatchAlternative(**alt)
                        for alt in face.get("match_alternatives", [])
                    ] if face.get("match_alternatives") else None,
                    encoding_hash=face.get("encoding_hash"),
                    disambiguated=face.get("disambiguated")
                )
                for face in result["faces"]
            ],
            processing_time_ms=result["processing_time_ms"],
            cached=result.get("cached", False),
            file_hash=result.get("file_hash")
        )
    except FileNotFoundError as e:
        logger.error(f"[Detection] File not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"[Detection] Error processing image: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/face-thumbnail")
async def get_face_thumbnail(image_path: str, x: int, y: int, width: int, height: int, size: int = 150):
    """
    Get thumbnail image of a detected face

    Args:
        image_path: Path to source image
        x, y, width, height: Bounding box coordinates
        size: Thumbnail size (default 150x150)

    Returns:
        JPEG image bytes

    Caching:
        - Checks disk cache first (preprocessing thumbnails)
        - Falls back to on-demand generation
        - Browser cache: 1 week (604800s)
    """
    from pathlib import Path

    from ..services.preprocessing_cache import get_cache

    logger.debug(f"[Detection] Getting thumbnail from {image_path} at ({x},{y},{width},{height})")
    bounding_box = {"x": x, "y": y, "width": width, "height": height}
    cache = get_cache()

    try:
        # Try disk cache first
        file_hash = cache.compute_file_hash(image_path)

        # Check if we have cached thumbnails and face detection data
        if cache.has_thumbnails(file_hash):
            faces_data = cache.get_face_detection(file_hash)
            if faces_data and 'faces' in faces_data:
                # Find matching face by bounding box
                for i, face in enumerate(faces_data['faces']):
                    bbox = face.get('bounding_box', {})
                    if (bbox.get('x') == x and bbox.get('y') == y and
                        bbox.get('width') == width and bbox.get('height') == height):
                        # Found matching face - serve cached thumbnail
                        thumb_paths = cache.get_thumbnails(file_hash)
                        if thumb_paths and i < len(thumb_paths):
                            thumb_path = Path(thumb_paths[i])
                            if thumb_path.exists():
                                logger.debug(f"[Detection] Serving cached thumbnail: {thumb_path.name}")
                                with open(thumb_path, 'rb') as f:
                                    thumbnail_bytes = f.read()
                                return Response(
                                    content=thumbnail_bytes,
                                    media_type="image/jpeg",
                                    headers={
                                        "Cache-Control": "public, max-age=604800",
                                        "X-Cache": "HIT"
                                    }
                                )

        # Fall back to on-demand generation
        logger.debug(f"[Detection] Generating thumbnail on-demand for {Path(image_path).name}")
        thumbnail_bytes = await get_detection_service().get_face_thumbnail(
            image_path,
            bounding_box,
            size=size
        )

        return Response(
            content=thumbnail_bytes,
            media_type="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=604800",
                "X-Cache": "MISS"
            }
        )
    except FileNotFoundError as e:
        logger.error(f"[Detection] File not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"[Detection] Error generating thumbnail: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/confirm-identity", response_model=ConfirmIdentityResponse)
async def confirm_identity(request: ConfirmIdentityRequest):
    """
    Confirm face identity and save to database

    Saves the face encoding with the person name to the known_faces database.
    """
    logger.info(f"[Detection] Confirming identity: {request.face_id} -> {request.person_name}")

    try:
        result = await get_detection_service().confirm_identity(
            request.face_id,
            request.person_name,
            request.image_path,
            suggested_name=request.suggested_name
        )

        return ConfirmIdentityResponse(**result)
    except ValueError as e:
        logger.error(f"[Detection] Invalid request: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Detection] Error confirming identity: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ignore-face", response_model=IgnoreFaceResponse)
async def ignore_face(request: IgnoreFaceRequest):
    """
    Mark face as ignored

    Adds the face encoding to the ignored_faces database to skip it in future detections.
    """
    logger.info(f"[Detection] Ignoring face: {request.face_id}")

    try:
        result = await get_detection_service().ignore_face(
            request.face_id,
            request.image_path
        )

        return IgnoreFaceResponse(**result)
    except ValueError as e:
        logger.error(f"[Detection] Invalid request: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Detection] Error ignoring face: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch-confirm", response_model=BatchConfirmResponse)
async def batch_confirm(request: BatchConfirmRequest):
    """
    Batch confirm/ignore multiple faces with a single database save.

    More efficient than individual confirm/ignore calls when processing
    all faces in an image at once.
    """
    logger.info(f"[Detection] Batch confirm: {len(request.confirmations)} confirms, {len(request.ignores)} ignores")

    try:
        result = await get_detection_service().batch_confirm(
            [c.model_dump() for c in request.confirmations],
            [i.model_dump() for i in request.ignores]
        )
        return BatchConfirmResponse(**result)
    except Exception as e:
        logger.error(f"[Detection] Error in batch confirm: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mark-review-complete", response_model=MarkReviewCompleteResponse)
async def mark_review_complete(request: MarkReviewCompleteRequest):
    """
    Mark review as complete and log to attempt_stats.jsonl

    Logs the review results with face labels in detection order.
    Required for rename functionality to work correctly.
    """
    logger.info(f"[Detection] Marking review complete for: {request.image_path}")

    try:
        result = await get_detection_service().mark_review_complete(
            request.image_path,
            [face.model_dump() for face in request.reviewed_faces],
            file_hash=request.file_hash
        )

        return MarkReviewCompleteResponse(**result)
    except Exception as e:
        logger.error(f"[Detection] Error marking review complete: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
