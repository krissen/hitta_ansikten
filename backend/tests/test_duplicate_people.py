"""Tests for ManagementService.find_duplicate_people — cross-person merge candidates."""

import numpy as np
import pytest

from api.services.management_service import ManagementService, _person_centroid
from tests.conftest import InMemoryDBStore


def _unit(seed):
    v = np.random.RandomState(seed).randn(512)
    return v / np.linalg.norm(v)


def _entry(vec, backend="insightface"):
    return {"encoding": np.asarray(vec, dtype=float), "backend": backend}


@pytest.fixture
def service(tmp_path, monkeypatch):
    """A ManagementService fully isolated from the real database and registry."""
    import api.services.management_service as m

    monkeypatch.setattr(m, "DISTINCT_PAIRS_PATH", tmp_path / "distinct_pairs.json")
    svc = ManagementService.__new__(ManagementService)
    svc.known_faces = {}
    svc.ignored_faces = []
    svc.hard_negatives = {}
    svc.processed_files = []
    # Route the service's store reads/mutations at the service's own live
    # in-memory collections, so nothing touches the real DB.
    svc.store = InMemoryDBStore(svc)
    return svc


async def _find(service, threshold):
    return await service.find_duplicate_people(threshold)


@pytest.mark.asyncio
async def test_finds_near_identical_pair_not_distinct(service):
    base = _unit(0)
    near = base + 0.01 * np.random.RandomState(1).randn(512)
    far = _unit(2)
    service.known_faces = {
        "Elis": [_entry(base)],
        "Elis Niemi": [_entry(near)],
        "Arvid": [_entry(far)],
    }

    result = await _find(service, 0.35)

    assert result["people_compared"] == 3
    assert len(result["pairs"]) == 1
    pair = result["pairs"][0]
    assert {pair["name_a"], pair["name_b"]} == {"Elis", "Elis Niemi"}
    assert pair["distance"] < 0.1
    assert pair["count_a"] == 1 and pair["count_b"] == 1


@pytest.mark.asyncio
async def test_threshold_excludes_borderline_pairs(service):
    base = _unit(0)
    near = base + 0.01 * np.random.RandomState(1).randn(512)
    service.known_faces = {"A": [_entry(base)], "B": [_entry(near)]}

    assert (await _find(service, 0.35))["pairs"], "near pair should match a loose threshold"
    assert (await _find(service, 0.0))["pairs"] == [], "a zero threshold excludes everything"


@pytest.mark.asyncio
async def test_pairs_sorted_closest_first(service):
    base = _unit(0)
    near = base + 0.005 * np.random.RandomState(1).randn(512)  # very close
    midd = base + 0.20 * np.random.RandomState(3).randn(512)  # less close
    service.known_faces = {
        "Base": [_entry(base)],
        "VeryClose": [_entry(near)],
        "LessClose": [_entry(midd)],
    }

    pairs = (await _find(service, 0.9))["pairs"]
    dists = [p["distance"] for p in pairs]
    assert dists == sorted(dists)


@pytest.mark.asyncio
async def test_manual_only_person_is_skipped(service):
    base = _unit(0)
    near = base + 0.01 * np.random.RandomState(1).randn(512)
    service.known_faces = {
        "Elis": [_entry(base)],
        "Elis Niemi": [_entry(near)],
        "ManualOnly": [{"encoding": None, "is_manual": True, "backend": "insightface"}],
    }

    result = await _find(service, 0.35)

    assert result["people_compared"] == 2  # ManualOnly contributes no centroid
    assert all("ManualOnly" not in (p["name_a"], p["name_b"]) for p in result["pairs"])


def test_person_centroid_counts_only_usable_encodings():
    base = _unit(0)
    encs = [
        {"encoding": base, "backend": "insightface"},
        {"encoding": None, "is_manual": True, "backend": "insightface"},
        {"encoding": _unit(5), "backend": "dlib"},  # other backend, filtered out
    ]
    result = _person_centroid(encs, "insightface")
    assert result is not None
    centroid, n_used = result
    assert n_used == 1
    assert centroid.shape == (512,)
    assert _person_centroid([{"encoding": None, "is_manual": True}], "insightface") is None
