"""
Annotation Routes

Endpoints for face annotation (confirm/reject identities).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# Request/Response models
class ConfirmIdentityRequest(BaseModel):
    face_id: str
    person_name: str
    image_path: str

class IgnoreFaceRequest(BaseModel):
    face_id: str
    image_path: str

class AnnotationResponse(BaseModel):
    success: bool
    message: str

@router.post("/confirm-identity", response_model=AnnotationResponse)
async def confirm_identity(request: ConfirmIdentityRequest):
    """
    Confirm face identity

    Associates a detected face with a person name and stores in database.
    """
    logger.info(f"[Annotation] Confirming face {request.face_id} as {request.person_name}")

    try:
        # TODO: Implement using db_service
        return AnnotationResponse(
            success=True,
            message=f"Face confirmed as {request.person_name}"
        )
    except Exception as e:
        logger.error(f"[Annotation] Error confirming identity: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ignore-face", response_model=AnnotationResponse)
async def ignore_face(request: IgnoreFaceRequest):
    """
    Ignore/reject a detected face

    Marks a face as ignored (false positive or unwanted).
    """
    logger.info(f"[Annotation] Ignoring face {request.face_id}")

    try:
        # TODO: Implement using db_service
        return AnnotationResponse(
            success=True,
            message="Face marked as ignored"
        )
    except Exception as e:
        logger.error(f"[Annotation] Error ignoring face: {e}")
        raise HTTPException(status_code=500, detail=str(e))
