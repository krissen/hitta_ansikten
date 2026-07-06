"""Tests for DetectionService EXIF-orientation handling in _load_image.

Regression: JPEG/PNG photos carrying an EXIF orientation tag (e.g. phone photos
shot in portrait) were loaded without applying the orientation, so faces were
detected in the un-rotated pixel frame while the frontend (Chromium <img>) shows
them EXIF-rotated. That mismatch put the bounding box ~90 deg off and rendered a
sideways thumbnail crop. _load_image must now honour EXIF orientation.
"""

import numpy as np
from PIL import Image
from unittest.mock import MagicMock

from api.services.detection_service import DetectionService


def _service():
    """A DetectionService with the backend mocked, bypassing model loading."""
    svc = DetectionService.__new__(DetectionService)
    svc.known_faces = {}
    svc.backend = MagicMock()
    return svc


def _write_oriented_jpeg(path, width, height, orientation):
    """Write a landscape JPEG whose EXIF says to rotate for display."""
    # Distinct-per-axis content so a transpose is observable, not just the shape.
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    arr[: height // 2, :, 0] = 255  # top half red
    img = Image.fromarray(arr, "RGB")
    exif = img.getexif()
    exif[274] = orientation  # 274 = Orientation tag; 6 = Rotate 90 CW
    img.save(path, exif=exif)


def test_load_image_applies_exif_orientation(tmp_path):
    """orientation=6 (Rotate 90 CW) on a 40x30 landscape JPEG -> loaded 30x40 portrait."""
    p = tmp_path / "260401_140101.jpg"
    _write_oriented_jpeg(p, width=40, height=30, orientation=6)

    rgb = _service()._load_image(p)

    # Displayed (oriented) frame is portrait: height > width.
    assert rgb.shape[0] > rgb.shape[1], f"expected portrait, got {rgb.shape}"
    # Matches PIL's own exif_transpose — the canonical oriented result.
    from PIL import ImageOps
    expected = np.array(ImageOps.exif_transpose(Image.open(p)).convert("RGB"))
    assert rgb.shape == expected.shape
    assert np.array_equal(rgb, expected)


def test_load_image_no_orientation_tag_is_unchanged(tmp_path):
    """A JPEG without an orientation tag is loaded as-is (no spurious transpose)."""
    p = tmp_path / "260401_140102.jpg"
    arr = np.zeros((30, 40, 3), dtype=np.uint8)
    Image.fromarray(arr, "RGB").save(p)

    rgb = _service()._load_image(p)

    assert rgb.shape == (30, 40, 3)
