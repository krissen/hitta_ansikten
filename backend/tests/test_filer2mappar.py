"""Tests for filer2mappar's source-folder matching mode."""

import json
from pathlib import Path

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

    assert safe == [(
        developed,
        target / "260801" / "utflykt" / developed.name,
    )]
    assert guessed == []
    assert unresolved == []


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

    result = filer2mappar.main([
        "matcha-kalla", "--kallrot", str(source), "--malrot", str(target)
    ])

    assert result == 0
    assert not developed.exists()
    assert not sidecar.exists()
    assert (target / "shoot" / developed.name).exists()
    assert (target / "shoot" / sidecar.name).read_bytes() == b"sidecar"
    journal = tmp_path / "rename_journal.jsonl"
    row = json.loads(journal.read_text().strip())
    assert row["op"] == "move"
    assert row["tool"] == "filer2mappar-matcha-kalla"
    assert row["sidecars"] == [{
        "src": str(sidecar),
        "dst": str(target / "shoot" / sidecar.name),
    }]
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

    result = filer2mappar.main([
        "matcha-kalla", "--dry-run", "--kallrot", str(source),
        "--malrot", str(target),
    ])

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
    assert filer2mappar.main([
        "matcha-kalla", "--flytta-osakra", *common_args
    ]) == 0
    assert not uncertain.exists()
    assert (target / "shoot" / uncertain.name).exists()


def test_match_command_never_overwrites_existing_target(tmp_path):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    _write(source / "shoot" / "260801_120000.NEF")
    developed = _write(target / "260801_120000.jpg", b"new")
    occupied = _write(target / "shoot" / developed.name, b"old")

    result = filer2mappar.main([
        "matcha-kalla", "--kallrot", str(source), "--malrot", str(target)
    ])

    assert result == 1
    assert developed.read_bytes() == b"new"
    assert occupied.read_bytes() == b"old"


def test_unresolved_suggests_sixty_minute_window(tmp_path, capsys):
    source = tmp_path / "nerladdat"
    target = tmp_path / "framkallat"
    source.mkdir()
    unresolved = _write(target / "260801_120000.jpg")

    result = filer2mappar.main([
        "matcha-kalla", "--kallrot", str(source), "--malrot", str(target)
    ])

    assert result == 1
    assert unresolved.exists()
    assert "--tidsfonster 60" in capsys.readouterr().err


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
