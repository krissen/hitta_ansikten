#!/usr/bin/env python3
import json
import sys
import time
from pathlib import Path

try:
    import rawpy
    from PIL import Image
except ImportError:
    print("Installera rawpy och pillow!", file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) < 3:
        print("Usage: nef2jpg.py input.NEF output.jpg", file=sys.stderr)
        sys.exit(2)
    nef_path = Path(sys.argv[1])
    jpg_path = Path(sys.argv[2])

    if not nef_path.exists():
        print(f"Filen finns ej: {nef_path}", file=sys.stderr)
        sys.exit(3)

    # Läs NEF, konvertera till RGB
    with rawpy.imread(str(nef_path)) as raw:
        rgb = raw.postprocess()

    img = Image.fromarray(rgb)
    img.save(jpg_path, format="JPEG", quality=98)

    status_path = (
        Path.home()
        / "Library"
        / "Application Support"
        / "bildvisare"
        / "original_status.json"
    )
    status = {
        "timestamp": time.time(),
        "source_nef": str(nef_path),
        "exported_jpg": str(jpg_path),
        "exported": "true",
    }
    status_path.parent.mkdir(parents=True, exist_ok=True)
    with open(status_path, "w") as f:
        json.dump(status, f, indent=2)


if __name__ == "__main__":
    main()
