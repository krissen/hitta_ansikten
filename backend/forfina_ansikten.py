#!/usr/bin/env python3
import sys

import numpy as np

from faceid_db import load_database, save_database

# ======== JUSTERBARA KONSTANTER OCH STANDARDVÄRDEN =========
STD_THRESHOLD = 2.0  # Stdavvikelse-gräns för outlier-filtrering
MIN_ENCODINGS = 8  # Ingen filtrering om färre än så
CLUSTER_DIST = 0.55  # Maxavstånd för kluster
CLUSTER_MIN = 6  # Minsta antal i kluster
REPAIR_ON_START = False  # Kör alltid shape-repair först?


# ================= FILTRERINGSFUNKTIONER ===================
def std_outlier_filter(encs, std_thr=STD_THRESHOLD):
    """Returnerar mask (True=behåll), samt distanser från centroid."""
    arr = np.stack(encs)
    centroid = np.mean(arr, axis=0)
    dists = np.linalg.norm(arr - centroid, axis=1)
    std = np.std(dists)
    mean = np.mean(dists)
    mask = np.abs(dists - mean) < std_thr * std
    return mask, dists


def cluster_filter(encs, cluster_dist=CLUSTER_DIST, cluster_min=CLUSTER_MIN):
    """Behåll största tätkluster (alla inom cluster_dist från centroid)."""
    arr = np.stack(encs)
    centroid = np.mean(arr, axis=0)
    dists = np.linalg.norm(arr - centroid, axis=1)
    inlier_mask = dists < cluster_dist
    if np.count_nonzero(inlier_mask) >= cluster_min:
        return inlier_mask, dists
    else:
        # Om för få, filtrera inte alls
        return np.ones_like(inlier_mask, dtype=bool), dists


def shape_repair(known_faces, simulate=False):
    changed = False
    print("--- Shape-reparation ---")
    for name, entries in list(known_faces.items()):
        shapes = [
            (i, (e["encoding"] if isinstance(e, dict) and "encoding" in e else e).shape)
            for i, e in enumerate(entries)
            if isinstance(
                (e["encoding"] if isinstance(e, dict) and "encoding" in e else e),
                np.ndarray,
            )
        ]
        if not shapes:
            continue
        shape_counts = {}
        for idx, shape in shapes:
            shape_counts[shape] = shape_counts.get(shape, 0) + 1
        common_shape = max(shape_counts, key=shape_counts.get)
        bad_idxs = [i for i, shape in shapes if shape != common_shape]
        if bad_idxs:
            msg = (
                f"{name}: {len(bad_idxs)} encodings tas bort (av {len(entries)})\n"
                f"    shapes: {set(shape for _, shape in shapes)}\n"
                f"    vanligast: {common_shape}\n"
            )
            print(msg)
            if not simulate:
                known_faces[name] = [
                    e for i, e in enumerate(entries) if i not in bad_idxs
                ]
                changed = True
    return changed


# =========================== HUVUDFUNKTION ============================
def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Filtrera/repair ansikts-encodings. Default: stdavvikelse.",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--repair",
        action="store_true",
        help="Reparera inkonsekventa encodings (felaktig shape per person).",
    )
    parser.add_argument(
        "--simulate",
        action="store_true",
        help="Simulera valda åtgärder, ändrar inte databasen.",
    )
    parser.add_argument(
        "--outlier-std",
        type=float,
        default=STD_THRESHOLD,
        help="Std-avvikelsegräns för outlier-filtrering (default: 2.0)",
    )
    parser.add_argument(
        "--min-encodings",
        type=int,
        default=MIN_ENCODINGS,
        help="Ingen filtrering om färre än så (default: 8)",
    )
    parser.add_argument(
        "--cluster",
        action="store_true",
        help="Använd klustring istället för stdavvikelse.",
    )
    parser.add_argument(
        "--cluster-dist",
        type=float,
        default=CLUSTER_DIST,
        help="Maxavstånd för kluster (default: 0.55)",
    )
    parser.add_argument(
        "--cluster-min",
        type=int,
        default=CLUSTER_MIN,
        help="Minsta klusterstorlek (default: 6)",
    )
    args = parser.parse_args()

    known_faces, ignored_faces, hard_negatives, processed_files = load_database()
    changed = False

    # --- (Ev) Shape-repair först ---
    if args.repair or REPAIR_ON_START:
        did_repair = shape_repair(known_faces, simulate=args.simulate)
        if did_repair and not args.simulate:
            save_database(known_faces, ignored_faces, hard_negatives, processed_files)
            print("Databas uppdaterad (shape-repair).")
        elif not did_repair:
            print("Inga inkonsekventa encodings hittades.")
        if args.repair:
            return

    # --- Outlier/kluster-filtrering ---
    print("--- Förfina encodings ---")
    for name, entries in list(known_faces.items()):
        # Plocka ut encodings (nytt/gammalt format)
        encs = [
            e["encoding"] if isinstance(e, dict) and "encoding" in e else e
            for e in entries
            if (
                isinstance(e, dict)
                and "encoding" in e
                and isinstance(e["encoding"], np.ndarray)
            )
            or isinstance(e, np.ndarray)
        ]
        if len(encs) < args.min_encodings:
            continue  # Skippa små klasser

        try:
            if args.cluster:
                mask, dists = cluster_filter(encs, args.cluster_dist, args.cluster_min)
                n_out = np.count_nonzero(~mask)
                n_in = np.count_nonzero(mask)
                label = "KLUSTER"
            else:
                mask, dists = std_outlier_filter(encs, args.outlier_std)
                n_out = np.count_nonzero(~mask)
                n_in = np.count_nonzero(mask)
                label = "STDAVVIKELSE"
        except Exception as ex:
            print(f"{name}: kunde inte filtrera (troligen inkonsekventa shapes): {ex}")
            continue

        if n_out > 0:
            print(f"{name}: {n_out} tas bort ({n_in}/{len(encs)}) [{label}]")
        # Rapportera alltid, även om simulate
        if not args.simulate and n_out > 0:
            kept = [e for i, e in enumerate(entries) if i < len(mask) and mask[i]]
            known_faces[name] = kept
            changed = True

    if changed and not args.simulate:
        save_database(known_faces, ignored_faces, hard_negatives, processed_files)
        print("Databas uppdaterad.")
    elif not changed:
        print("Ingen filtrering utförd – inget förändrat.")


if __name__ == "__main__":
    main()
