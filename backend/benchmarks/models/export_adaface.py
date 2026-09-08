"""One-shot CLI (networked machine): export AdaFace IR-101 to ONNX.

AdaFace ships no official ONNX — only PyTorch checkpoints. This tool bridges the
gap once, on a machine with network + torch, and produces the ONNX the benchmark
runtime (``adaface.py``) consumes. Torch is an **export-time dependency only**;
run this in a scratch venv, never the project venv::

    python3 -m venv /tmp/adaface-export && . /tmp/adaface-export/bin/activate
    pip install torch onnx onnxruntime huggingface_hub numpy
    cd backend
    python -m benchmarks.models.export_adaface            # download + export + verify

What it does:

1. **Acquire** the IR-101 WebFace12M checkpoint. Default source is the MIT HF
   mirror ``marcelo-victor/adaface_ir101_webface12m`` (file ``adaface_weights.ckpt``);
   pass ``--checkpoint PATH`` for a checkpoint you downloaded yourself (e.g. the
   authoritative Google-Drive file from ``github.com/mk-minchul/AdaFace``,
   id ``1dswnavflETcnAuplZj1IOKKP0eM8ITgT``). The checkpoint's sha256 is recorded.
2. **Load** the vendored IR-101 architecture (``_adaface_ir101_net.py``, MIT,
   Minchul Kim) and the checkpoint's ``state_dict`` (keys stripped of the
   ``model.`` prefix), ``strict=True`` — a mismatch fails loudly.
3. **Export** to ONNX (dynamic batch, opset 17, embedding head only — the
   backbone's ``(embedding, norm)`` tuple is wrapped so only the L2-normed
   embedding is emitted).
4. **Verify** torch-vs-ONNX parity: cosine > 0.999 on random inputs (and a real
   aligned crop from the benchmark dataset if one is present).
5. **Record** onnx sha256 + checkpoint sha256 + license + preprocessing + opset
   in the committed ``models_manifest.json``.

The ONNX and checkpoint are data (gitignored under ``_data/``); only the
manifest metadata is committed.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import numpy as np

from .. import config as cfg
from . import download as dl
from .adaface import DEFAULT_VARIANT, default_model_path

# MIT HF mirror of the original checkpoint (net.py-compatible state_dict).
CKPT_REPO = "marcelo-victor/adaface_ir101_webface12m"
CKPT_FILE = "adaface_weights.ckpt"
# Authoritative source (manual download): github.com/mk-minchul/AdaFace.
GDRIVE_ID = "1dswnavflETcnAuplZj1IOKKP0eM8ITgT"

OPSET = 17
LICENSE = "MIT"
PREPROCESSING = (
    "112x112 aligned crop; BGR (no swap); NCHW float32; (x-127.5)/127.5; "
    "embedding L2-normed by the net, caller re-L2-normalizes"
)


def _sha256(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# checkpoint acquisition
# ---------------------------------------------------------------------------
def acquire_checkpoint(explicit: str | None) -> Path:
    """Return a local checkpoint path, downloading the HF mirror if needed."""
    if explicit:
        p = Path(explicit).expanduser()
        if not p.exists():
            raise SystemExit(f"--checkpoint not found: {p}")
        return p

    dest = cfg.DATA_DIR / "models" / DEFAULT_VARIANT / CKPT_FILE
    if dest.exists():
        print(f"[checkpoint] using cached {dest}", file=sys.stderr)
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[checkpoint] downloading {CKPT_REPO}/{CKPT_FILE} ...", file=sys.stderr)
    try:
        from huggingface_hub import hf_hub_download

        cached = hf_hub_download(repo_id=CKPT_REPO, filename=CKPT_FILE)
        import shutil

        shutil.copyfile(cached, dest)
    except ImportError:
        url = dl.HF_RESOLVE.format(repo=CKPT_REPO, path=CKPT_FILE)
        _stream_download(url, dest)
    print(f"[checkpoint] saved {dest} (sha256 {_sha256(dest)})", file=sys.stderr)
    return dest


def _stream_download(url: str, dest: Path) -> None:
    import os
    import urllib.request

    headers = {"User-Agent": "ansikten-benchmark-downloader"}
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
        while True:
            block = resp.read(1 << 20)
            if not block:
                break
            out.write(block)
    tmp.replace(dest)


# ---------------------------------------------------------------------------
# model build + export
# ---------------------------------------------------------------------------
def _load_backbone(checkpoint: Path):
    """Build vendored IR-101 and load the checkpoint's filtered state_dict."""
    import torch

    from . import _adaface_ir101_net as net

    model = net.build_model("ir_101")
    blob = torch.load(str(checkpoint), map_location="cpu", weights_only=False)
    statedict = blob["state_dict"] if isinstance(blob, dict) and "state_dict" in blob else blob
    # Upstream wraps the backbone as ``model.`` in the LightningModule state.
    model_statedict = {k[6:]: v for k, v in statedict.items() if k.startswith("model.")}
    if not model_statedict:
        # Some mirrors store the bare backbone state_dict without the prefix.
        model_statedict = statedict
    model.load_state_dict(model_statedict, strict=True)
    model.eval()
    return model


class _EmbeddingHead:
    """Wrap the backbone so ONNX export emits only the L2-normed embedding."""

    def __new__(cls, backbone):
        import torch.nn as nn

        class _Head(nn.Module):
            def __init__(self, bb):
                super().__init__()
                self.bb = bb

            def forward(self, x):
                out, _norm = self.bb(x)
                return out

        return _Head(backbone)


def export_onnx(backbone, onnx_path: Path) -> Path:
    import torch

    head = _EmbeddingHead(backbone)
    head.eval()
    onnx_path.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.randn(1, 3, 112, 112)
    export_kwargs = dict(
        input_names=["input"],
        output_names=["embedding"],
        dynamic_axes={"input": {0: "batch"}, "embedding": {0: "batch"}},
        opset_version=OPSET,
        do_constant_folding=True,
    )
    # Force the legacy TorchScript exporter (portable, no onnxscript dependency).
    # ``dynamo`` is only a kwarg on newer torch; fall back if unknown.
    try:
        torch.onnx.export(head, dummy, str(onnx_path), dynamo=False, **export_kwargs)
    except TypeError:
        torch.onnx.export(head, dummy, str(onnx_path), **export_kwargs)
    return onnx_path


# ---------------------------------------------------------------------------
# parity: torch vs ONNX
# ---------------------------------------------------------------------------
def _sample_real_crop() -> np.ndarray | None:
    """Align one real dataset face (``_data/dataset.jsonl``); None if absent."""
    try:
        import json

        from ..dataset import MATCHED, load_bgr
        from .align import align_112

        manifest = cfg.DATA_DIR / "dataset.jsonl"
        if not manifest.exists():
            return None
        with open(manifest) as f:
            for line in f:
                row = json.loads(line)
                if row.get("bucket") == MATCHED and row.get("kps") and row.get("path"):
                    kps = np.asarray(row["kps"], dtype=np.float32)
                    return align_112(load_bgr(row["path"]), kps)
        return None
    # The real-crop sample is optional: a missing benchmark dataset, an
    # unreadable manifest line or an alignment failure all mean "no sample",
    # and the caller falls back to synthetic input.
    except Exception:  # noqa: BLE001
        return None


def _l2(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32).ravel()
    n = float(np.linalg.norm(v))
    return v if n <= 1e-10 else v / n


def verify_parity(backbone, onnx_path: Path, threshold: float, n: int) -> bool:
    import onnxruntime as ort
    import torch

    from .adaface import AdaFaceRecognition

    head = _EmbeddingHead(backbone)
    head.eval()
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name
    adapter = AdaFaceRecognition(model_path=str(onnx_path))

    # Torch-vs-ONNX on random NCHW tensors (backbone contract).
    worst = 1.0
    rng = np.random.default_rng(0)
    for i in range(n):
        x = rng.standard_normal((1, 3, 112, 112)).astype(np.float32)
        with torch.no_grad():
            t = _l2(head(torch.from_numpy(x)).numpy())
        o = _l2(sess.run([out_name], {in_name: x})[0])
        cos = float(np.dot(t, o))
        worst = min(worst, cos)
        print(f"tensor {i}: cos(torch, onnx) = {cos:.6f}", file=sys.stderr)

    # Full-pipeline check on a real crop if available (adapter preprocessing).
    real = _sample_real_crop()
    if real is not None:
        from PIL import Image

        # Reference to_input path: PIL RGB -> reverse to BGR -> normalize.
        rgb = real[:, :, ::-1]  # our crop is BGR; make an RGB PIL image
        pil = Image.fromarray(np.ascontiguousarray(rgb).astype(np.uint8))
        np_img = np.array(pil)
        brg = ((np_img[:, :, ::-1] / 255.0) - 0.5) / 0.5
        tref = torch.tensor([brg.transpose(2, 0, 1)]).float()
        with torch.no_grad():
            ref = _l2(head(tref).numpy())
        ours = adapter.embed(real)
        cos = float(np.dot(ref, ours))
        worst = min(worst, cos)
        print(f"real crop: cos(reference to_input, adapter) = {cos:.6f}", file=sys.stderr)

    print(f"\nworst-case cosine = {worst:.6f} (threshold {threshold})", file=sys.stderr)
    return worst >= threshold


# ---------------------------------------------------------------------------
# manifest
# ---------------------------------------------------------------------------
def write_manifest_entry(onnx_path: Path, checkpoint: Path) -> None:
    manifest = dl.load_manifest()
    entry = {
        "source_checkpoint_repo": CKPT_REPO,
        "source_checkpoint_file": CKPT_FILE,
        "authoritative_source": (
            f"https://drive.google.com/file/d/{GDRIVE_ID}/view "
            "(github.com/mk-minchul/AdaFace, adaface_ir101_webface12m.ckpt)"
        ),
        "checkpoint_sha256": _sha256(checkpoint),
        "onnx_sha256": _sha256(onnx_path),
        "onnx_opset": OPSET,
        "license": LICENSE,
        "dim": 512,
        "preprocessing": PREPROCESSING,
        "architecture": "IR-101 (vendored _adaface_ir101_net.py, MIT)",
        "local_path": str(Path("_data/models") / DEFAULT_VARIANT / f"{DEFAULT_VARIANT}.onnx"),
        "note": "Exported locally from the PyTorch checkpoint; no official ONNX exists.",
    }
    manifest.setdefault("models", {})[DEFAULT_VARIANT] = entry
    dl.write_manifest(manifest)
    print(f"[manifest] recorded {DEFAULT_VARIANT} in {dl.MANIFEST_PATH}", file=sys.stderr)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--checkpoint", default=None, help="Local checkpoint path (else download the HF mirror)."
    )
    ap.add_argument(
        "--out",
        default=None,
        help="Output ONNX path (default _data/models/adaface_ir101/adaface_ir101.onnx).",
    )
    ap.add_argument(
        "--threshold",
        type=float,
        default=0.999,
        help="Min torch-vs-ONNX cosine to accept (default 0.999).",
    )
    ap.add_argument("--n", type=int, default=4, help="Random parity samples (default 4).")
    ap.add_argument(
        "--skip-verify",
        action="store_true",
        help="Export without the parity gate (not recommended).",
    )
    args = ap.parse_args(argv)

    try:
        import torch  # noqa: F401
    except ImportError:
        print(
            "torch is required for export (export-time only). Use a scratch venv:\n"
            "  python3 -m venv /tmp/adaface-export && . /tmp/adaface-export/bin/activate\n"
            "  pip install torch onnx onnxruntime huggingface_hub numpy pillow",
            file=sys.stderr,
        )
        return 2

    cfg.ensure_data_dir()
    checkpoint = acquire_checkpoint(args.checkpoint)
    onnx_path = Path(args.out) if args.out else default_model_path(DEFAULT_VARIANT)

    print(f"[export] building IR-101 and loading {checkpoint.name} ...", file=sys.stderr)
    backbone = _load_backbone(checkpoint)
    print(f"[export] exporting ONNX (opset {OPSET}) -> {onnx_path}", file=sys.stderr)
    export_onnx(backbone, onnx_path)

    if not args.skip_verify:
        if not verify_parity(backbone, onnx_path, args.threshold, args.n):
            print("PARITY FAILED — export rejected", file=sys.stderr)
            return 1
        print("PARITY OK", file=sys.stderr)

    write_manifest_entry(onnx_path, checkpoint)
    print(f"\nDone. ONNX: {onnx_path}\nsha256: {_sha256(onnx_path)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
