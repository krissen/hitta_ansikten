"""Tests for the label-usage analysis over the review log.

All fixtures are synthetic: a small fabricated JSONL written to tmp_path.
Nothing here touches the real attempt log in ``~/.local/share/faceid/``.

The point of these tests is that the script's published output — the numbers
that midi.md uses to size the button mapping — is otherwise only verifiable by
running it against one private corpus.
"""

from __future__ import annotations

import json

from benchmarks.label_usage import (
    IGNORE_LABEL,
    analyse,
    collect,
    label_name,
    load_records,
    names_only,
    shoot_key,
    top_coverage,
)

# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def make_label(index: int, name: str) -> dict:
    """Build a label entry in the log's display format."""
    return {"label": f"#{index}\n{name}", "hash": f"h{index}{name}"}


def make_record(
    filename: str,
    timestamp: str,
    names: list[str],
    review_results: list[str] | None = None,
) -> dict:
    """One review record with a single attempt carrying ``names``."""
    return {
        "timestamp": timestamp,
        "filename": filename,
        "file_hash": "deadbeef",
        "attempts": [{"attempt_index": 0}],
        "used_attempt": 0,
        "review_results": review_results if review_results is not None else ["ok"],
        "labels_per_attempt": [[make_label(i + 1, n) for i, n in enumerate(names)]],
    }


def write_log(tmp_path, records: list[dict]):
    path = tmp_path / "attempt_stats.jsonl"
    with open(path, "w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return path


# --------------------------------------------------------------------------
# label_name
# --------------------------------------------------------------------------


def test_label_name_strips_the_index_prefix():
    assert label_name(make_label(3, "Elis Niemi")) == "Elis Niemi"


def test_label_name_returns_empty_for_a_prefix_without_a_name():
    # The two malformed entries in the real corpus look exactly like this.
    assert label_name({"label": "#7\n"}) == ""
    assert label_name({"label": ""}) == ""


def test_label_name_accepts_a_bare_string_label():
    # core.db.extract_face_labels and core.naming both tolerate str labels.
    assert label_name("#2\nSan Ahmed") == "San Ahmed"


def test_label_name_ignores_non_string_payloads():
    assert label_name({"label": None}) == ""
    assert label_name({"label": 17}) == ""


def test_label_name_normalises_every_ignore_marker():
    # All markers fold into one bucket so none is ever counted as a person.
    for marker in ("ignorerad", "ign", "okänt", "okant", "IGNORERAD", "Okänt"):
        assert label_name({"label": f"#1\n{marker}"}) == IGNORE_LABEL


def test_label_name_keeps_a_name_that_merely_contains_a_marker():
    assert label_name({"label": "#1\nIgnatius Bergman"}) == "Ignatius Bergman"


# --------------------------------------------------------------------------
# shoot_key
# --------------------------------------------------------------------------


def test_shoot_key_groups_by_directory_and_date():
    record = make_record("/photos/match-a/1.NEF", "2026-05-01T10:00:00", ["A"])
    assert shoot_key(record) == ("/photos/match-a", "2026-05-01")


def test_shoot_key_separates_same_directory_on_different_days():
    a = make_record("/photos/x/1.NEF", "2026-05-01T10:00:00", ["A"])
    b = make_record("/photos/x/2.NEF", "2026-05-02T10:00:00", ["A"])
    assert shoot_key(a) != shoot_key(b)


def test_shoot_key_separates_same_day_in_different_directories():
    a = make_record("/photos/x/1.NEF", "2026-05-01T10:00:00", ["A"])
    b = make_record("/photos/y/1.NEF", "2026-05-01T11:00:00", ["A"])
    assert shoot_key(a) != shoot_key(b)


def test_shoot_key_tolerates_missing_fields():
    assert shoot_key({}) == ("", "")


# --------------------------------------------------------------------------
# names_only
# --------------------------------------------------------------------------


def test_names_only_drops_the_ignore_bucket():
    from collections import Counter

    counts = Counter({"Elis": 3, IGNORE_LABEL: 10, "San": 1})
    assert names_only(counts) == Counter({"Elis": 3, "San": 1})
    # The original is untouched — callers rely on the ignore count separately.
    assert counts[IGNORE_LABEL] == 10


# --------------------------------------------------------------------------
# top_coverage
# --------------------------------------------------------------------------


def test_top_coverage_computes_the_share_of_the_n_most_frequent():
    from collections import Counter

    counts = Counter({"a": 6, "b": 3, "c": 1})
    assert top_coverage(counts, 1) == 0.6
    assert top_coverage(counts, 2) == 0.9


def test_top_coverage_is_one_when_n_exceeds_the_population():
    from collections import Counter

    assert top_coverage(Counter({"a": 2, "b": 2}), 10) == 1.0


def test_top_coverage_returns_none_on_an_empty_counter():
    from collections import Counter

    # Guards the divide-by-zero path for a shoot with no names at all.
    assert top_coverage(Counter(), 8) is None


# --------------------------------------------------------------------------
# collect
# --------------------------------------------------------------------------


def test_collect_counts_labels_and_separates_the_ignore_bucket():
    records = [
        make_record("/p/a/1.NEF", "2026-05-01T10:00:00", ["Elis", "ignorerad"]),
        make_record("/p/a/2.NEF", "2026-05-01T10:01:00", ["Elis", "San"]),
    ]
    global_counts, per_shoot, totals = collect(records)

    assert totals["labels"] == 4
    assert totals["ignored"] == 1
    assert global_counts["Elis"] == 2
    assert len(per_shoot) == 1


def test_collect_excludes_malformed_labels_and_reports_the_count():
    records = [make_record("/p/a/1.NEF", "2026-05-01T10:00:00", ["Elis", ""])]
    _, _, totals = collect(records)

    # Excluded, not silently ignored: raw and net are both reported so the
    # discrepancy is visible rather than inferred.
    assert totals["labels_raw"] == 2
    assert totals["labels_empty"] == 1
    assert totals["labels"] == 1


def test_collect_counts_labels_from_every_attempt_not_just_the_used_one():
    # A retried attempt is real naming work and is counted.
    record = make_record("/p/a/1.NEF", "2026-05-01T10:00:00", ["Elis"])
    record["labels_per_attempt"].append([make_label(1, "San")])
    record["review_results"] = ["retry", "ok"]
    record["used_attempt"] = 1

    _, _, totals = collect([record])
    assert totals["labels"] == 2


def test_collect_counts_reviews_that_did_not_land_cleanly():
    records = [
        make_record("/p/a/1.NEF", "2026-05-01T10:00:00", ["Elis"], ["ok"]),
        make_record("/p/a/2.NEF", "2026-05-01T10:01:00", ["San"], ["retry"]),
        make_record("/p/a/3.NEF", "2026-05-01T10:02:00", ["Ada"], ["skipped"]),
    ]
    _, _, totals = collect(records)
    assert totals["non_ok_reviews"] == 2


def test_collect_handles_records_without_labels():
    records = [{"timestamp": "2026-05-01T10:00:00", "filename": "/p/a/1.NEF"}]
    global_counts, _, totals = collect(records)
    assert totals["labels"] == 0
    assert global_counts == {}


# --------------------------------------------------------------------------
# load_records
# --------------------------------------------------------------------------


def test_load_records_skips_malformed_and_blank_lines(tmp_path):
    path = tmp_path / "log.jsonl"
    path.write_text(
        '{"timestamp": "2026-05-01T10:00:00"}\nnot json\n\n{"timestamp": "x"}\n',
        encoding="utf-8",
    )
    assert len(load_records(path)) == 2


# --------------------------------------------------------------------------
# analyse — the end-to-end shape the report prints
# --------------------------------------------------------------------------


def test_analyse_applies_the_min_labels_threshold(tmp_path):
    # Shoot A has 4 namings, shoot B has 1. With a threshold of 2 only A counts.
    records = [
        make_record("/p/a/1.NEF", "2026-05-01T10:00:00", ["Elis", "San"]),
        make_record("/p/a/2.NEF", "2026-05-01T10:01:00", ["Elis", "Ada"]),
        make_record("/p/b/1.NEF", "2026-05-02T10:00:00", ["Nils"]),
    ]
    result = analyse(load_records(write_log(tmp_path, records)), min_labels=2, tops=[2])

    assert result["shoots_total"] == 2
    assert result["shoots_counted"] == 1
    assert result["unique_names"] == 4


def test_analyse_per_shoot_coverage_is_computed_within_the_shoot(tmp_path):
    # One shoot: Elis x3, San x1. Top-1 covers 3/4.
    records = [
        make_record("/p/a/1.NEF", "2026-05-01T10:00:00", ["Elis", "Elis"]),
        make_record("/p/a/2.NEF", "2026-05-01T10:01:00", ["Elis", "San"]),
    ]
    result = analyse(load_records(write_log(tmp_path, records)), min_labels=1, tops=[1])

    assert result["shoot_coverage"][1] == [0.75]
    assert result["unique_per_shoot"] == [2]


def test_analyse_keeps_the_ignore_bucket_out_of_coverage(tmp_path):
    # ignorerad must not dilute or inflate name coverage.
    records = [
        make_record("/p/a/1.NEF", "2026-05-01T10:00:00", ["Elis", "ignorerad"]),
        make_record("/p/a/2.NEF", "2026-05-01T10:01:00", ["ignorerad", "ignorerad"]),
    ]
    result = analyse(load_records(write_log(tmp_path, records)), min_labels=1, tops=[1])

    assert result["unique_names"] == 1
    assert result["totals"]["ignored"] == 3
    assert result["global_coverage"][1] == 1.0
