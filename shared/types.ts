/**
 * Shared type definitions for hitta_ansikten monorepo.
 *
 * These types mirror the Python definitions in types.py.
 * Keep in sync when making changes.
 */

export enum FaceDetectionStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed"
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceAnnotation {
  imagePath: string;
  bbox: BoundingBox;
  personName?: string;
  confidence?: number;  // Default 1.0 for manual annotations
}

export interface DetectedFace {
  imagePath: string;
  bbox: BoundingBox;
  personName?: string;
  confidence: number;
  encoding?: number[];
}

export interface ImageStatus {
  imagePath: string;
  status: FaceDetectionStatus;
  facesDetected: number;
  timestamp: number;
  errorMessage?: string;
}
