"""
Detection Routes

Endpoints for face detection operations.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
import logging

from ..services.detection_service import detection_service

logger = logging.getLogger(__name__)
router = APIRouter()

# Request/Response models
class DetectionRequest(BaseModel):
    image_path: str
    force_reprocess: bool = False

class BoundingBox(BaseModel):
    x: int
    y: int
    width: int
    height: int

class DetectedFace(BaseModel):
    face_id: str
    bounding_box: BoundingBox
    confidence: float
    person_name: Optional[str] = None
    is_confirmed: bool = False

class DetectionResult(BaseModel):
    image_path: str
    faces: List[DetectedFace]
    processing_time_ms: float
    cached: bool = False

class ConfirmIdentityRequest(BaseModel):
    face_id: str
    person_name: str
    image_path: str

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

@router.post("/reload-database", response_model=ReloadDatabaseResponse)
async def reload_database():
    """
    Reload face database from disk

    Useful when database has been modified externally (e.g., by hantera_ansikten script).
    Clears detection cache to ensure fresh results with updated data.
    """
    logger.info("[Detection] Reloading database...")

    try:
        result = detection_service.reload_database()
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
        result = await detection_service.detect_faces(
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
                    is_confirmed=face["is_confirmed"]
                )
                for face in result["faces"]
            ],
            processing_time_ms=result["processing_time_ms"],
            cached=result.get("cached", False)
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
    """
    logger.info(f"[Detection] Getting thumbnail from {image_path} at ({x},{y},{width},{height})")

    try:
        bounding_box = {"x": x, "y": y, "width": width, "height": height}
        thumbnail_bytes = await detection_service.get_face_thumbnail(
            image_path,
            bounding_box,
            size=size
        )

        return Response(
            content=thumbnail_bytes,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"}
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
        result = await detection_service.confirm_identity(
            request.face_id,
            request.person_name,
            request.image_path
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
        result = await detection_service.ignore_face(
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
