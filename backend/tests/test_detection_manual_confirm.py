"""Tests for DetectionService manual-face confirmation.

Regression: manually added faces must be persisted with the file's content hash
(like detected faces), so the rename pipeline can recover them by hash even after
the file is renamed. The batch-confirm path previously stored hash=None.
"""

from unittest.mock import MagicMock

from api.services.detection_service import DetectionService
from faceid_db import get_file_hash
from tests.conftest import InMemoryDBStore


def _service():
    """A DetectionService with the backend mocked, bypassing model loading."""
    svc = DetectionService.__new__(DetectionService)
    svc.known_faces = {}
    svc.ignored_faces = []
    svc.hard_negatives = {}
    svc.processed_files = []
    svc.backend = MagicMock()
    svc.backend.backend_name = "insightface"
    svc.backend.get_model_info.return_value = {"version": "test"}
    # Confirm/ignore now route through the FaceDBStore; back it with the
    # service's own live collections so nothing touches disk.
    svc.store = InMemoryDBStore(svc)
    return svc


def test_manual_confirm_anchors_content_hash(tmp_path):
    img = tmp_path / "260111_080910.NEF"
    img.write_bytes(b"nef-bytes")
    svc = _service()

    svc._confirm_identity_nosave("manual_1", "Elis", str(img))

    entry = svc.known_faces["Elis"][0]
    assert entry["is_manual"] is True
    assert entry["encoding"] is None
    # Hash is the file's content hash, not None — this is the fix.
    assert entry["hash"] == get_file_hash(img)
    assert entry["hash"] is not None


def test_manual_confirm_missing_file_keeps_hash_none(tmp_path):
    """If the source file is gone, fall back gracefully to hash=None rather than crash."""
    svc = _service()

    svc._confirm_identity_nosave("manual_1", "Elis", str(tmp_path / "absent.NEF"))

    assert svc.known_faces["Elis"][0]["hash"] is None
