"""
Status Routes

Endpoints for checking image processing status.
"""

import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..websocket.progress import set_log_categories

logger = logging.getLogger(__name__)
router = APIRouter()

LOG_LEVELS = {"debug": logging.DEBUG, "info": logging.INFO, "warn": logging.WARNING, "error": logging.ERROR}


class LogLevelRequest(BaseModel):
    level: Literal["debug", "info", "warn", "error"]


class LogCategoriesRequest(BaseModel):
    categories: List[str]


@router.post("/log-level")
async def set_log_level(request: LogLevelRequest):
    level = LOG_LEVELS.get(request.level, logging.INFO)
    logging.getLogger().setLevel(level)
    logger.info(f"[Status] Log level changed to {request.level.upper()}")
    return {"status": "ok", "level": request.level}


@router.post("/log-categories")
async def update_log_categories(request: LogCategoriesRequest):
    set_log_categories(set(request.categories))
    return {"status": "ok", "categories": request.categories}

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
        # TODO: Implement real status lookup (currently returns a placeholder)
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
