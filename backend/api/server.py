"""
FastAPI Backend Server

Main entry point for the Bildvisare backend API.
Provides REST endpoints and WebSocket streaming for face detection.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Lifespan event handler (replaces deprecated on_event)
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    import os
    port = int(os.getenv('BILDVISARE_PORT', '5001'))
    logger.info("Bildvisare Backend API starting up...")
    logger.info(f"Server ready on http://127.0.0.1:{port}")
    yield
    # Shutdown
    logger.info("Bildvisare Backend API shutting down...")

# Create FastAPI app
app = FastAPI(
    title="Bildvisare Backend API",
    description="Face detection and annotation API for Bildvisare image viewer",
    version="1.0.0",
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
    """Health check endpoint for backend readiness"""
    return {"status": "ok", "service": "bildvisare-backend"}

# Import routes
from .routes import detection, annotation, status, database, statistics, management, preprocessing
app.include_router(detection.router, prefix="/api", tags=["detection"])
app.include_router(annotation.router, prefix="/api", tags=["annotation"])
app.include_router(status.router, prefix="/api", tags=["status"])
app.include_router(database.router, prefix="/api", tags=["database"])
app.include_router(statistics.router, prefix="/api", tags=["statistics"])
app.include_router(management.router, prefix="/api", tags=["management"])
app.include_router(preprocessing.router, tags=["preprocessing"])

# WebSocket endpoint
from .websocket import progress
app.include_router(progress.router)

if __name__ == "__main__":
    import uvicorn
    import os

    # Get port from environment variable, default to 5001
    port = int(os.getenv('BILDVISARE_PORT', '5001'))

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
