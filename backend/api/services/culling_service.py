"""Culling Service

Backs the stats-driven culling workspace: list a player's image files, and
soft-delete (trash) / restore them with an app-managed, manifest-backed trash so
deletions are always reversible.

Reuses the shared file resolution (file_resolver) + filename parsing
(core.playerstats.parse_filename) for listing, and the sidecar-aware move idea from
filer2mappar for trashing. No face recognition — players are filename-derived.
"""

import fnmatch
import json
import logging
import shutil
import uuid
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

from cli_config import load_config, save_config
from core.playerstats import (
    bucket_counter,
    parse_filename,
    resolve_exclusion_sets,
)

from .file_resolver import TRASH_DIR, preset_extensions, resolve_files
from .rename_service import (
    extract_filename_datetime,
    find_sidecar_files,
    validate_path_security,
)

logger = logging.getLogger(__name__)

MANIFEST_PATH = TRASH_DIR / "manifest.jsonl"

# Sidecar extensions to carry along when trashing/restoring (without dot).
SIDECAR_EXTENSIONS = ["xmp"]

# Min images for a name to appear in the filter dropdown, matching the
# rakna_spelare / stats-column default so the dropdown lists the same "players"
# set (group/crowd markers and below-threshold names are excluded).
DROPDOWN_MIN_IMAGES = 3


class CullingService:
    """List player files and trash/restore them reversibly."""

    # ----- listing -------------------------------------------------------

    def list_files(
        self,
        roots: list[str] | None = None,
        globs: list[str] | None = None,
        extension_preset: str | None = "jpg",
        recursive: bool = True,
        date_from: str | None = None,
        date_to: str | None = None,
        player: str | None = None,
        name_glob: str | None = None,
    ) -> dict:
        """Resolve files and return parsed entries, optionally filtered.

        ``player`` keeps only files where that exact parsed name appears.
        ``name_glob`` is a Finder-style, case-insensitive basename pattern
        (e.g. ``*ArvidW*``) applied to the resolved files within the selected
        folder(s) — it narrows the working set, it does not scan the filesystem.

        Returns {files: [{path, basename, names, datetime, mtime_ms, size}],
        players: [name,...]}. ``mtime_ms``/``size`` are a per-file fingerprint
        for grid thumbnail cache-busting; both are omitted if the file can't be
        stat'd.
        ``players`` is the sorted filter-dropdown list: names counted across all
        resolved files (before the player/name_glob narrowing so it stays
        complete) then filtered through the shared exclusions + threshold, so it
        lists the same players as rakna_spelare / the stats column (group/crowd
        markers, coaches, and below-threshold names are dropped). Raises
        ValueError when no folder/glob input is given.
        """
        roots = roots or []
        globs = globs or []
        if not roots and not globs:
            raise ValueError("Ange minst en mapp eller ett glob-mönster.")

        files = resolve_files(
            roots=roots,
            globs=globs,
            extensions=preset_extensions(extension_preset),
            recursive=recursive,
            date_from=date_from,
            date_to=date_to,
        )

        # Lenient listing: unlike the CLI counting core (build_entries), keep
        # files that have no _Name part (e.g. YYMMDD_HHMMSS.NEF from general
        # culling, which happens before names are assigned). Datetime comes from
        # parse_filename when names exist, else the name-agnostic prefix parser.
        entries: list[tuple] = []
        for path in files:
            dt, names = parse_filename(path)
            if dt is None:
                dt = extract_filename_datetime(Path(path).name)
                names = []
            if dt is None:
                continue
            entries.append((dt, names or [], path))
        entries.sort(key=lambda e: e[0])

        glob_lower = name_glob.lower() if name_glob else None

        # Count every name across the resolved files (before player/name_glob
        # narrowing) so the dropdown stays complete.
        name_counts: Counter[str] = Counter()
        out: list[dict] = []
        for dt, names, path in entries:
            name_counts.update(names)
            if player is not None and player not in names:
                continue
            if glob_lower is not None and not fnmatch.fnmatch(Path(path).name.lower(), glob_lower):
                continue
            entry = {
                "path": path,
                "basename": Path(path).name,
                "names": names,
                "datetime": dt.isoformat(),
            }
            # mtime+size fingerprint so the frontend grid can cache-bust a
            # thumbnail after an in-place re-export (same path, changed bytes).
            # A file that vanished between scan and stat is served without the
            # fingerprint — the grid cell just won't bust, matching prior behavior.
            try:
                st = Path(path).stat()
                entry["mtime_ms"] = st.st_mtime_ns // 1_000_000
                entry["size"] = st.st_size
            except OSError:
                pass
            out.append(entry)

        # Dropdown players: apply the same exclusions + threshold as the CLI /
        # stats column so group/crowd markers (Laget/FBK/Klacken), coaches, and
        # below-threshold names don't show up as filterable "players".
        tranare_set, publik_set, grupp_set = resolve_exclusion_sets()
        buckets = bucket_counter(
            name_counts, DROPDOWN_MIN_IMAGES, tranare_set, publik_set, grupp_set
        )
        players = sorted(buckets["players"].keys())

        return {"files": out, "players": players}

    # ----- trash manifest -----------------------------------------------

    def _load_manifest(self) -> list[dict]:
        if not MANIFEST_PATH.exists():
            return []
        entries: list[dict] = []
        with open(MANIFEST_PATH, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    entries.append(json.loads(line))
        return entries

    def _rewrite_manifest(self, entries: list[dict]) -> None:
        TRASH_DIR.mkdir(parents=True, exist_ok=True)
        tmp = MANIFEST_PATH.with_suffix(".jsonl.tmp")
        with open(tmp, "w") as f:
            for e in entries:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
        tmp.replace(MANIFEST_PATH)

    def _append_manifest(self, entry: dict) -> None:
        TRASH_DIR.mkdir(parents=True, exist_ok=True)
        with open(MANIFEST_PATH, "a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # ----- trash / restore ----------------------------------------------

    def trash(self, paths: list[str]) -> dict:
        """Move files (+ sidecars) to the app trash, recording how to restore them.

        Returns {trashed: [{id, original_path, basename}], errors: [...]}.
        """
        TRASH_DIR.mkdir(parents=True, exist_ok=True)
        trashed: list[dict] = []
        errors: list[dict] = []

        for p in paths:
            src = Path(p)
            if not src.is_file():
                errors.append({"path": p, "error": "Filen finns inte"})
                continue
            try:
                tid = uuid.uuid4().hex
                stored_name = f"{tid}__{src.name}"
                # Move the main file first; only after this succeeds is the file
                # gone from its folder, so the manifest entry below must always be
                # written to keep it restorable.
                shutil.move(str(src), str(TRASH_DIR / stored_name))
            except Exception as e:
                logger.exception("Failed to trash %s", p)
                errors.append({"path": p, "error": str(e)})
                continue

            # Sidecars are best-effort: a locked/failed sidecar must not abort the
            # manifest entry for the already-moved main file (else it'd be lost).
            stored_sidecars: list[dict] = []
            for sc in find_sidecar_files(src, SIDECAR_EXTENSIONS):
                try:
                    sc_stored = f"{tid}__{sc.name}"
                    shutil.move(str(sc), str(TRASH_DIR / sc_stored))
                    stored_sidecars.append({"original_path": str(sc), "stored_name": sc_stored})
                except Exception:
                    logger.exception("Failed to trash sidecar %s", sc)

            entry = {
                "id": tid,
                "original_path": str(src),
                "stored_name": stored_name,
                "basename": src.name,
                "sidecars": stored_sidecars,
                "trashed_at": datetime.now().isoformat(),
            }
            self._append_manifest(entry)
            trashed.append({"id": tid, "original_path": str(src), "basename": src.name})

        return {"trashed": trashed, "errors": errors}

    # ----- rename --------------------------------------------------------

    def rename(self, path: str, new_basename: str) -> dict:
        """Rename a single file (+ matching sidecars) within its folder.

        `new_basename` is the full target filename including extension. Returns
        {path, basename} for the renamed file. Raises ValueError on bad input
        (invalid name, existing target, missing source).
        """
        ok, err = validate_path_security(path)
        if not ok:
            raise ValueError(err)

        # The target must be a bare filename living in the same directory.
        if not new_basename or "\0" in new_basename or new_basename != Path(new_basename).name:
            raise ValueError("Ogiltigt filnamn")
        if new_basename in (".", ".."):
            raise ValueError("Ogiltigt filnamn")

        src = Path(path)
        dst = src.with_name(new_basename)
        if dst.name == src.name:
            return {"path": str(src), "basename": src.name}
        # On a case-insensitive filesystem (macOS) a case-only rename has
        # dst.exists() true while pointing at the source itself — allow that.
        if dst.exists() and not dst.samefile(src):
            raise ValueError("En fil med det namnet finns redan")

        # Preflight sidecar destinations BEFORE moving the main file, so we never
        # half-apply: renaming the main file but leaving a sidecar behind would
        # pair the image with an unrelated <new-stem>.xmp and orphan its own.
        sidecars = find_sidecar_files(src, SIDECAR_EXTENSIONS)
        sidecar_moves = []
        for sc in sidecars:
            sc_dst = dst.with_name(dst.stem + sc.suffix)
            # A target like "b.xmp" for an image with a b.xmp sidecar would make
            # the sidecar destination equal the main file's — the sidecar move
            # would then overwrite the renamed image. Reject up front.
            if sc_dst == dst:
                raise ValueError("Filnamnet krockar med en sidecar-fil")
            # samefile allows a case-only rename of the sidecar itself.
            if sc_dst.exists() and not sc_dst.samefile(sc):
                raise ValueError("En sidecar-fil med målnamnet finns redan")
            sidecar_moves.append((sc, sc_dst))

        # Atomic: if a sidecar move fails (e.g. a locked .xmp on Windows), roll
        # back every move so we never return success with an orphaned sidecar.
        self._safe_rename(src, dst)
        done = [(src, dst)]
        try:
            for sc, sc_dst in sidecar_moves:
                self._safe_rename(sc, sc_dst)
                done.append((sc, sc_dst))
        except Exception:
            logger.exception("Sidecar rename failed; rolling back %s", src)
            for moved_src, moved_dst in reversed(done):
                try:
                    self._safe_rename(moved_dst, moved_src)
                except Exception:
                    logger.exception("Rollback failed for %s", moved_dst)
            raise ValueError("Kunde inte byta namn på en sidecar-fil; ändringen återställdes")

        return {"path": str(dst), "basename": dst.name}

    @staticmethod
    def _safe_rename(src: Path, dst: Path) -> None:
        """Rename src→dst, handling case-only renames cross-platform.

        On a case-insensitive filesystem dst "exists" (it is src), and a direct
        os.rename raises FileExistsError on Windows. Go via a temp name so the
        capitalization change applies everywhere.
        """
        if dst.exists() and dst.samefile(src):
            tmp = src.with_name(f".{uuid.uuid4().hex}.rename.tmp")
            src.rename(tmp)
            tmp.rename(dst)
        else:
            src.rename(dst)

    def list_trash(self) -> dict:
        """Return active trash entries, newest first."""
        entries = self._load_manifest()
        entries.sort(key=lambda e: e.get("trashed_at", ""), reverse=True)
        return {"items": entries}

    def restore(self, ids: list[str]) -> dict:
        """Move trashed files (+ sidecars) back to their original locations.

        Never overwrites: if the original path is occupied, restores alongside as
        ``<stem>-restored<suffix>``. Returns {restored: [...], errors: [...]}.
        """
        entries = self._load_manifest()
        by_id = {e["id"]: e for e in entries}
        restored: list[dict] = []
        errors: list[dict] = []
        keep = list(entries)

        for tid in ids:
            entry = by_id.get(tid)
            if entry is None:
                errors.append({"id": tid, "error": "Finns inte i papperskorgen"})
                continue
            try:
                dest = self._restore_one(entry["original_path"], entry["stored_name"])
                # Sidecars must land beside the *actual* restored image: when the
                # original path was occupied and the image came back as
                # <stem>-restored, its .xmp must follow to <stem>-restored.xmp,
                # not the original name (which would orphan the metadata).
                for sc in entry.get("sidecars", []):
                    sc_suffix = Path(sc["original_path"]).suffix
                    sc_target = dest.with_name(dest.stem + sc_suffix)
                    self._restore_one(str(sc_target), sc["stored_name"])
                keep = [e for e in keep if e["id"] != tid]
                restored.append({"id": tid, "restored_path": str(dest)})
            except Exception as e:
                logger.exception("Failed to restore %s", tid)
                errors.append({"id": tid, "error": str(e)})

        self._rewrite_manifest(keep)
        return {"restored": restored, "errors": errors}

    def _restore_one(self, original_path: str, stored_name: str) -> Path:
        """Move one stored file back to original_path, never overwriting.

        If the original path is taken, restore alongside as ``<stem>-restored``,
        adding a numeric suffix until an unused name is found.
        """
        original = Path(original_path)
        original.parent.mkdir(parents=True, exist_ok=True)
        dest = original
        if dest.exists():
            dest = original.with_name(f"{original.stem}-restored{original.suffix}")
            counter = 2
            while dest.exists():
                dest = original.with_name(f"{original.stem}-restored-{counter}{original.suffix}")
                counter += 1
        shutil.move(str(TRASH_DIR / stored_name), str(dest))
        return dest

    def empty(self, ids: list[str] | None = None) -> dict:
        """Permanently delete trashed files (all, or the given ids)."""
        entries = self._load_manifest()
        # Distinguish omitted ids (None -> empty everything) from an explicit
        # empty list ([] -> delete nothing); a falsy check would nuke the whole
        # trash when a client forwards an empty selection.
        target_ids = {e["id"] for e in entries} if ids is None else set(ids)
        keep: list[dict] = []
        deleted = 0
        for e in entries:
            if e["id"] not in target_ids:
                keep.append(e)
                continue
            for name in [e["stored_name"], *[sc["stored_name"] for sc in e.get("sidecars", [])]]:
                try:
                    (TRASH_DIR / name).unlink(missing_ok=True)
                    deleted += 1
                except Exception:
                    logger.exception("Failed to delete trashed file %s", name)
        self._rewrite_manifest(keep)
        return {"deleted": deleted}

    # ----- retention ----------------------------------------------------

    def get_retention_days(self) -> int:
        """Current auto-purge threshold in days (0 = keep forever)."""
        try:
            return int(load_config().get("trash_retention_days", 30))
        except (TypeError, ValueError):
            return 30

    def set_retention_days(self, days: int) -> dict:
        """Persist the auto-purge threshold (clamped to >= 0). Returns {days}."""
        days = max(0, int(days))
        save_config({"trash_retention_days": days})
        return {"days": days}

    def purge_expired(self, max_age_days: int | None = None) -> dict:
        """Permanently delete trashed items older than the retention threshold.

        Reads the threshold from config when not given. A threshold of 0 (or
        negative) means "keep forever" and is a no-op. Entries with a missing or
        unparseable ``trashed_at`` are kept, so bad data never triggers deletion.
        Returns ``{purged: n}`` (number of trashed items removed).
        """
        if max_age_days is None:
            max_age_days = self.get_retention_days()
        if max_age_days <= 0:
            return {"purged": 0}

        cutoff = datetime.now() - timedelta(days=max_age_days)
        expired: list[str] = []
        for e in self._load_manifest():
            ts = e.get("trashed_at")
            if not ts:
                continue
            try:
                trashed_at = datetime.fromisoformat(ts)
            except (ValueError, TypeError):
                # Unparseable string or a non-string (e.g. epoch int in a
                # hand-edited manifest): keep, never purge on bad data.
                continue
            if trashed_at < cutoff:
                expired.append(e["id"])

        if not expired:
            return {"purged": 0}
        self.empty(expired)
        logger.info("Trash retention: purged %d expired item(s)", len(expired))
        return {"purged": len(expired)}


# Lazy singleton — construction is deferred so importing this module has no
# side effects at import time.
_culling_service = None


def get_culling_service() -> CullingService:
    """Return the process-wide CullingService, constructing it on first use."""
    global _culling_service
    if _culling_service is None:
        _culling_service = CullingService()
    return _culling_service
