"""
Preprocessing API Routes

Endpoints for:
- Cache status and management
- NEF conversion with caching
- Face detection with caching
- Thumbnail generation with caching
"""

import os
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, List

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from ..services.preprocessing_cache import get_cache, PreprocessingCache

# Thread pool for CPU-intensive operations
_executor = ThreadPoolExecutor(max_workers=4)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================

class CacheStatusResponse(BaseModel):
    cache_dir: str
    total_entries: int
    total_size_bytes: int
    total_size_mb: float
    max_size_mb: float
    usage_percent: float


class CacheSettingsRequest(BaseModel):
    max_size_mb: Optional[int] = None


class FileHashRequest(BaseModel):
    file_path: str


class FileHashResponse(BaseModel):
    file_path: str
    file_hash: str


class CacheCheckRequest(BaseModel):
    file_hash: str


class CacheCheckResponse(BaseModel):
    file_hash: str
    has_nef_conversion: bool
    has_face_detection: bool
    has_thumbnails: bool
    nef_jpg_path: Optional[str] = None
    face_count: Optional[int] = None  # Number of faces detected (if cached)


class PreprocessRequest(BaseModel):
    file_path: str
    file_hash: Optional[str] = None  # If not provided, will be computed
    steps: Optional[List[str]] = None  # ['nef', 'faces', 'thumbs'] - None means all


class PreprocessResponse(BaseModel):
    file_hash: str
    status: str  # 'cached', 'processing', 'completed', 'error'
    nef_jpg_path: Optional[str] = None
    faces_cached: bool = False
    thumbnails_cached: bool = False
    face_count: Optional[int] = None  # Number of faces detected
    error: Optional[str] = None


# ============================================================================
# Cache Management Endpoints
# ============================================================================

@router.get("/cache/status", response_model=CacheStatusResponse)
async def get_cache_status():
    """Get current cache status."""
    cache = get_cache()
    return CacheStatusResponse(**cache.get_status())


@router.post("/cache/settings")
async def update_cache_settings(request: CacheSettingsRequest):
    """Update cache settings."""
    cache = get_cache()

    if request.max_size_mb is not None:
        cache.set_max_size(request.max_size_mb)

    return {"status": "ok", "settings": cache.get_status()}


@router.delete("/cache")
async def clear_cache():
    """Clear all cache entries."""
    cache = get_cache()
    cache.clear()
    return {"status": "ok", "message": "Cache cleared"}


@router.delete("/cache/{file_hash}")
async def remove_cache_entry(file_hash: str):
    """Remove a specific cache entry."""
    cache = get_cache()
    success = cache.remove_entry(file_hash)

    if not success:
        raise HTTPException(status_code=404, detail="Cache entry not found")

    return {"status": "ok", "file_hash": file_hash}


# ============================================================================
# Hash Computation
# ============================================================================

@router.post("/hash", response_model=FileHashResponse)
async def compute_file_hash(request: FileHashRequest):
    """Compute SHA1 hash of a file."""
    file_path = request.file_path

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    if os.path.isdir(file_path):
        raise HTTPException(status_code=400, detail=f"Path is a directory, not a file: {file_path}")

    try:
        file_hash = PreprocessingCache.compute_file_hash(file_path)
        return FileHashResponse(file_path=file_path, file_hash=file_hash)
    except IOError as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute hash: {e}")


# ============================================================================
# Cache Check
# ============================================================================

@router.post("/check", response_model=CacheCheckResponse)
async def check_cache(request: CacheCheckRequest):
    """Check what's cached for a file hash."""
    cache = get_cache()
    file_hash = request.file_hash

    has_nef = cache.has_nef_conversion(file_hash)
    has_faces = cache.has_face_detection(file_hash)
    has_thumbs = cache.has_thumbnails(file_hash)

    nef_path = cache.get_nef_conversion(file_hash) if has_nef else None

    # Get face count if face detection is cached
    face_count = None
    if has_faces:
        faces_data = cache.get_face_detection(file_hash)
        if faces_data and 'faces' in faces_data:
            face_count = len(faces_data['faces'])

    return CacheCheckResponse(
        file_hash=file_hash,
        has_nef_conversion=has_nef,
        has_face_detection=has_faces,
        has_thumbnails=has_thumbs,
        nef_jpg_path=nef_path,
        face_count=face_count
    )


# ============================================================================
# Preprocessing Endpoints
# ============================================================================

def _convert_nef_sync(file_path: str, file_hash: str, cache) -> dict:
    """Synchronous NEF conversion - runs in thread pool."""
    from ..services.detection_service import convert_nef_to_jpg

    jpg_path = None
    try:
        logger.info(f"[Preprocessing] Converting NEF: {file_path}")
        jpg_path = convert_nef_to_jpg(file_path)

        if jpg_path and os.path.exists(jpg_path):
            with open(jpg_path, 'rb') as f:
                jpg_data = f.read()

            cached_path = cache.store_nef_conversion(file_hash, file_path, jpg_data)
            return {'status': 'completed', 'nef_jpg_path': cached_path}
        else:
            return {'status': 'error', 'error': 'NEF conversion failed'}
    except Exception as e:
        logger.error(f"[Preprocessing] NEF conversion error: {e}")
        return {'status': 'error', 'error': str(e)}
    finally:
        if jpg_path and os.path.exists(jpg_path):
            try:
                os.remove(jpg_path)
            except OSError:
                pass


@router.post("/nef", response_model=PreprocessResponse)
async def preprocess_nef(request: PreprocessRequest):
    """
    Convert NEF to JPG with caching.

    If already cached, returns cached path immediately.
    Otherwise, performs conversion and caches result.
    """
    cache = get_cache()
    file_path = request.file_path

    # Validate file exists
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    # Compute hash (can be blocking for large files, but needed for cache lookup)
    loop = asyncio.get_event_loop()
    file_hash = request.file_hash
    if not file_hash:
        file_hash = await loop.run_in_executor(
            _executor, PreprocessingCache.compute_file_hash, file_path
        )

    # Check cache first
    cached_path = cache.get_nef_conversion(file_hash)
    if cached_path:
        logger.debug(f"[Preprocessing] NEF cache hit: {file_hash}")
        return PreprocessResponse(
            file_hash=file_hash,
            status='cached',
            nef_jpg_path=cached_path
        )

    # Convert NEF in thread pool (non-blocking)
    result = await loop.run_in_executor(
        _executor, _convert_nef_sync, file_path, file_hash, cache
    )

    if result['status'] == 'completed':
        return PreprocessResponse(
            file_hash=file_hash,
            status='completed',
            nef_jpg_path=result['nef_jpg_path']
        )
    else:
        return PreprocessResponse(
            file_hash=file_hash,
            status='error',
            error=result.get('error', 'NEF conversion failed')
        )


def _detect_faces_sync(file_path: str, file_hash: str, cache) -> dict:
    """Synchronous face detection - runs in thread pool."""
    from ..services.detection_service import detect_faces_in_image

    try:
        logger.info(f"[Preprocessing] Detecting faces: {file_path}")

        # Use the JPG path if available (faster than NEF)
        image_path = file_path
        cached_jpg = cache.get_nef_conversion(file_hash)
        if cached_jpg:
            image_path = cached_jpg

        faces_data = detect_faces_in_image(image_path, include_encodings=False)

        # Cache results (without encodings - just bounding boxes)
        cacheable_data = {
            'faces': [
                {
                    'face_id': f.get('face_id'),
                    'bounding_box': f.get('bounding_box'),
                    'confidence': f.get('confidence')
                }
                for f in faces_data.get('faces', [])
            ],
            'image_width': faces_data.get('image_width'),
            'image_height': faces_data.get('image_height')
        }

        cache.store_face_detection(file_hash, file_path, cacheable_data)
        return {'status': 'completed', 'face_count': len(cacheable_data['faces'])}
    except Exception as e:
        logger.error(f"[Preprocessing] Face detection error: {e}")
        return {'status': 'error', 'error': str(e)}


@router.post("/faces", response_model=PreprocessResponse)
async def preprocess_faces(request: PreprocessRequest):
    """
    Detect faces with caching.

    If already cached, returns cached results immediately.
    Otherwise, performs detection and caches result.

    Note: This only caches face locations/bounding boxes, NOT name matching.
    Name matching must be done at load time with current database.
    """
    cache = get_cache()
    file_path = request.file_path

    # Validate file exists
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    # Compute or use provided hash (in executor if needed)
    loop = asyncio.get_event_loop()
    file_hash = request.file_hash
    if not file_hash:
        file_hash = await loop.run_in_executor(
            _executor, PreprocessingCache.compute_file_hash, file_path
        )

    # Check cache first
    if cache.has_face_detection(file_hash):
        logger.debug(f"[Preprocessing] Faces cache hit: {file_hash}")
        # Get face count from cached data
        faces_data = cache.get_face_detection(file_hash)
        face_count = len(faces_data.get('faces', [])) if faces_data else None
        return PreprocessResponse(
            file_hash=file_hash,
            status='cached',
            faces_cached=True,
            face_count=face_count
        )

    # Detect faces in thread pool (non-blocking)
    result = await loop.run_in_executor(
        _executor, _detect_faces_sync, file_path, file_hash, cache
    )

    if result['status'] == 'completed':
        return PreprocessResponse(
            file_hash=file_hash,
            status='completed',
            faces_cached=True,
            face_count=result.get('face_count')
        )
    else:
        return PreprocessResponse(
            file_hash=file_hash,
            status='error',
            error=result.get('error', 'Face detection failed')
        )


def _generate_thumbnails_sync(file_path: str, file_hash: str, faces_data: dict, cache) -> dict:
    """Synchronous thumbnail generation - runs in thread pool."""
    from ..services.detection_service import generate_face_thumbnails

    try:
        logger.info(f"[Preprocessing] Generating thumbnails: {file_path}")

        # Use the JPG path if available
        image_path = file_path
        cached_jpg = cache.get_nef_conversion(file_hash)
        if cached_jpg:
            image_path = cached_jpg

        thumbnails = generate_face_thumbnails(
            image_path,
            faces_data.get('faces', [])
        )

        if thumbnails:
            cache.store_thumbnails(file_hash, file_path, thumbnails)

        return {'status': 'completed'}
    except Exception as e:
        logger.error(f"[Preprocessing] Thumbnail generation error: {e}")
        return {'status': 'error', 'error': str(e)}


@router.post("/thumbnails", response_model=PreprocessResponse)
async def preprocess_thumbnails(request: PreprocessRequest):
    """
    Generate face thumbnails with caching.

    Requires face detection to be cached first.
    """
    cache = get_cache()
    file_path = request.file_path

    # Validate file exists
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    # Compute or use provided hash (in executor if needed)
    loop = asyncio.get_event_loop()
    file_hash = request.file_hash
    if not file_hash:
        file_hash = await loop.run_in_executor(
            _executor, PreprocessingCache.compute_file_hash, file_path
        )

    # Check cache first
    if cache.has_thumbnails(file_hash):
        logger.debug(f"[Preprocessing] Thumbnails cache hit: {file_hash}")
        return PreprocessResponse(
            file_hash=file_hash,
            status='cached',
            thumbnails_cached=True
        )

    # Need face detection first
    faces_data = cache.get_face_detection(file_hash)
    if not faces_data:
        return PreprocessResponse(
            file_hash=file_hash,
            status='error',
            error='Face detection required before thumbnail generation'
        )

    # Generate thumbnails in thread pool (non-blocking)
    result = await loop.run_in_executor(
        _executor, _generate_thumbnails_sync, file_path, file_hash, faces_data, cache
    )

    if result['status'] == 'completed':
        return PreprocessResponse(
            file_hash=file_hash,
            status='completed',
            thumbnails_cached=True
        )
    else:
        return PreprocessResponse(
            file_hash=file_hash,
            status='error',
            error=result.get('error', 'Thumbnail generation failed')
        )


@router.post("/all", response_model=PreprocessResponse)
async def preprocess_all(request: PreprocessRequest):
    """
    Run all preprocessing steps for a file.

    Steps: NEF conversion → Face detection → Thumbnails
    Uses cache where available.
    """
    # Initialize cache (used by sub-functions)
    get_cache()
    file_path = request.file_path
    steps = request.steps or ['nef', 'faces', 'thumbs']

    # Validate file exists
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    # Compute or use provided hash (in executor if needed)
    loop = asyncio.get_event_loop()
    file_hash = request.file_hash
    if not file_hash:
        file_hash = await loop.run_in_executor(
            _executor, PreprocessingCache.compute_file_hash, file_path
        )

    result = PreprocessResponse(
        file_hash=file_hash,
        status='completed'
    )

    try:
        # Step 1: NEF conversion
        if 'nef' in steps and file_path.lower().endswith(('.nef', '.raw', '.cr2', '.arw')):
            nef_result = await preprocess_nef(PreprocessRequest(
                file_path=file_path,
                file_hash=file_hash
            ))
            result.nef_jpg_path = nef_result.nef_jpg_path
            if nef_result.status == 'error':
                result.status = 'error'
                result.error = nef_result.error
                return result

        # Step 2: Face detection
        if 'faces' in steps:
            faces_result = await preprocess_faces(PreprocessRequest(
                file_path=file_path,
                file_hash=file_hash
            ))
            result.faces_cached = faces_result.faces_cached
            if faces_result.status == 'error':
                result.status = 'error'
                result.error = faces_result.error
                return result

        # Step 3: Thumbnails
        if 'thumbs' in steps:
            thumbs_result = await preprocess_thumbnails(PreprocessRequest(
                file_path=file_path,
                file_hash=file_hash
            ))
            result.thumbnails_cached = thumbs_result.thumbnails_cached
            if thumbs_result.status == 'error':
                result.status = 'error'
                result.error = thumbs_result.error
                return result

        return result

    except Exception as e:
        logger.error(f"[Preprocessing] Error: {e}")
        return PreprocessResponse(
            file_hash=file_hash,
            status='error',
            error=str(e)
        )
