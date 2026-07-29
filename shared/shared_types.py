"""Shared type definitions for Ansikten monorepo.

These types are used by both backend (Python) and frontend (TypeScript).
Keep in sync with types.ts when making changes.
"""

from dataclasses import dataclass
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
    person_name: str | None = None
    confidence: float = 1.0  # Manual annotations have 100% confidence


@dataclass
class DetectedFace:
    """Face detected by ML backend."""
    image_path: str
    bbox: BoundingBox
    person_name: str | None
    confidence: float
    encoding: list[float] | None = None


@dataclass
class ImageStatus:
    """Status of image processing."""
    image_path: str
    status: FaceDetectionStatus
    faces_detected: int
    timestamp: float
    error_message: str | None = None


@dataclass
class MatchAlternative:
    """Alternative match candidate for a face."""
    name: str
    distance: float
    confidence: int
    is_ignored: bool = False


@dataclass
class DetectedFaceResult:
    """Detected face entry returned by the detection API."""
    face_id: str
    bounding_box: BoundingBox
    confidence: float
    person_name: str | None = None
    is_confirmed: bool = False
    match_case: str | None = None
    ignore_distance: float | None = None
    ignore_confidence: int | None = None
    match_alternatives: list[MatchAlternative] | None = None
    encoding_hash: str | None = None


@dataclass
class DetectionResult:
    """Detection response payload for an image."""
    image_path: str
    faces: list[DetectedFaceResult]
    processing_time_ms: float
    cached: bool = False
    file_hash: str | None = None


@dataclass
class ReviewedFace:
    """Reviewed face payload for mark-review-complete."""
    face_index: int
    face_id: str
    encoding_hash: str | None = None
    person_name: str | None = None
    is_ignored: bool = False


@dataclass
class MarkReviewCompleteRequest:
    """Request payload for marking a review complete."""
    image_path: str
    reviewed_faces: list[ReviewedFace]
    file_hash: str | None = None
