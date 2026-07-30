"""
Database Routes

Endpoints for accessing face database (people, statistics).
Uses faceid_db directly to avoid loading heavy ML libraries on startup.
"""

import asyncio
import logging
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Add backend to path for faceid_db import
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from api.services.db_store import get_db_store

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

@router.get("/database/people", response_model=list[PersonProfile])
async def get_people():
    """
    Get list of all people in database

    Returns profiles for all known people with face statistics.
    """
    logger.info("[Database] Fetching people list")

    try:
        # TODO: Implement real people listing (currently returns a placeholder)
        return []
    except Exception as e:  # noqa: BLE001 - request boundary: any failure becomes a 500 JSON body, never a bare traceback
        logger.error(f"[Database] Error fetching people: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/database/people/names", response_model=list[str])
async def get_people_names():
    """
    Get list of all person names in database (for autocomplete)

    Returns sorted list of unique person names from known_faces.
    """
    logger.info("[Database] Fetching people names for autocomplete")

    try:
        # store.read takes the store lock synchronously; run it in a worker
        # thread so the (possibly first-load) read never blocks the event loop.
        names = await asyncio.to_thread(
            get_db_store().read,
            lambda known, ignored, hardneg, processed: sorted(known.keys()),
        )
        logger.info(f"[Database] Found {len(names)} people in database")
        return names
    except Exception as e:  # noqa: BLE001 - request boundary: a corrupt/unreadable DB must answer 500 with the reason, not crash the autocomplete call
        logger.error(f"[Database] Error fetching people names: {e}")
        raise HTTPException(status_code=500, detail=str(e))
