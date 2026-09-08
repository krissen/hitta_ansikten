"""Tests for the actual-provider logging path in ``InsightFaceBackend``.

The app *requests* CoreML on macOS but insightface's ``prepare(ctx_id<0)``
resets every session to CPU, so the requested list is misleading. The backend
therefore logs the providers *actually* bound to each ONNX session
(``session.get_providers()``). These tests exercise that path with a mocked
session — no insightface, no real models — so they run on any platform, with a
macOS-gated variant that asserts the CPU-fallback is what surfaces on the real
platform contract.
"""

import logging
import platform

import pytest

from face_backends import InsightFaceBackend


class _FakeSession:
    def __init__(self, providers):
        self._providers = list(providers)

    def get_providers(self):
        return list(self._providers)


class _FakeModel:
    def __init__(self, providers):
        self.session = _FakeSession(providers)


class _FakeApp:
    def __init__(self, models):
        self.models = models


def _backend_with_models(models):
    """Build a backend instance without running the heavy __init__."""
    backend = InsightFaceBackend.__new__(InsightFaceBackend)
    backend.app = _FakeApp(models)
    return backend


def test_actual_providers_reports_bound_list():
    backend = _backend_with_models(
        {
            "detection": _FakeModel(["CoreMLExecutionProvider", "CPUExecutionProvider"]),
            "recognition": _FakeModel(["CPUExecutionProvider"]),
        }
    )
    actual = backend._actual_providers()
    assert actual == {
        "detection": ["CoreMLExecutionProvider", "CPUExecutionProvider"],
        "recognition": ["CPUExecutionProvider"],
    }


def test_actual_providers_handles_missing_session():
    class _NoSession:
        session = None

    backend = _backend_with_models({"detection": _NoSession()})
    assert backend._actual_providers() == {"detection": ["unknown"]}


def test_actual_providers_handles_no_app():
    backend = InsightFaceBackend.__new__(InsightFaceBackend)
    # No `app` attribute at all -> empty mapping, never raises.
    assert backend._actual_providers() == {}


def test_log_actual_providers_emits_info(caplog):
    backend = _backend_with_models(
        {
            "detection": _FakeModel(["CPUExecutionProvider"]),
            "recognition": _FakeModel(["CPUExecutionProvider"]),
        }
    )
    with caplog.at_level(logging.INFO):
        backend._log_actual_providers()

    messages = [r.getMessage() for r in caplog.records]
    assert any(
        "Actual bound providers [detection]" in m and "CPUExecutionProvider" in m for m in messages
    )
    assert any("Actual bound providers [recognition]" in m for m in messages)


@pytest.mark.skipif(platform.system() != "Darwin", reason="macOS CoreML-fallback contract")
def test_macos_coreml_request_falls_back_to_cpu_in_log(caplog):
    """On macOS the app requests CoreML but insightface pins CPU (ctx_id<0).

    We simulate that end state (session bound to CPU only) and assert the log
    makes the CPU-only reality explicit rather than echoing the requested list.
    """
    backend = _backend_with_models(
        {
            "detection": _FakeModel(["CPUExecutionProvider"]),
            "recognition": _FakeModel(["CPUExecutionProvider"]),
        }
    )
    with caplog.at_level(logging.INFO):
        backend._log_actual_providers()

    joined = "\n".join(r.getMessage() for r in caplog.records)
    assert "CPUExecutionProvider" in joined
    assert "CoreMLExecutionProvider" not in joined
