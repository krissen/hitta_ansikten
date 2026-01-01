"""
Statistics API Routes

Provides statistical data and analytics for the workspace dashboard.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.statistics_service import statistics_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Request/Response Models ============


class AttemptStat(BaseModel):
    """Statistics for a specific detection attempt configuration"""
    backend: str
    upsample: Optional[int]
    scale_label: str
    scale_px: int
    used_count: int
    total_count: int
    hit_rate: float
    avg_faces: float
    avg_time: float


class TopFace(BaseModel):
    """Person with face count"""
    name: str
    face_count: int
    percentage: Optional[int] = None


class RecentImage(BaseModel):
    """Recently processed image with detected people"""
    filename: str
    timestamp: str
    person_names: List[str]
    source: str = "cli"  # 'cli' or 'bildvisare'


class LogLine(BaseModel):
    """Log entry"""
    level: str  # 'info', 'warning', 'error'
    message: str
    timestamp: str


class StatisticsSummary(BaseModel):
    """Complete statistics summary for dashboard"""
    attempt_stats: List[AttemptStat]
    top_faces: List[TopFace]
    ignored_count: int
    ignored_total: int
    ignored_fraction: float
    recent_images: List[RecentImage]
    recent_logs: List[LogLine]
    total_files_processed: int


# ============ API Endpoints ============


@router.get("/statistics/summary", response_model=StatisticsSummary)
async def get_statistics_summary():
    """
    Get complete statistics summary for dashboard

    Returns:
    - Attempt statistics table data
    - Top 19 faces by encoding count
    - Ignored face statistics
    - Last 3 processed images with names
    - Last 3 log entries
    - Total files processed

    Results are cached for 2 seconds for performance.
    """
    try:
        logger.info("[Statistics] Getting complete summary")
        summary = await statistics_service.get_summary()
        return StatisticsSummary(**summary)

    except FileNotFoundError as e:
        logger.error(f"[Statistics] File not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"[Statistics] Error getting summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statistics/attempt-stats", response_model=List[AttemptStat])
async def get_attempt_stats():
    """
    Get just attempt statistics table

    Returns statistics for each detection attempt configuration:
    - Which backend/settings were used
    - How often they succeeded
    - Average faces found
    - Average processing time
    """
    try:
        logger.info("[Statistics] Getting attempt stats")
        stats = await statistics_service.get_attempt_stats()
        return [AttemptStat(**stat) for stat in stats]

    except Exception as e:
        logger.error(f"[Statistics] Error getting attempt stats: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statistics/top-faces")
async def get_top_faces():
    """
    Get top faces by encoding count

    Returns:
    - List of top 19 people with face counts
    - Ignored face statistics
    """
    try:
        logger.info("[Statistics] Getting top faces")
        result = await statistics_service.get_top_faces()
        return result

    except Exception as e:
        logger.error(f"[Statistics] Error getting top faces: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statistics/recent-images", response_model=List[RecentImage])
async def get_recent_images(n: int = 3):
    """
    Get most recently processed images

    Args:
    - n: Number of images to return (default 3)

    Returns list of recent images with detected people
    """
    try:
        logger.info(f"[Statistics] Getting {n} recent images")
        images = await statistics_service.get_recent_images(n=n)
        return [RecentImage(**img) for img in images]

    except Exception as e:
        logger.error(f"[Statistics] Error getting recent images: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statistics/recent-logs", response_model=List[LogLine])
async def get_recent_logs(n: int = 3):
    """
    Get most recent log entries

    Args:
    - n: Number of log lines to return (default 3)

    Returns list of recent log entries
    """
    try:
        logger.info(f"[Statistics] Getting {n} recent log lines")
        logs = await statistics_service.get_recent_logs(n=n)
        return [LogLine(**log) for log in logs]

    except Exception as e:
        logger.error(f"[Statistics] Error getting recent logs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statistics/processed-files")
async def get_processed_files(n: int = 200, source: Optional[str] = None):
    """
    Get list of recently processed files for CLI use

    Args:
    - n: Number of files to return (default 200, max 1000)
    - source: Filter by source ('cli', 'bildvisare', or None for all)

    Returns list of processed files with timestamps, names, and source
    """
    try:
        n = min(n, 1000)  # Cap at 1000
        logger.info(f"[Statistics] Getting {n} processed files (source: {source or 'all'})")
        images = await statistics_service.get_recent_images(n=n)

        # Filter by source if specified
        if source:
            images = [img for img in images if img.get("source") == source]

        return {
            "count": len(images),
            "files": images
        }

    except Exception as e:
        logger.error(f"[Statistics] Error getting processed files: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
