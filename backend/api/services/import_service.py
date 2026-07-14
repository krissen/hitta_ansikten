"""Import Service

GUI backing for importing NEF off a camera card: detect the mounted card volume,
transfer its NEFs (+ .xmp sidecars) to a destination folder with live progress,
and eject the card. Mirrors the user's shell one-liner
(`find /Volumes/... -iname '*.NEF' -exec mv ... && diskutil eject ...`).

Import-only — renaming (rename_nef) is a separate step. macOS-focused (diskutil);
degrades to an empty volume list / disabled eject elsewhere.
"""

import asyncio
import logging
import os
import plistlib
import shutil
import subprocess
import threading
from pathlib import Path

from core import fs_ops

from ..websocket.progress import broadcast_event
from .rename_service import find_sidecar_files

logger = logging.getLogger(__name__)

VOLUMES_ROOT = Path("/Volumes")
SIDECAR_EXTENSIONS = ["xmp"]


class ImportService:
    """Detect card volumes and transfer NEFs off them."""

    # ----- volume detection ---------------------------------------------

    def list_volumes(self) -> list[dict]:
        """List ejectable/external volumes under /Volumes with NEF counts.

        Never includes the internal/boot disk. Returns [] on non-macOS or when
        diskutil is unavailable.
        """
        if not VOLUMES_ROOT.is_dir():
            return []
        volumes: list[dict] = []
        for entry in sorted(VOLUMES_ROOT.iterdir()):
            try:
                if not entry.is_dir() or entry.is_symlink():
                    continue
            except OSError:
                continue
            info = self._diskutil_info(str(entry))
            if not self._is_ejectable(info):
                continue
            count, size = self._count_nefs(entry)
            volumes.append({
                "name": entry.name,
                "mount": str(entry),
                "nef_count": count,
                "total_bytes": size,
                "ejectable": True,
            })
        return volumes

    def _diskutil_info(self, mount: str) -> dict | None:
        try:
            res = subprocess.run(
                ["diskutil", "info", "-plist", mount],
                capture_output=True, timeout=15,
            )
            if res.returncode != 0:
                return None
            return plistlib.loads(res.stdout)
        except FileNotFoundError:
            logger.warning("[Import] diskutil not available (non-macOS?)")
            return None
        except Exception as e:
            logger.debug("[Import] diskutil info failed for %s: %s", mount, e)
            return None

    @staticmethod
    def _is_ejectable(info: dict | None) -> bool:
        """Only external/removable, never the internal/boot disk."""
        if not info:
            return False
        if info.get("Internal") is True:
            return False
        return bool(info.get("Ejectable") or info.get("RemovableMedia"))

    @staticmethod
    def _count_nefs(base: Path) -> tuple[int, int]:
        count = 0
        size = 0
        try:
            for p in base.rglob("*"):
                if p.is_file() and p.suffix.lower() == ".nef":
                    count += 1
                    try:
                        size += p.stat().st_size
                    except OSError:
                        pass
        except OSError:
            pass
        return count, size

    # ----- transfer -----------------------------------------------------

    async def run_import(
        self,
        volume_mount: str,
        destination: str,
        mode: str = "move",
        eject: bool = True,
    ) -> dict:
        """Transfer NEFs (+ sidecars) from the volume to destination, then eject.

        Returns {transferred, skipped, errors, ejected, eject_error, total}, and
        broadcasts a terminal `import-progress` event with `phase: "done"`. Never
        raises on a single-file error (collected in `errors`); ejects only after a
        zero-error transfer.
        """
        if not volume_mount or not destination:
            raise ValueError("volume_mount och destination krävs.")
        src_base = Path(volume_mount)
        if not src_base.is_dir():
            raise ValueError(f"Volymen finns inte: {volume_mount}")

        dest = Path(os.path.expanduser(destination))
        dest.mkdir(parents=True, exist_ok=True)

        nefs = sorted(
            p for p in src_base.rglob("*")
            if p.is_file() and p.suffix.lower() == ".nef"
        )
        total = len(nefs)
        transferred: list[str] = []
        skipped: list[dict] = []
        errors: list[dict] = []
        op = shutil.move if mode == "move" else shutil.copy2
        # Journal op mirrors the transfer mode: a move is reversible by moving
        # back; a copy is recorded too (undo-of-copy semantics deferred to PR 2).
        journal_op = "move" if mode == "move" else "copy"
        batch_id = fs_ops.new_batch_id()
        loop = asyncio.get_event_loop()

        for i, src in enumerate(nefs, 1):
            try:
                target = await loop.run_in_executor(None, fs_ops.resolve_import_target, dest, src.name, src)
                if target is None:
                    # Byte-identical copy already present (base or a -N variant) —
                    # safe to skip; re-import is idempotent.
                    skipped.append({"path": str(src), "reason": "identisk fil finns redan"})
                else:
                    await loop.run_in_executor(None, op, str(src), str(target))
                    # Carry .xmp sidecars, named after the (possibly renamed)
                    # target; collect the ones that actually transferred so the
                    # journal row reflects the real delta, never a pre-existing
                    # sidecar already on the target stem.
                    moved_sidecars: list[tuple[Path, Path]] = []
                    for sc in find_sidecar_files(src, SIDECAR_EXTENSIONS):
                        sc_target = dest / f"{target.stem}{sc.suffix}"
                        if not sc_target.exists():
                            try:
                                await loop.run_in_executor(None, op, str(sc), str(sc_target))
                                moved_sidecars.append((sc, sc_target))
                            except Exception:
                                logger.exception("[Import] sidecar transfer failed: %s", sc)
                    # Journal after the sidecars are settled, listing only movers.
                    fs_ops.record(op=journal_op, tool="import", batch_id=batch_id,
                                  src=src, dst=target, sidecars=moved_sidecars)
                    transferred.append(str(target))
            except Exception as e:
                logger.exception("[Import] transfer failed: %s", src)
                errors.append({"path": str(src), "error": str(e)})
            await broadcast_event("import-progress", {
                "phase": "transfer",
                "current": i,
                "total": total,
                "file": src.name,
                "percent": round(100 * i / total) if total else 100,
            })

        ejected = False
        eject_error: str | None = None
        if eject:
            if errors:
                # Deliberately don't eject after a partial transfer (a failed file
                # may need a retry off the card). Surface a reason so the UI warns
                # the card is still mounted instead of leaving it silently so.
                eject_error = "utmatning hoppades över på grund av överföringsfel"
                logger.warning("[Import] eject skipped — transfer had %d error(s): %s", len(errors), volume_mount)
            # Re-validate ejectable here (defense-in-depth): keep the "never the
            # internal/boot disk" guarantee local to the destructive call, not only
            # in list_volumes.
            elif self._is_ejectable(self._diskutil_info(volume_mount)):
                ejected, eject_error = await self._eject(volume_mount)
            else:
                eject_error = "volymen kan inte matas ut"
                logger.warning("[Import] eject skipped — volume not ejectable: %s", volume_mount)

        # Terminal event: lets the UI show the final summary even if the HTTP
        # response was lost (a long import can outlive the request). Carries
        # counts (not the full path lists), the destination, and eject outcome.
        await broadcast_event("import-progress", {
            "phase": "done",
            "transferred": len(transferred),
            "skipped": len(skipped),
            "errors": len(errors),
            "ejected": ejected,
            "eject_error": eject_error,
            "destination": str(dest),
            "total": total,
        })

        return {
            "transferred": transferred,
            "skipped": skipped,
            "errors": errors,
            "ejected": ejected,
            "eject_error": eject_error,
            "total": total,
        }

    async def _eject(self, mount: str) -> tuple[bool, str | None]:
        """Eject the volume. Returns (ejected, error) — error is a short reason
        string on failure (surfaced to the UI), None on success."""
        loop = asyncio.get_event_loop()
        try:
            res = await loop.run_in_executor(
                None,
                lambda: subprocess.run(["diskutil", "eject", mount], capture_output=True, timeout=60),
            )
            if res.returncode != 0:
                reason = res.stderr.decode(errors="replace").strip()
                logger.warning("[Import] eject failed for %s: %s", mount, reason)
                return False, reason or "diskutil eject misslyckades"
            return True, None
        except Exception as e:
            logger.warning("[Import] eject error for %s: %s", mount, e)
            return False, str(e)


# Lazy singleton — construction is deferred so importing this module has no
# side effects at import time.
_import_service = None
_import_service_lock = threading.Lock()


def get_import_service() -> ImportService:
    """Return the process-wide ImportService, constructing it on first use."""
    global _import_service
    if _import_service is None:
        with _import_service_lock:
            if _import_service is None:
                _import_service = ImportService()
    return _import_service
