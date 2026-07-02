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
from fastapi.responses import Response
from pydantic import BaseModel

from ..services.preprocessing_cache import get_cache, PreprocessingCache

# Thread pool for CPU-intensive operations
_executor = ThreadPoolExecutor(max_workers=4)

# RAW extensions handled via rawpy — kept aligned with detection_service._load_image
# and the "raw" extension preset.
_RAW_EXTS = {'.nef', '.cr2', '.cr3', '.arw', '.dng', '.raw', '.raf', '.orf', '.rw2'}

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


class BatchDeleteRequest(BaseModel):
    file_hashes: List[str]


class PriorityHashesRequest(BaseModel):
    file_hashes: List[str]


@router.post("/cache/priority")
async def set_priority_hashes(request: PriorityHashesRequest):
    """Set file hashes that should be evicted last during LRU cleanup."""
    cache = get_cache()
    cache.set_priority_hashes(request.file_hashes)
    return {"status": "ok", "count": len(request.file_hashes)}


@router.post("/cache/batch-delete")
async def batch_delete_cache_entries(request: BatchDeleteRequest):
    """Remove multiple cache entries at once (for rolling window cleanup)."""
    cache = get_cache()
    removed = []
    not_found = []

    for file_hash in request.file_hashes:
        if cache.remove_entry(file_hash):
            removed.append(file_hash)
        else:
            not_found.append(file_hash)

    return {
        "status": "ok",
        "removed": removed,
        "removed_count": len(removed),
        "not_found": not_found
    }


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
    """Synchronous NEF conversion - runs in thread pool with deduplication."""
    from ..services.detection_service import convert_nef_to_jpg

    with cache.processing_slot(file_hash, "NEF conversion") as (should_process, attempt):
        if not should_process:
            cached_path = cache.get_nef_conversion(file_hash)
            if cached_path:
                logger.debug(f"[Preprocessing] NEF already converted by another thread: {file_hash[:8]}")
                return {'status': 'completed', 'nef_jpg_path': cached_path}
            return {'status': 'error', 'error': 'Conversion failed in another thread'}

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


# ============================================================================
# Overview (grid) Thumbnails
# ============================================================================

def _make_preview_thumb_sync(file_path: str, size: int) -> bytes:
    """
    Downscale a whole frame to a JPEG overview thumbnail (runs in thread pool).

    RAW files use the embedded preview (rawpy.extract_thumb) when available —
    milliseconds vs. seconds for a full postprocess() — falling back to a full
    decode only if extraction fails. JPEG/other formats are decoded directly.
    EXIF orientation is honoured; output is JPEG quality 80.
    """
    import io
    from PIL import Image, ImageOps

    ext = os.path.splitext(file_path)[1].lower()
    img = None

    if ext in _RAW_EXTS:
        import rawpy
        try:
            with rawpy.imread(file_path) as raw:
                thumb = raw.extract_thumb()
                if thumb.format == rawpy.ThumbFormat.JPEG:
                    img = Image.open(io.BytesIO(bytes(thumb.data)))
                else:  # BITMAP
                    img = Image.fromarray(thumb.data)
                img.load()  # force decode while the raw buffer is alive
        except Exception as e:
            logger.debug(f"[Preprocessing] extract_thumb failed for {file_path} ({e}); full decode")
            with rawpy.imread(file_path) as raw:
                img = Image.fromarray(raw.postprocess())

    if img is None:
        # Context manager so the file handle is released promptly (matters on
        # Windows, where an open fd can block a later rename/delete).
        with Image.open(file_path) as opened:
            opened.load()
            img = opened

    img = ImageOps.exif_transpose(img)
    img = img.convert('RGB')
    img.thumbnail((size, size), Image.Resampling.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=80)
    return buf.getvalue()


def _generate_grid_thumb(file_path: str, grid_key: str, size: int, cache) -> dict:
    """Generate + store an overview thumbnail, returning the raw bytes."""
    try:
        jpg_data = _make_preview_thumb_sync(file_path, size)
        # Return the freshly generated bytes directly. store_grid_thumb runs LRU
        # eviction, which on a tiny cache could remove the file we just wrote —
        # so we never rely on re-reading it from disk.
        cache.store_grid_thumb(grid_key, file_path, jpg_data)
        return {'status': 'completed', 'data': jpg_data}
    except Exception as e:
        logger.error(f"[Preprocessing] Grid thumbnail error for {file_path}: {e}")
        return {'status': 'error', 'error': str(e)}


def _grid_thumb_sync(file_path: str, grid_key: str, size: int, cache) -> dict:
    """Synchronous grid-thumbnail generation - runs in thread pool with dedup."""
    with cache.processing_slot(grid_key, "grid thumbnail") as (should_process, attempt):
        if not should_process:
            cached = cache.get_grid_thumb(grid_key)
            if cached:
                try:
                    with open(cached, 'rb') as f:
                        return {'status': 'completed', 'data': f.read()}
                except OSError:
                    pass  # evicted between lookup and read — regenerate below
            # The other thread's result is gone (evicted on a tiny cache, or
            # vanished): regenerate ourselves rather than 500. A redundant
            # render is cheap and keeps the request correct.
            return _generate_grid_thumb(file_path, grid_key, size, cache)

        return _generate_grid_thumb(file_path, grid_key, size, cache)


@router.get("/preview-thumb")
async def get_preview_thumb(path: str, size: int = 256):
    """
    Whole-frame overview thumbnail (JPEG) for the culling grid.

    Downscales a JPEG or RAW file to `size` px on the longest edge, cached under
    grid/ keyed on a cheap path+mtime+size fingerprint (no full-file hashing, so
    filling a grid of hundreds of files stays fast). RAW uses the embedded
    preview. Browser cache: 1 week; X-Cache: HIT|MISS.
    """
    cache = get_cache()

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    if os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"Path is a directory, not a file: {path}")

    size = max(32, min(size, 1024))
    try:
        grid_key = PreprocessingCache.compute_grid_key(path, size)
    except OSError:
        # File vanished/became inaccessible between the checks above and the stat.
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    cached = cache.get_grid_thumb(grid_key)
    if cached:
        try:
            with open(cached, 'rb') as f:
                data = f.read()
            return Response(
                content=data,
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=604800", "X-Cache": "HIT"}
            )
        except OSError:
            # Evicted between the index lookup and the read — regenerate below
            # rather than turning a cache HIT into a 500.
            pass

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(_executor, _grid_thumb_sync, path, grid_key, size, cache)

    if result['status'] != 'completed':
        raise HTTPException(status_code=500, detail=result.get('error', 'Thumbnail generation failed'))

    # Serve the bytes the worker returned — never re-read from disk, which a
    # concurrent eviction could have removed.
    return Response(
        content=result['data'],
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=604800", "X-Cache": "MISS"}
    )


def _detect_faces_sync(file_path: str, file_hash: str, cache) -> dict:
    """Synchronous face detection - runs in thread pool with deduplication."""
    from ..services.detection_service import detect_faces_in_image

    with cache.processing_slot(file_hash, "face detection") as (should_process, attempt):
        if not should_process:
            faces_data = cache.get_face_detection(file_hash)
            if faces_data:
                logger.debug(f"[Preprocessing] Faces already detected by another thread: {file_hash[:8]}")
                return {'status': 'completed', 'face_count': len(faces_data.get('faces', []))}
            return {'status': 'error', 'error': 'Detection failed in another thread'}

        try:
            logger.info(f"[Preprocessing] Detecting faces: {file_path}")

            image_path = file_path
            cached_jpg = cache.get_nef_conversion(file_hash)
            if cached_jpg:
                image_path = cached_jpg

            faces_data = detect_faces_in_image(image_path, include_encodings=False)

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
    """Synchronous thumbnail generation - runs in thread pool with deduplication."""
    from ..services.detection_service import generate_face_thumbnails

    with cache.processing_slot(file_hash, "thumbnail generation") as (should_process, attempt):
        if not should_process:
            if cache.has_thumbnails(file_hash):
                logger.debug(f"[Preprocessing] Thumbnails already generated by another thread: {file_hash[:8]}")
                return {'status': 'completed'}
            return {'status': 'error', 'error': 'Thumbnail generation failed in another thread'}

        try:
            logger.info(f"[Preprocessing] Generating thumbnails: {file_path}")

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
