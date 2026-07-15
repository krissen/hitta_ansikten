"""Räkna spelare exclusion config: save round-trip + the GUI/API exclusions
surface (get_exclusions / save_exclusions)."""

import json

import pytest

from api.services.player_count_service import PlayerCountService
from core import playerstats
from core.playerstats import (
    ALWAYS_GRUPP,
    ALWAYS_PUBLIK,
    compute_player_stats,
    load_exclusion_config,
    resolve_always_markers,
    resolve_exclusion_sets,
    save_exclusion_config,
)


@pytest.fixture
def config(tmp_path, monkeypatch):
    """Point the exclusion config at a temp file (no real ~/.local writes)."""
    cfg = tmp_path / "rakna_spelare.json"
    monkeypatch.setattr(playerstats, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(playerstats, "CONFIG_FILE", cfg)
    # Env overrides config in resolve_exclusion_sets — clear so tests are
    # deterministic regardless of the host environment.
    for env in (
        "RAKNA_TRANARE",
        "RAKNA_PUBLIK",
        "RAKNA_GRUPP",
        "RAKNA_ALWAYS_GRUPP",
        "RAKNA_ALWAYS_PUBLIK",
    ):
        monkeypatch.delenv(env, raising=False)
    return cfg


def test_save_round_trips(config):
    save_exclusion_config(tranare=["Anna", "Bo"], publik=["Cecilia"])
    assert load_exclusion_config() == {
        "tranare": ["Anna", "Bo"],
        "publik": ["Cecilia"],
        "grupp": [],
    }


def test_save_strips_always_markers(config):
    # ALWAYS markers are merged by the resolver, so they must not be persisted.
    save_exclusion_config(
        tranare=["Coach"],
        publik=["Cecilia", *ALWAYS_PUBLIK],
        grupp=list(ALWAYS_GRUPP),
    )
    written = json.loads(config.read_text())
    assert written["publik"] == ["Cecilia"]
    assert written["grupp"] == []
    assert not (set(written["publik"]) & ALWAYS_PUBLIK)


def test_save_dedupes_and_drops_empties(config):
    save_exclusion_config(tranare=["Anna", "  Anna  ", "", "Bo"], publik=[])
    assert load_exclusion_config()["tranare"] == ["Anna", "Bo"]


def test_save_none_preserves_existing_grupp(config):
    save_exclusion_config(grupp=["Reserverna"])
    # A later save of only tranare/publik must keep the configured grupp.
    save_exclusion_config(tranare=["Anna"], publik=["Cecilia"])
    assert load_exclusion_config()["grupp"] == ["Reserverna"]


def test_get_exclusions_shape_includes_always(config):
    save_exclusion_config(tranare=["Anna"], publik=["Cecilia"])
    result = PlayerCountService().get_exclusions()

    assert result["tranare"] == ["Anna"]
    assert "Cecilia" in result["publik"]
    # ALWAYS markers are merged into the resolved lists...
    assert ALWAYS_PUBLIK <= set(result["publik"])
    assert ALWAYS_GRUPP <= set(result["grupp"])
    # ...and reported separately so the GUI can lock them.
    assert set(result["always"]["publik"]) == ALWAYS_PUBLIK
    assert set(result["always"]["grupp"]) == ALWAYS_GRUPP


def test_save_exclusions_service_persists_and_returns(config):
    result = PlayerCountService().save_exclusions(tranare=["Anna"], publik=["Cecilia"])
    assert result["tranare"] == ["Anna"]
    assert load_exclusion_config()["tranare"] == ["Anna"]


def test_post_partial_payload_rejected_without_wiping(config):
    # Both lists are required: an accidental {} must 422, not silently wipe the
    # existing config.
    from fastapi.testclient import TestClient

    from api.server import app

    save_exclusion_config(tranare=["Anna"], publik=["Cecilia"])
    client = TestClient(app)

    resp = client.post("/api/v1/players/exclusions", json={})
    assert resp.status_code == 422
    assert load_exclusion_config()["tranare"] == ["Anna"]  # untouched

    # An explicit both-lists save still works (and can clear).
    ok = client.post("/api/v1/players/exclusions", json={"tranare": ["Bo"], "publik": []})
    assert ok.status_code == 200
    assert load_exclusion_config() == {"tranare": ["Bo"], "publik": [], "grupp": []}


# --- Per-request force-include (spelare) -----------------------------------


def test_count_spelare_force_include_beats_always_markers(config, tmp_path):
    # "Klacken" is an always-publik marker; a per-request spelare override must
    # still move it into the players bucket (session-only reclassify).
    photos = tmp_path / "photos"
    photos.mkdir()
    for ts in ("120000", "120100", "120200"):
        (photos / f"260601_{ts}_Klacken.jpg").touch()

    service = PlayerCountService()

    baseline = service.count(roots=[str(photos)])
    assert "Klacken" in {e["name"] for e in baseline["excluded"]["publik"]}

    forced = service.count(roots=[str(photos)], spelare=["Klacken"])
    assert "Klacken" in {p["name"] for p in forced["players"]}
    assert "Klacken" not in {e["name"] for e in forced["excluded"]["publik"]}


def test_count_spelare_bypasses_min_images(config, tmp_path):
    # A force-included name with fewer than min_images must still land in
    # players (the whole point: a briefly-playing player with few images).
    photos = tmp_path / "photos"
    photos.mkdir()
    for ts in ("120000", "120100", "120200"):
        (photos / f"260601_{ts}_Anna.jpg").touch()
    (photos / "260601_120300_Oscar.jpg").touch()  # 1 image < min_images=3

    service = PlayerCountService()

    baseline = service.count(roots=[str(photos)])
    assert "Oscar" in {e["name"] for e in baseline["excluded"]["below_threshold"]}

    forced = service.count(roots=[str(photos)], spelare=["Oscar"])
    assert "Oscar" in {p["name"] for p in forced["players"]}
    assert "Oscar" not in {e["name"] for e in forced["excluded"]["below_threshold"]}


def test_count_session_pins_move_between_buckets(config, tmp_path):
    # Session pins win over always-markers and place the name in exactly one
    # bucket (no double-listing across overlapping sets).
    photos = tmp_path / "photos"
    photos.mkdir()
    for ts in ("120000", "120100", "120200"):
        (photos / f"260601_{ts}_Klacken.jpg").touch()
        (photos / f"260601_{ts}_Anna.jpg").touch()

    service = PlayerCountService()

    # always-publik marker -> tranare (session)
    moved = service.count(roots=[str(photos)], session_tranare=["Klacken"])
    assert "Klacken" in {e["name"] for e in moved["excluded"]["tranare"]}
    assert "Klacken" not in {e["name"] for e in moved["excluded"]["publik"]}

    # player -> grupp (session)
    grouped = service.count(roots=[str(photos)], session_grupp=["Anna"])
    assert "Anna" in {e["name"] for e in grouped["excluded"]["grupp"]}
    assert "Anna" not in {p["name"] for p in grouped["players"]}

    # player -> publik (session)
    audience = service.count(roots=[str(photos)], session_publik=["Anna"])
    assert "Anna" in {e["name"] for e in audience["excluded"]["publik"]}
    assert "Anna" not in {p["name"] for p in audience["players"]}
    # Nothing persisted by any session pin.
    assert load_exclusion_config() == {"tranare": [], "publik": [], "grupp": []}


def test_get_exclusions_exposes_raw_config(config, monkeypatch):
    # `config` mirrors the persisted file only — no env values, no
    # always-markers — so targeted saves can't echo transient env lists back.
    save_exclusion_config(tranare=["Anna"], publik=["Cecilia"])
    monkeypatch.setenv("RAKNA_PUBLIK", "EnvOnly")
    result = PlayerCountService().get_exclusions()
    assert "EnvOnly" in result["publik"]  # resolved view follows env
    assert "Cecilia" not in result["publik"]  # env shadows the config list
    assert result["config"]["publik"] == ["Cecilia"]  # raw view does not
    assert result["config"]["tranare"] == ["Anna"]
    assert not (set(result["config"]["publik"]) & ALWAYS_PUBLIK)


def test_count_grupp_request_override(config, tmp_path):
    # A per-request grupp override moves a would-be player into the grupp
    # bucket without touching the persisted config.
    photos = tmp_path / "photos"
    photos.mkdir()
    for ts in ("120000", "120100", "120200"):
        (photos / f"260601_{ts}_Anna.jpg").touch()

    stats = PlayerCountService().count(roots=[str(photos)], grupp=["Anna"])
    assert "Anna" in {e["name"] for e in stats["excluded"]["grupp"]}
    assert "Anna" not in {p["name"] for p in stats["players"]}
    assert load_exclusion_config()["grupp"] == []  # config untouched


# --- Config-driven always-markers -----------------------------------------


def test_always_markers_default_to_builtins(config):
    grupp, publik = resolve_always_markers(load_exclusion_config())
    assert grupp == ALWAYS_GRUPP
    assert publik == ALWAYS_PUBLIK


def test_always_markers_configurable_add_and_remove(config):
    # Add a custom always-grupp marker and drop FBK; keep Laget.
    save_exclusion_config(always_grupp=["Laget", "Forward"])
    grupp, _ = resolve_always_markers(load_exclusion_config())
    assert grupp == {"Laget", "Forward"}
    assert "FBK" not in grupp

    # And it flows through the shared resolver used by CLI + GUI.
    _, _, grupp_set = resolve_exclusion_sets()
    assert "Forward" in grupp_set
    assert "FBK" not in grupp_set


def test_always_marker_empty_key_clears(config):
    save_exclusion_config(always_publik=[])
    _, publik = resolve_always_markers(load_exclusion_config())
    assert publik == set()
    # Klacken is no longer force-excluded.
    _, publik_set, _ = resolve_exclusion_sets()
    assert "Klacken" not in publik_set


def test_custom_always_excludes_a_player(config):
    save_exclusion_config(always_grupp=["Forward"])
    files = [
        "260601_120000_Anna.jpg",
        "260601_120100_Anna.jpg",
        "260601_120200_Anna.jpg",
        "260601_120300_Forward.jpg",
        "260601_120400_Forward.jpg",
        "260601_120500_Forward.jpg",
    ]
    tranare, publik, grupp = resolve_exclusion_sets()
    stats = compute_player_stats(
        files, min_images=3, tranare_set=tranare, publik_set=publik, grupp_set=grupp
    )
    player_names = {p["name"] for p in stats["players"]}
    assert player_names == {"Anna"}
    assert "Forward" in {e["name"] for e in stats["excluded"]["grupp"]}


def test_save_strips_regular_lists_against_custom_always(config):
    # A custom always-grupp name must be stripped from the regular grupp list.
    save_exclusion_config(always_grupp=["Forward"], grupp=["Forward", "Reserverna"])
    written = json.loads(config.read_text())
    assert written["grupp"] == ["Reserverna"]
    assert written["always_grupp"] == ["Forward"]


def test_save_preserves_always_when_not_passed(config):
    save_exclusion_config(always_grupp=["Forward"])
    save_exclusion_config(tranare=["Anna"], publik=["Cecilia"])  # no always_* args
    assert load_exclusion_config()["always_grupp"] == ["Forward"]


def test_get_exclusions_reports_configured_always_and_env(config, monkeypatch):
    result = PlayerCountService().save_exclusions(
        tranare=["Anna"], publik=["Cecilia"], always_grupp=["Forward"]
    )
    assert result["always"]["grupp"] == ["Forward"]
    assert result["env_active"] is False
    assert result["env_keys"] == []

    monkeypatch.setenv("RAKNA_TRANARE", "Coach")
    result2 = PlayerCountService().get_exclusions()
    assert result2["env_active"] is True
    assert "RAKNA_TRANARE" in result2["env_keys"]


def test_save_strip_ignores_always_env(config, monkeypatch):
    # With RAKNA_ALWAYS_PUBLIK set, saving publik must NOT strip against the env
    # value — persistence depends on the config/defaults, not a transient env.
    monkeypatch.setenv("RAKNA_ALWAYS_PUBLIK", "EnvOnly")
    save_exclusion_config(publik=["EnvOnly", "Cecilia"])
    written = json.loads(config.read_text())
    assert "EnvOnly" in written["publik"]  # not stripped by the env always-set
    assert "Cecilia" in written["publik"]
