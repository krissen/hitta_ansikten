"""Tests for CullingService.list_files — the filter dropdown's player list.

The dropdown must apply the same exclusions + threshold as rakna_spelare / the
stats column: group/crowd markers (Laget/FBK/Klacken) and below-threshold names
must not appear as filterable players. Files themselves are always listed.
"""

import pytest

from api.services.culling_service import DROPDOWN_MIN_IMAGES, CullingService


@pytest.fixture
def service():
    return CullingService()


@pytest.fixture(autouse=True)
def _isolate_exclusion_config(monkeypatch):
    # Isolate from the runner's real environment: clear RAKNA_* overrides AND
    # neutralize the on-disk config file, so only the built-in ALWAYS markers
    # (FBK/Laget/Klacken) drive the assertions.
    for var in ("RAKNA_TRANARE", "RAKNA_PUBLIK", "RAKNA_GRUPP"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(
        "core.playerstats.load_exclusion_config",
        lambda: {"tranare": [], "publik": [], "grupp": []},
    )


def _make(tmp_path, name, n, start=1):
    """Create ``n`` jpgs at 260626_1200SS_<name>.jpg."""
    for i in range(n):
        (tmp_path / f"260626_1200{start + i:02d}_{name}.jpg").write_bytes(b"jpg")


def test_dropdown_excludes_group_marker_and_below_threshold(service, tmp_path):
    _make(tmp_path, "Anna", DROPDOWN_MIN_IMAGES, start=1)  # a real player
    _make(tmp_path, "FBK", DROPDOWN_MIN_IMAGES, start=20)  # group marker
    _make(tmp_path, "Kim", DROPDOWN_MIN_IMAGES - 1, start=40)  # below threshold

    result = service.list_files(roots=[str(tmp_path)], recursive=False)

    assert result["players"] == ["Anna"]
    # Every file is still listed regardless of the dropdown filtering.
    assert len(result["files"]) == 3 * DROPDOWN_MIN_IMAGES - 1


def test_dropdown_lists_multiple_players_sorted(service, tmp_path):
    _make(tmp_path, "Bo", DROPDOWN_MIN_IMAGES, start=1)
    _make(tmp_path, "Ada", DROPDOWN_MIN_IMAGES, start=20)

    result = service.list_files(roots=[str(tmp_path)], recursive=False)

    assert result["players"] == ["Ada", "Bo"]


def test_files_carry_mtime_size_fingerprint(service, tmp_path):
    # Each listed file exposes an mtime_ms/size fingerprint so the frontend grid
    # can cache-bust a thumbnail after an in-place re-export.
    _make(tmp_path, "Ida", DROPDOWN_MIN_IMAGES, start=1)

    result = service.list_files(roots=[str(tmp_path)], recursive=False)

    assert result["files"], "expected listed files"
    for f in result["files"]:
        assert isinstance(f["mtime_ms"], int)
        assert isinstance(f["size"], int)
        assert f["size"] > 0
