"""Tests for CullingService trash retention: age-based purge + config helpers."""

from datetime import datetime, timedelta

import pytest

import api.services.culling_service as cs
from api.services.culling_service import CullingService


@pytest.fixture
def service(tmp_path, monkeypatch):
    """A CullingService whose trash lives under tmp_path (no real ~/.local writes)."""
    trash = tmp_path / "trash"
    trash.mkdir()
    monkeypatch.setattr(cs, "TRASH_DIR", trash)
    monkeypatch.setattr(cs, "MANIFEST_PATH", trash / "manifest.jsonl")
    return CullingService()


def _trash_file(service, tmp_path, name):
    img = tmp_path / name
    img.write_bytes(b"jpg")
    return service.trash([str(img)])["trashed"][0]["id"]


def _backdate(service, tid, days):
    entries = service._load_manifest()
    for e in entries:
        if e["id"] == tid:
            # Naive, matching the on-disk manifest format the service writes
            # and the naive cutoff purge_expired compares against.
            e["trashed_at"] = (datetime.now() - timedelta(days=days)).isoformat()  # noqa: DTZ005
    service._rewrite_manifest(entries)


def test_purge_removes_expired_keeps_recent(service, tmp_path):
    old_id = _trash_file(service, tmp_path, "old.jpg")
    new_id = _trash_file(service, tmp_path, "new.jpg")
    _backdate(service, old_id, 40)
    _backdate(service, new_id, 5)

    result = service.purge_expired(max_age_days=30)

    assert result["purged"] == 1
    ids = {e["id"] for e in service._load_manifest()}
    assert old_id not in ids
    assert new_id in ids
    assert not list(cs.TRASH_DIR.glob(f"{old_id}__*"))
    assert list(cs.TRASH_DIR.glob(f"{new_id}__*"))


def test_purge_zero_is_keep_forever(service, tmp_path):
    tid = _trash_file(service, tmp_path, "ancient.jpg")
    _backdate(service, tid, 9999)

    assert service.purge_expired(max_age_days=0)["purged"] == 0
    assert any(e["id"] == tid for e in service._load_manifest())


@pytest.mark.parametrize("bad_ts", ["not-a-date", 1700000000, None])
def test_purge_keeps_entries_with_bad_timestamp(service, tmp_path, bad_ts):
    # Unparseable string (ValueError) and non-string values (TypeError, or a
    # missing key) must all be kept, never aborting or deleting on bad data.
    tid = _trash_file(service, tmp_path, "weird.jpg")
    entries = service._load_manifest()
    for e in entries:
        if e["id"] == tid:
            if bad_ts is None:
                e.pop("trashed_at", None)
            else:
                e["trashed_at"] = bad_ts
    service._rewrite_manifest(entries)

    assert service.purge_expired(max_age_days=1)["purged"] == 0
    assert any(e["id"] == tid for e in service._load_manifest())


def test_purge_removes_expired_sidecars(service, tmp_path):
    img = tmp_path / "260626_191003_Milian.jpg"
    img.write_bytes(b"jpg")
    (tmp_path / "260626_191003_Milian.xmp").write_text("xmp")
    tid = service.trash([str(img)])["trashed"][0]["id"]
    _backdate(service, tid, 40)

    service.purge_expired(max_age_days=30)

    assert not list(cs.TRASH_DIR.glob(f"{tid}__*"))


def test_set_and_get_retention_days(tmp_path, monkeypatch):
    from core import config as core_config
    monkeypatch.setattr(core_config, "BASE_DIR", tmp_path)
    monkeypatch.setattr(core_config, "CONFIG_PATH", tmp_path / "config.json")
    service = CullingService()

    assert service.set_retention_days(14) == {"days": 14}
    assert service.get_retention_days() == 14
    # Negative clamps to 0 (= keep forever).
    assert service.set_retention_days(-5) == {"days": 0}
    assert service.get_retention_days() == 0
