"""
WebSocket Progress Streaming

Real-time progress updates for face detection and processing.
"""

import asyncio
import json
import logging
import queue
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter()

# Active WebSocket connections
active_connections: set[WebSocket] = set()

# Enabled log categories for broadcasting (empty = all enabled)
enabled_log_categories: set[str] = set()

# Thread-safe queue required: emit() called from any thread, process_log_queue() in asyncio loop
_log_queue = queue.Queue(maxsize=1000)


class WebSocketLogHandler(logging.Handler):
    """Logging handler that queues log entries for WebSocket broadcast"""
    
    def __init__(self):
        super().__init__()
        self._loop = None
    
    def emit(self, record: logging.LogRecord):
        try:
            category = self._extract_category(record)
            
            if enabled_log_categories and category not in enabled_log_categories:
                return
            
            level = record.levelname.lower()
            message = self.format(record)
            timestamp = datetime.fromtimestamp(record.created).isoformat()
            
            entry = {
                "level": level,
                "message": message,
                "category": category,
                "timestamp": timestamp
            }
            
            try:
                _log_queue.put_nowait(entry)
            except queue.Full:
                pass
        # A logging handler that raises would break the call site that logged —
        # including error paths. Broadcasting a log line is never worth that.
        except Exception:  # noqa: BLE001
            pass
    
    def _extract_category(self, record: logging.LogRecord) -> str:
        msg = record.getMessage()
        if msg.startswith("[") and "]" in msg:
            return msg[1:msg.index("]")]
        return record.name


async def process_log_queue():
    """Background task to process queued log entries and broadcast them"""
    while True:
        try:
            entry = _log_queue.get_nowait()
            await broadcast_event("log-entry", entry)
        except queue.Empty:
            await asyncio.sleep(0.1)
        except Exception as e:  # noqa: BLE001 - endless background loop: it must survive one bad entry, or log broadcasting stops for the rest of the session
            logger.error(f"[WebSocket] Error processing log queue: {e}")


def set_log_categories(categories: set[str]):
    """Set which log categories to broadcast (empty = all)"""
    global enabled_log_categories
    enabled_log_categories = set(categories) if categories else set()
    logger.info(f"[WebSocket] Log categories updated: {enabled_log_categories or 'all'}")

@router.websocket("/ws/progress")
async def websocket_progress(websocket: WebSocket):
    """
    WebSocket endpoint for real-time progress updates

    Events emitted:
    - log-entry: Backend log messages
    - detection-progress: Face detection progress percentage
    - face-detected: New face detected event
    - face-confirmed: Face identity confirmed event
    - startup-status: Startup state changes (KASAM UX)
    """
    await websocket.accept()
    active_connections.add(websocket)
    logger.info(f"[WebSocket] Client connected (total: {len(active_connections)})")

    try:
        await websocket.send_text(json.dumps({
            "event": "connected",
            "data": {"message": "WebSocket connection established"}
        }))

        # Send current startup status immediately
        from ..services.startup_service import get_startup_state
        startup_status = get_startup_state().get_status()
        await websocket.send_text(json.dumps({
            "event": "startup-status",
            "data": startup_status
        }))

        while True:
            data = await websocket.receive_text()
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
        except Exception as e:  # noqa: BLE001 - one dead client must not stop the broadcast to the others; it is dropped from the set below
            logger.error(f"[WebSocket] Error sending to client: {e}")
            disconnected.add(connection)

    # Remove disconnected clients
    for connection in disconnected:
        active_connections.remove(connection)

async def send_log_entry(level: str, message: str):
    """Send log entry to all connected clients"""
    await broadcast_event("log-entry", {
        "level": level,
        "message": message,
        "timestamp": None
    })


async def broadcast_startup_status(status: dict):
    """Broadcast startup status change to all connected clients (KASAM UX)"""
    await broadcast_event("startup-status", status)


def setup_startup_listener():
    """Hook up StartupState listener to broadcast WS events"""
    from ..services.startup_service import get_startup_state
    startup_state = get_startup_state()
    startup_state.add_listener(broadcast_startup_status)
