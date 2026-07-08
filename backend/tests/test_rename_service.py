"""
Tests for rename_service.collect_persons_for_files

Verifies that:
1. Hash-matched review data is used when available
2. Unique basename fallback works when hash is missing
3. Duplicate basenames are NOT used (prevents collision)
4. Encoding data is merged correctly with review data
"""

from unittest.mock import patch

from api.services.rename_service import collect_persons_for_files


class TestCollectPersonsForFiles:
    """Test suite for collect_persons_for_files function."""

    def test_hash_match_preferred_over_basename(self, tmp_path):
        """When hash matches, use that review data even if basename also matches."""
        known_faces = {}
        # Create a real file so Path.exists() returns True
        test_file = tmp_path / "IMG_0001.NEF"
        test_file.touch()
        filelist = [str(test_file)]

        attempt_log = [
            {
                "filename": "/other/IMG_0001.NEF",
                "file_hash": "different_hash",
                "used_attempt": 0,
                "review_results": ["ok"],
                "labels_per_attempt": [[{"label": "#1\nWrong Person"}]],
            },
            {
                "filename": str(test_file),
                "file_hash": "correct_hash",
                "used_attempt": 0,
                "review_results": ["ok"],
                "labels_per_attempt": [[{"label": "#1\nCorrect Person"}]],
            },
        ]

        with patch("api.services.rename_service.get_file_hash", return_value="correct_hash"):
            result = collect_persons_for_files(filelist, known_faces, attempt_log=attempt_log)

        assert result[str(test_file)] == ["Correct Person"]

    def test_unique_basename_fallback_when_no_hash(self, tmp_path):
        """When file_hash is None but basename is unique, use basename fallback."""
        known_faces = {}
        test_file = tmp_path / "unique_file.NEF"
        test_file.touch()
        filelist = [str(test_file)]

        attempt_log = [
            {
                "filename": str(test_file),
                "file_hash": None,
                "used_attempt": 0,
                "review_results": ["ok"],
                "labels_per_attempt": [[{"label": "#1\nSome Person"}]],
            },
        ]

        with patch("api.services.rename_service.get_file_hash", return_value=None):
            result = collect_persons_for_files(filelist, known_faces, attempt_log=attempt_log)

        assert result[str(test_file)] == ["Some Person"]

    def test_duplicate_basename_not_used(self, tmp_path):
        """When multiple entries have same basename, skip review data to avoid collision."""
        known_faces = {}
        folder_a = tmp_path / "folder_a"
        folder_a.mkdir()
        test_file = folder_a / "IMG_0001.NEF"
        test_file.touch()
        filelist = [str(test_file)]

        # attempt_log has two entries with same basename but different paths
        attempt_log = [
            {
                "filename": str(test_file),
                "file_hash": None,
                "used_attempt": 0,
                "review_results": ["ok"],
                "labels_per_attempt": [[{"label": "#1\nPerson A"}]],
            },
            {
                "filename": "/folder_b/IMG_0001.NEF",
                "file_hash": None,
                "used_attempt": 0,
                "review_results": ["ok"],
                "labels_per_attempt": [[{"label": "#1\nPerson B"}]],
            },
        ]

        with patch("api.services.rename_service.get_file_hash", return_value=None):
            result = collect_persons_for_files(filelist, known_faces, attempt_log=attempt_log)

        # Should be empty because basename is ambiguous (2 entries with IMG_0001.NEF)
        assert result[str(test_file)] == []

    def test_merge_review_with_encodings(self, tmp_path):
        """Review data should be merged with encoding data, review first."""
        test_file = tmp_path / "IMG_0001.NEF"
        test_file.touch()
        known_faces = {
            "Encoding Person": [{"file": "IMG_0001.NEF", "hash": "some_hash", "encoding": [0.1]}]
        }
        filelist = [str(test_file)]

        attempt_log = [
            {
                "filename": str(test_file),
                "file_hash": "some_hash",
                "used_attempt": 0,
                "review_results": ["ok"],
                "labels_per_attempt": [[{"label": "#1\nReview Person"}]],
            },
        ]

        with patch("api.services.rename_service.get_file_hash", return_value="some_hash"):
            result = collect_persons_for_files(filelist, known_faces, attempt_log=attempt_log)

        # Review person first, then encoding person added
        assert result[str(test_file)] == ["Review Person", "Encoding Person"]

    def test_encoding_only_when_no_review(self, tmp_path):
        """When no review data exists, use encoding data only."""
        test_file = tmp_path / "IMG_0001.NEF"
        test_file.touch()
        known_faces = {
            "Encoding Person": [{"file": "IMG_0001.NEF", "hash": "some_hash", "encoding": [0.1]}]
        }
        filelist = [str(test_file)]
        attempt_log = []

        with patch("api.services.rename_service.get_file_hash", return_value="some_hash"):
            result = collect_persons_for_files(filelist, known_faces, attempt_log=attempt_log)

        assert result[str(test_file)] == ["Encoding Person"]

    def test_manual_face_hash_only_not_suppressed_by_basename(self, tmp_path):
        """A manual face anchored only by hash must survive when another face matches
        by basename.

        Regression for the reported bug: after a file is renamed, the auto-detected
        face's encoding points to the current basename while the manually added face's
        encoding diverges (e.g. it still carries the pre-rename basename, or only a
        hash). The old fallback consulted the hash index only when the basename index
        was empty, so the basename hit for the detected face silently dropped the
        manual face. The lookup is now a union of both indexes.
        """
        test_file = tmp_path / "260111_080910_Aryan.NEF"
        test_file.touch()
        known_faces = {
            # Detected face: encoding basename matches the current filename.
            "Aryan": [{"file": "260111_080910_Aryan.NEF", "hash": "H", "encoding": [0.1]}],
            # Manual face: encoding basename has diverged, only the hash still matches.
            "Elis": [{"file": "260111_080910.NEF", "hash": "H",
                      "encoding": None, "is_manual": True}],
        }
        filelist = [str(test_file)]

        with patch("api.services.rename_service.get_file_hash", return_value="H"):
            result = collect_persons_for_files(filelist, known_faces, attempt_log=[])

        assert result[str(test_file)] == ["Aryan", "Elis"]

    def test_legacy_manual_face_hash_none_recovered_by_basename(self, tmp_path):
        """A legacy manual entry (hash=None) is still recovered via the basename index
        alongside a detected face on the same file."""
        test_file = tmp_path / "260111_080910_Aryan.NEF"
        test_file.touch()
        known_faces = {
            "Aryan": [{"file": "260111_080910_Aryan.NEF", "hash": "H", "encoding": [0.1]}],
            "Elis": [{"file": "260111_080910_Aryan.NEF", "hash": None,
                      "encoding": None, "is_manual": True}],
        }
        filelist = [str(test_file)]

        with patch("api.services.rename_service.get_file_hash", return_value="H"):
            result = collect_persons_for_files(filelist, known_faces, attempt_log=[])

        assert result[str(test_file)] == ["Aryan", "Elis"]

    def test_union_does_not_duplicate_when_both_keys_match(self, tmp_path):
        """A face matched by both basename and hash appears once, and merging with
        review data does not duplicate it."""
        test_file = tmp_path / "IMG_0001.NEF"
        test_file.touch()
        known_faces = {
            "Aryan": [{"file": "IMG_0001.NEF", "hash": "H", "encoding": [0.1]}],
        }
        filelist = [str(test_file)]
        attempt_log = [
            {
                "filename": str(test_file),
                "file_hash": "H",
                "used_attempt": 0,
                "review_results": ["ok"],
                "labels_per_attempt": [[{"label": "#1\nAryan"}]],
            },
        ]

        with patch("api.services.rename_service.get_file_hash", return_value="H"):
            result = collect_persons_for_files(filelist, known_faces, attempt_log=attempt_log)

        assert result[str(test_file)] == ["Aryan"]

    def test_ignored_labels_filtered(self, tmp_path):
        """Labels marked as ignored should not be included."""
        known_faces = {}
        test_file = tmp_path / "IMG_0001.NEF"
        test_file.touch()
        filelist = [str(test_file)]

        attempt_log = [
            {
                "filename": str(test_file),
                "file_hash": "hash123",
                "used_attempt": 0,
                "review_results": ["ok"],
                "labels_per_attempt": [[
                    {"label": "#1\nReal Person"},
                    {"label": "#2\nIgnorerad"},
                    {"label": "#3\nokänt"},
                ]],
            },
        ]

        with patch("api.services.rename_service.get_file_hash", return_value="hash123"):
            result = collect_persons_for_files(filelist, known_faces, attempt_log=attempt_log)

        assert result[str(test_file)] == ["Real Person"]
