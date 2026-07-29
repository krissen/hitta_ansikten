"""Undo Service

Backs the "undo last rename batch" feature: list recent journal batches and
reverse one, replaying its recorded ``dst → src`` moves via ``core.fs_ops``. The
journal (written by every migrated rename/move/trash flow) is the single source
of truth; this service never derives what to move — it replays exactly what the
batch recorded.

Scope (PR 2): only ``rename`` batches are undoable. An import ``move`` would need
a cross-device move back (``Path.rename`` raises EXDEV over a filesystem
boundary — the normal card→disk case), a ``copy`` would need a delete, and
``trash`` / ``restore`` batches already have their own undo via the culling trash
manifest — all reported non-undoable and refused here with a clear Swedish
message.

After the moves, the face DB is repaired the same way the forward face-rename
does (``RenameService._update_database_paths``) but with the reversed mapping, so
both ``known_faces[*].file`` and ``processed_files[*].name`` are repointed off
the renamed name back onto the original — not just one collection.

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

from core import fs_ops

logger = logging.getLogger(__name__)


class UndoService:
    """List journal batches and undo (reverse) a chosen one."""

    def __init__(self):
        # One undo at a time: reverting mutates the filesystem across await
        # points, so two overlapping calls could both plan the same batch and the
        # second would run its moves against paths the first already reverted.
        self._lock = asyncio.Lock()

    def list_batches(self, limit: int = 20, undoable_only: bool = True) -> dict:
        """Recent batches, newest first, capped at ``limit``.

        Each entry is ``{batch_id, ts, tool, op, count, undoable}`` — the raw
        journal rows are kept server-side only (undo reads them fresh by id).

        ``undoable_only`` (default) filters to undoable batches **before** the
        limit, so a wall of newer non-undoable batches (imports, trash/restore)
        can't push an older undoable rename past the cap and hide it (a false
        "nothing to undo" in the GUI). Pass ``False`` to list every batch.
        """
        batches = fs_ops.group_batches(fs_ops.read_rows())
        batches.reverse()  # chronological -> newest first
        if undoable_only:
            batches = [b for b in batches if b["undoable"]]
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
                    "Den här åtgärden kan inte ångras — endast namnbyten stöds "
                    "(import och papperskorg hanteras separat)."
                )

            rows = batch["rows"]
            if not execute:
                items = fs_ops.preview_revert(rows)
                return {
                    "batch_id": batch_id,
                    "tool": batch["tool"],
                    "op": batch["op"],
                    "ts": batch["ts"],
                    "count": batch["count"],
                    "to_revert": sum(1 for it in items if it["status"] == "ok"),
                    "to_skip": sum(1 for it in items if it["status"] == "skip"),
                    "items": items,
                }

            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, fs_ops.revert_batch, rows)

            # Repair the face DB the SAME way the forward face-rename does, with
            # the reversed mapping: repoint BOTH known_faces[*].file and
            # processed_files[*].name off the renamed basename back onto the
            # original. Reusing RenameService._update_database_paths (rather than
            # a second, partial sync) keeps the two directions symmetric — the
            # forward rename updates both collections, so undo must too, or face
            # encodings keep pointing at a name that no longer exists. It is a
            # no-op for basenames not in the DB, so it runs generally for every
            # tool's batch (rename-nef / import / culling), not gated on tool.
            await loop.run_in_executor(
                None, self._repair_db_paths, result["reverted_mains"])

            return {
                "batch_id": batch_id,
                "reverted": result["reverted"],
                "skipped": result["skipped"],
                "errors": result["errors"],
                "results": result["results"],
            }

    @staticmethod
    def _repair_db_paths(reverted_mains: list[dict]) -> int:
        """Repoint known_faces/processed_files entries off the reverted names.

        ``reverted_mains`` is the ``[{"original", "new"}, ...]`` list from
        ``revert_batch`` — ``original`` the renamed path the DB still points at,
        ``new`` the restored original path, both absolute. Handed to the forward
        rename's ``_update_database_paths`` in ``match="fullpath"`` mode so it
        keys on the whole path (not the basename) — undoing a rename in one
        folder never touches a DB entry that merely shares a basename in another
        folder — and updates both collections in one store mutation.
        """
        if not reverted_mains:
            return 0
        from .rename_service import get_rename_service

        return get_rename_service()._update_database_paths(
            reverted_mains, match="fullpath")


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
