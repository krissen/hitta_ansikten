#!/usr/bin/env python3
"""Compare face detection at different InsightFace det_size settings.

Runs the real detection path (image load + <=4500px downscale, matching
production) at each requested det_size and reports faces found, wall time,
and embedding dimensionality per image.

Usage::

    python -m benchmarks.detsize_compare IMG1.jpg IMG2.NEF ...
    python -m benchmarks.detsize_compare --det-sizes 640,1280 *.jpg

This is a diagnostic tool, not a pytest test — it needs a real InsightFace
model and real photos, so it is not part of the automated suite.
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np

# Allow running as a script from anywhere inside the repo.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from face_backends import InsightFaceBackend

RAW_EXTENSIONS = {".nef", ".cr2", ".arw", ".raf", ".dng", ".orf", ".rw2"}
MAX_DIMENSION = 4500  # Production downscales detection input to this long side.


def load_rgb(path: Path) -> np.ndarray:
    """Load an image as an RGB ndarray, downscaled to MAX_DIMENSION long side."""
    ext = path.suffix.lower()
    if ext in RAW_EXTENSIONS:
        import rawpy

        with rawpy.imread(str(path)) as raw:
            rgb = raw.postprocess(half_size=True)
    else:
        from PIL import Image, ImageOps

        img = ImageOps.exif_transpose(Image.open(path))
        rgb = np.array(img.convert("RGB"))

    h, w = rgb.shape[:2]
    if max(h, w) > MAX_DIMENSION:
        import cv2

        scale = MAX_DIMENSION / max(h, w)
        rgb = cv2.resize(rgb, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return rgb


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", help="Image paths (jpg/png/NEF/...)")
    parser.add_argument(
        "--det-sizes",
        default="640,1280",
        help="Comma-separated square det_size values (default: 640,1280)",
    )
    args = parser.parse_args()

    det_sizes = [int(x) for x in args.det_sizes.split(",")]
    backends = {}
    for d in det_sizes:
        print(f"Loading backend at det_size={d}x{d} ...", file=sys.stderr)
        backends[d] = InsightFaceBackend(det_size=(d, d))

    header = ["image"]
    for d in det_sizes:
        header += [f"faces@{d}", f"ms@{d}", f"dim@{d}"]
    rows = []

    for img_path in args.images:
        path = Path(img_path).expanduser()
        if not path.exists():
            print(f"skip (missing): {path}", file=sys.stderr)
            continue
        try:
            rgb = load_rgb(path)
        except Exception as e:  # noqa: BLE001 - a benchmark run over many images skips the ones it cannot load rather than aborting mid-table
            print(f"skip (load error {e}): {path}", file=sys.stderr)
            continue

        row = [path.name]
        for d in det_sizes:
            t0 = time.perf_counter()
            locs, encs = backends[d].detect_faces(rgb, model="", upsample=0)
            ms = (time.perf_counter() - t0) * 1000.0
            dim = len(encs[0]) if encs else 0
            row += [len(locs), f"{ms:.0f}", dim]
        rows.append(row)
        print("done:", path.name, file=sys.stderr)

    # Print an aligned table to stdout.
    widths = [max(len(str(r[i])) for r in ([header] + rows)) for i in range(len(header))]
    fmt = "  ".join("{:<" + str(w) + "}" for w in widths)
    print(fmt.format(*header))
    print(fmt.format(*["-" * w for w in widths]))
    for r in rows:
        print(fmt.format(*[str(c) for c in r]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
