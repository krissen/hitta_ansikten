"""Tests for within-person redundant-encoding dedup."""

import hashlib

import numpy as np
import pytest

from api.services.management_service import ManagementService, _redundant_indices
from tests.conftest import InMemoryDBStore


def _unit(seed, dim=16):
    v = np.random.RandomState(seed).randn(dim)
    return v / np.linalg.norm(v)


def _entry(vec):
    a = np.asarray(vec, dtype=float)
    return {
        "encoding": a,
        "backend": "insightface",
        "encoding_hash": hashlib.sha1(a.tobytes()).hexdigest(),
    }


_MANUAL = {"encoding": None, "is_manual": True, "backend": "insightface"}


@pytest.fixture
def service():
    svc = ManagementService.__new__(ManagementService)
    svc.known_faces = {}
    svc.ignored_faces = []
    svc.hard_negatives = {}
    svc.processed_files = []
    # Route store reads/mutations at the service's own live in-memory
    # collections, so nothing touches the real DB.
    svc.store = InMemoryDBStore(svc)
    return svc


# ----- _redundant_indices --------------------------------------------------

def test_exact_duplicates_removed_keeping_one():
    base = _unit(0)
    encs = [_entry(base), _entry(base), _entry(_unit(5))]  # 0 and 1 byte-identical
    assert _redundant_indices(encs, 0.0, "insightface") == {1}


def test_near_duplicates_only_above_threshold():
    base = _unit(0)
    encs = [_entry(base), _entry(base + 0.01 * _unit(1)), _entry(_unit(5))]
    assert _redundant_indices(encs, 0.0, "insightface") == set()      # near ≠ exact
    assert _redundant_indices(encs, 0.1, "insightface") == {1}        # within threshold


def test_manual_and_other_backend_never_removed():
    base = _unit(0)
    encs = [
        _entry(base),
        _MANUAL,
        _MANUAL,  # two manual faces — never redundant even though identical
        {"encoding": _unit(5), "backend": "dlib"},  # other backend — ignored
    ]
    assert _redundant_indices(encs, 0.1, "insightface") == set()


def test_redundant_indices_computes_missing_hash():
    base = _unit(0)
    e1 = {"encoding": np.asarray(base), "backend": "insightface"}  # no encoding_hash
    e2 = {"encoding": np.asarray(base), "backend": "insightface"}
    assert _redundant_indices([e1, e2], 0.0, "insightface") == {1}


# ----- find_redundant_encodings / dedup_people -----------------------------

@pytest.mark.asyncio
async def test_find_lists_only_people_with_redundancy(service):
    base = _unit(0)
    service.known_faces = {
        "Dup": [_entry(base), _entry(base), _entry(_unit(2))],
        "Clean": [_entry(_unit(3)), _entry(_unit(4))],
    }
    result = await service.find_redundant_encodings(0.0)
    assert result["total_redundant"] == 1
    assert [p["name"] for p in result["people"]] == ["Dup"]
    dup = result["people"][0]
    assert dup == {"name": "Dup", "total": 3, "redundant": 1, "kept": 2}


@pytest.mark.asyncio
async def test_dedup_removes_and_dry_run_does_not(service):
    base = _unit(0)
    service.known_faces = {"Dup": [_entry(base), _entry(base), _entry(_unit(2))]}

    preview = await service.dedup_people(["Dup"], threshold=0.0, dry_run=True)
    assert preview["total_removed"] == 1
    assert len(service.known_faces["Dup"]) == 3  # unchanged on dry-run

    applied = await service.dedup_people(["Dup"], threshold=0.0)
    assert applied["total_removed"] == 1
    assert applied["removed_per_person"] == {"Dup": 1}
    assert len(service.known_faces["Dup"]) == 2  # one byte-duplicate removed


@pytest.mark.asyncio
async def test_dedup_never_removes_manual_faces(service):
    base = _unit(0)
    service.known_faces = {"P": [_entry(base), _entry(base), _MANUAL, _MANUAL]}
    await service.dedup_people(["P"], threshold=0.1)
    # one exact dup removed; both manual faces survive
    kept = service.known_faces["P"]
    assert sum(1 for e in kept if e.get("encoding") is None) == 2
    assert len(kept) == 3
