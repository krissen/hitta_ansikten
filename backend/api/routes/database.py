"""
Database Routes

Endpoints for accessing face database (people, statistics).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# Response models
class PersonProfile(BaseModel):
    person_id: str
    name: str
    face_count: int
    first_seen: str  # ISO timestamp
    last_seen: str   # ISO timestamp

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
