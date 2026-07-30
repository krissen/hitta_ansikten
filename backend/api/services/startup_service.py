"""
Startup State Service

Tracks initialization status of backend components for KASAM UX.
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

logger = logging.getLogger(__name__)


class LoadingState(str, Enum):
    PENDING = "pending"
    LOADING = "loading"
    READY = "ready"
    ERROR = "error"


@dataclass
class ComponentStatus:
    state: LoadingState = LoadingState.PENDING
    message: str = ""
    progress: float | None = None
    error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


class StartupState:
    _instance: Optional['StartupState'] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        
        # Components shown in startup toast (order matters for display)
        self.components: dict[str, ComponentStatus] = {
            "backend": ComponentStatus(state=LoadingState.READY, message="Connected"),
            "database": ComponentStatus(message="Waiting..."),
            "mlModels": ComponentStatus(message="Waiting..."),
        }
        self._listeners: list[Callable] = []
        logger.info("[StartupState] Initialized")

    def set_state(self, component: str, state: LoadingState, 
                  message: str | None = None, progress: float | None = None, 
                  error: str | None = None):
        if component not in self.components:
            self.components[component] = ComponentStatus()
        
        status = self.components[component]
        status.state = state
        
        if message:
            status.message = message
        if progress is not None:
            status.progress = progress
        if error:
            status.error = error
            
        if state == LoadingState.LOADING and not status.started_at:
            status.started_at = datetime.now(timezone.utc)
        elif state in (LoadingState.READY, LoadingState.ERROR):
            status.completed_at = datetime.now(timezone.utc)
            
        logger.info(f"[StartupState] {component}: {state.value} - {status.message}")
        self._notify_listeners()

    def get_status(self) -> dict[str, Any]:
        items = {}
        for name, status in self.components.items():
            items[name] = {
                "state": status.state.value,
                "message": status.message,
                "progress": status.progress,
                "error": status.error,
            }
        
        all_ready = all(s.state == LoadingState.READY for s in self.components.values())
        any_error = any(s.state == LoadingState.ERROR for s in self.components.values())
        
        return {
            "items": items,
            "allReady": all_ready,
            "hasError": any_error,
        }

    def add_listener(self, callback: Callable):
        self._listeners.append(callback)

    def remove_listener(self, callback: Callable):
        if callback in self._listeners:
            self._listeners.remove(callback)

    def _notify_listeners(self):
        status = self.get_status()
        logger.debug(f"[StartupState] Notifying {len(self._listeners)} listeners")
        for listener in self._listeners:
            try:
                if asyncio.iscoroutinefunction(listener):
                    asyncio.create_task(listener(status))
                    logger.debug("[StartupState] Created task for async listener")
                else:
                    listener(status)
                    logger.debug("[StartupState] Called sync listener")
            except Exception as e:
                logger.exception(f"[StartupState] Listener error: {e}")


def get_startup_state() -> StartupState:
    return StartupState()
