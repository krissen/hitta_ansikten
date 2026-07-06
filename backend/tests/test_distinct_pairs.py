"""Tests for the confirmed-distinct pair registry + head-to-head separability."""

import numpy as np
import pytest

import api.services.management_service as m
from api.services.management_service import ManagementService, _pair_separability
from tests.conftest import InMemoryDBStore


def _unit(seed):
    v = np.random.RandomState(seed).randn(512)
    return v / np.linalg.norm(v)


def _norm_list(seeds, base=None, jitter=0.0, jseed=0):
    out = []
    for k, s in enumerate(seeds):
        v = _unit(s) if base is None else base + jitter * _unit(jseed + k)
        out.append(v / np.linalg.norm(v))
    return out


def _entry(vec):
    return {"encoding": np.asarray(vec, dtype=float), "backend": "insightface"}


def _people(*names, seed0=0):
    """Minimal known_faces with one usable encoding per named person."""
    return {n: [_entry(_unit(seed0 + i))] for i, n in enumerate(names)}


@pytest.fixture
def service(tmp_path, monkeypatch):
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


# ----- separability metric -------------------------------------------------

def test_separability_high_for_separable_sets():
    base = _unit(0)
    a = _norm_list(range(1, 6), base=base, jitter=0.02, jseed=1)
    b = _norm_list(range(1, 6), base=base + 0.1 * _unit(99), jitter=0.02, jseed=50)
    acc, margin = _pair_separability(a, b)
    assert acc >= 0.9          # cleanly separable → different people
    assert margin > 0


def test_separability_low_for_overlapping_sets():
    base = _unit(0)
    a = _norm_list(range(1, 6), base=base, jitter=0.02, jseed=1)
    b = _norm_list(range(1, 6), base=base, jitter=0.02, jseed=30)
    acc, _ = _pair_separability(a, b)
    assert acc < 0.75          # indistinguishable → likely the same person


def test_separability_none_when_too_few_samples():
    assert _pair_separability([_unit(1)], [_unit(2), _unit(3)]) is None
    assert _pair_separability([], [_unit(2), _unit(3)]) is None


def test_separability_balanced_for_imbalanced_same_person():
    # Same person, but one name has many photos and the other just 2. A pooled
    # 1-NN rate would be dominated by the large class (~0.98) and mis-flag this
    # true duplicate as distinct; balanced accuracy stays near 0.5.
    base = _unit(0)
    big = _norm_list(range(0, 100), base=base, jitter=0.02, jseed=1)
    small = _norm_list(range(0, 2), base=base, jitter=0.02, jseed=900)
    acc, _ = _pair_separability(big, small)
    assert acc < 0.75


def test_strided_sample_caps_length():
    vecs = [np.zeros(4) for _ in range(1000)]
    assert len(m._strided_sample(vecs, 200)) == 200
    assert len(m._strided_sample(vecs[:10], 200)) == 10


def test_separability_bounded_for_many_encodings(monkeypatch):
    # With a large set, the metric must stay bounded (no giant matrix) and still
    # return a finite score.
    monkeypatch.setattr(m, "MAX_SEPARABILITY_SAMPLES", 50)
    base = _unit(0)
    a = _norm_list(range(0, 400), base=base, jitter=0.02, jseed=1)
    b = _norm_list(range(0, 400), base=base + 0.1 * _unit(99), jitter=0.02, jseed=500)
    acc, margin = _pair_separability(a, b)
    assert 0.0 <= acc <= 1.0


# ----- registry + find_duplicate_people ------------------------------------

@pytest.mark.asyncio
async def test_registry_add_remove_list_roundtrip(service):
    service.known_faces = _people("Wilmer", "Maximilian")
    assert (await service.list_distinct_pairs())["count"] == 0
    await service.add_distinct_pair("Wilmer", "Maximilian")
    listed = await service.list_distinct_pairs()
    assert listed["count"] == 1
    assert listed["pairs"][0] == {"name_a": "Maximilian", "name_b": "Wilmer"}  # sorted
    await service.remove_distinct_pair("Maximilian", "Wilmer")
    assert (await service.list_distinct_pairs())["count"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["null", "5", "true", '{"a": 1}', "not json"])
async def test_load_tolerates_malformed_registry(service, bad):
    # A corrupt/hand-edited file (non-list or invalid JSON) must degrade to empty,
    # never raise out of list/add/find.
    service.known_faces = _people("A", "B")
    m.DISTINCT_PAIRS_PATH.write_text(bad)
    assert (await service.list_distinct_pairs())["count"] == 0
    # add still works (overwrites the bad file)
    await service.add_distinct_pair("A", "B")
    assert (await service.list_distinct_pairs())["count"] == 1


@pytest.mark.asyncio
async def test_add_distinct_pair_order_independent_and_validated(service):
    service.known_faces = _people("A name", "B name")
    await service.add_distinct_pair("B name", "A name")
    await service.add_distinct_pair("A name", "B name")  # same pair, no dup
    assert (await service.list_distinct_pairs())["count"] == 1
    with pytest.raises(ValueError):
        await service.add_distinct_pair("Same", "Same")


def test_load_ignores_non_string_entries(service):
    # A two-item entry with a non-string (e.g. ["C", 1]) must not crash sorted();
    # only valid string pairs survive.
    m.DISTINCT_PAIRS_PATH.write_text('[["A", "B"], ["C", 1], [1, 2], "x", ["only"]]')
    assert m._load_distinct_pairs() == {("A", "B")}


@pytest.mark.asyncio
async def test_add_rejects_unknown_person(service):
    service.known_faces = _people("Real")
    with pytest.raises(ValueError):
        await service.add_distinct_pair("Real", "Ghost")
    assert (await service.list_distinct_pairs())["count"] == 0


@pytest.mark.asyncio
async def test_scan_reconciles_against_fresh_names(service):
    # INTENTIONALLY UPDATED for the FaceDBStore migration (was
    # test_scan_reloads_before_pruning). The old test relied on
    # find_duplicate_people forcing a `_reload_from_disk` to repair a stale
    # in-memory cache before reconcile-pruning. There is no stale cache anymore:
    # the service reads through FaceDBStore, which reflects ground truth on every
    # call (reloading on external file change). The surviving invariant — a valid
    # pair whose members both still exist must NOT be pruned by a scan — is now
    # guaranteed by construction because reconcile runs against the store's live
    # names.
    service.known_faces = _people("Wilmer", "Maximilian")
    await service.add_distinct_pair("Wilmer", "Maximilian")
    await service.find_duplicate_people(0.35)
    assert (await service.list_distinct_pairs())["count"] == 1


@pytest.mark.asyncio
async def test_find_and_list_prune_stale_pairs(service):
    # A pair whose member is removed by an unsynced path (here, a direct deletion)
    # is self-healed away on the next find/list, so a recreated name isn't hidden.
    service.known_faces = _people("Wilmer", "Maximilian")
    await service.add_distinct_pair("Wilmer", "Maximilian")
    del service.known_faces["Maximilian"]  # e.g. move-to-ignore / undo emptied them
    await service.find_duplicate_people(0.35)
    assert (await service.list_distinct_pairs())["count"] == 0


@pytest.mark.asyncio
async def test_find_duplicates_excludes_registered_pair(service):
    base = _unit(0)
    service.known_faces = {
        "Wilmer": [_entry(v) for v in _norm_list(range(1, 6), base=base, jitter=0.02, jseed=1)],
        "Maximilian": [_entry(v) for v in _norm_list(range(1, 6), base=base, jitter=0.02, jseed=30)],
    }
    before = await service.find_duplicate_people(0.35)
    assert any({p["name_a"], p["name_b"]} == {"Wilmer", "Maximilian"} for p in before["pairs"])

    await service.add_distinct_pair("Wilmer", "Maximilian")
    after = await service.find_duplicate_people(0.35)
    assert all({p["name_a"], p["name_b"]} != {"Wilmer", "Maximilian"} for p in after["pairs"])


@pytest.mark.asyncio
async def test_find_duplicates_flags_likely_distinct_and_sorts_last(service):
    base = _unit(0)
    # Twins: close centroids but separable clusters.
    twin_a = _norm_list(range(1, 6), base=base, jitter=0.02, jseed=1)
    twin_b = _norm_list(range(1, 6), base=base + 0.1 * _unit(99), jitter=0.02, jseed=50)
    # True duplicate: one cluster under two names.
    dup_a = _norm_list(range(1, 6), base=base, jitter=0.02, jseed=200)
    dup_b = _norm_list(range(1, 6), base=base, jitter=0.02, jseed=230)
    service.known_faces = {
        "TwinA": [_entry(v) for v in twin_a],
        "TwinB": [_entry(v) for v in twin_b],
        "DupA": [_entry(v) for v in dup_a],
        "DupB": [_entry(v) for v in dup_b],
    }
    result = await service.find_duplicate_people(0.35)
    by_pair = {frozenset((p["name_a"], p["name_b"])): p for p in result["pairs"]}

    twin = by_pair[frozenset(("TwinA", "TwinB"))]
    dup = by_pair[frozenset(("DupA", "DupB"))]
    assert twin["likely_distinct"] is True
    assert dup["likely_distinct"] is False
    # likely_distinct pairs sink below true candidates.
    assert result["pairs"][0]["likely_distinct"] is False
    assert result["pairs"][-1]["likely_distinct"] is True


# ----- registry stays in sync with name changes ----------------------------

@pytest.mark.asyncio
async def test_rename_rewrites_distinct_pair(service):
    service.known_faces = _people("Wilmer", "Maximilian")
    await service.add_distinct_pair("Wilmer", "Maximilian")
    await service.rename_person("Wilmer", "Wilmer B")
    assert (await service.list_distinct_pairs())["pairs"] == [
        {"name_a": "Maximilian", "name_b": "Wilmer B"}
    ]


@pytest.mark.asyncio
async def test_delete_drops_distinct_pair(service):
    service.known_faces = _people("Wilmer", "Maximilian")
    await service.add_distinct_pair("Wilmer", "Maximilian")
    await service.delete_person("Wilmer")
    assert (await service.list_distinct_pairs())["count"] == 0


@pytest.mark.asyncio
async def test_move_to_ignore_drops_distinct_pair(service):
    # Removing a person via move-to-ignore must clear their exclusions at delete
    # time, so a recreated same-name person can't inherit the stale pair.
    service.known_faces = _people("Wilmer", "Maximilian")
    await service.add_distinct_pair("Wilmer", "Maximilian")
    await service.move_to_ignore("Wilmer")
    assert "Wilmer" not in service.known_faces
    assert (await service.list_distinct_pairs())["count"] == 0


@pytest.mark.asyncio
async def test_undo_file_drops_emptied_person_pair(service):
    h = "deadbeef"
    service.known_faces = {
        "Wilmer": [{"encoding": _unit(0), "backend": "insightface", "hash": h}],
        "Maximilian": [_entry(_unit(1))],
    }
    service.processed_files = [{"name": "260101_120000.NEF", "hash": h}]
    await service.add_distinct_pair("Wilmer", "Maximilian")
    await service.undo_file("260101_120000.NEF")
    assert "Wilmer" not in service.known_faces
    assert (await service.list_distinct_pairs())["count"] == 0


@pytest.mark.asyncio
async def test_remove_then_recreate_does_not_suppress(service):
    # The exact case the deletion-time drop targets (and that existence-reconcile
    # alone would MISS): remove a person, then recreate the same name as someone
    # who really IS a duplicate of the old partner. The stale exclusion must be
    # gone so the new duplicate is surfaced, not silently suppressed.
    base = _unit(0)
    service.known_faces = {
        "Wilmer": [_entry(base + 0.02 * _unit(i)) for i in range(1, 6)],
        "Maximilian": [_entry(base + 0.1 * _unit(99) + 0.02 * _unit(i)) for i in range(10, 15)],
    }
    await service.add_distinct_pair("Wilmer", "Maximilian")
    await service.move_to_ignore("Wilmer")  # removes Wilmer, clears the exclusion
    # Recreate "Wilmer" as a true duplicate of Maximilian (same cluster).
    service.known_faces["Wilmer"] = [
        _entry(base + 0.1 * _unit(99) + 0.02 * _unit(i)) for i in range(20, 25)
    ]
    result = await service.find_duplicate_people(0.35)
    assert any({p["name_a"], p["name_b"]} == {"Wilmer", "Maximilian"} for p in result["pairs"])


@pytest.mark.asyncio
async def test_purge_to_empty_drops_distinct_pair(service):
    # Purging all of a person's encodings leaves a face-less name that could be
    # reused; the exclusion must drop so it can't hide a future duplicate.
    service.known_faces = _people("Wilmer", "Maximilian")  # one encoding each
    await service.add_distinct_pair("Wilmer", "Maximilian")
    await service.purge_encodings("Wilmer", 1)
    assert service.known_faces["Wilmer"] == []
    assert (await service.list_distinct_pairs())["count"] == 0


@pytest.mark.asyncio
async def test_merge_transfers_distinct_pair_to_target(service):
    # A is distinct from C; merging A into B asserts A≡B, so B inherits "distinct
    # from C" — the exclusion transfers to the canonical name, not dropped.
    service.known_faces = {
        "A": [_entry(_unit(0))],
        "B": [_entry(_unit(1))],
        "C": [_entry(_unit(2))],
    }
    await service.add_distinct_pair("A", "C")
    await service.merge_people(["A"], "B")  # A vanishes into B
    assert (await service.list_distinct_pairs())["pairs"] == [
        {"name_a": "B", "name_b": "C"}
    ]


@pytest.mark.asyncio
async def test_merge_drops_pair_that_collapses_onto_target(service):
    # Merging A into B where (A,B) itself was marked distinct collapses the pair
    # onto one name → dropped.
    service.known_faces = {"A": [_entry(_unit(0))], "B": [_entry(_unit(1))]}
    await service.add_distinct_pair("A", "B")
    await service.merge_people(["A"], "B")
    assert (await service.list_distinct_pairs())["count"] == 0
