"""Cross-service coherence test for the shared FaceDBStore.

The point of the D-phase store migration: ManagementService and DetectionService
no longer hold private copies of the face DB — they share ONE process-wide
FaceDBStore. A mutation committed by one service must therefore be immediately
visible to the other, with no reload call in between.

This test drives that end to end: rename a person through ManagementService, then
assert DetectionService's real match path (`_match_encoding`) returns the NEW
name for that person's encoding — proving both services read the same authority.
"""

from collections import OrderedDict

import numpy as np
import pytest

import api.services.db_store as db_store_mod
import api.services.management_service as m
import faceid_db
from api.services.db_store import get_db_store
from api.services.detection_service import DetectionService
from api.services.management_service import ManagementService


class _FakeBackend:
    """Deterministic InsightFace stand-in (Euclidean distances, no model load)."""

    backend_name = "insightface"

    def compute_distances(self, matrix, encoding):
        matrix = np.asarray(matrix, dtype=float)
        encoding = np.asarray(encoding, dtype=float)
        return np.linalg.norm(matrix - encoding, axis=1)

    def get_model_info(self):
        return {"version": "test-v1", "model": "test-model"}


@pytest.fixture
def db_dir(tmp_path, monkeypatch):
    """Redirect the shared DB paths into a temp dir and reset the store singleton."""
    base = tmp_path / "faceid"
    base.mkdir()
    monkeypatch.setattr(faceid_db, "BASE_DIR", base)
    monkeypatch.setattr(faceid_db, "ARCHIVE_DIR", base / "archive")
    monkeypatch.setattr(faceid_db, "ENCODING_PATH", base / "encodings.pkl")
    monkeypatch.setattr(faceid_db, "IGNORED_PATH", base / "ignored.pkl")
    monkeypatch.setattr(faceid_db, "HARDNEG_PATH", base / "hardneg.pkl")
    monkeypatch.setattr(faceid_db, "PROCESSED_PATH", base / "processed_files.jsonl")
    monkeypatch.setattr(faceid_db, "ATTEMPT_LOG_PATH", base / "attempt_stats.jsonl")
    monkeypatch.setattr(faceid_db, "LOGGING_PATH", base / "ansikten.log")
    monkeypatch.setattr(m, "BASE_DIR", base)
    monkeypatch.setattr(m, "DISTINCT_PAIRS_PATH", base / "distinct_pairs.json")
    # Fresh authority per test, bound to this temp dir.
    monkeypatch.setattr(db_store_mod, "_store", None)
    return base


def _entry(vec):
    return {"encoding": np.asarray(vec, dtype=float), "backend": "insightface"}


def _detection_service():
    """A DetectionService bound to the shared store, with the model faked."""
    svc = DetectionService.__new__(DetectionService)
    svc.config = {}
    svc.backend = _FakeBackend()
    svc.store = get_db_store()
    svc._cache_db_version = svc.store.version
    return svc


@pytest.mark.asyncio
async def test_management_rename_is_immediately_visible_to_detection(db_dir):
    faceid_db.save_database({"Old Name": [_entry([1.0, 2.0])]}, [], {}, [])

    mgmt = ManagementService()
    det = _detection_service()

    # Sanity: detection matches the seeded name before the rename.
    name, _ = det._match_encoding(np.array([1.0, 2.0]))
    assert name == "Old Name"

    # Mutate through the OTHER service.
    await mgmt.rename_person("Old Name", "New Name")

    # No reload_database() call — detection's next read sees the rename because
    # both services share the same FaceDBStore.
    name, dist = det._match_encoding(np.array([1.0, 2.0]))
    assert name == "New Name"
    assert dist == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_detection_confirm_is_immediately_visible_to_management(db_dir):
    faceid_db.save_database({}, [], {}, [])

    mgmt = ManagementService()
    det = _detection_service()

    # Confirm a detected face through DetectionService.
    enc = np.array([5.0, 6.0])
    det.encoding_cache = OrderedDict()
    det.encoding_cache["face_0"] = (enc, {"x": 0, "y": 0, "width": 1, "height": 1}, "h", None)
    await det.confirm_identity("face_0", "Alice", "/a.NEF")

    # Management sees the new person immediately via the shared store.
    state = await mgmt.get_database_state()
    assert any(p["name"] == "Alice" for p in state["people"])

    # Settle the confirm's debounced save so no daemon Timer outlives the test
    # (it would otherwise fire mid-suite against another test's patched store).
    det.store.flush()
