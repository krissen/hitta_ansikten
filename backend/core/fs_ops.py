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

# Only a same-directory ``rename`` is safely undoable in PR 2. ``move`` (card
# import → disk, often across filesystems) would need a cross-device move back —
# ``Path.rename`` raises EXDEV over a device boundary, so the undo would fail in
# exactly the normal import case, and moving back onto a card that may already be
# ejected is dubious. ``copy`` would need a delete, and ``trash``/``restore``
# already undo via the culling trash manifest. All of those are reported
# non-undoable and refused by the undo endpoint (see ROADMAP for a future
# cross-device move-back).
UNDOABLE_OPS = ("rename",)


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


def _plan_revert(batch_rows: Sequence[dict]) -> list[dict]:
    """Predict the per-file outcome of reverting a batch — the SAME all-or-nothing
    unit decision ``revert_batch``'s strict execution makes, so a preview never
    promises a revert the execute then skips. Pure (no filesystem change).

    Each journal row is one unit (main + its recorded sidecars). A file whose
    recorded ``dst`` no longer exists is skipped: a missing main skips its whole
    row; a missing sidecar is dropped from the unit (its main can still come back)
    and reported skipped. A unit is skipped if any of its original destinations is
    occupied by an *unrelated* file — a destination taken only by another batch
    source is free, since that source moves away first (the temp indirection),
    which is how burst-renumber chains resolve. Otherwise the whole unit reverts.

    Returns ``{path, from, to, from_name, to_name, status, reason}`` per file,
    ``status`` ``"reverted"`` or ``"skipped"``. Path-state only: the journal
    carries no content fingerprint (see docs/dev/database.md).
    """
    # Every current source that will move away; a destination occupied only by
    # one of these is free (mirrors the two-pass mover's pass-1 source vacation).
    sources = {str(frm) for frm, _to, _m in _flatten_reverse_moves(batch_rows) if frm.exists()}

    plan: list[dict] = []

    def _emit(frm: Path, to: Path, status: str, reason):
        plan.append({"path": str(frm), "from": str(frm), "to": str(to),
                     "from_name": frm.name, "to_name": to.name,
                     "status": status, "reason": reason})

    for row in batch_rows:
        main_frm, main_to = Path(row["dst"]), Path(row["src"])
        row_sidecars = [(Path(sc["dst"]), Path(sc["src"])) for sc in row.get("sidecars", []) or []]

        if not main_frm.exists():
            # The whole row can't be reverted (nothing to move the main from).
            _emit(main_frm, main_to, "skipped", "filen saknas — redan flyttad eller borttagen")
            for sc_frm, sc_to in row_sidecars:
                _emit(sc_frm, sc_to, "skipped", "hoppas över — huvudfilen kunde inte ångras")
            continue

        present = [(f, t) for f, t in row_sidecars if f.exists()]
        missing = [(f, t) for f, t in row_sidecars if not f.exists()]

        # Unit destinations (main first, then present sidecars): the unit reverts
        # only if none is blocked by an unrelated file. A destination that exists
        # but is a batch source, or a case-only self-rename, is not a blocker.
        blocker = None
        for frm, to in [(main_frm, main_to), *present]:
            if to.exists() and str(to) not in sources and not _is_case_only_same(to, frm):
                blocker = to
                break
        if blocker is not None:
            status, reason = "skipped", f"målnamn upptaget: {blocker.name}"
        else:
            status, reason = "reverted", None

        _emit(main_frm, main_to, status, reason)
        for sc_frm, sc_to in present:
            _emit(sc_frm, sc_to, status, reason)
        # A missing sidecar is skipped regardless of the unit's fate.
        for sc_frm, sc_to in missing:
            _emit(sc_frm, sc_to, "skipped", "filen saknas — redan flyttad eller borttagen")

    return plan


def preview_revert(batch_rows: Sequence[dict]) -> list[dict]:
    """Per-file dry-run of reversing a batch — no filesystem change.

    Thin wrapper over the shared ``_plan_revert`` predictor (the same decision the
    strict execute makes), mapping its ``reverted``/``skipped`` status to the UI's
    ``ok``/``skip``. Grouping by journal row is what keeps the preview honest: a
    unit whose main is gone, or any of whose destinations is blocked, is shown
    fully skipped rather than promising a partial revert the execute won't do.
    """
    return [
        {"from": p["from"], "to": p["to"],
         "from_name": p["from_name"], "to_name": p["to_name"],
         "status": "ok" if p["status"] == "reverted" else "skip",
         "reason": p["reason"]}
        for p in _plan_revert(batch_rows)
    ]


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
    sidecars_for: Callable[[Path, Path], Sequence[tuple[Path, Path]]] | None = None,
    strict_units: bool = False,
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

    Sidecars are attached to each main two ways. The forward flows derive them:
    each ``.<sidecar-ext>`` sidecar of a source (found via ``find_sidecars``) is
    carried to the destination's stem. Undo passes them **explicitly** via
    ``sidecars_for(main_src, main_dst) -> [(sc_src, sc_dst), ...]`` (the literal
    pairs a journal row recorded — never re-derived); when given, it supersedes
    the ``find_sidecars`` derivation.

    ``strict_units`` chooses the pass-2 sidecar policy:

    * **Lenient** (default, forward flows): a sidecar is grouped with its main's
      fate — if the main is skipped/fails its sidecars are restored too — but a
      sidecar's *own* target collision skips just that sidecar and never fells its
      main (the PR-1 invariant: a row records exactly what moved).
    * **Strict** (undo/redo): the whole unit is all-or-nothing. Before the main
      leaves its temp, every destination in the unit (main + each moved sidecar)
      must be free; if any is occupied the entire unit is restored and skipped
      (no journal row). A failure while placing part of the unit rolls the whole
      unit back. This stops a reverted main from pairing with an unrelated
      pre-existing sidecar at the target stem while the real sidecar is orphaned.

    Journals one row per main file whose move completes, carrying the sidecars
    that actually landed with it. Returns ``{"renamed": [{from, to}],
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
        if sidecars_for is not None:
            # Explicit literal pairs (undo): use exactly what the caller recorded.
            for sc_src, sc_dst in sidecars_for(src, dst):
                sidecars.append((sc_src, sc_dst, sc_src.parent / f"{tmp_prefix}_{stamp}_{ctr}{sc_src.suffix}"))
                ctr += 1
        elif sidecar_exts and find_sidecars is not None:
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

        if strict_units:
            _place_unit_strict(
                unit, tool=tool, journal_op=journal_op, batch_id=batch_id,
                log_prefix=log_prefix, renamed=renamed, skipped=skipped, errors=errors)
            continue

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


def _place_unit_strict(unit, *, tool, journal_op, batch_id, log_prefix,
                       renamed: list, skipped: list, errors: list) -> None:
    """Pass-2 placement for one all-or-nothing unit (main + explicit sidecars).

    Restores the whole unit and skips (no journal row) if any destination is
    occupied, and on a mid-placement failure restores the whole unit — the
    members that already landed (final → source) AND every member still sitting at
    its temp (the one whose rename raised and any not-yet-attempted), so a locked
    or permission error never leaves hidden ``.undo_tmp*`` files behind while
    their visible original names are gone. So a reverted main never lands while
    one of its sidecars is left at the old name (or paired with an unrelated file
    already at the target stem).
    """
    src, dst, tmp = unit["main"]
    sidecars = unit["sidecars"]
    sc_moved = unit["sc_moved"]

    if not unit["main_moved"]:
        # Main never reached its temp (pass-1 error already recorded); its
        # sidecars must not move without it.
        _restore_moved_sidecars(sidecars, sc_moved, log_prefix, errors)
        return

    moved = [(sc_src, sc_dst, sc_tmp)
             for (sc_src, sc_dst, sc_tmp), was in zip(sidecars, sc_moved) if was]

    # Every unit member as (original_src, temp) — all currently sit at their temp.
    unit_entries: list[tuple[Path, Path]] = [(src, tmp),
                                             *((sc_src, sc_tmp) for sc_src, _sc_dst, sc_tmp in moved)]

    def _restore_all_temps():
        # Every member is still at its temp — move each back to its source,
        # never overwriting (a source taken → leave the temp, reported by caller).
        for original_src, temp in unit_entries:
            _restore_tmp(temp, original_src, log_prefix)

    # A sidecar that couldn't even reach its temp makes the all-or-nothing unit
    # unfulfillable — restore what moved and fail the whole unit.
    if not all(sc_moved):
        _restore_all_temps()
        errors.append({"path": str(src),
                       "error": "kan ej ångra hela enheten — en sidecar saknas"})
        return

    # Every destination in the unit must be free before anything is placed.
    blocker = None
    if dst.exists():
        blocker = dst
    else:
        blocker = next((sc_dst for _s, sc_dst, _t in moved if sc_dst.exists()), None)
    if blocker is not None:
        _restore_all_temps()
        skipped.append({"path": str(src), "reason": f"målnamn upptaget: {blocker.name}"})
        return

    # Place main + sidecars; on any failure roll the WHOLE unit back — both the
    # members that already landed (final -> source) AND every member still at its
    # temp: the one whose rename raised and any not-yet-attempted. Otherwise a
    # locked/permission error would leave hidden `.undo_tmp*` files while their
    # visible original names are gone, orphaning files despite all-or-nothing.
    placed: list[tuple[Path, Path]] = []  # (final_path, original_src)
    try:
        tmp.rename(dst)
        placed.append((dst, src))
        for sc_src, sc_dst, sc_tmp in moved:
            sc_tmp.rename(sc_dst)
            placed.append((sc_dst, sc_src))
    except OSError as e:
        logger.error("[%s] strict unit placement failed: %s -> %s: %s", log_prefix, tmp, dst, e)
        placed_srcs = {original_src for _final, original_src in placed}
        # (a) reverse the members that landed: final -> source (never overwrite).
        for final_path, original_src in reversed(placed):
            _restore_tmp(final_path, original_src, log_prefix)
        # (b)+(c) the failing member and any not-yet-placed members are still at
        # their temps: restore those too.
        for original_src, temp in unit_entries:
            if original_src not in placed_srcs:
                _restore_tmp(temp, original_src, log_prefix)
        errors.append({"path": str(src), "error": str(e)})
        return

    renamed.append({"from": src.name, "to": dst.name})
    landed: list[tuple[Path, Path]] = []
    for sc_src, sc_dst, _sc_tmp in moved:
        renamed.append({"from": sc_src.name, "to": sc_dst.name})
        landed.append((sc_src, sc_dst))
    record(op=journal_op, tool=tool, batch_id=batch_id, src=src, dst=dst, sidecars=landed)


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

    Each journal row is reversed as ONE all-or-nothing unit — the main move
    (``dst → src``) plus every listed sidecar (``dst → src``, literal, never
    re-derived). The units run through the shared two-pass mover in strict mode,
    so within-batch chains (burst renumbering, where one file's original name is
    another's current name) still resolve via temp indirection, no original path
    is ever overwritten, and a row is reverted only if its whole unit can be — a
    reverted main is never paired with an unrelated sidecar while the real one is
    orphaned (see ``strict_units`` in ``two_pass_rename``).

    A file whose recorded ``dst`` no longer exists is skipped up front (nothing to
    move): a missing main skips its whole row; a missing sidecar is dropped from
    its unit (the main can still come back) and reported skipped.

    The successful reversals are journaled by ``two_pass_rename`` as a fresh batch
    (op ``rename``, the given ``tool``, one row per reverted unit), so the undo is
    itself undoable (redo). Returns::

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
    main_pairs: list[tuple[Path, Path]] = []
    # str(main_from) -> [(sc_from, sc_to), ...] for the sidecars whose source
    # still exists; two_pass reads it back per main via ``sidecars_for``.
    sidecars_by_main: dict[str, list[tuple[Path, Path]]] = {}

    for row in batch_rows:
        main_frm, main_to = Path(row["dst"]), Path(row["src"])
        if not main_frm.exists():
            # The whole row can't be reverted: report the main and its sidecars.
            results.append({"path": str(main_frm), "status": "skipped",
                            "reason": "filen saknas — redan flyttad eller borttagen"})
            for sc in row.get("sidecars", []) or []:
                results.append({"path": str(Path(sc["dst"])), "status": "skipped",
                                "reason": "hoppas över — huvudfilen kunde inte ångras"})
            continue
        sc_pairs: list[tuple[Path, Path]] = []
        for sc in row.get("sidecars", []) or []:
            sc_frm, sc_to = Path(sc["dst"]), Path(sc["src"])
            if not sc_frm.exists():
                results.append({"path": str(sc_frm), "status": "skipped",
                                "reason": "filen saknas — redan flyttad eller borttagen"})
                continue
            sc_pairs.append((sc_frm, sc_to))
        main_pairs.append((main_frm, main_to))
        sidecars_by_main[str(main_frm)] = sc_pairs

    move_res = two_pass_rename(
        main_pairs, tool=tool, journal_op="rename",
        sidecars_for=lambda ms, _md: sidecars_by_main.get(str(ms), []),
        strict_units=True, tmp_prefix=".undo_tmp", log_prefix="Undo",
    )
    # Strict units skip/error at the unit level, keyed on the main's source path.
    skipped_by_main = {s["path"]: s["reason"] for s in move_res["skipped"]}
    errors_by_main = {e["path"]: e["error"] for e in move_res["errors"]}

    reverted_mains: list[dict] = []
    for main_frm, main_to in main_pairs:
        key = str(main_frm)
        sc_pairs = sidecars_by_main.get(key, [])
        if key in errors_by_main:
            status, reason = "error", errors_by_main[key]
        elif key in skipped_by_main:
            status, reason = "skipped", skipped_by_main[key]
        else:
            status, reason = "reverted", None
            reverted_mains.append({"original": key, "new": str(main_to)})
        results.append({"path": key, "status": status, "reason": reason})
        # Sidecars share their main's fate under all-or-nothing.
        for sc_frm, _sc_to in sc_pairs:
            results.append({"path": str(sc_frm), "status": status,
                            "reason": None if status == "reverted" else reason})

    return {
        "results": results,
        "reverted": sum(1 for r in results if r["status"] == "reverted"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "errors": sum(1 for r in results if r["status"] == "error"),
        "reverted_mains": reverted_mains,
    }
