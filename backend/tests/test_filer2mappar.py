"""Tests for filer2mappar's source-folder matching mode."""

import json
from pathlib import Path

import pytest

import filer2mappar


def _write(path: Path, contents: bytes = b"image") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents)
    return path


def test_exact_match_mirrors_nested_source_folder(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "260801" / "utflykt" / "260801_120000_original.NEF")
    developed = _write(target / "260801_120000_Anna.jpg")

    safe, guessed, unresolved = filer2mappar.compute_matched_moves(source, target, 30)

    assert safe == [
        (
            developed,
            target / "260801" / "utflykt" / developed.name,
        )
    ]
    assert guessed == []
    assert unresolved == []


def test_source_image_at_root_marks_developed_image_as_already_placed(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "260801_120000.NEF")
    developed = _write(target / "260801_120000_Anna.jpg")

    safe, guessed, unresolved = filer2mappar.compute_matched_moves(source, target, 30)

    assert safe == []
    assert guessed == []
    assert unresolved == []
    assert developed.exists()


def test_root_source_participates_in_nearest_source_guess(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "shoot" / "260801_120000.NEF")
    _write(source / "260801_121000.NEF")
    _write(source / "shoot" / "260801_122000.NEF")
    _write(target / "260801_120000.jpg")
    uncertain = _write(target / "260801_121100.jpg")
    _write(target / "260801_122000.jpg")

    _safe, guessed, unresolved = filer2mappar.compute_matched_moves(source, target, 30)

    assert guessed == []
    assert unresolved == [uncertain]


def test_multiple_source_formats_in_one_folder_are_still_unambiguous(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    folder = source / "shoot"
    _write(folder / "260801_120000.NEF")
    _write(folder / "260801_120000.jpg")
    developed = _write(target / "260801_120000_changed.tiff")

    safe, guessed, unresolved = filer2mappar.compute_matched_moves(source, target, 30)

    assert safe == [(developed, target / "shoot" / developed.name)]
    assert guessed == []
    assert unresolved == []


def test_same_timestamp_in_different_source_folders_is_unresolved(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "one" / "260801_120000.NEF")
    _write(source / "two" / "260801_120000.jpg")
    developed = _write(target / "260801_120000.jpg")

    safe, guessed, unresolved = filer2mappar.compute_matched_moves(source, target, 30)

    assert safe == []
    assert guessed == []
    assert unresolved == [developed]


def test_guess_requires_nearest_source_and_both_exact_neighbours_to_agree(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    folder = source / "shoot"
    _write(folder / "260801_120000.NEF")
    _write(folder / "260801_121000.NEF")
    _write(folder / "260801_122000.NEF")
    _write(target / "260801_120000.jpg")
    uncertain = _write(target / "260801_121100_changed.jpg")
    _write(target / "260801_122000.jpg")

    safe, guessed, unresolved = filer2mappar.compute_matched_moves(source, target, 30)

    assert len(safe) == 2
    assert guessed == [(uncertain, target / "shoot" / uncertain.name, 60)]
    assert unresolved == []


def test_guess_respects_time_window(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    folder = source / "shoot"
    _write(folder / "260801_120000.NEF")
    _write(folder / "260801_140000.NEF")
    _write(target / "260801_120000.jpg")
    uncertain = _write(target / "260801_130000.jpg")
    _write(target / "260801_140000.jpg")

    _safe, guessed, unresolved = filer2mappar.compute_matched_moves(source, target, 30)

    assert guessed == []
    assert unresolved == [uncertain]


def test_second_run_can_use_safe_images_already_moved_to_subfolders(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    folder = source / "shoot"
    for token in ("260801_120000", "260801_121000", "260801_122000"):
        _write(folder / f"{token}.NEF")
    _write(target / "shoot" / "260801_120000.jpg")
    uncertain = _write(target / "260801_121100.jpg")
    _write(target / "shoot" / "260801_122000.jpg")

    safe, guessed, unresolved = filer2mappar.compute_matched_moves(source, target, 30)

    assert safe == []
    assert guessed == [(uncertain, target / "shoot" / uncertain.name, 60)]
    assert unresolved == []


def test_match_command_moves_safe_and_journals_sidecar(tmp_path, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "shoot" / "260801_120000.NEF")
    developed = _write(target / "260801_120000_name.jpg")
    sidecar = _write(target / "260801_120000_name.xmp", b"sidecar")

    result = filer2mappar.main(["matcha-kalla", "--kallrot", str(source), "--malrot", str(target)])

    assert result == 0
    assert not developed.exists()
    assert not sidecar.exists()
    assert (target / "shoot" / developed.name).exists()
    assert (target / "shoot" / sidecar.name).read_bytes() == b"sidecar"
    journal = tmp_path / "rename_journal.jsonl"
    row = json.loads(journal.read_text().strip())
    assert row["op"] == "move"
    assert row["tool"] == "filer2mappar-matcha-kalla"
    assert row["sidecars"] == [
        {
            "src": str(sidecar),
            "dst": str(target / "shoot" / sidecar.name),
        }
    ]
    assert "Flyttade 1 bilder." in capsys.readouterr().out


def test_match_command_reports_guess_and_requires_opt_in(tmp_path, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    folder = source / "shoot"
    for token in ("260801_120000", "260801_121000", "260801_122000"):
        _write(folder / f"{token}.jpg")
    _write(target / "260801_120000.jpg")
    uncertain = _write(target / "260801_121100.jpg")
    _write(target / "260801_122000.jpg")

    result = filer2mappar.main(
        [
            "matcha-kalla",
            "--dry-run",
            "--kallrot",
            str(source),
            "--malrot",
            str(target),
        ]
    )

    output = capsys.readouterr().out
    assert result == 0
    assert uncertain.exists()
    assert "--flytta-osakra" in output
    assert "närmaste källa 60 s bort" in output


def test_match_command_moves_guess_only_after_opt_in_on_second_run(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    folder = source / "shoot"
    for token in ("260801_120000", "260801_121000", "260801_122000"):
        _write(folder / f"{token}.jpg")
    _write(target / "260801_120000.jpg")
    uncertain = _write(target / "260801_121100.jpg")
    _write(target / "260801_122000.jpg")
    common_args = ["--kallrot", str(source), "--malrot", str(target)]

    assert filer2mappar.main(["matcha-kalla", *common_args]) == 0
    assert uncertain.exists()
    assert filer2mappar.main(["matcha-kalla", "--flytta-osakra", *common_args]) == 0
    assert not uncertain.exists()
    assert (target / "shoot" / uncertain.name).exists()


def test_match_command_never_overwrites_existing_target(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "shoot" / "260801_120000.NEF")
    developed = _write(target / "260801_120000.jpg", b"new")
    occupied = _write(target / "shoot" / developed.name, b"old")

    result = filer2mappar.main(["matcha-kalla", "--kallrot", str(source), "--malrot", str(target)])

    assert result == 1
    assert developed.read_bytes() == b"new"
    assert occupied.read_bytes() == b"old"


def test_match_dry_run_reports_occupied_sidecar_target(tmp_path, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "shoot" / "260801_120000.NEF")
    developed = _write(target / "260801_120000.jpg")
    sidecar = _write(target / "260801_120000.xmp", b"new sidecar")
    occupied = _write(target / "shoot" / sidecar.name, b"old sidecar")

    result = filer2mappar.main(
        [
            "matcha-kalla",
            "--dry-run",
            "--kallrot",
            str(source),
            "--malrot",
            str(target),
        ]
    )

    output = capsys.readouterr()
    assert result == 1
    assert developed.exists()
    assert sidecar.read_bytes() == b"new sidecar"
    assert occupied.read_bytes() == b"old sidecar"
    assert "målet finns redan" in output.err
    assert f"(dry) {developed.name}" not in output.out


def test_match_dry_run_reports_dangling_symlink_target(tmp_path, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "shoot" / "260801_120000.NEF")
    developed = _write(target / "260801_120000.jpg")
    occupied = target / "shoot" / developed.name
    occupied.parent.mkdir()
    occupied.symlink_to(target / "missing.jpg")

    result = filer2mappar.main(
        [
            "matcha-kalla",
            "--dry-run",
            "--kallrot",
            str(source),
            "--malrot",
            str(target),
        ]
    )

    output = capsys.readouterr()
    assert result == 1
    assert developed.exists()
    assert occupied.is_symlink()
    assert "målet finns redan" in output.err
    assert f"(dry) {developed.name}" not in output.out


def test_match_command_reports_destination_directory_creation_failure(tmp_path, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "shoot" / "260801_120000.NEF")
    developed = _write(target / "260801_120000.jpg")
    blocker = _write(target / "shoot", b"not a directory")

    result = filer2mappar.main(["matcha-kalla", "--kallrot", str(source), "--malrot", str(target)])

    assert result == 1
    assert developed.exists()
    assert blocker.read_bytes() == b"not a directory"
    assert "FEL: 260801_120000.jpg" in capsys.readouterr().err


def test_match_dry_run_reports_blocked_destination_parent(tmp_path, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "shoot" / "260801_120000.NEF")
    developed = _write(target / "260801_120000.jpg")
    blocker = _write(target / "shoot", b"not a directory")

    result = filer2mappar.main(
        [
            "matcha-kalla",
            "--dry-run",
            "--kallrot",
            str(source),
            "--malrot",
            str(target),
        ]
    )

    output = capsys.readouterr()
    assert result == 1
    assert developed.exists()
    assert blocker.read_bytes() == b"not a directory"
    assert "sökväg blockeras av en fil" in output.err
    assert f"(dry) {developed.name}" not in output.out


def test_match_dry_run_reports_unwritable_destination_parent(tmp_path, monkeypatch, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "shoot" / "260801_120000.NEF")
    developed = _write(target / "260801_120000.jpg")
    real_access = filer2mappar.os.access
    monkeypatch.setattr(
        filer2mappar.os,
        "access",
        lambda path, mode: False if path == target else real_access(path, mode),
    )

    result = filer2mappar.main(
        [
            "matcha-kalla",
            "--dry-run",
            "--kallrot",
            str(source),
            "--malrot",
            str(target),
        ]
    )

    output = capsys.readouterr()
    assert result == 1
    assert developed.exists()
    assert "målkatalogen är inte skrivbar" in output.err
    assert f"(dry) {developed.name}" not in output.out


def test_unresolved_suggests_sixty_minute_window(tmp_path, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    source.mkdir()
    unresolved = _write(target / "260801_120000.jpg")

    result = filer2mappar.main(["matcha-kalla", "--kallrot", str(source), "--malrot", str(target)])

    assert result == 1
    assert unresolved.exists()
    assert "--tidsfonster 60" in capsys.readouterr().err


def test_match_command_rejects_overlapping_source_and_target_roots(tmp_path, capsys):
    source = tmp_path / "nerladdat"
    target = source / "framkallat"
    original = _write(target / "260801_120000.jpg")

    result = filer2mappar.main(["matcha-kalla", "--kallrot", str(source), "--malrot", str(target)])

    assert result == 1
    assert original.exists()
    assert "får inte överlappa" in capsys.readouterr().err


def test_non_images_in_target_root_are_ignored(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    source.mkdir()
    _write(target / ".DS_Store")

    safe, guessed, unresolved = filer2mappar.compute_matched_moves(source, target, 30)

    assert safe == []
    assert guessed == []
    assert unresolved == []


def test_legacy_date_folder_mode_still_moves_and_journals(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    original = _write(tmp_path / "260801_120000.NEF")

    result = filer2mappar.main(["*.NEF"])

    moved = tmp_path / "260801" / original.name
    assert result == 0
    assert moved.exists()
    row = json.loads((tmp_path / "rename_journal.jsonl").read_text().strip())
    assert row["op"] == "move"
    assert row["tool"] == "filer2mappar"


def test_legacy_date_mode_keeps_main_and_sidecar_atomic_on_collision(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    original = _write(tmp_path / "260801_120000.NEF", b"new")
    sidecar = _write(tmp_path / "260801_120000.xmp", b"sidecar")
    occupied = _write(tmp_path / "260801" / original.name, b"old")

    result = filer2mappar.main(["*.NEF"])

    assert result == 0
    assert original.read_bytes() == b"new"
    assert sidecar.read_bytes() == b"sidecar"
    assert occupied.read_bytes() == b"old"
    assert not (tmp_path / "260801" / sidecar.name).exists()
    assert not (tmp_path / "rename_journal.jsonl").exists()


def test_legacy_date_mode_assigns_shared_stem_sidecar_once(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    raw = _write(tmp_path / "260801_120000.NEF")
    jpeg = _write(tmp_path / "260801_120000.jpg")
    sidecar = _write(tmp_path / "260801_120000.xmp")

    result = filer2mappar.main(["*.NEF", "*.jpg"])

    target = tmp_path / "260801"
    assert result == 0
    assert (target / raw.name).exists()
    assert (target / jpeg.name).exists()
    assert (target / sidecar.name).exists()
    rows = [
        json.loads(line) for line in (tmp_path / "rename_journal.jsonl").read_text().splitlines()
    ]
    assert len(rows) == 2
    assert sum(len(row["sidecars"]) for row in rows) == 1


def test_legacy_dry_run_reports_occupied_sidecar_target(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    original = _write(tmp_path / "260801_120000.NEF")
    sidecar = _write(tmp_path / "260801_120000.xmp", b"new sidecar")
    occupied = _write(tmp_path / "260801" / sidecar.name, b"old sidecar")

    result = filer2mappar.main(["--dry-run", "*.NEF"])

    output = capsys.readouterr()
    assert result == 0
    assert original.exists()
    assert sidecar.read_bytes() == b"new sidecar"
    assert occupied.read_bytes() == b"old sidecar"
    assert "målet finns redan" in output.err
    assert f"(dry) {original.name}" not in output.out


def test_top_level_help_advertises_source_matching(capsys):
    with pytest.raises(SystemExit) as exit_info:
        filer2mappar.main(["--help"])

    output = capsys.readouterr().out
    assert exit_info.value.code == 0
    assert "matcha-kalla" in output
    assert "matcha-kalla --help" in output


def test_selection_moves_only_the_named_files(tmp_path, monkeypatch, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "260801" / "utflykt" / "260801_120000.NEF")
    _write(source / "260802" / "cup" / "260802_090000.NEF")
    chosen = _write(target / "260801_120000-0_Elis.jpg")
    untouched = _write(target / "260802_090000-0_Ellen.jpg")
    monkeypatch.chdir(target)

    result = filer2mappar.main(
        [
            "matcha-kalla",
            "--kallrot",
            str(source),
            "--malrot",
            str(target),
            chosen.name,
        ]
    )

    capsys.readouterr()
    assert result == 0
    assert (target / "260801" / "utflykt" / chosen.name).exists()
    assert not chosen.exists()
    assert untouched.exists()


def test_selection_keeps_full_evidence_for_guesses(tmp_path, monkeypatch, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    folder = source / "shoot"
    _write(folder / "260801_120000.NEF")
    _write(folder / "260801_121000.NEF")
    _write(folder / "260801_122000.NEF")
    _write(target / "260801_120000.jpg")
    uncertain = _write(target / "260801_121100_changed.jpg")
    _write(target / "260801_122000.jpg")
    monkeypatch.chdir(target)

    result = filer2mappar.main(
        [
            "matcha-kalla",
            "--kallrot",
            str(source),
            "--malrot",
            str(target),
            "--flytta-osakra",
            uncertain.name,
        ]
    )

    output = capsys.readouterr().out
    assert result == 0
    assert "Säkra: 0, osäkra förslag: 1" in output
    assert (target / "shoot" / uncertain.name).exists()
    assert (target / "260801_120000.jpg").exists()


def test_selection_rejects_files_outside_the_target_root(tmp_path, monkeypatch, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "260801" / "utflykt" / "260801_120000.NEF")
    developed = _write(target / "260801_120000-0_Elis.jpg")
    outside = _write(tmp_path / "annat" / "260801_120000-1_Elis.jpg")
    monkeypatch.chdir(tmp_path)

    result = filer2mappar.main(
        [
            "matcha-kalla",
            "--kallrot",
            str(source),
            "--malrot",
            str(target),
            str(outside),
        ]
    )

    output = capsys.readouterr()
    assert result == 1
    assert "ligger inte direkt i målroten" in output.err
    assert developed.exists()
    assert outside.exists()


def test_selection_without_matches_reports_the_pattern(tmp_path, monkeypatch, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "260801" / "utflykt" / "260801_120000.NEF")
    developed = _write(target / "260801_120000-0_Elis.jpg")
    monkeypatch.chdir(target)

    result = filer2mappar.main(
        [
            "matcha-kalla",
            "--kallrot",
            str(source),
            "--malrot",
            str(target),
            "*.tif",
        ]
    )

    output = capsys.readouterr()
    assert result == 1
    assert "ingen fil matchar" in output.err
    assert developed.exists()
