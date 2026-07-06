"""
Startup Status Routes

Endpoint for frontend to check initialization status of backend components.
"""

import logging

from fastapi import APIRouter

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/startup/status")
async def get_startup_status():
    """
    Get current startup/initialization status of all backend components.
    
    Returns status for:
    - database: Face database loading
    - mlModels: ML model initialization (InsightFace)
    """
    from ..services.startup_service import get_startup_state
    return get_startup_state().get_status()
