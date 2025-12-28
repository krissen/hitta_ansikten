"""
Database Routes

Endpoints for accessing face database (people, statistics).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import logging

from ..services.detection_service import detection_service

logger = logging.getLogger(__name__)
router = APIRouter()

# Response models
class PersonProfile(BaseModel):
    person_id: str
    name: str
    face_count: int
    first_seen: str  # ISO timestamp
    last_seen: str   # ISO timestamp

class PersonName(BaseModel):
    name: str

@router.get("/database/people", response_model=List[PersonProfile])
async def get_people():
    """
    Get list of all people in database

    Returns profiles for all known people with face statistics.
    """
    logger.info("[Database] Fetching people list")

    try:
        # TODO: Implement using db_service
        return []
    except Exception as e:
        logger.error(f"[Database] Error fetching people: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/database/people/names", response_model=List[str])
async def get_people_names():
    """
    Get list of all person names in database (for autocomplete)

    Returns sorted list of unique person names from known_faces.
    """
    logger.info("[Database] Fetching people names for autocomplete")

    try:
        # Get names from detection_service known_faces
        names = sorted(detection_service.known_faces.keys())
        logger.info(f"[Database] Found {len(names)} people in database")
        return names
    except Exception as e:
        logger.error(f"[Database] Error fetching people names: {e}")
        raise HTTPException(status_code=500, detail=str(e))
