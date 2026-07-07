"""
FastAPI Backend Server

Main entry point for the Ansikten backend API.
Provides REST endpoints and WebSocket streaming for face detection.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Configure logging - level from env var ANSIKTEN_LOG_LEVEL (default: info)
_log_level_str = os.environ.get('ANSIKTEN_LOG_LEVEL', 'info').upper()
_log_level = getattr(logging, _log_level_str, logging.INFO)
logging.basicConfig(
    level=_log_level,
    format='[%(asctime)s] %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Lifespan event handler
@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    import os
    import time

    from .services.startup_service import LoadingState, get_startup_state

    startup_state = get_startup_state()
    port = int(os.getenv('ANSIKTEN_PORT', '5001'))
    logger.info("Ansikten Backend API starting up...")
    logger.info(f"Server ready on http://127.0.0.1:{port}")
    
    def _load_database_sync():
        """Sync function for thread pool - loads database and rotates logs"""
        from faceid_db import rotate_logs

        # Rotate logs on startup to prevent unbounded growth
        rotate_logs()

        # Purge trashed files past the retention threshold (0 = keep forever),
        # so the app trash doesn't grow without bound between sessions.
        try:
            from .services.culling_service import culling_service
            culling_service.purge_expired()
        except Exception:
            logger.warning("Trash retention purge on startup failed", exc_info=True)

        from .services.db_store import get_db_store

        # Warm the shared store (loads the DB) and report the people count.
        return get_db_store().read(lambda known, ignored, hardneg, processed: len(known))

    async def preload_database():
        t0 = time.perf_counter()
        startup_state.set_state("database", LoadingState.LOADING, "Läser in...")
        try:
            people_count = await asyncio.to_thread(_load_database_sync)
            elapsed = time.perf_counter() - t0
            startup_state.set_state("database", LoadingState.READY,
                                    f"{people_count} persons")
            logger.info(f"[Startup Profile] Database loaded in {elapsed:.2f}s")
        except Exception as e:
            logger.error(f"Failed to pre-load database: {e}", exc_info=True)
            startup_state.set_state("database", LoadingState.ERROR, 
                                    "Failed to load", error=str(e))
    
    asyncio.create_task(preload_database())
    
    startup_state.set_state("mlModels", LoadingState.PENDING, "Waiting...")
    
    ML_LOAD_TIMEOUT = 120.0
    
    async def eager_load_ml():
        await asyncio.sleep(0.1)
        startup_state.set_state("mlModels", LoadingState.LOADING, "Loading...")
        await asyncio.sleep(0.05)
        t0 = time.perf_counter()
        
        loop = asyncio.get_running_loop()
        load_complete = asyncio.Event()
        load_error = None
        
        def do_load():
            nonlocal load_error
            try:
                from .services.detection_service import detection_service
                _ = detection_service.backend.backend_name
            except Exception as e:
                load_error = e
            finally:
                loop.call_soon_threadsafe(load_complete.set)
        
        import threading
        thread = threading.Thread(target=do_load, daemon=True)
        thread.start()
        
        try:
            await asyncio.wait_for(load_complete.wait(), timeout=ML_LOAD_TIMEOUT)
            elapsed = time.perf_counter() - t0
            
            if load_error:
                raise load_error
                
            startup_state.set_state("mlModels", LoadingState.READY, 
                                   f"Ready ({elapsed:.1f}s)")
            logger.info(f"[Startup Profile] ML models loaded in {elapsed:.2f}s")
        except asyncio.TimeoutError:
            logger.error(f"ML model loading timed out after {ML_LOAD_TIMEOUT}s")
            startup_state.set_state("mlModels", LoadingState.ERROR, 
                                   f"Timeout ({ML_LOAD_TIMEOUT:.0f}s)", 
                                   error="Laddning tog för lång tid")
        except Exception as e:
            logger.error(f"Failed to eager-load ML models: {e}", exc_info=True)
            startup_state.set_state("mlModels", LoadingState.ERROR, 
                                   "Failed to load", error=str(e))
    
    asyncio.create_task(eager_load_ml())
    
    from .websocket.progress import WebSocketLogHandler, process_log_queue, setup_startup_listener
    setup_startup_listener()
    
    ws_handler = WebSocketLogHandler()
    ws_handler.setLevel(logging.DEBUG)
    ws_handler.setFormatter(logging.Formatter('%(message)s'))
    logging.getLogger().addHandler(ws_handler)
    asyncio.create_task(process_log_queue())
    
    yield
    logger.info("Ansikten Backend API shutting down...")

# Create FastAPI app
app = FastAPI(
    title="Ansikten Backend API",
    description="Face detection and annotation API for Ansikten image viewer",
    version="1.3.0",
    lifespan=lifespan
)

# Configure CORS - only allow localhost (all ports)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint for backend readiness.

    Returns overall status and component states:
    - status: "ok" (all ready), "degraded" (has errors), "starting" (still loading)
    - components: backend, database, mlModels with individual states
    """
    from .services.startup_service import get_startup_state

    startup = get_startup_state()
    status_data = startup.get_status()

    # Determine overall status
    if status_data["allReady"]:
        overall = "ok"
    elif status_data["hasError"]:
        overall = "degraded"
    else:
        overall = "starting"

    return {
        "status": overall,
        "service": "ansikten-backend",
        "version": app.version,
        "components": {
            name: {
                "state": info["state"],
                "message": info["message"]
            }
            for name, info in status_data["items"].items()
        }
    }



# API version prefix
API_V1_PREFIX = "/api/v1"

# Import routes
from .routes import (
    culling,
    database,
    detection,
    files,
    imports,
    management,
    player_count,
    preprocessing,
    refinement,
    rename_nef,
    startup,
    statistics,
    status,
)

app.include_router(detection.router, prefix=API_V1_PREFIX, tags=["detection"])
app.include_router(status.router, prefix=API_V1_PREFIX, tags=["status"])
app.include_router(database.router, prefix=API_V1_PREFIX, tags=["database"])
app.include_router(statistics.router, prefix=API_V1_PREFIX, tags=["statistics"])
app.include_router(player_count.router, prefix=API_V1_PREFIX, tags=["players"])
app.include_router(culling.router, prefix=API_V1_PREFIX, tags=["culling"])
app.include_router(imports.router, prefix=API_V1_PREFIX, tags=["import"])
app.include_router(rename_nef.router, prefix=API_V1_PREFIX, tags=["rename-nef"])
app.include_router(management.router, prefix=API_V1_PREFIX, tags=["management"])
app.include_router(refinement.router, prefix=API_V1_PREFIX, tags=["refinement"])
app.include_router(preprocessing.router, prefix=f"{API_V1_PREFIX}/preprocessing", tags=["preprocessing"])
app.include_router(files.router, prefix=API_V1_PREFIX, tags=["files"])
app.include_router(startup.router, prefix=API_V1_PREFIX, tags=["startup"])

# WebSocket endpoint
from .websocket import progress

app.include_router(progress.router)

if __name__ == "__main__":
    import os

    import uvicorn

    # Get port from environment variable, default to 5001
    port = int(os.getenv('ANSIKTEN_PORT', '5001'))

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
