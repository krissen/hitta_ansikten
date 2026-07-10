"""Stratification of face records for the benchmark feasibility report.

All functions are pure over a list of ``FaceRecord`` plus a set of resolved
SHA1 hashes (the source images currently present on disk), so they are fully
testable with a fabricated mini-DB.

Strata produced:
- ``is_manual`` faces vs detected faces
- bounding-box area quartiles (Q1 = smallest; ``no_bbox`` for missing boxes)
- sibling surname groups (identities sharing a surname) + the confirmed twin
  pair from ``distinct_pairs.json``
- per-event buckets keyed by the ``YYMMDD`` filename prefix
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from .db_access import FaceRecord


@dataclass
class GroupCount:
    """Face- and image-level totals/recovered counts for one stratum bucket."""

    total_faces: int = 0
    recovered_faces: int = 0
    total_images: int = 0
    recovered_images: int = 0
    identities: set[str] = field(default_factory=set)

    @property
    def face_rate(self) -> float:
        return self.recovered_faces / self.total_faces if self.total_faces else 0.0

    @property
    def image_rate(self) -> float:
        return self.recovered_images / self.total_images if self.total_images else 0.0


def _count(records: list[FaceRecord], resolved: set[str]) -> GroupCount:
    gc = GroupCount()
    seen_hashes: set[str] = set()
    seen_recovered: set[str] = set()
    for r in records:
        gc.total_faces += 1
        gc.identities.add(r.identity)
        if r.sha1 in resolved:
            gc.recovered_faces += 1
        if r.sha1 not in seen_hashes:
            seen_hashes.add(r.sha1)
            gc.total_images += 1
            if r.sha1 in resolved and r.sha1 not in seen_recovered:
                seen_recovered.add(r.sha1)
                gc.recovered_images += 1
    return gc


def quartile_thresholds(areas: list[int]) -> tuple[float, float, float]:
    """Return the (25th, 50th, 75th) percentile cut points of ``areas``."""
    if not areas:
        return (0.0, 0.0, 0.0)
    s = sorted(areas)
    n = len(s)

    def pct(p: float) -> float:
        if n == 1:
            return float(s[0])
        idx = p * (n - 1)
        lo = int(idx)
        hi = min(lo + 1, n - 1)
        frac = idx - lo
        return s[lo] + (s[hi] - s[lo]) * frac

    return (pct(0.25), pct(0.50), pct(0.75))


def bbox_quartile_label(area: int | None, thresholds: tuple[float, float, float]) -> str:
    """Assign a bbox area to Q1..Q4 (Q1 = smallest) or ``no_bbox``."""
    if area is None:
        return "no_bbox"
    q1, q2, q3 = thresholds
    if area <= q1:
        return "Q1_smallest"
    if area <= q2:
        return "Q2"
    if area <= q3:
        return "Q3"
    return "Q4_largest"


def surname(identity: str) -> str | None:
    """Last whitespace-separated token of a name, treated as surname."""
    parts = identity.split()
    return parts[-1] if len(parts) >= 2 else None


def stratify(
    records: list[FaceRecord],
    resolved: set[str],
    distinct_pairs: list[list[str]] | None = None,
) -> dict[str, dict[str, GroupCount]]:
    """Compute all strata. Returns ``{dimension: {bucket: GroupCount}}``."""
    strata: dict[str, dict[str, GroupCount]] = {}

    # -- is_manual ---------------------------------------------------------
    manual_buckets: dict[str, list[FaceRecord]] = {"manual": [], "detected": []}
    for r in records:
        manual_buckets["manual" if r.is_manual else "detected"].append(r)
    strata["is_manual"] = {k: _count(v, resolved) for k, v in manual_buckets.items()}

    # -- bbox area quartiles ----------------------------------------------
    areas = [r.bbox_area for r in records if r.bbox_area is not None]
    thresholds = quartile_thresholds(areas)
    q_buckets: dict[str, list[FaceRecord]] = defaultdict(list)
    for r in records:
        q_buckets[bbox_quartile_label(r.bbox_area, thresholds)].append(r)
    strata["bbox_quartile"] = {k: _count(v, resolved) for k, v in sorted(q_buckets.items())}

    # -- sibling surname groups -------------------------------------------
    by_surname: dict[str, set[str]] = defaultdict(set)
    for r in records:
        s = surname(r.identity)
        if s:
            by_surname[s].add(r.identity)
    sibling_surnames = {s for s, ids in by_surname.items() if len(ids) >= 2}
    surname_buckets: dict[str, list[FaceRecord]] = defaultdict(list)
    for r in records:
        s = surname(r.identity)
        if s in sibling_surnames:
            surname_buckets[s].append(r)
    strata["sibling_surname"] = {
        k: _count(v, resolved) for k, v in sorted(surname_buckets.items())
    }

    # -- confirmed twin pairs (distinct_pairs.json) -----------------------
    twin_strata: dict[str, GroupCount] = {}
    for pair in distinct_pairs or []:
        members = set(pair)
        label = " + ".join(pair)
        pair_records = [r for r in records if r.identity in members]
        twin_strata[label] = _count(pair_records, resolved)
    if twin_strata:
        strata["twin_pairs"] = twin_strata

    # -- per-event (YYMMDD prefix) ----------------------------------------
    event_buckets: dict[str, list[FaceRecord]] = defaultdict(list)
    for r in records:
        ev = r.event_prefix or "unknown"
        event_buckets[ev].append(r)
    strata["event"] = {k: _count(v, resolved) for k, v in sorted(event_buckets.items())}

    return strata


def gallery_probe_viability(
    records: list[FaceRecord], resolved: set[str]
) -> dict[str, int]:
    """Count identities with >=2 recovered *distinct source images*.

    An identity needs at least a gallery image and a probe image drawn from
    different source photos to be usable in a recognition benchmark.
    """
    per_identity_images: dict[str, set[str]] = defaultdict(set)
    per_identity_recovered: dict[str, set[str]] = defaultdict(set)
    for r in records:
        per_identity_images[r.identity].add(r.sha1)
        if r.sha1 in resolved:
            per_identity_recovered[r.identity].add(r.sha1)

    total_identities = len(per_identity_images)
    viable = sum(1 for ids in per_identity_recovered.values() if len(ids) >= 2)
    with_any = sum(1 for ids in per_identity_recovered.values() if len(ids) >= 1)
    return {
        "total_identities": total_identities,
        "identities_with_any_recovered": with_any,
        "identities_gallery_probe_viable": viable,
    }
