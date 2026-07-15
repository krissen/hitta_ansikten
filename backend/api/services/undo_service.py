"""Undo Service

Backs the "undo last rename batch" feature: list recent journal batches and
reverse one, replaying its recorded ``dst → src`` moves via ``core.fs_ops``. The
journal (written by every migrated rename/move/trash flow) is the single source
of truth; this service never derives what to move — it replays exactly what the
batch recorded.

Scope (PR 2): only ``rename`` / ``move`` batches are undoable. A ``copy`` batch
(import copy) would need a delete, and ``trash`` / ``restore`` batches already
have their own undo via the culling trash manifest — those are reported
non-undoable and refused here with a clear Swedish message.

The undo is itself journaled as a fresh batch (tool ``undo``), so it shows up in
the history and can be redone.
"""

import asyncio
import logging
import sys
import threading
from pathlib import Path

# Backend root on sys.path to import the CLI core (mirrors the sibling services).
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import fs_ops  # noqa: E402

logger = logging.getLogger(__name__)


class UndoService:
    """List journal batches and undo (reverse) a chosen one."""

    def __init__(self):
        # One undo at a time: reverting mutates the filesystem across await
        # points, so two overlapping calls could both plan the same batch and the
        # second would run its moves against paths the first already reverted.
        self._lock = asyncio.Lock()

    def list_batches(self, limit: int = 20) -> dict:
        """Recent batches, newest first, capped at ``limit``.

        Each entry is ``{batch_id, ts, tool, op, count, undoable}`` — the raw
        journal rows are kept server-side only (undo reads them fresh by id).
        """
        batches = fs_ops.group_batches(fs_ops.read_rows())
        batches.reverse()  # chronological -> newest first
        wire = [
            {k: b[k] for k in ("batch_id", "ts", "tool", "op", "count", "undoable")}
            for b in batches[: max(0, limit)]
        ]
        return {"batches": wire}

    def _find_batch(self, batch_id: str) -> dict | None:
        for b in fs_ops.group_batches(fs_ops.read_rows()):
            if b["batch_id"] == batch_id:
                return b
        return None

    async def undo(self, batch_id: str, execute: bool = False) -> dict:
        """Preview (``execute=False``) or perform the reversal of one batch.

        Raises ``ValueError`` (mapped to HTTP 400/404 by the route) when the batch
        is unknown or not undoable.
        """
        async with self._lock:
            batch = self._find_batch(batch_id)
            if batch is None:
                raise ValueError("Batchen finns inte i journalen.")
            if not batch["undoable"]:
                raise ValueError(
                    "Den här åtgärden kan inte ångras — endast namnbyten och "
                    "flyttar stöds (kopior och papperskorg hanteras separat)."
                )

            rows = batch["rows"]
            if not execute:
                items = fs_ops.preview_revert(rows)
                return {
                    "batch_id": batch_id,
                    "tool": batch["tool"],
                    "op": batch["op"],
                    "count": batch["count"],
                    "to_revert": sum(1 for it in items if it["status"] == "ok"),
                    "to_skip": sum(1 for it in items if it["status"] == "skip"),
                    "items": items,
                }

            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, fs_ops.revert_batch, rows)

            # Point each reverted main file's DB entry back at its restored name
            # (mirrors restore-names' processed_files sync). Sidecars aren't in
            # the face DB, so only mains are re-synced.
            await loop.run_in_executor(None, self._sync_reverted_names,
                                       result["reverted_mains"])

            return {
                "batch_id": batch_id,
                "reverted": result["reverted"],
                "skipped": result["skipped"],
                "errors": result["errors"],
                "results": result["results"],
            }

    @staticmethod
    def _sync_reverted_names(reverted_mains: list[str]) -> int:
        """Re-sync processed_files names for the reverted main files.

        Hash each restored file and, via the shared ``_sync_processed_names``
        mechanism, point its per-hash entry at the on-disk (original) basename —
        so a file whose DB name had been advanced by the original rename is
        pointed back. Files not in processed_files are simply no-ops.
        """
        if not reverted_mains:
            return 0
        from faceid_db import get_file_hash

        from .rename_nef_service import RenameNefService

        final_by_hash: dict[str, str] = {}
        for path_str in reverted_mains:
            p = Path(path_str)
            if not p.exists():
                continue
            h = get_file_hash(p)
            if h:
                final_by_hash[h] = p.name
        return RenameNefService._sync_processed_names(final_by_hash)


# Lazy singleton — no import-time construction / side effects.
_undo_service = None
_undo_service_lock = threading.Lock()


def get_undo_service() -> UndoService:
    """Return the process-wide UndoService, constructing it on first use."""
    global _undo_service
    if _undo_service is None:
        with _undo_service_lock:
            if _undo_service is None:
                _undo_service = UndoService()
    return _undo_service
