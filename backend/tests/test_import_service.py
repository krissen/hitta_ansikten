"""Tests for ImportService.run_import terminal "done" event.

run_import broadcasts a final `import-progress` event with `phase: "done"` after
the transfer loop so the UI can render the completion summary even when the HTTP
response is lost (a long card import can outlive the request). These tests mock
broadcast_event and assert that event's shape, including eject outcome.
"""

import pytest

from api.services import import_service
from api.services.import_service import ImportService


def _capture_events(monkeypatch):
    """Patch broadcast_event to collect (event, payload) tuples."""
    events = []

    async def _capture(event, payload):
        events.append((event, payload))

    monkeypatch.setattr(import_service, "broadcast_event", _capture)
    return events


@pytest.mark.asyncio
async def test_run_import_broadcasts_done_event(tmp_path, monkeypatch):
    events = _capture_events(monkeypatch)

    src = tmp_path / "card"
    src.mkdir()
    (src / "DSC0001.NEF").write_bytes(b"raw-1")
    (src / "DSC0002.NEF").write_bytes(b"raw-2")
    dest = tmp_path / "dest"

    result = await ImportService().run_import(
        volume_mount=str(src),
        destination=str(dest),
        mode="copy",
        eject=False,
    )

    done = [payload for name, payload in events if payload.get("phase") == "done"]
    assert len(done) == 1
    ev = done[0]
    assert ev == {
        "phase": "done",
        "transferred": 2,
        "skipped": 0,
        "errors": 0,
        "ejected": False,
        "eject_error": None,
        "destination": str(dest),
        "total": 2,
    }
    # The event mirrors the returned counts.
    assert len(result["transferred"]) == 2
    assert result["eject_error"] is None


@pytest.mark.asyncio
async def test_run_import_done_event_reports_eject_failure(tmp_path, monkeypatch):
    events = _capture_events(monkeypatch)

    src = tmp_path / "card"
    src.mkdir()
    (src / "DSC0001.NEF").write_bytes(b"raw-1")
    dest = tmp_path / "dest"

    svc = ImportService()
    # Force the eject path: volume looks ejectable but diskutil fails (mirrors a
    # card held by another process, e.g. mscamerad).
    monkeypatch.setattr(svc, "_is_ejectable", lambda info: True)

    async def _failing_eject(mount):
        return False, "kortet används av en annan process"

    monkeypatch.setattr(svc, "_eject", _failing_eject)

    result = await svc.run_import(
        volume_mount=str(src),
        destination=str(dest),
        mode="copy",
        eject=True,
    )

    done = next(payload for name, payload in events if payload.get("phase") == "done")
    assert done["ejected"] is False
    assert done["eject_error"] == "kortet används av en annan process"
    assert result["ejected"] is False
    assert result["eject_error"] == "kortet används av en annan process"
