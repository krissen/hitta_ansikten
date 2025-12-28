"""
Detection Routes

Endpoints for face detection operations.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging

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

@router.post("/detect-faces", response_model=DetectionResult)
async def detect_faces(request: DetectionRequest):
    """
    Detect faces in an image

    Returns list of detected faces with bounding boxes and confidence scores.
    Results are cached based on image path and modification time.
    """
    logger.info(f"[Detection] Processing image: {request.image_path}")

    try:
        # TODO: Implement actual detection using detection_service
        # For now, return mock data
        return DetectionResult(
            image_path=request.image_path,
            faces=[
                DetectedFace(
                    face_id="mock_face_1",
                    bounding_box=BoundingBox(x=100, y=100, width=200, height=200),
                    confidence=0.95,
                    person_name=None,
                    is_confirmed=False
                )
            ],
            processing_time_ms=123.45,
            cached=False
        )
    except Exception as e:
        logger.error(f"[Detection] Error processing image: {e}")
        raise HTTPException(status_code=500, detail=str(e))
