"""
Tests for the manual filename suffix feature.

Covers:
1. normalize_suffix rules (spaces -> _, diacritics folded, path chars, empty)
2. set/get/clear round-trip via a temporary store
3. build_new_filename_with_config with/without faces and suffix
"""

import pytest

from api.services import manual_suffix_service as mss
from api.services.manual_suffix_service import normalize_suffix
from api.services.rename_service import build_new_filename_with_config


# ---------------------------------------------------------------------------
# normalize_suffix
# ---------------------------------------------------------------------------

class TestNormalizeSuffix:
    def test_spaces_to_underscore(self):
        assert normalize_suffix("blå bär") == "bla_bar"

    def test_diacritics_folded(self):
        # å/ä -> a, ö -> o
        assert normalize_suffix("vinbär") == "vinbar"
        assert normalize_suffix("Åke Öberg") == "Ake_Oberg"

    def test_runs_of_whitespace_collapse(self):
        assert normalize_suffix("  a   b  ") == "a_b"

    def test_path_chars_sanitized(self):
        # path separators are replaced then collapsed/trimmed away
        assert normalize_suffix("a/b\\c") == "a_b_c"
        assert normalize_suffix("/etc/passwd") == "etc_passwd"

    def test_empty_and_whitespace(self):
        assert normalize_suffix("") == ""
        assert normalize_suffix("   ") == ""
        assert normalize_suffix(None) == ""

    def test_path_only_is_empty(self):
        # collapses to a single underscore, then trimmed to ''
        assert normalize_suffix("///") == ""

    def test_dot_runs_collapsed(self):
        # No '..' traversal token survives (build_new_filename_with_config's
        # guard would otherwise reject it after the preview showed it as valid).
        assert normalize_suffix("sommar..24") == "sommar_24"
        assert normalize_suffix("a...b") == "a_b"
        assert normalize_suffix("...") == ""
        assert ".." not in normalize_suffix("x....y")


# ---------------------------------------------------------------------------
# store round-trip
# ---------------------------------------------------------------------------

class TestStoreRoundTrip:
    @pytest.fixture
    def temp_store(self, tmp_path, monkeypatch):
        store = tmp_path / "manual_suffixes.json"
        monkeypatch.setattr(mss, "MANUAL_SUFFIX_PATH", store)
        return store

    def test_set_get(self, temp_store):
        mss.set_manual_suffix("abc123", "vinbär")
        assert mss.get_manual_suffix("abc123") == "vinbär"

    def test_get_missing_returns_none(self, temp_store):
        assert mss.get_manual_suffix("nope") is None

    def test_clear_with_empty(self, temp_store):
        mss.set_manual_suffix("abc123", "vinbär")
        mss.set_manual_suffix("abc123", "")
        assert mss.get_manual_suffix("abc123") is None

    def test_clear_with_whitespace(self, temp_store):
        mss.set_manual_suffix("abc123", "vinbär")
        mss.set_manual_suffix("abc123", "   ")
        assert mss.get_manual_suffix("abc123") is None

    def test_missing_file_returns_empty_dict(self, temp_store):
        # store never written yet
        assert mss.load_manual_suffixes() == {}

    def test_corrupt_file_returns_empty_dict(self, temp_store):
        temp_store.write_text("{ not json", encoding="utf-8")
        assert mss.load_manual_suffixes() == {}

    def test_none_hash_is_noop(self, temp_store):
        mss.set_manual_suffix(None, "x")
        assert mss.load_manual_suffixes() == {}
        assert mss.get_manual_suffix(None) is None


# ---------------------------------------------------------------------------
# build_new_filename_with_config
# ---------------------------------------------------------------------------

class TestBuildFilenameWithSuffix:
    def test_faces_plus_suffix_appended_last(self):
        # Config joins names with ",_"; suffix must come AFTER person names.
        new_name = build_new_filename_with_config(
            "260401_140101.jpg",
            ["Anna Svensson"],
            {"Anna Svensson": "Anna"},
            None,
            None,
            manual_suffix="vinbär",
        )
        assert new_name == "260401_140101_Anna,_vinbar.jpg"

    def test_suffix_only_no_faces_still_renames(self):
        new_name = build_new_filename_with_config(
            "260401_140101.jpg",
            [],
            {},
            None,
            None,
            manual_suffix="vinbär",
        )
        assert new_name == "260401_140101_vinbar.jpg"

    def test_no_faces_no_suffix_returns_none(self):
        new_name = build_new_filename_with_config(
            "260401_140101.jpg",
            [],
            {},
            None,
            None,
        )
        assert new_name is None

    def test_empty_suffix_with_no_faces_returns_none(self):
        new_name = build_new_filename_with_config(
            "260401_140101.jpg",
            [],
            {},
            None,
            None,
            manual_suffix="   ",
        )
        assert new_name is None
