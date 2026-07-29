#!/usr/bin/env python3
"""
Generate JSON Schema from Pydantic models.

This script exports the key API models to JSON Schema format,
creating a shared type definition that can be used by both
backend (Python/Pydantic) and frontend (JavaScript validation).

Usage:
    python shared/generate_schemas.py

Output:
    shared/schemas/*.json
"""

import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from pydantic import BaseModel


def export_schema(model: type[BaseModel], name: str, output_dir: Path):
    """Export a Pydantic model to JSON Schema."""
    schema = model.model_json_schema()
    output_path = output_dir / f"{name}.json"
    with open(output_path, "w") as f:
        json.dump(schema, f, indent=2)
    print(f"  {name}.json")


def main():
    output_dir = Path(__file__).parent / "schemas"
    output_dir.mkdir(exist_ok=True)

    print("Generating JSON Schemas...")

    # Import models from routes
    from api.routes.detection import (
        BoundingBox,
        ConfirmIdentityRequest,
        ConfirmIdentityResponse,
        DetectedFace,
        DetectionRequest,
        DetectionResult,
        IgnoreFaceRequest,
        IgnoreFaceResponse,
        MarkReviewCompleteRequest,
        MarkReviewCompleteResponse,
        MatchAlternative,
        ReviewedFace,
    )
    from api.routes.files import (
        RenameConfig,
        RenameExecuteRequest,
        RenameExecuteResponse,
        RenamePreviewItem,
        RenamePreviewRequest,
        RenamePreviewResponse,
    )
    from api.routes.management import (
        DatabaseState,
        DeletePersonRequest,
        MergePeopleRequest,
        OperationResponse,
        PersonEntry,
        RenamePersonRequest,
        StatsResponse,
    )
    from api.routes.preprocessing import (
        CacheStatusResponse,
        PreprocessRequest,
        PreprocessResponse,
    )
    from api.routes.refinement import (
        ApplyRequest,
        ApplyResponse,
        PreviewEntry,
        PreviewResponse,
    )
    from api.routes.statistics import (
        AttemptStat,
        RecentImage,
        StatisticsSummary,
        TopFace,
    )

    # Core types
    print("\nCore types:")
    export_schema(BoundingBox, "BoundingBox", output_dir)
    export_schema(MatchAlternative, "MatchAlternative", output_dir)
    export_schema(DetectedFace, "DetectedFace", output_dir)
    export_schema(ReviewedFace, "ReviewedFace", output_dir)
    export_schema(PersonEntry, "PersonEntry", output_dir)

    # Detection API
    print("\nDetection API:")
    export_schema(DetectionRequest, "DetectionRequest", output_dir)
    export_schema(DetectionResult, "DetectionResult", output_dir)
    export_schema(ConfirmIdentityRequest, "ConfirmIdentityRequest", output_dir)
    export_schema(ConfirmIdentityResponse, "ConfirmIdentityResponse", output_dir)
    export_schema(IgnoreFaceRequest, "IgnoreFaceRequest", output_dir)
    export_schema(IgnoreFaceResponse, "IgnoreFaceResponse", output_dir)
    export_schema(MarkReviewCompleteRequest, "MarkReviewCompleteRequest", output_dir)
    export_schema(MarkReviewCompleteResponse, "MarkReviewCompleteResponse", output_dir)

    # Management API
    print("\nManagement API:")
    export_schema(DatabaseState, "DatabaseState", output_dir)
    export_schema(RenamePersonRequest, "RenamePersonRequest", output_dir)
    export_schema(MergePeopleRequest, "MergePeopleRequest", output_dir)
    export_schema(DeletePersonRequest, "DeletePersonRequest", output_dir)
    export_schema(OperationResponse, "OperationResponse", output_dir)
    export_schema(StatsResponse, "StatsResponse", output_dir)

    # Files API
    print("\nFiles API:")
    export_schema(RenameConfig, "RenameConfig", output_dir)
    export_schema(RenamePreviewRequest, "RenamePreviewRequest", output_dir)
    export_schema(RenamePreviewItem, "RenamePreviewItem", output_dir)
    export_schema(RenamePreviewResponse, "RenamePreviewResponse", output_dir)
    export_schema(RenameExecuteRequest, "RenameExecuteRequest", output_dir)
    export_schema(RenameExecuteResponse, "RenameExecuteResponse", output_dir)

    # Statistics API
    print("\nStatistics API:")
    export_schema(AttemptStat, "AttemptStat", output_dir)
    export_schema(TopFace, "TopFace", output_dir)
    export_schema(RecentImage, "RecentImage", output_dir)
    export_schema(StatisticsSummary, "StatisticsSummary", output_dir)

    # Preprocessing API
    print("\nPreprocessing API:")
    export_schema(CacheStatusResponse, "CacheStatusResponse", output_dir)
    export_schema(PreprocessRequest, "PreprocessRequest", output_dir)
    export_schema(PreprocessResponse, "PreprocessResponse", output_dir)

    # Refinement API
    print("\nRefinement API:")
    export_schema(PreviewEntry, "PreviewEntry", output_dir)
    export_schema(PreviewResponse, "PreviewResponse", output_dir)
    export_schema(ApplyRequest, "ApplyRequest", output_dir)
    export_schema(ApplyResponse, "ApplyResponse", output_dir)

    print(f"\nDone! Schemas written to {output_dir}/")


if __name__ == "__main__":
    main()
