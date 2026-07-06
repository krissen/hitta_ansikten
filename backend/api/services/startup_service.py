"""
Startup State Service

Tracks initialization status of backend components for KASAM UX.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

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
    progress: Optional[float] = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


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
        self.components: Dict[str, ComponentStatus] = {
            "backend": ComponentStatus(state=LoadingState.READY, message="Connected"),
            "database": ComponentStatus(message="Waiting..."),
            "mlModels": ComponentStatus(message="Waiting..."),
        }
        self._listeners: List[Callable] = []
        logger.info("[StartupState] Initialized")

    def set_state(self, component: str, state: LoadingState, 
                  message: Optional[str] = None, progress: Optional[float] = None, 
                  error: Optional[str] = None):
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
            status.started_at = datetime.now()
        elif state in (LoadingState.READY, LoadingState.ERROR):
            status.completed_at = datetime.now()
            
        logger.info(f"[StartupState] {component}: {state.value} - {status.message}")
        self._notify_listeners()

    def get_status(self) -> Dict[str, Any]:
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
                logger.error(f"[StartupState] Listener error: {e}", exc_info=True)


def get_startup_state() -> StartupState:
    return StartupState()
