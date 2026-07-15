"""Shared safe filesystem operations + an append-only rename/move journal.

Consolidates the never-overwrite / two-pass / sidecar-following / rollback
patterns that four flows (rename, rename-nef, restore-names, import, culling)
had each reimplemented, and adds a single append-only journal so every rename /
move / trash the app performs is recorded and later reversible (see PR 2).

Two move strategies live here, matching the two shapes the callers actually
need:

* ``rename_with_sidecars`` — one main file plus its sidecars moved as an
  *atomic unit*: preflight, never overwrite, and roll every move back if any
  step fails (used by the single-file culling rename and the confirmed-identity
  rename).
* ``two_pass_rename`` — a whole batch moved src→temp→dst so targets that clash
  with other *sources* in the same batch (burst renumbering) resolve cleanly,
  never overwriting and restoring the original on collision (used by the
  EXIF rename-nef and the restore-names batches).

Both journal the *main* file's src→dst per successful move. Sidecars follow the
main deterministically (``<new-stem><sidecar-suffix>``) and are not journaled
individually — reversing the main move reverses them by the same rule.

The journal lives at ``<BASE_DIR>/rename_journal.jsonl`` (one JSON object per
line, append-only, no rotation — rows are tiny). Journal writes are best-effort:
a failure to record must never fail the filesystem operation itself.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Sequence

logger = logging.getLogger(__name__)

# Sidecar destination follows the main file's new stem; recognised operations in
# the journal ``op`` field. ``copy`` records an import copy (undo semantics for a
# copy — deleting the copy — are deferred to the undo work in PR 2).
JOURNAL_OPS = ("rename", "move", "copy", "trash", "restore")


# ---------------------------------------------------------------------------
# Journal
# ---------------------------------------------------------------------------

def new_batch_id() -> str:
    """A fresh id grouping all rows written by one batch operation."""
    return uuid.uuid4().hex


def journal_path() -> Path:
    """Path to the append-only journal, under the live ``core.db.BASE_DIR``.

    Read fresh each call (not captured at import) so tests can redirect the data
    dir by monkeypatching ``core.db.BASE_DIR``.
    """
    from core import db
    return db.BASE_DIR / "rename_journal.jsonl"


def record(*, op: str, tool: str, batch_id: str, src, dst,
           sidecars: Iterable[tuple] = ()) -> None:
    """Append one journal row. Best-effort — never raises into the caller.

    A row is ``{ts, op, tool, batch_id, src, dst, sidecars}`` with absolute
    paths as strings. ``sidecars`` is a list of ``{"src", "dst"}`` objects for
    the sidecars that **actually moved** alongside the main file (empty list
    when none did). The invariant: a row describes exactly the filesystem delta,
    so undo (PR 2) can replay ``src→dst`` plus each listed sidecar literally and
    never touch a pre-existing file that merely shared the target stem.

    Callers must therefore write the row *after* the whole unit's moves are
    decided, passing only the sidecars that landed. Journalling must not be able
    to fail the filesystem operation it describes, so every error here is
    swallowed (logged, not raised).

    Paths are absolutised with ``os.path.abspath`` (which normalises against the
    current cwd) so a relative path from the CLI — ``./rename_nef.py *.NEF`` — is
    replayable from any directory. ``Path.resolve`` is deliberately NOT used: it
    also resolves symlinks, and this project uses them actively, so it would
    record a different path than the user's.
    """
    try:
        path = journal_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "op": op,
            "tool": tool,
            "batch_id": batch_id,
            "src": os.path.abspath(str(src)),
            "dst": os.path.abspath(str(dst)),
            "sidecars": [
                {"src": os.path.abspath(str(s)), "dst": os.path.abspath(str(d))}
                for s, d in sidecars
            ],
        }
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        logger.exception("[fs_ops] journal write failed (op=%s tool=%s)", op, tool)


# ---------------------------------------------------------------------------
# Journal reading / batch grouping (backing the "undo last batch" feature)
# ---------------------------------------------------------------------------

# Only these ops describe a plain relocation whose undo is a move back. ``copy``
# would need a delete (out of scope in PR 2), and ``trash``/``restore`` already
# have their own undo via the culling trash manifest — so a batch of those is
# reported non-undoable and refused by the undo endpoint.
UNDOABLE_OPS = ("rename", "move")


def read_rows() -> list[dict]:
    """Read every journal row in chronological (file) order; ``[]`` if absent.

    Malformed lines are skipped (logged) rather than raising — a single corrupt
    append must not make the whole history unreadable.
    """
    path = journal_path()
    if not path.exists():
        return []
    rows: list[dict] = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    logger.warning("[fs_ops] skipping malformed journal line")
    except OSError:
        logger.exception("[fs_ops] journal read failed")
        return []
    return rows


def group_batches(rows: Sequence[dict]) -> list[dict]:
    """Group rows by ``batch_id``, preserving first-seen (chronological) order.

    Each batch is ``{batch_id, ts, tool, op, count, undoable, rows}`` where ``ts``
    is the first row's timestamp, ``tool``/``op`` are the single shared value or
    ``"mixed"`` if a batch somehow spans several, and ``undoable`` is true only
    when every row's op is in ``UNDOABLE_OPS``. ``rows`` carries the raw journal
    rows (undo replays them); the API layer drops it from the wire payload.
    """
    order: list[str] = []
    by_id: dict[str, dict] = {}
    for r in rows:
        bid = r.get("batch_id")
        b = by_id.get(bid)
        if b is None:
            b = by_id[bid] = {
                "batch_id": bid, "ts": r.get("ts"),
                "rows": [], "tools": set(), "ops": set(),
            }
            order.append(bid)
        b["rows"].append(r)
        b["tools"].add(r.get("tool"))
        b["ops"].add(r.get("op"))
    batches = []
    for bid in order:
        b = by_id[bid]
        ops, tools = b["ops"], b["tools"]
        batches.append({
            "batch_id": bid,
            "ts": b["ts"],
            "tool": next(iter(tools)) if len(tools) == 1 else "mixed",
            "op": next(iter(ops)) if len(ops) == 1 else "mixed",
            "count": len(b["rows"]),
            "undoable": bool(ops) and ops <= set(UNDOABLE_OPS),
            "rows": b["rows"],
        })
    return batches


def _flatten_reverse_moves(batch_rows: Sequence[dict]) -> list[tuple[Path, Path, bool]]:
    """Flatten a batch to per-file ``(from, to, is_main)`` move-back tuples.

    ``from`` is the recorded ``dst`` (where the file sits now), ``to`` the recorded
    ``src`` (its original path). Sidecars follow their main but are **literal** —
    only the exact paths the row recorded, never re-derived from a stem rule.
    """
    moves: list[tuple[Path, Path, bool]] = []
    for row in batch_rows:
        moves.append((Path(row["dst"]), Path(row["src"]), True))
        for sc in row.get("sidecars", []) or []:
            moves.append((Path(sc["dst"]), Path(sc["src"]), False))
    return moves


def _is_case_only_same(a: Path, b: Path) -> bool:
    """True if ``a`` exists and is the same inode as ``b`` (a case-only rename)."""
    try:
        return a.exists() and a.samefile(b)
    except OSError:
        return False


def preview_revert(batch_rows: Sequence[dict]) -> list[dict]:
    """Per-file dry-run of reversing a batch — no filesystem change.

    Returns one item per move-back ``{from, to, from_name, to_name, status, reason}``
    with ``status`` ``"ok"`` (would revert) or ``"skip"``. A move is skipped when
    the recorded ``dst`` no longer exists (already moved/deleted) or its original
    path is now occupied by an unrelated file. The occupied check treats the
    batch's own recorded ``dst`` paths as free, since they vacate when reverted —
    matching the two-pass mover's own source-exclusion.

    Path-state only: the journal carries no content fingerprint, so this verifies
    the move is *safe to replay*, not that the bytes are byte-for-byte the batch
    output (see docs/dev/database.md).
    """
    sources = {str(frm) for frm, _to, _m in _flatten_reverse_moves(batch_rows)}
    items = []
    for frm, to, _is_main in _flatten_reverse_moves(batch_rows):
        if not frm.exists():
            status, reason = "skip", "filen saknas — redan flyttad eller borttagen"
        elif to.exists() and str(to) not in sources and not _is_case_only_same(to, frm):
            status, reason = "skip", "originalplatsen är upptagen"
        else:
            status, reason = "ok", None
        items.append({
            "from": str(frm), "to": str(to),
            "from_name": frm.name, "to_name": to.name,
            "status": status, "reason": reason,
        })
    return items


# ---------------------------------------------------------------------------
# Low-level move
# ---------------------------------------------------------------------------

def safe_swap_rename(src: Path, dst: Path) -> None:
    """Rename src→dst, handling a case-only rename cross-platform.

    On a case-insensitive filesystem (macOS) ``dst`` "exists" (it is ``src``),
    and a direct rename raises ``FileExistsError`` on Windows. Go via a temp name
    so a capitalization-only change applies everywhere. No existence guard beyond
    the case-only case — callers preflight target collisions.
    """
    if dst.exists() and dst.samefile(src):
        tmp = src.with_name(f".{uuid.uuid4().hex}.rename.tmp")
        src.rename(tmp)
        tmp.rename(dst)
    else:
        src.rename(dst)


# ---------------------------------------------------------------------------
# Atomic unit rename (main file + sidecars, all-or-nothing)
# ---------------------------------------------------------------------------

def rename_with_sidecars(
    main_src: Path,
    main_dst: Path,
    sidecar_pairs: Sequence[tuple[Path, Path]] = (),
    *,
    tool: str,
    journal_op: str = "rename",
    batch_id: str | None = None,
) -> list[tuple[Path, Path]]:
    """Move a main file and its sidecars as an atomic unit, then journal the main.

    Never overwrites: a target that already exists (and is not the source itself,
    i.e. a case-only rename) aborts before anything moves. If any move fails, all
    completed moves are rolled back so the caller never sees a half-applied
    rename with an orphaned sidecar. Journals ``main_src -> main_dst`` only on
    full success.

    The unit's destinations must be pairwise distinct under a case-insensitive
    comparison (``casefold``): a unit whose targets differ only in case is never
    intended and is rejected unconditionally (raising ``FileExistsError``),
    regardless of the filesystem's own case sensitivity — deterministic
    cross-platform behaviour beats a per-directory probe. This does not affect a
    legitimate case-only rename of a single file (that is a src↔dst change).

    Returns the list of ``(src, dst)`` pairs actually moved (main first). Raises
    the underlying error (``FileExistsError`` for an occupied target, ``OSError``
    for a failed move) after rolling back.
    """
    # The unit's destinations must be pairwise distinct: two entries writing the
    # same target (e.g. a filenamePattern that gives the main a sidecar
    # extension, or two sidecars colliding) would silently clobber each other
    # since a target that doesn't exist yet passes the per-entry guard below.
    # Reject up front, before anything moves. Keys are casefolded so a pair that
    # differs only in case (``B.XMP`` vs ``B.xmp`` — the same file on a
    # case-insensitive filesystem) is rejected too; we do this unconditionally
    # (even on a case-sensitive filesystem) since a unit whose destinations
    # differ only in case is never intended, and deterministic cross-platform
    # behaviour beats a per-directory filesystem probe. This compares
    # destinations to each other, never src to dst, so a legitimate case-only
    # *rename* of one file is unaffected.
    all_dsts = [main_dst, *(sc_dst for _sc_src, sc_dst in sidecar_pairs)]
    seen: set[str] = set()
    for d in all_dsts:
        key = str(d).casefold()
        if key in seen:
            raise FileExistsError(f"målnamn krockar inom operationen: {d.name}")
        seen.add(key)

    _guard_target(main_src, main_dst)
    for sc_src, sc_dst in sidecar_pairs:
        _guard_target(sc_src, sc_dst)

    done: list[tuple[Path, Path]] = []
    try:
        safe_swap_rename(main_src, main_dst)
        done.append((main_src, main_dst))
        for sc_src, sc_dst in sidecar_pairs:
            safe_swap_rename(sc_src, sc_dst)
            done.append((sc_src, sc_dst))
    except Exception:
        for moved_src, moved_dst in reversed(done):
            try:
                safe_swap_rename(moved_dst, moved_src)
            except Exception:
                logger.exception("[fs_ops] rollback failed for %s", moved_dst)
        raise

    # Atomic unit: on success every sidecar pair moved, so record them all.
    record(op=journal_op, tool=tool, batch_id=batch_id or new_batch_id(),
           src=main_src, dst=main_dst, sidecars=list(sidecar_pairs))
    return done


def _guard_target(src: Path, dst: Path) -> None:
    """Refuse to overwrite: raise if dst exists and is not src (case-only ok)."""
    if dst.exists() and not dst.samefile(src):
        raise FileExistsError(f"målnamn upptaget: {dst.name}")


# ---------------------------------------------------------------------------
# Two-pass batch rename (src→temp→dst; never-overwrite; restore on collision)
# ---------------------------------------------------------------------------

def two_pass_rename(
    pairs: Sequence[tuple[Path, Path]],
    *,
    tool: str,
    sidecar_exts: Sequence[str] = (),
    find_sidecars: Callable[[Path, Sequence[str]], Iterable[Path]] | None = None,
    journal_op: str = "rename",
    tmp_prefix: str = ".rename_tmp",
    log_prefix: str = "fs_ops",
) -> dict:
    """Move a batch of (main src, main dst) pairs via unique temp names.

    Pass 1 moves every source to a hidden temp in its own directory; pass 2 moves
    each temp to its destination, never overwriting an existing file and
    restoring the original (from its temp) on collision. The temp indirection
    lets a batch whose destinations overlap other *sources* (burst renumbering)
    resolve without spurious collisions.

    Each ``.<sidecar-ext>`` sidecar of a source (found via ``find_sidecars``) is
    carried to the destination's stem, **grouped with its main file's fate**: if
    the main is skipped (target taken) or fails, its sidecars are restored too —
    never left orphaned at the new stem. The reverse does not hold: a sidecar's
    own target collision skips just that sidecar and never fells its main.

    Journals one row per main file whose move completes, carrying the sidecars
    that actually landed with it (a skipped/failed sidecar is left out of the
    row, matching the on-disk delta). Returns ``{"renamed": [{from, to}],
    "skipped": [...], "errors": [...]}`` (Swedish reason/error strings, matching
    the prior per-service implementations).
    """
    # A per-batch uuid (not just the pid) makes the temp names exclusive: a
    # leftover ``.<tmp_prefix>_<pid>_..._<n>`` from an earlier crashed batch
    # carries a different uuid, so pass 1's ``src.rename(tmp)`` (which silently
    # replaces an existing file on POSIX) can never destroy it.
    stamp = f"{os.getpid()}_{uuid.uuid4().hex}"
    batch_id = new_batch_id()

    # Build move units: each main paired with its sidecars, each entry given a
    # fresh unique temp name. Grouping (vs a flat list) is what lets a sidecar
    # share its main's pass-2 fate.
    units: list[dict] = []
    ctr = 0
    for src, dst in pairs:
        main = (src, dst, src.parent / f"{tmp_prefix}_{stamp}_{ctr}{src.suffix}")
        ctr += 1
        sidecars: list[tuple[Path, Path, Path]] = []
        if sidecar_exts and find_sidecars is not None:
            for sc in find_sidecars(src, sidecar_exts):
                sc_dst = dst.with_name(f"{dst.stem}{sc.suffix}")
                if sc.name == sc_dst.name:
                    continue
                sidecars.append((sc, sc_dst, sc.parent / f"{tmp_prefix}_{stamp}_{ctr}{sc.suffix}"))
                ctr += 1
        units.append({"main": main, "sidecars": sidecars})

    renamed: list[dict] = []
    skipped: list[dict] = []
    errors: list[dict] = []

    # Pass 1: src -> temp, for every entry. Record per-entry whether it moved so
    # pass 2 only touches temps that exist.
    for unit in units:
        unit["main_moved"] = _move_to_temp(*unit["main"], log_prefix, errors)
        unit["sc_moved"] = [_move_to_temp(*sc, log_prefix, errors) for sc in unit["sidecars"]]

    # Pass 2: temp -> dst, never overwriting; restore on collision. Sidecars
    # follow their main: only placed if the main lands, restored if it doesn't.
    for unit in units:
        src, dst, tmp = unit["main"]
        sidecars = unit["sidecars"]
        sc_moved = unit["sc_moved"]

        if not unit["main_moved"]:
            # Main never reached its temp (pass-1 error already recorded); its
            # sidecars must not move without it.
            _restore_moved_sidecars(sidecars, sc_moved, log_prefix, errors)
            continue

        if dst.exists():
            if _restore_tmp(tmp, src, log_prefix):
                skipped.append({"path": str(src), "reason": f"målnamn upptaget: {dst.name}"})
            else:
                errors.append({"path": str(tmp),
                               "error": f"kan ej återställa: {src.name} upptaget — fil kvar som {tmp.name}"})
            _restore_moved_sidecars(sidecars, sc_moved, log_prefix, errors)
            continue

        try:
            tmp.rename(dst)
        except OSError as e:
            logger.error("[%s] to-final failed: %s -> %s: %s", log_prefix, tmp, dst, e)
            if _restore_tmp(tmp, src, log_prefix):
                errors.append({"path": str(src), "error": str(e)})
            else:
                errors.append({"path": str(tmp),
                               "error": f"{e}; kunde ej återställa (fil kvar som {tmp.name})"})
            _restore_moved_sidecars(sidecars, sc_moved, log_prefix, errors)
            continue

        # Main placed — place its sidecars, then journal main + the sidecars that
        # actually landed. A sidecar collision or failure skips just that sidecar
        # (the main stays put) and keeps it out of the row.
        renamed.append({"from": src.name, "to": dst.name})
        landed_sidecars: list[tuple[Path, Path]] = []
        for (sc_src, sc_dst, sc_tmp), was_moved in zip(sidecars, sc_moved):
            if not was_moved:
                continue
            if sc_dst.exists():
                if _restore_tmp(sc_tmp, sc_src, log_prefix):
                    skipped.append({"path": str(sc_src), "reason": f"målnamn upptaget: {sc_dst.name}"})
                else:
                    errors.append({"path": str(sc_tmp),
                                   "error": f"kan ej återställa: {sc_src.name} upptaget — fil kvar som {sc_tmp.name}"})
                continue
            try:
                sc_tmp.rename(sc_dst)
                renamed.append({"from": sc_src.name, "to": sc_dst.name})
                landed_sidecars.append((sc_src, sc_dst))
            except OSError as e:
                logger.error("[%s] sidecar to-final failed: %s -> %s: %s", log_prefix, sc_tmp, sc_dst, e)
                if _restore_tmp(sc_tmp, sc_src, log_prefix):
                    errors.append({"path": str(sc_src), "error": str(e)})
                else:
                    errors.append({"path": str(sc_tmp),
                                   "error": f"{e}; kunde ej återställa (fil kvar som {sc_tmp.name})"})
        record(op=journal_op, tool=tool, batch_id=batch_id, src=src, dst=dst,
               sidecars=landed_sidecars)

    return {"renamed": renamed, "skipped": skipped, "errors": errors}


def _move_to_temp(src: Path, dst: Path, tmp: Path, log_prefix: str, errors: list) -> bool:
    """Rename src→tmp (pass 1). Returns True on success; records an error else.

    Never moves onto an occupied temp name (a backstop to the uuid stamp — a
    rename would silently clobber it on POSIX).
    """
    if tmp.exists():
        logger.error("[%s] temp name occupied, skipping: %s -> %s", log_prefix, src, tmp)
        errors.append({"path": str(src), "error": f"temp-namn upptaget: {tmp.name}"})
        return False
    try:
        src.rename(tmp)
        return True
    except OSError as e:
        logger.error("[%s] to-temp failed: %s -> %s: %s", log_prefix, src, tmp, e)
        errors.append({"path": str(src), "error": str(e)})
        return False


def _restore_moved_sidecars(sidecars, sc_moved, log_prefix: str, errors: list) -> None:
    """Restore every sidecar that reached its temp back to its original name."""
    for (sc_src, _sc_dst, sc_tmp), was_moved in zip(sidecars, sc_moved):
        if was_moved and not _restore_tmp(sc_tmp, sc_src, log_prefix):
            errors.append({"path": str(sc_tmp),
                           "error": f"kan ej återställa: {sc_src.name} — fil kvar som {sc_tmp.name}"})


def _restore_tmp(tmp: Path, src: Path, log_prefix: str) -> bool:
    """Move a temp back to its original name, NEVER overwriting an existing file.

    Returns False (leaving the temp in place) if ``src`` is occupied — better a
    recoverable hidden temp than clobbering a sibling already placed at that name
    in this same pass.
    """
    if src.exists():
        return False
    try:
        tmp.rename(src)
        return True
    except OSError as e:
        logger.error("[%s] restore failed: %s -> %s: %s", log_prefix, tmp, src, e)
        return False


# ---------------------------------------------------------------------------
# Import target resolution (byte-identical skip + -N disambiguation)
# ---------------------------------------------------------------------------

def same_file(a: Path, b: Path) -> bool:
    """True if two files are byte-identical (filecmp short-circuits on size)."""
    import filecmp
    try:
        return filecmp.cmp(str(a), str(b), shallow=False)
    except OSError:
        return False


def resolve_import_target(dest: Path, name: str, src: Path) -> Path | None:
    """Where to write ``src`` in ``dest``, or None if an identical copy exists.

    Skips byte-identical re-imports — checking the base name AND any earlier
    ``-N`` disambiguation variant, so re-importing is idempotent — and otherwise
    returns the next free ``<stem>-N<suffix>`` so a distinct same-named frame is
    never dropped.
    """
    target = dest / name
    if not target.exists():
        return target
    if same_file(src, target):
        return None
    stem, suffix = os.path.splitext(name)
    i = 1
    while True:
        cand = dest / f"{stem}-{i}{suffix}"
        if not cand.exists():
            return cand
        if same_file(src, cand):
            return None
        i += 1


# ---------------------------------------------------------------------------
# Undo: replay a batch's recorded moves backwards
# ---------------------------------------------------------------------------

def revert_batch(batch_rows: Sequence[dict], *, tool: str = "undo") -> dict:
    """Reverse a batch's recorded moves (``dst → src``), literally, then journal.

    Each row's main move and every listed sidecar is replayed backwards. A move
    whose recorded ``dst`` no longer exists is skipped up front (nothing to move);
    the rest run through the shared two-pass mover, so within-batch chains (burst
    renumbering, where one file's original name is another's current name) resolve
    cleanly and no original path is ever overwritten. Sidecars are **literal** —
    only the exact paths the row recorded are touched, never re-derived.

    The successful reversals are journaled by ``two_pass_rename`` as a fresh batch
    (op ``rename``, the given ``tool``, one row per file), so the undo is itself
    undoable (redo). Returns::

        {"results": [{path, status: reverted|skipped|error, reason}],
         "reverted": int, "skipped": int, "errors": int,
         "reverted_mains": [{"original": renamed_path, "new": restored_path}, ...]}

    ``reverted_mains`` lists the main files that came back, in the
    ``{"original", "new"}`` shape the face-DB path repair expects — ``original``
    is where the file sat (the recorded ``dst``), ``new`` its restored original
    path — so the caller can repoint ``known_faces``/``processed_files`` entries
    off the now-gone renamed name and back onto the original.
    """
    results: list[dict] = []
    eligible: list[tuple[Path, Path, bool]] = []
    for frm, to, is_main in _flatten_reverse_moves(batch_rows):
        if not frm.exists():
            results.append({"path": str(frm), "status": "skipped",
                            "reason": "filen saknas — redan flyttad eller borttagen"})
            continue
        eligible.append((frm, to, is_main))

    move_res = two_pass_rename(
        [(frm, to) for frm, to, _ in eligible],
        tool=tool, journal_op="rename",
        tmp_prefix=".undo_tmp", log_prefix="Undo",
    )
    skipped_by_path = {s["path"]: s["reason"] for s in move_res["skipped"]}
    errors_by_path = {e["path"]: e["error"] for e in move_res["errors"]}

    reverted_mains: list[dict] = []
    for frm, to, is_main in eligible:
        key = str(frm)
        if key in errors_by_path:
            results.append({"path": key, "status": "error", "reason": errors_by_path.pop(key)})
        elif key in skipped_by_path:
            results.append({"path": key, "status": "skipped", "reason": skipped_by_path[key]})
        else:
            results.append({"path": key, "status": "reverted", "reason": None})
            if is_main:
                reverted_mains.append({"original": key, "new": str(to)})
    # Any remaining errors are keyed by a leftover temp path (a rare
    # restore-after-failure) — surface them so nothing is hidden.
    for key, err in errors_by_path.items():
        results.append({"path": key, "status": "error", "reason": err})

    return {
        "results": results,
        "reverted": sum(1 for r in results if r["status"] == "reverted"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "errors": sum(1 for r in results if r["status"] == "error"),
        "reverted_mains": reverted_mains,
    }
