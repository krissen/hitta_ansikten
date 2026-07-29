#!/usr/bin/env python3
"""Bulk-restore benchmark source images from the restic archive into local staging.

Read-only against kailash/restic: each file is fetched with ``restic dump`` executed
on kailash and streamed to this machine (nothing is written on kailash). Every
restored file is SHA1-verified against the DB's recorded hash. Resumable: entries
already verified in the manifest are skipped.

Writes ONLY under ``~/.local/share/faceid/benchmark_staging/`` and the manifest at
``backend/benchmarks/_data/restore_manifest.json``.

Usage (from anywhere)::

    python3 restore_from_backup.py [--workers N] [--limit N] [--dry-run]

.. warning::

   **The input worklist is not currently reproducible.** This script reads
   ``_data/restore_worklist.json``, which was generated ad hoc during the B2
   restore and never committed (``_data/`` is gitignored). No tooling in this
   repository regenerates it, so the script cannot be run as-is; the restic
   dump + SHA1-verification logic below is preserved for when a restore is
   needed again, and the worklist would have to be rebuilt first.

   Expected shape — a JSON list of objects with:

   * ``sha1`` — the hash recorded in the face database, used both to skip
     already-verified entries and to verify each restored file
   * ``recorded_basenames`` — candidate filenames as recorded in the database
   * ``candidates`` — archive paths to try with ``restic dump``
   * ``face_count`` — faces recorded for the image, used for reporting

   ``_data/restore_manifest.json`` from the original run *is* present locally
   and is what makes the process resumable.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import subprocess
import threading
import time

HOME = os.path.expanduser("~")
# Resolved from this file's own location so the script keeps working when run
# from anywhere, and regardless of where the repository is checked out.
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_data")
WORKLIST = os.path.join(DATA, "restore_worklist.json")
MANIFEST = os.path.join(DATA, "restore_manifest.json")
STAGING = os.path.join(HOME, ".local/share/faceid/benchmark_staging")

SSH_HOST = "kailash"
RESTIC = (
    "restic -r rclone:hetzner:restic-repo "
    "--password-file=\"$HOME/.config/restic-password\" "
    "-o rclone.args=\"serve restic --stdio --low-level-retries 30 --retries 5\" "
    "--no-lock"
)
DUMP_RETRIES = 3
CHUNK = 1 << 16


def sha1_file(path: str) -> str | None:
    h = hashlib.sha1()
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(CHUNK), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def event_of(basename: str) -> str:
    return basename[:6] if basename[:6].isdigit() else "misc"


def staged_path(sha1: str, basename: str) -> str:
    ev = event_of(basename)
    return os.path.join(STAGING, ev, f"{sha1[:10]}__{basename}")


def dump_to(snapshot: str, archive_path: str, dest_tmp: str) -> tuple[bool, str]:
    """restic dump one file from kailash to dest_tmp. Returns (ok, stderr_tail)."""
    remote = f'{RESTIC} dump {snapshot} "{archive_path}"'
    for attempt in range(1, DUMP_RETRIES + 1):
        try:
            with open(dest_tmp, "wb") as out:
                proc = subprocess.run(
                    ["ssh", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
                     SSH_HOST, remote],
                    stdout=out,
                    stderr=subprocess.PIPE,
                    timeout=600,
                )
            if proc.returncode == 0 and os.path.getsize(dest_tmp) > 0:
                return True, ""
            err = proc.stderr.decode("utf-8", "replace")[-400:]
        except (subprocess.TimeoutExpired, OSError) as exc:
            err = f"{type(exc).__name__}: {exc}"
        if attempt < DUMP_RETRIES:
            time.sleep(2 * attempt)
    return False, err


class Manifest:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()
        self.by_sha1: dict[str, dict] = {}
        if os.path.exists(path):
            try:
                for rec in json.load(open(path, encoding="utf-8")):
                    self.by_sha1[rec["sha1"]] = rec
            except (OSError, json.JSONDecodeError):
                pass
        self._dirty = 0

    def verified_sha1s(self) -> set[str]:
        return {
            s for s, r in self.by_sha1.items()
            if r.get("verified") and r.get("staged_path") and os.path.exists(r["staged_path"])
        }

    def update(self, rec: dict, flush_every: int = 20):
        with self.lock:
            self.by_sha1[rec["sha1"]] = rec
            self._dirty += 1
            if self._dirty >= flush_every:
                self._flush_locked()
                self._dirty = 0

    def flush(self):
        with self.lock:
            self._flush_locked()
            self._dirty = 0

    def _flush_locked(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(list(self.by_sha1.values()), fh, indent=2, ensure_ascii=False)
        os.replace(tmp, self.path)


def process_entry(entry: dict, manifest: Manifest, counters: dict, clock: dict) -> None:
    sha1 = entry["sha1"]
    basename = entry["recorded_basenames"][0]
    dest = staged_path(sha1, basename)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".tmp"

    last_hash = None
    last_bytes = 0
    used = None
    for cand in entry["candidates"]:
        ok, err = dump_to(cand["snapshot"], cand["path"], tmp)
        if not ok:
            continue
        got = sha1_file(tmp)
        last_hash = got
        last_bytes = os.path.getsize(tmp)
        if got == sha1:
            os.replace(tmp, dest)
            used = cand
            rec = {
                "sha1": sha1, "basename": basename, "staged_path": dest,
                "expected_sha1": sha1, "restored_sha1": got, "verified": True,
                "bytes": last_bytes, "face_count": entry["face_count"],
                "archive_path": cand["path"], "snapshot": cand["snapshot"],
            }
            manifest.update(rec)
            with manifest.lock:
                counters["verified"] += 1
                counters["bytes"] += last_bytes
                counters["done"] += 1
            _progress(counters, clock, entry)
            return
    # No candidate matched the recorded hash: keep last dump (if any) as mismatch.
    if last_hash is not None:
        os.replace(tmp, dest)
        rec = {
            "sha1": sha1, "basename": basename, "staged_path": dest,
            "expected_sha1": sha1, "restored_sha1": last_hash, "verified": False,
            "bytes": last_bytes, "face_count": entry["face_count"],
            "archive_path": entry["candidates"][0]["path"], "snapshot": None,
            "note": "hash_mismatch",
        }
    else:
        if os.path.exists(tmp):
            os.remove(tmp)
        rec = {
            "sha1": sha1, "basename": basename, "staged_path": None,
            "expected_sha1": sha1, "restored_sha1": None, "verified": False,
            "bytes": 0, "face_count": entry["face_count"], "note": "dump_failed",
        }
    manifest.update(rec)
    with manifest.lock:
        counters["failed"] += 1
        counters["done"] += 1
    _progress(counters, clock, entry)


def _progress(counters: dict, clock: dict, entry: dict) -> None:
    done = counters["done"]
    if done % 25 == 0 or done == counters["total"]:
        elapsed = time.time() - clock["start"]
        rate = done / elapsed if elapsed else 0
        remaining = (counters["total"] - done) / rate if rate else 0
        gb = counters["bytes"] / 1e9
        print(
            f"[{done}/{counters['total']}] verified={counters['verified']} "
            f"failed={counters['failed']} {gb:.1f}GB "
            f"{rate*60:.1f} files/min ETA {remaining/60:.0f}min",
            flush=True,
        )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    os.makedirs(STAGING, exist_ok=True)
    worklist = json.load(open(WORKLIST, encoding="utf-8"))
    manifest = Manifest(MANIFEST)
    already = manifest.verified_sha1s()

    todo = [e for e in worklist if e["sha1"] not in already]
    if args.limit:
        todo = todo[: args.limit]

    print(f"worklist={len(worklist)} already_verified={len(already)} todo={len(todo)} "
          f"workers={args.workers}", flush=True)
    if args.dry_run:
        for e in todo[:5]:
            print("would restore", e["sha1"][:12], e["recorded_basenames"][0])
        return 0

    counters = {"total": len(todo), "done": 0, "verified": 0, "failed": 0, "bytes": 0}
    clock = {"start": time.time()}

    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(process_entry, e, manifest, counters, clock) for e in todo]
        for f in cf.as_completed(futs):
            exc = f.exception()
            if exc:
                print("worker error:", exc, flush=True)
    manifest.flush()

    elapsed = time.time() - clock["start"]
    print(f"DONE in {elapsed/60:.1f}min verified={counters['verified']} "
          f"failed={counters['failed']} bytes={counters['bytes']} "
          f"({counters['bytes']/1e9:.1f}GB)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
