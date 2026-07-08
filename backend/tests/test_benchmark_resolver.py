"""Tests for the benchmark source resolver, DB extraction, and strata.

All fixtures are synthetic: tmp dirs with dummy image files and a fabricated
mini-DB dict. Nothing here touches the real face database.
"""

from __future__ import annotations

import hashlib
import json

import pytest

from benchmarks.db_access import (
    FaceRecord,
    face_counts,
    records_from_db,
    recorded_hash_map,
)
from benchmarks.resolver import SourceIndex, resolve_hashes, sha1_file
from benchmarks.strata import (
    bbox_quartile_label,
    gallery_probe_viability,
    quartile_thresholds,
    stratify,
    surname,
)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _write(path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return hashlib.sha1(content).hexdigest()


def _mkrec(identity, sha1, *, basename="x.NEF", bbox=None, is_manual=False):
    return FaceRecord(
        identity=identity,
        recorded_file=basename,
        basename=basename,
        sha1=sha1,
        bbox=bbox,
        is_manual=is_manual,
        created_at=None,
    )


# --------------------------------------------------------------------------
# sha1_file
# --------------------------------------------------------------------------
def test_sha1_file_matches_hashlib(tmp_path):
    p = tmp_path / "a.jpg"
    digest = _write(p, b"hello world" * 10000)
    assert sha1_file(p) == digest


def test_sha1_file_missing_returns_none(tmp_path):
    assert sha1_file(tmp_path / "nope.jpg") is None


# --------------------------------------------------------------------------
# SourceIndex build / cache / prune
# --------------------------------------------------------------------------
def test_build_indexes_images_only(tmp_path):
    h1 = _write(tmp_path / "one.NEF", b"raw-one")
    _write(tmp_path / "two.jpg", b"jpg-two")
    _write(tmp_path / "note.txt", b"not an image")  # skipped

    idx = SourceIndex()
    stats = idx.build([tmp_path])

    assert stats.scanned == 2  # txt ignored
    assert stats.hashed == 2
    assert h1 in idx.hashes()
    assert len(idx) == 2


def test_incremental_cache_reuses_unchanged(tmp_path):
    cache = tmp_path / "cache.json"
    _write(tmp_path / "a.jpg", b"content-a")

    idx1 = SourceIndex(cache).load()
    s1 = idx1.build([tmp_path])
    idx1.save()
    assert s1.hashed == 1 and s1.reused == 0

    # Second pass, nothing changed -> reused, not rehashed.
    idx2 = SourceIndex(cache).load()
    s2 = idx2.build([tmp_path])
    assert s2.hashed == 0
    assert s2.reused == 1


def test_incremental_cache_rehashes_on_change(tmp_path):
    cache = tmp_path / "cache.json"
    p = tmp_path / "a.jpg"
    _write(p, b"content-a")

    idx1 = SourceIndex(cache).load()
    idx1.build([tmp_path])
    idx1.save()

    # Change content + bump mtime so (size, mtime) differs.
    import os
    import time

    new_hash = _write(p, b"content-a-modified-longer")
    os.utime(p, (time.time() + 5, time.time() + 5))

    idx2 = SourceIndex(cache).load()
    s2 = idx2.build([tmp_path])
    assert s2.hashed == 1
    assert new_hash in idx2.hashes()


def test_build_prunes_deleted_files(tmp_path):
    cache = tmp_path / "cache.json"
    p = tmp_path / "a.jpg"
    _write(p, b"content-a")
    _write(tmp_path / "b.jpg", b"content-b")

    idx1 = SourceIndex(cache).load()
    idx1.build([tmp_path])
    idx1.save()
    assert len(idx1) == 2

    p.unlink()
    idx2 = SourceIndex(cache).load()
    s2 = idx2.build([tmp_path])
    assert s2.pruned == 1
    assert len(idx2) == 1


def test_cache_roundtrip_persists(tmp_path):
    cache = tmp_path / "cache.json"
    h = _write(tmp_path / "a.jpg", b"persist-me")
    idx = SourceIndex(cache).load()
    idx.build([tmp_path])
    idx.save()

    reloaded = SourceIndex(cache).load()
    assert h in reloaded.hashes()
    data = json.loads(cache.read_text())
    assert data["version"] == SourceIndex.VERSION


def test_missing_root_is_skipped(tmp_path):
    idx = SourceIndex()
    stats = idx.build([tmp_path / "does-not-exist"])
    assert stats.scanned == 0
    assert len(idx) == 0


# --------------------------------------------------------------------------
# resolve_hashes join
# --------------------------------------------------------------------------
def test_resolve_join(tmp_path):
    h_present = _write(tmp_path / "present.NEF", b"i-am-here")
    idx = SourceIndex()
    idx.build([tmp_path])

    recorded = {h_present: ["present.NEF"], "deadbeef" * 5: ["gone.NEF", "gone.NEF"]}
    counts = {h_present: 3, "deadbeef" * 5: 2}
    res = {r.sha1: r for r in resolve_hashes(recorded, counts, idx)}

    assert res[h_present].resolved is True
    assert res[h_present].face_count == 3
    assert res[h_present].current_paths  # non-empty
    gone = res["deadbeef" * 5]
    assert gone.resolved is False
    assert gone.recorded_basenames == ["gone.NEF"]  # deduped


# --------------------------------------------------------------------------
# db_access
# --------------------------------------------------------------------------
def test_records_from_db_flattens_and_skips_hashless():
    db = {
        "Alice Alpha": [
            {"file": "/x/250101_1_Alice.NEF", "hash": "h1", "bounding_box": {"x": 0, "y": 0, "width": 10, "height": 20}},
            {"file": "250101_2_Alice.NEF", "hash": "h2", "is_manual": True},
            {"file": "no-hash.NEF"},  # skipped (no hash)
        ],
    }
    recs = records_from_db(db)
    assert len(recs) == 2
    r0 = recs[0]
    assert r0.identity == "Alice Alpha"
    assert r0.basename == "250101_1_Alice.NEF"
    assert r0.bbox_area == 200
    assert r0.event_prefix == "250101"
    assert recs[1].is_manual is True


def test_recorded_hash_map_and_counts():
    recs = [_mkrec("A", "h1"), _mkrec("B", "h1"), _mkrec("A", "h2")]
    hm = recorded_hash_map(recs)
    assert set(hm["h1"]) == {"x.NEF"}
    assert face_counts(recs) == {"h1": 2, "h2": 1}


def test_event_prefix_requires_six_digits():
    assert _mkrec("A", "h", basename="notdigits.NEF").event_prefix is None
    assert _mkrec("A", "h", basename="260627_x.NEF").event_prefix == "260627"


# --------------------------------------------------------------------------
# strata
# --------------------------------------------------------------------------
def test_quartile_thresholds_and_labels():
    areas = [10, 20, 30, 40]
    q1, q2, q3 = quartile_thresholds(areas)
    assert q1 < q2 < q3
    assert bbox_quartile_label(None, (q1, q2, q3)) == "no_bbox"
    assert bbox_quartile_label(10, (q1, q2, q3)) == "Q1_smallest"
    assert bbox_quartile_label(40, (q1, q2, q3)) == "Q4_largest"


def test_surname_extraction():
    assert surname("Max Björneholt") == "Björneholt"
    assert surname("Cher") is None


def test_stratify_manual_events_and_twins():
    recs = [
        _mkrec("Max Björneholt", "h1", basename="260627_1.NEF", bbox={"x": 0, "y": 0, "width": 5, "height": 5}),
        _mkrec("Vilmer Björneholt", "h2", basename="260627_2.NEF", bbox={"x": 0, "y": 0, "width": 50, "height": 50}),
        _mkrec("Solo Person", "h3", basename="250101_1.NEF", is_manual=True),
    ]
    resolved = {"h1", "h3"}
    strata = stratify(recs, resolved, distinct_pairs=[["Max Björneholt", "Vilmer Björneholt"]])

    assert strata["is_manual"]["manual"].total_faces == 1
    assert strata["is_manual"]["detected"].total_faces == 2
    # Sibling surname group present for Björneholt.
    assert "Björneholt" in strata["sibling_surname"]
    assert strata["sibling_surname"]["Björneholt"].total_faces == 2
    assert strata["sibling_surname"]["Björneholt"].recovered_faces == 1
    # Twin pair stratum.
    twin_key = next(iter(strata["twin_pairs"]))
    assert strata["twin_pairs"][twin_key].total_faces == 2
    # Events keyed by YYMMDD.
    assert "260627" in strata["event"]
    assert "250101" in strata["event"]


def test_gallery_probe_viability_counts_distinct_images():
    recs = [
        _mkrec("A", "h1"),
        _mkrec("A", "h2"),  # 2 distinct images, both recovered -> viable
        _mkrec("B", "h3"),
        _mkrec("B", "h3"),  # same image twice -> only 1 distinct -> not viable
        _mkrec("C", "h4"),  # not recovered
    ]
    resolved = {"h1", "h2", "h3"}
    v = gallery_probe_viability(recs, resolved)
    assert v["total_identities"] == 3
    assert v["identities_with_any_recovered"] == 2  # A and B
    assert v["identities_gallery_probe_viable"] == 1  # only A


def test_image_vs_face_counts_differ_for_shared_source():
    # Two faces from the same source image (one recovered image, two faces).
    recs = [_mkrec("A", "h1"), _mkrec("B", "h1")]
    resolved = {"h1"}
    strata = stratify(recs, resolved)
    detected = strata["is_manual"]["detected"]
    assert detected.total_faces == 2
    assert detected.total_images == 1
    assert detected.recovered_images == 1
    assert detected.recovered_faces == 2
