"""Tests for core.exiftool.find_exiftool path resolution."""

import pytest

import core.exiftool as exiftool_mod
from core.exiftool import find_exiftool


def test_returns_path_from_which(monkeypatch):
    """A PATH hit via shutil.which is used verbatim."""
    monkeypatch.setattr(exiftool_mod.shutil, "which", lambda _: "/usr/bin/exiftool")
    assert find_exiftool() == "/usr/bin/exiftool"


def test_falls_back_to_known_location(monkeypatch):
    """With no PATH hit, a runnable well-known location is returned."""
    monkeypatch.setattr(exiftool_mod.shutil, "which", lambda _: None)
    monkeypatch.setattr(
        exiftool_mod, "_FALLBACK_PATHS", ("/opt/homebrew/bin/exiftool",)
    )
    monkeypatch.setattr(
        exiftool_mod.os.path, "isfile", lambda p: p == "/opt/homebrew/bin/exiftool"
    )
    monkeypatch.setattr(exiftool_mod.os, "access", lambda p, mode: True)

    assert find_exiftool() == "/opt/homebrew/bin/exiftool"


def test_missing_raises_file_not_found(monkeypatch):
    """No PATH hit and no existing fallback → FileNotFoundError."""
    monkeypatch.setattr(exiftool_mod.shutil, "which", lambda _: None)
    monkeypatch.setattr(exiftool_mod.os.path, "isfile", lambda p: False)

    with pytest.raises(FileNotFoundError):
        find_exiftool()
