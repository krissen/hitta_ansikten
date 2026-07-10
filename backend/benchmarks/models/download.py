"""CLI: acquire model weights (recognition heads and detectors) for the harness.

The benchmark can drive several recognition heads (buffalo_l today, LVFace and
others later) and detectors (YOLO-face). Their weights are large and not
vendored: this tool downloads a named model — from Hugging Face, or from a
direct URL such as a GitHub release asset (``ModelSpec.url``) — into
``_data/models/<name>/`` (gitignored) and records what it fetched in a
**committed** ``models_manifest.json`` next to this file — the manifest is code
(source URL, sha256, license, embedding dim, preprocessing notes), the weights
are data.

Downloads use ``huggingface_hub`` if it is importable in the environment;
otherwise a dependency-free streaming HTTPS download from the Hub's
``resolve/main`` endpoint (which the ``hf_hub_download`` path also hits). The
Hub stores each LFS blob's **sha256 as its git-LFS oid**, so the committed
manifest's ``sha256`` doubles as an integrity check on every future download.

Usage (from ``backend/``)::

    python -m benchmarks.models.download --list
    python -m benchmarks.models.download lvface_base
    python -m benchmarks.models.download lvface_tiny lvface_base
    python -m benchmarks.models.download --all

If a download needs authentication that is not configured (``HF_TOKEN`` / a
logged-in ``huggingface_hub``), the tool reports the auth failure rather than
guessing credentials. LVFace is a public MIT repo and needs no auth.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .. import config as cfg

# Where downloaded weights live (gitignored, alongside the other _data caches).
MODELS_DIR = cfg.DATA_DIR / "models"

# The committed manifest sits next to this module (it is code, not data).
MANIFEST_PATH = Path(__file__).resolve().parent / "models_manifest.json"

HF_RESOLVE = "https://huggingface.co/{repo}/resolve/main/{path}"


@dataclass(frozen=True)
class ModelSpec:
    """A downloadable benchmark model (recognition head or detector).

    Attributes:
        name: the benchmark model key (matches ``run.py``'s ``--models``).
        repo: Hugging Face repo id ("" when ``url`` is set).
        path: file path within the repo (the ONNX weights). When ``url`` is
            set, only its basename is used (the local filename).
        sha256: expected sha256 (== the Hub's git-LFS oid) for integrity.
        license: SPDX license id of the weights.
        dim: embedding dimensionality the ONNX head outputs (0 for detectors).
        preprocessing: short human note on the input contract (verified spec).
        url: optional direct download URL (e.g. a GitHub release asset) that
            bypasses the Hugging Face resolve endpoint entirely.
        kind: ``"recognition"`` (default) or ``"detector"``.
    """

    name: str
    repo: str
    path: str
    sha256: str
    license: str
    dim: int
    preprocessing: str
    url: str | None = None
    kind: str = "recognition"


# Verified against github.com/bytedance/LVFace inference_onnx.py (MIT):
# 112x112 aligned crop, BGR->RGB, CHW, ((x/255)-0.5)/0.5 == (x-127.5)/127.5,
# float32 NCHW; the ONNX emits a raw (un-normalized) 512-d embedding.
_LVFACE_PRE = (
    "112x112 aligned crop; BGR->RGB; NCHW float32; (x-127.5)/127.5; "
    "raw embedding, caller L2-normalizes"
)

KNOWN_MODELS: dict[str, ModelSpec] = {
    "lvface_tiny": ModelSpec(
        name="lvface_tiny",
        repo="bytedance-research/LVFace",
        path="LVFace-T_Glint360K/LVFace-T_Glint360K.onnx",
        sha256="bf8da0e1e93c432d9a1d874a9ba0990f5859f970e8864b3990f2f33d11f9cdb3",
        license="MIT",
        dim=512,
        preprocessing=_LVFACE_PRE,
    ),
    "lvface_small": ModelSpec(
        name="lvface_small",
        repo="bytedance-research/LVFace",
        path="LVFace-S_Glint360K/LVFace-S_Glint360K.onnx",
        sha256="cd09f27c82ce0a3633fb8b1966d779a7171b23aa4f14ca0de6edf9677573d119",
        license="MIT",
        dim=512,
        preprocessing=_LVFACE_PRE,
    ),
    "lvface_base": ModelSpec(
        name="lvface_base",
        repo="bytedance-research/LVFace",
        path="LVFace-B_Glint360K/LVFace-B_Glint360K.onnx",
        sha256="9d834ed8e927fd35b9123b2bf97c40aad05785b1f9ecfb1c4c1f6242d38d1382",
        license="MIT",
        dim=512,
        preprocessing=_LVFACE_PRE,
    ),
    "lvface_large": ModelSpec(
        name="lvface_large",
        repo="bytedance-research/LVFace",
        path="LVFace-L_Glint360K/LVFace-L_Glint360K.onnx",
        sha256="49389036a4a5b69e0efcddfe34839ac72c7a71ce6b4dc1b6821e2ac368c87063",
        license="MIT",
        dim=512,
        preprocessing=_LVFACE_PRE,
    ),
    # YOLOv8-face detector (5-point landmarks; see models/yoloface.py). AGPL-3.0
    # ultralytics-derived weights — acceptable for this LOCAL, non-shipped
    # benchmark tooling only; never bundled into the distributed app. Direct
    # GitHub release asset (the HF CDN mirror hosts are not reliably reachable).
    "yolov8n-face": ModelSpec(
        name="yolov8n-face",
        repo="",
        path="yolov8n-face.onnx",
        sha256="06b941fd5792be624ad18f2df9ede0a021c4df165dd418204d978c20fd555928",
        license="AGPL-3.0",
        dim=0,
        preprocessing=(
            "letterbox to 640x640; BGR->RGB; NCHW float32 in [0,1]; "
            "NMS-baked output (1, M, 6+3K): [x1,y1,x2,y2,score,class,(x,y,vis)*5]"
        ),
        url="https://github.com/akanametov/yolo-face/releases/download/1.0.0/yolov8n-face.onnx",
        kind="detector",
    ),
    # YOLOv12-large face detector (same akanametov 1.0.0 release, AGPL-3.0). Unlike
    # the nano/small variants, the *large* akanametov face models are plain
    # detectors (not pose models): the released ONNX emits (1, M, 6) with **no
    # landmarks**, so it drives the detection A/B only, never recognition. Same
    # local-benchmark-only license terms as the nano weights.
    "yolov12l-face": ModelSpec(
        name="yolov12l-face",
        repo="",
        path="yolov12l-face.onnx",
        sha256="d55f67bcddf5622cfc90306c6cb2f7d478e5ed4202a35dc2f833003c837243da",
        license="AGPL-3.0",
        dim=0,
        preprocessing=(
            "letterbox to 640x640; BGR->RGB; NCHW float32 in [0,1]; "
            "NMS-baked detection output (1, M, 6): [x1,y1,x2,y2,score,class] "
            "(no landmarks — detection A/B only)"
        ),
        url="https://github.com/akanametov/yolo-face/releases/download/1.0.0/yolov12l-face.onnx",
        kind="detector",
    ),
}


def local_path(spec: ModelSpec) -> Path:
    """Where ``spec``'s weights land locally (``_data/models/<name>/<file>``)."""
    return MODELS_DIR / spec.name / Path(spec.path).name


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    """Streaming sha256 of a file (matches the Hub's git-LFS oid)."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# download backends
# ---------------------------------------------------------------------------
def _download_via_hf_hub(spec: ModelSpec, dest: Path) -> bool:
    """Try ``huggingface_hub.hf_hub_download``; return False if unavailable."""
    if spec.url:
        return False  # direct-URL spec (not a Hub artifact)
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        return False

    cached = hf_hub_download(repo_id=spec.repo, filename=spec.path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Copy out of the hf cache so our _data tree is self-contained.
    import shutil

    shutil.copyfile(cached, dest)
    return True


def _download_via_https(spec: ModelSpec, dest: Path) -> None:
    """Dependency-free streaming download (Hub resolve endpoint or direct URL)."""
    import os

    url = spec.url or HF_RESOLVE.format(repo=spec.repo, path=spec.path)
    headers = {"User-Agent": "ansikten-benchmark-downloader"}
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token and not spec.url:
        headers["Authorization"] = f"Bearer {token}"

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp, open(tmp, "wb") as out:
            total = resp.headers.get("Content-Length")
            total = int(total) if total else None
            done = 0
            while True:
                block = resp.read(1 << 20)
                if not block:
                    break
                out.write(block)
                done += len(block)
                if total:
                    pct = 100 * done / total
                    print(f"\r  {spec.name}: {done >> 20}/{total >> 20} MiB "
                          f"({pct:4.1f}%)", end="", file=sys.stderr)
        print("", file=sys.stderr)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise SystemExit(
                f"Authentication required for {spec.repo} ({e.code}). Set HF_TOKEN "
                f"or run `huggingface-cli login`, then retry."
            ) from e
        raise
    tmp.replace(dest)


def download_model(spec: ModelSpec, *, force: bool = False) -> Path:
    """Download ``spec`` (unless already present + verified) and return its path."""
    dest = local_path(spec)
    if dest.exists() and not force:
        actual = sha256_of(dest)
        if actual == spec.sha256:
            print(f"[{spec.name}] already present and verified: {dest}", file=sys.stderr)
            return dest
        print(f"[{spec.name}] sha256 mismatch on disk, re-downloading", file=sys.stderr)

    source = spec.url or f"{spec.repo}/{spec.path}"
    print(f"[{spec.name}] downloading {source} ...", file=sys.stderr)
    if not _download_via_hf_hub(spec, dest):
        _download_via_https(spec, dest)

    actual = sha256_of(dest)
    if actual != spec.sha256:
        raise SystemExit(
            f"[{spec.name}] sha256 verification FAILED after download:\n"
            f"  expected {spec.sha256}\n  actual   {actual}"
        )
    print(f"[{spec.name}] verified sha256 {actual}", file=sys.stderr)
    return dest


# ---------------------------------------------------------------------------
# manifest
# ---------------------------------------------------------------------------
def load_manifest() -> dict:
    if MANIFEST_PATH.exists():
        try:
            return json.loads(MANIFEST_PATH.read_text())
        except json.JSONDecodeError:
            pass
    return {"models": {}}


def write_manifest(manifest: dict) -> None:
    manifest["models"] = dict(sorted(manifest.get("models", {}).items()))
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")


def manifest_entry(spec: ModelSpec) -> dict:
    entry = {
        "source_url": spec.url or HF_RESOLVE.format(repo=spec.repo, path=spec.path),
        "repo": spec.repo,
        "path": spec.path,
        "sha256": spec.sha256,
        "license": spec.license,
        "dim": spec.dim,
        "preprocessing": spec.preprocessing,
        "local_path": str(Path("_data/models") / spec.name / Path(spec.path).name),
    }
    if spec.kind != "recognition":
        entry["kind"] = spec.kind
    return entry


def update_manifest_entry(existing: dict | None, spec: ModelSpec) -> dict:
    """Fresh entry for ``spec``, preserving hand-maintained keys.

    Keys present in the committed manifest but not produced by
    :func:`manifest_entry` (e.g. ``license_note``, ``note``) are carried over so
    a CLI run never silently drops curated documentation.
    """
    fresh = manifest_entry(spec)
    if existing:
        for key, value in existing.items():
            fresh.setdefault(key, value)
    return fresh


def update_manifest(spec: ModelSpec) -> None:
    """Record ``spec`` in the committed manifest (idempotent)."""
    manifest = load_manifest()
    models = manifest.setdefault("models", {})
    models[spec.name] = update_manifest_entry(models.get(spec.name), spec)
    write_manifest(manifest)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("models", nargs="*", help="Model name(s) to download.")
    ap.add_argument("--all", action="store_true", help="Download every known model.")
    ap.add_argument("--list", action="store_true", help="List known models and exit.")
    ap.add_argument("--force", action="store_true", help="Re-download even if present.")
    ap.add_argument("--manifest-only", action="store_true",
                    help="Only (re)write the manifest entries; do not download.")
    args = ap.parse_args(argv)

    if args.list:
        for name, spec in KNOWN_MODELS.items():
            dest = local_path(spec)
            state = "present" if dest.exists() else "not downloaded"
            source = spec.url or f"{spec.repo}/{spec.path}"
            print(f"{name:14s} {source}  [{spec.license}, dim={spec.dim}, {state}]")
        return 0

    names = list(KNOWN_MODELS) if args.all else args.models
    if not names:
        ap.error("give one or more model names, or --all / --list")

    unknown = [n for n in names if n not in KNOWN_MODELS]
    if unknown:
        print(f"Unknown model(s): {unknown}. Known: {list(KNOWN_MODELS)}", file=sys.stderr)
        return 2

    cfg.ensure_data_dir()
    for name in names:
        spec = KNOWN_MODELS[name]
        if not args.manifest_only:
            download_model(spec, force=args.force)
        update_manifest(spec)
    print(f"Manifest written: {MANIFEST_PATH}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
