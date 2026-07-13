"""Rename-NEF Service

GUI backing for the rename_nef CLI: rename NEFs from EXIF CreateDate to
YYMMDD_HHMMSS.NEF, with a preview (dry-run) and a confirm (execute). Reuses the
CLI's EXIF read + duplicate-timestamp disambiguation; reimplements the two-pass
execute to return structured results, carry .xmp sidecars, and — unlike the CLI —
restore (never delete) the original when a target name is already taken.
"""

import asyncio
import logging
import os
import re
import sys
import threading
from pathlib import Path

# Backend root on sys.path to import the CLI core.
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from rename_nef import compute_renames, get_exif_data  # noqa: E402

from ..websocket.progress import broadcast_event  # noqa: E402
from .file_resolver import preset_extensions, resolve_files  # noqa: E402
from .rename_service import find_sidecar_files  # noqa: E402

logger = logging.getLogger(__name__)

SIDECAR_EXTENSIONS = ["xmp"]
# EXIF reads dominate preview/execute time on large folders. Chunk the exiftool
# calls so progress can be broadcast between batches instead of one long stall.
EXIF_CHUNK_SIZE = 50
# Above this file count, gather the plan-cache signature (a stat per file) in a
# thread so the event loop isn't blocked; below it the stats are cheap inline.
SIGNATURE_EXECUTOR_THRESHOLD = 2000
# A usable capture timestamp must be exactly YYMMDD_HHMMSS. exiftool's
# `-if defined $CreateDate` can still let a blank/zero date through (→ ts ""),
# which would otherwise rename a file to just ".NEF" — guard against that.
_VALID_TS = re.compile(r"^\d{6}_\d{6}$")


class RenameNefService:
    """Preview and execute EXIF-based NEF renaming."""

    def __init__(self):
        # Plan cache: preview stores its (renames, no_date, valid_count) here
        # keyed by request + a per-file (mtime_ns, size) signature, so a
        # following execute on unchanged files can skip the slow EXIF re-read.
        # Purely an optimization — correctness rests on the signature match; any
        # divergence falls back to a full _plan.
        self._preview_cache = None
        # Serialize execute(): it plans then mutates the filesystem across await
        # points, so two overlapping calls (double-submit, two clients) could both
        # plan the same files, and the second would run its two-pass move against
        # source paths the first already renamed away — raining per-file errors
        # instead of being a clean no-op. preview() stays lock-free (read-only).
        self._execute_lock = asyncio.Lock()

    def _resolve(self, roots, globs, recursive):
        roots = roots or []
        globs = globs or []
        if not roots and not globs:
            raise ValueError("Ange minst en mapp eller ett glob-mönster.")
        return resolve_files(
            roots=roots, globs=globs,
            extensions=preset_extensions("nef"), recursive=recursive,
        )

    @staticmethod
    def _request_key(roots, globs, recursive):
        """Order-invariant identity of a preview/execute request."""
        return (tuple(sorted(roots or [])), tuple(sorted(globs or [])), bool(recursive))

    @staticmethod
    def _signature_sync(files):
        """Map each resolved file to (mtime_ns, size); None if it can't be stat'd.

        The dict's keys double as the file-set identity, so a comparison against
        a cached signature detects added/removed files and content changes alike.
        """
        sig = {}
        for f in files:
            try:
                st = os.stat(f)
                sig[f] = (st.st_mtime_ns, st.st_size)
            except OSError:
                sig[f] = None
        return sig

    async def _signature(self, files):
        loop = asyncio.get_event_loop()
        if len(files) > SIGNATURE_EXECUTOR_THRESHOLD:
            return await loop.run_in_executor(None, self._signature_sync, files)
        return self._signature_sync(files)

    async def _plan(self, files, phase="preview"):
        """Return (renames, no_date_names, valid_count) from the resolved files.

        Only entries with a well-formed YYMMDD_HHMMSS timestamp are eligible;
        everything else (no/blank CreateDate) is reported as no_date and never
        renamed.

        EXIF is read in chunks so progress can be broadcast between batches over
        the `rename-nef-progress` WebSocket event (phase = 'preview'|'execute').
        get_exif_data sorts each batch internally, so the *merged* list is
        re-sorted with the same key before compute_renames — the -NN suffixes
        depend on that global ordering.
        """
        total = len(files)
        loop = asyncio.get_event_loop()
        entries: list[tuple[str, int, Path]] = []

        await broadcast_event("rename-nef-progress", {
            "phase": phase, "current": 0, "total": total,
            "percent": 0 if total else 100,
        })
        for start in range(0, total, EXIF_CHUNK_SIZE):
            chunk = [Path(f) for f in files[start:start + EXIF_CHUNK_SIZE]]
            try:
                chunk_entries = await loop.run_in_executor(None, get_exif_data, chunk)
            except FileNotFoundError:
                raise ValueError("exiftool krävs men hittades inte i PATH.")
            entries.extend(chunk_entries)
            done = min(start + EXIF_CHUNK_SIZE, total)
            await broadcast_event("rename-nef-progress", {
                "phase": phase, "current": done, "total": total,
                "percent": round(100 * done / total) if total else 100,
            })

        entries.sort(key=lambda e: (e[0], e[1], str(e[2])))
        valid = [(ts, sub, p) for ts, sub, p in entries if _VALID_TS.match(ts or "")]
        dated = {str(p) for _, _, p in valid}
        no_date = [Path(f).name for f in files if f not in dated]
        renames = compute_renames(valid)
        return renames, no_date, len(valid)

    async def preview(self, roots=None, globs=None, recursive=True) -> dict:
        files = self._resolve(roots, globs, recursive)
        # Drop any stale plan first, then capture the signature just before the
        # EXIF read so it reflects the state the plan is built from.
        self._preview_cache = None
        signature = await self._signature(files)
        plan = await self._plan(files, phase="preview")
        renames, no_date, valid_count = plan
        self._preview_cache = {
            "key": self._request_key(roots, globs, recursive),
            "signature": signature,
            "plan": plan,
        }
        return {
            "items": [
                {"original_path": str(src), "original": src.name, "new_name": dst.name}
                for src, dst, _ in renames
            ],
            "total_files": len(files),
            "to_rename": len(renames),
            "already_named": valid_count - len(renames),  # had a date but were no-ops
            "no_date": no_date,
        }

    async def execute(self, roots=None, globs=None, recursive=True) -> dict:
        # Serialize the whole plan-then-rename body: overlapping executes must not
        # interleave at the await points (see _execute_lock in __init__).
        async with self._execute_lock:
            files = self._resolve(roots, globs, recursive)

            # Reuse the preview's plan when the request and every file's
            # (mtime_ns, size) are unchanged — skips the slow EXIF re-read entirely.
            # The signature's keys are the file set, so this also rejects a changed
            # file set. Any mismatch falls back to a fresh _plan.
            cache = self._preview_cache
            key = self._request_key(roots, globs, recursive)
            if cache and cache["key"] == key and cache["signature"] == await self._signature(files):
                renames, _no_date, _valid = cache["plan"]
                # Nothing to read — flip the UI straight to done instead of waiting.
                await broadcast_event("rename-nef-progress", {
                    "phase": "execute", "current": len(files), "total": len(files),
                    "percent": 100,
                })
            else:
                renames, _no_date, _valid = await self._plan(files, phase="execute")

            # Build the full move list: each NEF plus its .xmp sidecar, with fresh
            # unique temp names (two-pass avoids intra-batch collisions).
            stamp = str(os.getpid())
            full: list[tuple[Path, Path, Path]] = []
            ctr = 0
            for src, dst, _tmp in renames:
                full.append((src, dst, src.parent / f".rename_tmp_{stamp}_{ctr}{src.suffix}"))
                ctr += 1
                for sc in find_sidecar_files(src, SIDECAR_EXTENSIONS):
                    sc_dst = dst.with_name(f"{dst.stem}{sc.suffix}")
                    if sc.name == sc_dst.name:
                        continue
                    full.append((sc, sc_dst, sc.parent / f".rename_tmp_{stamp}_{ctr}{sc.suffix}"))
                    ctr += 1

            renamed: list[dict] = []
            skipped: list[dict] = []
            errors: list[dict] = []

            # Pass 1: src -> temp.
            moved: list[tuple[Path, Path, Path]] = []
            for src, dst, tmp in full:
                try:
                    src.rename(tmp)
                    moved.append((src, dst, tmp))
                except OSError as e:
                    logger.error("[RenameNef] to-temp failed: %s -> %s: %s", src, tmp, e)
                    errors.append({"path": str(src), "error": str(e)})

            # Pass 2: temp -> dst, never overwriting; restore the original on collision.
            for src, dst, tmp in moved:
                if dst.exists():
                    if self._restore(tmp, src):
                        skipped.append({"path": str(src), "reason": f"målnamn upptaget: {dst.name}"})
                    else:
                        errors.append({"path": str(tmp), "error": f"kan ej återställa: {src.name} upptaget — fil kvar som {tmp.name}"})
                    continue
                try:
                    tmp.rename(dst)
                    renamed.append({"from": src.name, "to": dst.name})
                except OSError as e:
                    logger.error("[RenameNef] to-final failed: %s -> %s: %s", tmp, dst, e)
                    if self._restore(tmp, src):
                        errors.append({"path": str(src), "error": str(e)})
                    else:
                        errors.append({"path": str(tmp), "error": f"{e}; kunde ej återställa (fil kvar som {tmp.name})"})

            # The plan is consumed and the files on disk have changed names — drop
            # the cache so a later preview/execute can't match a stale signature.
            self._preview_cache = None

            # The rename passes above are fast local moves; report a closing 100% so
            # the UI's progress bar completes rather than freezing at the EXIF total.
            await broadcast_event("rename-nef-progress", {
                "phase": "execute", "current": len(files), "total": len(files),
                "percent": 100,
            })
            return {"renamed": renamed, "skipped": skipped, "errors": errors}

    @staticmethod
    def _restore(tmp: Path, src: Path) -> bool:
        """Move a temp back to its original name, NEVER overwriting an existing file.

        Returns False (leaving the temp in place) if `src` is occupied — better a
        recoverable hidden temp than silently clobbering a sibling already placed
        at that name in this same pass.
        """
        if src.exists():
            return False
        try:
            tmp.rename(src)
            return True
        except OSError as e:
            logger.error("[RenameNef] restore failed: %s -> %s: %s", tmp, src, e)
            return False


# Lazy singleton — construction is deferred so importing this module has no
# side effects at import time.
_rename_nef_service = None
_rename_nef_service_lock = threading.Lock()


def get_rename_nef_service() -> RenameNefService:
    """Return the process-wide RenameNefService, constructing it on first use."""
    global _rename_nef_service
    if _rename_nef_service is None:
        with _rename_nef_service_lock:
            if _rename_nef_service is None:
                _rename_nef_service = RenameNefService()
    return _rename_nef_service
