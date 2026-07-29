"""
naming.py - Filename and person-name helpers for Ansikten.

Pure(-ish) helpers that map person names to short, filesystem-safe forms and
build/parse the YYMMDD_HHMMSS[_names].NEF filename convention. Moved out of the
hitta_ansikten monolith so the API no longer needs to import the CLI entry point.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from pathlib import Path

from core.db import get_file_hash, load_attempt_log

# Label markers that mean "this face is not a person" — the reviewer skipped it,
# or the identity is unknown. Compare case-folded. ``okant`` is the ASCII
# spelling of ``okänt``; both occur in the log.
#
# This is the canonical set. Near-copies still exist elsewhere (``core/db.py``,
# ``api/services/rename_service.py``, ``api/services/statistics_service.py``)
# and they do not all agree — ``db.py`` omits ``okant``. Consolidating them
# changes application behaviour and belongs in its own change.
IGNORE_MARKERS: frozenset[str] = frozenset({"ignorerad", "ign", "okänt", "okant"})


def extract_prefix_suffix(fname: str) -> tuple[str | None, str | None]:
    """
    Returnera (prefix, suffix) där prefix = YYMMDD_HHMMSS eller YYMMDD_HHMMSS-2,
    suffix = .NEF
    """
    m = re.match(r"^(\d{6}_\d{6}(?:-\d+)?)(?:_[^.]*)?(\.NEF)$", fname, re.IGNORECASE)
    if not m:
        return None, None
    return m.group(1), m.group(2)

def is_unrenamed(fname: str) -> bool:
    """Returnera True om filnamn är YYMMDD_HHMMSS.NEF eller YYMMDD_HHMMSS-1.NEF etc."""
    prefix, suffix = extract_prefix_suffix(fname)
    return bool(prefix and suffix)

def record_previous_name(entry: dict, old_name: str) -> None:
    """Preserve an overwritten ``name`` in a processed_files entry.

    Appends ``old_name`` to the entry's ``previous_names`` list before its
    ``name`` field is replaced, so a name is never overwritten without a trace.
    The list is an append-only log (oldest first, most recent last) — it is not
    a stack: an undo that reverts a rename appends the reverted name too.

    Callers invoke this only when the name actually changes. Guards keep it
    additive and idempotent:
    - a falsy ``old_name`` is ignored;
    - a re-write to the same value (last element already ``old_name``) is a
      no-op, so an idempotent re-run never grows the list.

    The field is created on demand and read by nothing in the load path, so no
    consumer of processed_files needs to change.
    """
    if not old_name:
        return
    history = entry.get("previous_names")
    if not isinstance(history, list):
        history = []
    if history and history[-1] == old_name:
        return
    history.append(old_name)
    entry["previous_names"] = history


def collect_persons_for_files(
    filelist: list[Path | str],
    known_faces: dict[str, list],
    processed_files: list[dict] | None = None,
    attempt_log: list[dict] | None = None,
) -> dict[str, list[str]]:
    """
    Returnera dict: { filename: [namn, ...] }
    Merge-strategi: review-ordning först, sedan komplettera från encodings.
    """
    from pathlib import Path

    file_to_persons = {}
    hash_to_persons = {}

    for name, entries in known_faces.items():
        for entry in entries:
            if isinstance(entry, dict):
                f = entry.get("file")
                h = entry.get("hash")
                if f:
                    f = Path(f).name
                    file_to_persons.setdefault(f, []).append(name)
                if h:
                    hash_to_persons.setdefault(h, []).append(name)

    filehash_map = {}
    for f in filelist:
        fpath = Path(f)
        h = get_file_hash(fpath)
        filehash_map[fpath.name] = h

    if processed_files is None:
        processed_files = []
    processed_name_to_hash = {Path(x['name']).name: x.get('hash') for x in processed_files if isinstance(x, dict) and x.get('name')}

    if attempt_log is None:
        attempt_log = load_attempt_log()

    stats_by_hash = {}
    stats_by_name = {}
    basename_count = {}

    for entry in attempt_log:
        fn = Path(entry.get("filename", "")).name
        fh = entry.get("file_hash")
        if entry.get("used_attempt") is not None and entry.get("review_results"):
            idx = entry["used_attempt"]
            if idx < len(entry.get("labels_per_attempt", [])):
                res = entry["review_results"][idx]
                labels = entry["labels_per_attempt"][idx]
                if res == "ok" and labels:
                    persons = []
                    for lbl in labels:
                        label = lbl["label"] if isinstance(lbl, dict) else lbl
                        if "\n" in label:
                            namn = label.split("\n", 1)[1]
                            if namn.lower() not in IGNORE_MARKERS:
                                persons.append(namn)
                    if persons:
                        if fh:
                            stats_by_hash[fh] = persons
                        stats_by_name[fn] = persons
                        basename_count[fn] = basename_count.get(fn, 0) + 1

    result = {}
    for f in filelist:
        fname = Path(f).name
        h = filehash_map.get(fname) or processed_name_to_hash.get(fname)

        # Union of basename- and hash-matched names (deduped) — see rename_service.py.
        # Manual faces may be anchored by only one key, so neither match must be
        # suppressed by the other.
        encoding_persons = list(file_to_persons.get(fname, []))
        if h:
            for name in hash_to_persons.get(h, []):
                if name not in encoding_persons:
                    encoding_persons.append(name)

        review_persons = []
        if h and h in stats_by_hash:
            review_persons = stats_by_hash[h]
        elif fname in stats_by_name and basename_count.get(fname, 0) == 1:
            review_persons = stats_by_name[fname]

        if review_persons:
            persons = list(review_persons)
            for name in encoding_persons:
                if name not in persons:
                    persons.append(name)
        else:
            persons = encoding_persons

        result[fname] = persons
    return result

def normalize_name(name: str) -> str:
    """
    Normalize name by removing diacritics and sanitizing for safe filename use.

    Security: Replaces path separators and null bytes to prevent path traversal.
    """
    # Remove diacritics (Källa → Kalla, François → Francois)
    n = unicodedata.normalize('NFKD', name)
    n = "".join(c for c in n if not unicodedata.combining(c))

    # Sanitize for filesystem safety: remove path separators and null bytes
    # Replace / and \ with _ to prevent directory traversal
    n = n.replace('/', '_').replace('\\', '_').replace('\0', '_')

    return n

def split_fornamn_efternamn(namn: str) -> tuple[str, str]:
    # "Edvin Twedmark" => "Edvin", "Twedmark"
    parts = namn.strip().split()
    if len(parts) < 2:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])

def resolve_fornamn_dubletter(all_persons: list[str]) -> dict[str, str]:
    """
    all_persons: lista av alla personnamn (kan förekomma flera gånger)
    Returnerar dict namn → kortnamn (bara förnamn, eller förnamn+efternamnsbokstav om flera delar efternamn).
    """
    # Skapa map förnamn -> set av fulla namn (dvs. efternamn)
    fornamn_map = {}
    namn_map = {}
    for namn in set(all_persons):
        fornamn, efternamn = split_fornamn_efternamn(namn)
        if fornamn not in fornamn_map:
            fornamn_map[fornamn] = set()
        fornamn_map[fornamn].add(efternamn)
        namn_map[namn] = (fornamn, efternamn)
    # Bestäm för varje namn: bara förnamn om unikt, annars förnamn+efternamnsbokstav(ar)
    kortnamn = {}
    for namn, (fornamn, efternamn) in namn_map.items():
        efternamnset = fornamn_map[fornamn] - {""}
        if len(efternamnset) <= 1:
            # Endast ett efternamn för detta förnamn → endast förnamn behövs
            kortnamn[namn] = fornamn
        else:
            # Flera olika efternamn: bygg så många tecken från efternamn som krävs
            andra_efternamn = sorted(efternamnset - {efternamn})
            prefixlen = 1
            while any(efternamn[:prefixlen] == andra[:prefixlen] for andra in andra_efternamn):
                prefixlen += 1
            kortnamn[namn] = fornamn + (efternamn[:prefixlen] if efternamn else "")
    return kortnamn

def build_new_filename(fname: str, personer: list[str], namnmap: dict[str, str]) -> str | None:
    """
    Build new filename with person names.

    Security: Validates against path traversal attempts.
    """
    prefix, suffix = extract_prefix_suffix(fname)
    if not (prefix and suffix):
        return None
    fornamn_lista = []
    for namn in personer:
        kort = namnmap.get(namn)
        if kort:
            fornamn_lista.append(normalize_name(kort))
    if not fornamn_lista:
        return None
    namnstr = ",_".join(fornamn_lista)
    new_name = f"{prefix}_{namnstr}{suffix}"

    # Security: Validate no path traversal attempts
    if '..' in new_name or '/' in new_name or '\\' in new_name or '\0' in new_name:
        logging.error(f"[SECURITY] Rejected unsafe filename: {new_name}")
        return None

    return new_name
