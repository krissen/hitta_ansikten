"""Model abstractions for the benchmark harness (protocols + buffalo adapters).

Only ``base`` and ``align`` are import-safe without insightface; ``buffalo``
imports insightface lazily (on instantiation), so importing this package is
always cheap.
"""

from .base import (
    Detector,
    Face,
    RecognitionModel,
    RecognitionModelBase,
    l2_normalize,
)

__all__ = [
    "Detector",
    "Face",
    "RecognitionModel",
    "RecognitionModelBase",
    "l2_normalize",
]
