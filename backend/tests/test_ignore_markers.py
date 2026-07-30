"""Invariant matrix for the ignore-marker vocabulary (core.labels).

Four code paths used to filter "this label is not a person" with four different
inline mechanisms that disagreed. They now share ``core.labels``. This matrix is
what keeps them from diverging again: every marker, in both label forms
(``#N\\nmarker`` and bare), through every consolidated path.

Paths covered:
  * ``core.labels.is_ignore_name`` / ``is_ignore_label`` (the helpers)
  * ``core.db.extract_face_labels``
  * ``core.naming.collect_persons_for_files`` (CLI / naming path)
  * ``api.services.rename_service.collect_persons_for_files`` (rename path)
  * ``api.services.statistics_service.StatisticsService.calc_ignored_fraction``
"""

from unittest.mock import patch

import pytest

from api.services.rename_service import (
    collect_persons_for_files as rename_collect_persons,
)
from api.services.statistics_service import StatisticsService
from core.db import extract_face_labels
from core.labels import (
    CANONICAL_IGNORE_MARKER,
    IGNORE_MARKERS,
    is_ignore_label,
    is_ignore_name,
)
from core.naming import collect_persons_for_files as naming_collect_persons

# Every marker, plus the case and whitespace variants a hand-typed log carries.
MARKER_FORMS = [
    "ignorerad", "Ignorerad", "IGNORERAD", " ignorerad ",
    "ign", "IGN", " ign",
    "okänt", "Okänt", "OKÄNT",
    "okant", "Okant", " okant ",
]

# Names that must never count as markers. ``X ignorerad`` is the semantics
# change in statistics_service: the old endswith() match called it an ignore,
# the exact match calls it a person.
PERSON_FORMS = ["Elis Niemi", "Ignorerad Andersson", "X ignorerad", "ignorerade", "ignore"]


def _entry(filename, labels, file_hash="hash123"):
    """One accepted attempt-log entry with the given display labels."""
    return {
        "filename": str(filename),
        "file_hash": file_hash,
        "used_attempt": 0,
        "review_results": ["ok"],
        "labels_per_attempt": [[{"label": lbl} for lbl in labels]],
    }


# --------------------------------------------------------------------------
# 1. The vocabulary itself
# --------------------------------------------------------------------------

def test_marker_set_is_the_four_markers():
    assert IGNORE_MARKERS == frozenset({"ignorerad", "ign", "okänt", "okant"})


def test_written_marker_is_one_the_readers_accept():
    """Writers emit CANONICAL_IGNORE_MARKER; every reader must recognise it."""
    assert is_ignore_name(CANONICAL_IGNORE_MARKER)
    assert is_ignore_label(f"#1\n{CANONICAL_IGNORE_MARKER}")
    assert extract_face_labels([{"label": f"#1\n{CANONICAL_IGNORE_MARKER}"}]) == []


@pytest.mark.parametrize("marker", MARKER_FORMS)
def test_is_ignore_name_accepts_every_marker_form(marker):
    assert is_ignore_name(marker)


@pytest.mark.parametrize("marker", MARKER_FORMS)
def test_is_ignore_label_strips_the_index_prefix(marker):
    """Both label forms resolve to the same verdict — the prefix fix."""
    assert is_ignore_label(f"#3\n{marker}")
    assert is_ignore_label(marker)


@pytest.mark.parametrize("name", PERSON_FORMS)
def test_person_names_are_not_markers(name):
    assert not is_ignore_name(name)
    assert not is_ignore_label(name)
    assert not is_ignore_label(f"#1\n{name}")


def test_only_a_hash_digit_newline_prefix_is_stripped():
    """A newline that is not the ``#N`` display prefix is not a prefix."""
    assert not is_ignore_label("Anna\nignorerad")
    assert not is_ignore_label("#x\nignorerad")


# --------------------------------------------------------------------------
# 2. core.db.extract_face_labels — prefixed labels only
# --------------------------------------------------------------------------

@pytest.mark.parametrize("marker", MARKER_FORMS)
def test_extract_face_labels_drops_every_marker(marker):
    labels = [{"label": "#1\nElis Niemi"}, {"label": f"#2\n{marker}"}]
    assert extract_face_labels(labels) == ["Elis Niemi"]
    # Bare strings are accepted as well as dicts.
    assert extract_face_labels(["#1\nElis Niemi", f"#2\n{marker}"]) == ["Elis Niemi"]


@pytest.mark.parametrize("name", PERSON_FORMS)
def test_extract_face_labels_keeps_person_names(name):
    assert extract_face_labels([{"label": f"#1\n{name}"}]) == [name]


# --------------------------------------------------------------------------
# 3. core.naming.collect_persons_for_files
# --------------------------------------------------------------------------

@pytest.mark.parametrize("marker", MARKER_FORMS)
def test_naming_collect_persons_drops_every_marker(tmp_path, marker):
    test_file = tmp_path / "260701_100000.NEF"
    test_file.touch()
    log = [_entry(test_file, ["#1\nElis Niemi", f"#2\n{marker}"])]

    with patch("core.naming.get_file_hash", return_value="hash123"):
        result = naming_collect_persons([str(test_file)], {}, processed_files=[], attempt_log=log)

    assert result[test_file.name] == ["Elis Niemi"]


@pytest.mark.parametrize("name", PERSON_FORMS)
def test_naming_collect_persons_keeps_person_names(tmp_path, name):
    test_file = tmp_path / "260701_100000.NEF"
    test_file.touch()
    log = [_entry(test_file, [f"#1\n{name}"])]

    with patch("core.naming.get_file_hash", return_value="hash123"):
        result = naming_collect_persons([str(test_file)], {}, processed_files=[], attempt_log=log)

    assert result[test_file.name] == [name]


# --------------------------------------------------------------------------
# 4. rename path
# --------------------------------------------------------------------------

@pytest.mark.parametrize("marker", MARKER_FORMS)
def test_rename_collect_persons_drops_every_marker(tmp_path, marker):
    test_file = tmp_path / "260701_100000.NEF"
    test_file.touch()
    log = [_entry(test_file, ["#1\nElis Niemi", f"#2\n{marker}"])]

    with patch("api.services.rename_service.get_file_hash", return_value="hash123"):
        result = rename_collect_persons([str(test_file)], {}, attempt_log=log)

    assert result[str(test_file)] == ["Elis Niemi"]


@pytest.mark.parametrize("name", PERSON_FORMS)
def test_rename_collect_persons_keeps_person_names(tmp_path, name):
    test_file = tmp_path / "260701_100000.NEF"
    test_file.touch()
    log = [_entry(test_file, [f"#1\n{name}"])]

    with patch("api.services.rename_service.get_file_hash", return_value="hash123"):
        result = rename_collect_persons([str(test_file)], {}, attempt_log=log)

    assert result[str(test_file)] == [name]


# --------------------------------------------------------------------------
# 5. statistics — the path that used to undercount
# --------------------------------------------------------------------------

@pytest.mark.parametrize("marker", MARKER_FORMS)
def test_calc_ignored_fraction_counts_every_prefixed_marker(marker):
    """``#N\\nign`` and friends now count; before the fix only ``ignorerad`` did."""
    stats = [_entry("260701_100000.NEF", ["#1\nElis Niemi", f"#2\n{marker}"])]

    ignored, total, frac = StatisticsService().calc_ignored_fraction(stats)

    assert (ignored, total) == (1, 2)
    assert frac == 0.5


@pytest.mark.parametrize("marker", MARKER_FORMS)
def test_calc_ignored_fraction_counts_unprefixed_markers_too(marker):
    stats = [_entry("260701_100000.NEF", ["Elis Niemi", marker])]

    ignored, total, _ = StatisticsService().calc_ignored_fraction(stats)

    assert (ignored, total) == (1, 2)


@pytest.mark.parametrize("name", PERSON_FORMS)
def test_calc_ignored_fraction_does_not_count_person_names(name):
    """Exact matching: ``X ignorerad`` was an ignore under endswith(), not now."""
    stats = [_entry("260701_100000.NEF", [f"#1\n{name}"])]

    ignored, total, frac = StatisticsService().calc_ignored_fraction(stats)

    assert (ignored, total, frac) == (0, 1, 0)


# --------------------------------------------------------------------------
# 6. Cross-path agreement — the actual invariant
# --------------------------------------------------------------------------

@pytest.mark.parametrize("marker", MARKER_FORMS)
def test_all_paths_agree_on_every_marker(tmp_path, marker):
    """One label, four paths, one verdict: marker in, no person out, one ignore counted."""
    test_file = tmp_path / "260701_100000.NEF"
    test_file.touch()
    labels = [f"#1\n{marker}"]
    log = [_entry(test_file, labels)]

    assert extract_face_labels([{"label": labels[0]}]) == []

    with patch("core.naming.get_file_hash", return_value="hash123"):
        naming_result = naming_collect_persons(
            [str(test_file)], {}, processed_files=[], attempt_log=log
        )
    assert naming_result[test_file.name] == []

    with patch("api.services.rename_service.get_file_hash", return_value="hash123"):
        rename_result = rename_collect_persons([str(test_file)], {}, attempt_log=log)
    assert rename_result[str(test_file)] == []

    assert StatisticsService().calc_ignored_fraction(log) == (1, 1, 1.0)
