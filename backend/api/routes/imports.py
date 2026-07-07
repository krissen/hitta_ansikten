"""Import API Routes

Detect camera-card volumes and transfer NEFs off them (+ eject). See
`import_service`. Module named `imports` because `import` is a reserved word.
"""

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.import_service import get_import_service

logger = logging.getLogger(__name__)

router = APIRouter()


class ImportRunRequest(BaseModel):
    volume_mount: str
    destination: str
    mode: Literal["move", "copy"] = "move"
    eject: bool = True


@router.get("/import/volumes")
async def list_volumes():
    """List ejectable/external card volumes with NEF counts."""
    try:
        return {"volumes": get_import_service().list_volumes()}
    except Exception as e:
        logger.exception("Import volume listing failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/run")
async def run_import(request: ImportRunRequest):
    """Transfer NEFs from the volume to the destination, then eject."""
    try:
        return await get_import_service().run_import(
            volume_mount=request.volume_mount,
            destination=request.destination,
            mode=request.mode,
            eject=request.eject,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Import run failed")
        raise HTTPException(status_code=500, detail=str(e))
