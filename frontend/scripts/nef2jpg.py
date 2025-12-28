#!/usr/bin/env python3
"""
NEF to JPG converter for Bildvisare.

Converts Nikon RAW (NEF) files to JPEG format and writes status information
for the Bildvisare image viewer application.

Exit codes:
    0: Success
    1: Missing dependencies (rawpy or pillow)
    2: Invalid usage (missing arguments)
    3: Input file not found
    4: Failed to read NEF file (corrupted or invalid)
    5: Unexpected error reading NEF
    6: Failed to save JPG (disk full, permissions)
    7: Unexpected error saving JPG
    8: Invalid file extension (not .NEF/.nef)
    9: File size validation failed

Usage:
    nef2jpg.py [--verbose] [--quality QUALITY] input.NEF output.jpg

Options:
    --verbose           Enable detailed logging to stderr
    --quality QUALITY   JPEG quality (1-100, default: 98)
"""
import json
import sys
import time
from pathlib import Path
from typing import Dict, Any, Optional
import argparse

try:
    import rawpy
    from PIL import Image
    import numpy as np
except ImportError:
    print("ERROR: Please install required packages: rawpy and pillow", file=sys.stderr)
    print("Run: pip install rawpy pillow", file=sys.stderr)
    sys.exit(1)


# Configuration constants
MIN_FILE_SIZE: int = 1024 * 100  # 100 KB minimum
MAX_FILE_SIZE: int = 1024 * 1024 * 100  # 100 MB maximum
DEFAULT_JPEG_QUALITY: int = 98
VALID_EXTENSIONS: set = {'.nef', '.NEF'}


def log_verbose(message: str, verbose: bool = False) -> None:
    """Print message to stderr if verbose mode is enabled.

    Args:
        message: The message to log
        verbose: Whether verbose mode is enabled
    """
    if verbose:
        print(f"[INFO] {message}", file=sys.stderr)


def validate_nef_file(file_path: Path, verbose: bool = False) -> bool:
    """
    Validate that the input file is a valid NEF file.

    Args:
        file_path: Path object pointing to the NEF file
        verbose: Whether to print verbose messages

    Returns:
        True if valid

    Raises:
        SystemExit with appropriate code if validation fails
    """
    # Check file extension
    if file_path.suffix not in VALID_EXTENSIONS:
        print(f"ERROR: Invalid file extension: {file_path.suffix}", file=sys.stderr)
        print(f"Expected .NEF or .nef, got: {file_path}", file=sys.stderr)
        sys.exit(8)

    log_verbose(f"File extension valid: {file_path.suffix}", verbose)

    # Check file size
    file_size = file_path.stat().st_size
    log_verbose(f"File size: {file_size:,} bytes ({file_size / 1024 / 1024:.2f} MB)", verbose)

    if file_size < MIN_FILE_SIZE:
        print(f"ERROR: File too small ({file_size} bytes, minimum {MIN_FILE_SIZE})", file=sys.stderr)
        print(f"File may be corrupted: {file_path}", file=sys.stderr)
        sys.exit(9)

    if file_size > MAX_FILE_SIZE:
        print(f"ERROR: File too large ({file_size} bytes, maximum {MAX_FILE_SIZE})", file=sys.stderr)
        sys.exit(9)

    log_verbose("File size validation passed", verbose)
    return True


def validate_output_path(output_path: Path, verbose: bool = False) -> None:
    """
    Validate that the output path is safe to write to.

    Args:
        output_path: Path object for the output JPG file
        verbose: Whether to print verbose messages

    Raises:
        SystemExit if path is unsafe
    """
    # Basic safety check: don't allow paths outside /tmp or user directories
    resolved = output_path.resolve()
    home = Path.home()
    tmp = Path("/tmp").resolve()  # Resolve to handle /private/tmp on macOS

    # Check if path is under /tmp or home directory
    try:
        is_safe = resolved.is_relative_to(tmp) or resolved.is_relative_to(home)
    except ValueError:
        is_safe = False

    if not is_safe:
        print(f"ERROR: Output path is not safe: {resolved}", file=sys.stderr)
        print(f"Path must be under /tmp or {home}", file=sys.stderr)
        sys.exit(9)

    log_verbose(f"Output path validation passed: {resolved}", verbose)


def convert_nef_to_jpeg(
    nef_path: Path,
    jpg_path: Path,
    quality: int = DEFAULT_JPEG_QUALITY,
    verbose: bool = False
) -> Dict[str, Any]:
    """
    Convert a NEF file to JPEG format.

    Args:
        nef_path: Path to input NEF file
        jpg_path: Path to output JPG file
        quality: JPEG quality (1-100)
        verbose: Whether to print verbose messages

    Returns:
        Dictionary with conversion metadata (elapsed_time, output_size, image_shape)

    Raises:
        SystemExit with appropriate code if conversion fails
    """
    start_time = time.time()
    log_verbose("Starting NEF conversion...", verbose)

    # Read NEF and convert to RGB
    try:
        with rawpy.imread(str(nef_path)) as raw:
            rgb: np.ndarray = raw.postprocess()
        log_verbose(f"NEF read successful, image size: {rgb.shape}", verbose)
    except rawpy.LibRawError as e:
        print(f"ERROR: Failed to read NEF file: {e}", file=sys.stderr)
        print(f"File may be corrupted or not a valid NEF: {nef_path}", file=sys.stderr)
        sys.exit(4)
    except Exception as e:
        print(f"ERROR: Unexpected error reading NEF: {e}", file=sys.stderr)
        sys.exit(5)

    # Convert to JPEG
    log_verbose(f"Converting to JPEG (quality={quality})...", verbose)

    try:
        img = Image.fromarray(rgb)
        img.save(jpg_path, format="JPEG", quality=quality)

        # Get output file size
        output_size = jpg_path.stat().st_size
        log_verbose(f"JPG saved: {output_size:,} bytes ({output_size / 1024 / 1024:.2f} MB)", verbose)
    except OSError as e:
        print(f"ERROR: Failed to save JPG file: {e}", file=sys.stderr)
        print(f"Check disk space and permissions for: {jpg_path}", file=sys.stderr)
        sys.exit(6)
    except Exception as e:
        print(f"ERROR: Unexpected error saving JPG: {e}", file=sys.stderr)
        sys.exit(7)

    elapsed = time.time() - start_time
    log_verbose(f"Conversion completed in {elapsed:.2f} seconds", verbose)

    return {
        "elapsed_time": elapsed,
        "output_size": output_size,
        "image_shape": rgb.shape
    }


def write_status_file(
    nef_path: Path,
    jpg_path: Path,
    verbose: bool = False
) -> None:
    """
    Write status file for Bildvisare application.

    Args:
        nef_path: Path to source NEF file
        jpg_path: Path to exported JPG file
        verbose: Whether to print verbose messages
    """
    log_verbose("Writing status file...", verbose)

    status_path = (
        Path.home()
        / "Library"
        / "Application Support"
        / "bildvisare"
        / "original_status.json"
    )
    status: Dict[str, Any] = {
        "timestamp": time.time(),
        "source_nef": str(nef_path),
        "exported_jpg": str(jpg_path),
        "exported": True,
    }

    try:
        status_path.parent.mkdir(parents=True, exist_ok=True)
        with open(status_path, "w") as f:
            json.dump(status, f, indent=2)
        log_verbose(f"Status file written: {status_path}", verbose)
    except OSError as e:
        print(f"WARNING: Failed to write status file: {e}", file=sys.stderr)
        print(f"Conversion succeeded but status not saved to: {status_path}", file=sys.stderr)
        # Don't exit with error - conversion was successful
    except Exception as e:
        print(f"WARNING: Unexpected error writing status: {e}", file=sys.stderr)
        # Don't exit with error - conversion was successful


def parse_arguments() -> argparse.Namespace:
    """
    Parse command-line arguments.

    Returns:
        Parsed arguments namespace
    """
    parser = argparse.ArgumentParser(
        description="Convert Nikon NEF files to JPEG format",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        "input_nef",
        type=Path,
        help="Input NEF file path"
    )
    parser.add_argument(
        "output_jpg",
        type=Path,
        help="Output JPG file path"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging to stderr"
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=DEFAULT_JPEG_QUALITY,
        metavar="QUALITY",
        help=f"JPEG quality 1-100 (default: {DEFAULT_JPEG_QUALITY})"
    )

    args = parser.parse_args()

    # Validate quality range
    if not 1 <= args.quality <= 100:
        parser.error(f"Quality must be between 1 and 100, got: {args.quality}")

    return args


def main() -> None:
    """Main conversion function."""
    args = parse_arguments()

    nef_path: Path = args.input_nef
    jpg_path: Path = args.output_jpg
    verbose: bool = args.verbose
    quality: int = args.quality

    log_verbose("Verbose mode enabled", verbose)
    log_verbose(f"Input file: {nef_path}", verbose)
    log_verbose(f"Output file: {jpg_path}", verbose)
    log_verbose(f"JPEG quality: {quality}", verbose)

    # Validate input file exists
    if not nef_path.exists():
        print(f"ERROR: File does not exist: {nef_path}", file=sys.stderr)
        sys.exit(3)

    # Validate input file
    validate_nef_file(nef_path, verbose)

    # Validate output path
    validate_output_path(jpg_path, verbose)

    # Convert NEF to JPEG
    conversion_info = convert_nef_to_jpeg(nef_path, jpg_path, quality, verbose)

    # Write status file
    write_status_file(nef_path, jpg_path, verbose)


if __name__ == "__main__":
    main()
