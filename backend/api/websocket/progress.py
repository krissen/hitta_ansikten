"""
WebSocket Progress Streaming

Real-time progress updates for face detection and processing.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set
import logging
import json

logger = logging.getLogger(__name__)
router = APIRouter()

# Active WebSocket connections
active_connections: Set[WebSocket] = set()

@router.websocket("/ws/progress")
async def websocket_progress(websocket: WebSocket):
    """
    WebSocket endpoint for real-time progress updates

    Events emitted:
    - log-entry: Backend log messages
    - detection-progress: Face detection progress percentage
    - face-detected: New face detected event
    - face-confirmed: Face identity confirmed event
    """
    await websocket.accept()
    active_connections.add(websocket)
    logger.info(f"[WebSocket] Client connected (total: {len(active_connections)})")

    try:
        # Send welcome message
        await websocket.send_text(json.dumps({
            "event": "connected",
            "data": {"message": "WebSocket connection established"}
        }))

        # Keep connection alive and listen for messages
        while True:
            data = await websocket.receive_text()
            # Echo back for now (can handle commands later)
            logger.debug(f"[WebSocket] Received: {data}")

    except WebSocketDisconnect:
        active_connections.remove(websocket)
        logger.info(f"[WebSocket] Client disconnected (total: {len(active_connections)})")

async def broadcast_event(event_name: str, data: dict):
    """
    Broadcast event to all connected WebSocket clients

    Args:
        event_name: Name of the event
        data: Event payload
    """
    if not active_connections:
        return

    message = json.dumps({
        "event": event_name,
        "data": data
    })

    disconnected = set()
    for connection in active_connections:
        try:
            await connection.send_text(message)
        except Exception as e:
            logger.error(f"[WebSocket] Error sending to client: {e}")
            disconnected.add(connection)

    # Remove disconnected clients
    for connection in disconnected:
        active_connections.remove(connection)

async def send_log_entry(level: str, message: str):
    """
    Send log entry to all connected clients

    Args:
        level: Log level (info, warn, error)
        message: Log message
    """
    await broadcast_event("log-entry", {
        "level": level,
        "message": message,
        "timestamp": None  # TODO: Add timestamp
    })
