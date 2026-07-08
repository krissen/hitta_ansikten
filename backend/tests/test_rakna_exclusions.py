"""Always-excluded markers in räkna spelare: Laget/FBK (group) and Klacken
(audience) are never counted as players, regardless of config or count."""

from rakna_spelare import (
    ALWAYS_GRUPP,
    ALWAYS_PUBLIK,
    compute_player_stats,
    resolve_exclusion_sets,
)


def test_always_markers_present_with_explicit_empty_overrides():
    # Explicit [] overrides skip env/config, so the result is purely the
    # built-in ALWAYS markers — deterministic regardless of the host config.
    tranare, publik, grupp = resolve_exclusion_sets(tranare=[], publik=[], grupp=[])
    assert tranare == set()
    assert {"Laget", "FBK"} <= grupp
    assert "Klacken" in publik
    assert ALWAYS_GRUPP <= grupp
    assert ALWAYS_PUBLIK <= publik


def _names(bucket):
    return {e["name"] for e in bucket}


def test_fbk_klacken_laget_always_excluded_even_above_threshold():
    # FBK appears many times (well above min_images) but must still be excluded
    # as a group photo, never a player. Same for Klacken (audience) and Laget.
    files = [
        "260601_120000_Anna.jpg",
        "260601_120100_Anna.jpg",
        "260601_120200_Anna.jpg",
        "260601_120300_FBK.jpg",
        "260601_120400_FBK.jpg",
        "260601_120500_FBK.jpg",
        "260601_120600_FBK.jpg",
        "260601_120700_Klacken.jpg",
        "260601_120800_Klacken.jpg",
        "260601_120900_Klacken.jpg",
        "260601_121000_Laget.jpg",
    ]
    tranare, publik, grupp = resolve_exclusion_sets(tranare=[], publik=[], grupp=[])
    stats = compute_player_stats(
        files,
        min_images=3,
        tranare_set=tranare,
        publik_set=publik,
        grupp_set=grupp,
    )

    player_names = {p["name"] for p in stats["players"]}
    assert player_names == {"Anna"}  # only the real player is counted

    assert "FBK" in _names(stats["excluded"]["grupp"])
    assert "Laget" in _names(stats["excluded"]["grupp"])
    assert "Klacken" in _names(stats["excluded"]["publik"])

    # And never leak into the players list or the below-threshold bucket.
    excluded_below = _names(stats["excluded"]["below_threshold"])
    for marker in ("FBK", "Klacken", "Laget"):
        assert marker not in player_names
        assert marker not in excluded_below
