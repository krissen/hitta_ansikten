"""Tests for the unified face-match threshold source of truth.

Covers:
  * _get_backend_thresholds — backend_thresholds is authoritative; stale
    top-level flat keys never override the canonical metric defaults.
  * _migrate_config / load_config — one-time, idempotent migration of legacy
    euclidean-era flat threshold keys into a correct-metric backend_thresholds
    block.
"""

import json

import core.config as config_mod
from core.config import (
    CONFIG_VERSION,
    DEFAULT_CONFIG,
    _migrate_config,
    load_config,
)
from core.matching import (
    COSINE_DEFAULT_THRESHOLDS,
    EUCLIDEAN_DEFAULT_THRESHOLDS,
    _get_backend_thresholds,
)


class _Backend:
    def __init__(self, name, metric):
        self.backend_name = name
        self.distance_metric = metric


_INSIGHTFACE = _Backend("insightface", "cosine")
_DLIB = _Backend("dlib", "euclidean")


# --------------------------------------------------------------------------
# _get_backend_thresholds
# --------------------------------------------------------------------------

def test_insightface_defaults_to_cosine_when_no_block():
    # Empty config -> canonical cosine defaults for the insightface backend.
    assert _get_backend_thresholds({}, _INSIGHTFACE) == COSINE_DEFAULT_THRESHOLDS


def test_dlib_defaults_to_euclidean_when_no_block():
    assert _get_backend_thresholds({}, _DLIB) == EUCLIDEAN_DEFAULT_THRESHOLDS


def test_flat_keys_do_not_override_cosine_defaults():
    # The core bug: stale euclidean flat keys (0.6/0.5) must NOT loosen cosine
    # matching. Without a backend block they are ignored entirely.
    cfg = {"match_threshold": 0.6, "ignore_distance": 0.5, "hard_negative_distance": 0.45}
    assert _get_backend_thresholds(cfg, _INSIGHTFACE) == COSINE_DEFAULT_THRESHOLDS


def test_backend_block_is_authoritative():
    cfg = {
        "match_threshold": 0.6,  # stale flat keys present but ignored
        "backend_thresholds": {
            "insightface": {
                "match_threshold": 0.42,
                "ignore_distance": 0.36,
                "hard_negative_distance": 0.30,
            }
        },
    }
    out = _get_backend_thresholds(cfg, _INSIGHTFACE)
    assert out == {
        "match_threshold": 0.42,
        "ignore_distance": 0.36,
        "hard_negative_distance": 0.30,
    }


def test_default_config_insightface_block_matches_cosine_defaults():
    # The shipped default block and the code-level canonical defaults agree, so
    # both callers land on the same numbers whichever path supplies them.
    assert DEFAULT_CONFIG["backend_thresholds"]["insightface"] == COSINE_DEFAULT_THRESHOLDS


def test_manual_mode_without_block_still_uses_canonical_defaults():
    cfg = {"threshold_mode": "manual", "match_threshold": 0.6}
    assert _get_backend_thresholds(cfg, _INSIGHTFACE) == COSINE_DEFAULT_THRESHOLDS


# --------------------------------------------------------------------------
# _migrate_config
# --------------------------------------------------------------------------

def _legacy_config():
    # Mirrors the real-world on-disk config that motivated the fix.
    return {
        "min_confidence": 0.4,
        "ignore_distance": 0.5,
        "match_threshold": 0.6,
        "backend": {"type": "insightface"},
    }


def test_migration_rewrites_legacy_flat_keys():
    raw, changed = _migrate_config(_legacy_config())

    assert changed is True
    # Flat threshold keys removed...
    assert "match_threshold" not in raw
    assert "ignore_distance" not in raw
    assert "hard_negative_distance" not in raw
    # ...and the canonical cosine block written (NOT the stale 0.6/0.5 values).
    assert raw["backend_thresholds"]["insightface"] == COSINE_DEFAULT_THRESHOLDS
    assert raw["config_version"] == CONFIG_VERSION
    # Unrelated keys are preserved.
    assert raw["min_confidence"] == 0.4
    assert raw["backend"] == {"type": "insightface"}


def test_migration_is_idempotent():
    once, changed1 = _migrate_config(_legacy_config())
    twice, changed2 = _migrate_config(dict(once))

    assert changed1 is True
    assert changed2 is False
    assert twice["backend_thresholds"]["insightface"] == COSINE_DEFAULT_THRESHOLDS


def test_migration_does_not_touch_existing_insightface_block():
    cfg = {
        "match_threshold": 0.6,  # flat key present, but block already exists
        "backend_thresholds": {
            "insightface": {
                "match_threshold": 0.42,
                "ignore_distance": 0.36,
                "hard_negative_distance": 0.30,
            }
        },
    }
    raw, changed = _migrate_config(dict(cfg))

    assert changed is False
    assert raw["backend_thresholds"]["insightface"]["match_threshold"] == 0.42
    # A custom block is authoritative; the flat key is left as-is (inert).
    assert raw["match_threshold"] == 0.6


def test_migration_preserves_other_backend_blocks():
    cfg = {
        "match_threshold": 0.6,
        "backend_thresholds": {
            "dlib": {"match_threshold": 0.54, "ignore_distance": 0.48, "hard_negative_distance": 0.45}
        },
    }
    raw, changed = _migrate_config(cfg)

    assert changed is True
    assert "insightface" in raw["backend_thresholds"]
    assert raw["backend_thresholds"]["dlib"]["match_threshold"] == 0.54


def test_migration_noop_without_flat_keys():
    cfg = {"min_confidence": 0.5, "backend": {"type": "insightface"}}
    raw, changed = _migrate_config(dict(cfg))
    assert changed is False
    assert "backend_thresholds" not in raw


# --------------------------------------------------------------------------
# _migrate_config — v3 match_threshold 0.40 -> 0.45 (face-recognition audit)
# --------------------------------------------------------------------------

def _audit_era_config():
    # The owner's live v2 config: canonical block pinned to the audit-era 0.40.
    return {
        "backend_thresholds": {
            "insightface": {
                "match_threshold": 0.4,
                "ignore_distance": 0.35,
                "hard_negative_distance": 0.32,
            }
        },
        "config_version": 2,
    }


def test_migration_v3_raises_audit_era_threshold():
    raw, changed = _migrate_config(_audit_era_config())

    assert changed is True
    assert raw["backend_thresholds"]["insightface"]["match_threshold"] == 0.45
    # Sibling thresholds are left untouched.
    assert raw["backend_thresholds"]["insightface"]["ignore_distance"] == 0.35
    assert raw["backend_thresholds"]["insightface"]["hard_negative_distance"] == 0.32
    assert raw["config_version"] == CONFIG_VERSION


def test_migration_v3_leaves_custom_threshold_untouched():
    # A user-customized value (0.42) is NOT the audit-era default -> not lifted.
    cfg = {
        "backend_thresholds": {
            "insightface": {
                "match_threshold": 0.42,
                "ignore_distance": 0.35,
                "hard_negative_distance": 0.32,
            }
        },
        "config_version": 2,
    }
    raw, changed = _migrate_config(dict(cfg))

    assert changed is False
    assert raw["backend_thresholds"]["insightface"]["match_threshold"] == 0.42


def test_migration_v3_is_idempotent():
    once, changed1 = _migrate_config(_audit_era_config())
    twice, changed2 = _migrate_config(once)

    assert changed1 is True
    assert changed2 is False
    assert twice["backend_thresholds"]["insightface"]["match_threshold"] == 0.45


def test_migration_v3_noop_when_already_current():
    # A config already at the current canonical 0.45 needs no migration.
    cfg = {
        "backend_thresholds": {
            "insightface": dict(COSINE_DEFAULT_THRESHOLDS),
        },
        "config_version": CONFIG_VERSION,
    }
    raw, changed = _migrate_config(dict(cfg))

    assert changed is False
    assert raw["backend_thresholds"]["insightface"]["match_threshold"] == 0.45


def test_load_config_fresh_default_already_at_045(tmp_path, monkeypatch):
    # A fresh default config is written at 0.45 and needs no migration.
    cfg_path = tmp_path / "config.json"
    monkeypatch.setattr(config_mod, "CONFIG_PATH", cfg_path)
    monkeypatch.setattr(config_mod, "BASE_DIR", tmp_path)

    merged = load_config()

    assert merged["backend_thresholds"]["insightface"]["match_threshold"] == 0.45
    on_disk = json.loads(cfg_path.read_text(encoding="utf-8"))
    assert on_disk["backend_thresholds"]["insightface"]["match_threshold"] == 0.45


# --------------------------------------------------------------------------
# load_config persistence
# --------------------------------------------------------------------------

def test_load_config_persists_migration(tmp_path, monkeypatch):
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text(json.dumps(_legacy_config()), encoding="utf-8")
    monkeypatch.setattr(config_mod, "CONFIG_PATH", cfg_path)
    monkeypatch.setattr(config_mod, "BASE_DIR", tmp_path)

    merged = load_config()

    # Returned (merged) config uses the canonical thresholds.
    assert merged["backend_thresholds"]["insightface"] == COSINE_DEFAULT_THRESHOLDS
    assert merged["config_version"] == CONFIG_VERSION

    # The migration was written back to disk (flat keys gone, block present).
    on_disk = json.loads(cfg_path.read_text(encoding="utf-8"))
    assert "match_threshold" not in on_disk
    assert on_disk["backend_thresholds"]["insightface"] == COSINE_DEFAULT_THRESHOLDS
    assert on_disk["config_version"] == CONFIG_VERSION


def test_load_config_fresh_default_needs_no_migration(tmp_path, monkeypatch):
    cfg_path = tmp_path / "config.json"
    monkeypatch.setattr(config_mod, "CONFIG_PATH", cfg_path)
    monkeypatch.setattr(config_mod, "BASE_DIR", tmp_path)

    merged = load_config()

    assert merged["config_version"] == CONFIG_VERSION
    on_disk = json.loads(cfg_path.read_text(encoding="utf-8"))
    assert on_disk["config_version"] == CONFIG_VERSION
    # Fresh default carries no legacy flat threshold keys.
    assert "match_threshold" not in on_disk
    assert "ignore_distance" not in on_disk
