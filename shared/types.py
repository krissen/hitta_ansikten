"""Shared type definitions for hitta_ansikten monorepo.

These types are used by both backend (Python) and frontend (TypeScript).
Keep in sync with types.ts when making changes.
"""

from dataclasses import dataclass
from typing import Optional, List
from enum import Enum


class FaceDetectionStatus(Enum):
    """Status of face detection operation."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class BoundingBox:
    """Face bounding box coordinates."""
    x: int
    y: int
    width: int
    height: int


@dataclass
class FaceAnnotation:
    """Manual face annotation from user."""
    image_path: str
    bbox: BoundingBox
    person_name: Optional[str] = None
    confidence: float = 1.0  # Manual annotations have 100% confidence


@dataclass
class DetectedFace:
    """Face detected by ML backend."""
    image_path: str
    bbox: BoundingBox
    person_name: Optional[str]
    confidence: float
    encoding: Optional[List[float]] = None


@dataclass
class ImageStatus:
    """Status of image processing."""
    image_path: str
    status: FaceDetectionStatus
    faces_detected: int
    timestamp: float
    error_message: Optional[str] = None
