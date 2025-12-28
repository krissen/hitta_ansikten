"""
Status Routes

Endpoints for checking image processing status.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# Response models
class ImageStatus(BaseModel):
    image_path: str
    is_processed: bool
    faces_count: int
    confirmed_count: int
    last_processed: Optional[str] = None  # ISO timestamp

@router.get("/status/{image_path:path}", response_model=ImageStatus)
async def get_image_status(image_path: str):
    """
    Get processing status for an image

    Returns whether image has been processed and face detection results.
    """
    logger.info(f"[Status] Checking status for: {image_path}")

    try:
        # TODO: Implement using db_service
        return ImageStatus(
            image_path=image_path,
            is_processed=False,
            faces_count=0,
            confirmed_count=0,
            last_processed=None
        )
    except Exception as e:
        logger.error(f"[Status] Error checking status: {e}")
        raise HTTPException(status_code=500, detail=str(e))
