#!/usr/bin/env python3
"""
Entry point for PyInstaller bundle.

This script properly initializes the package context before running the server.
"""

import os
import sys


def main() -> None:
    # Ensure we can find our modules
    if getattr(sys, "frozen", False):
        # Running as PyInstaller bundle
        base_path = sys._MEIPASS
    else:
        # Running as script
        base_path = os.path.dirname(os.path.abspath(__file__))

    # Add base path to sys.path if not already there
    if base_path not in sys.path:
        sys.path.insert(0, base_path)

    # Set matplotlib config dir to persistent location (avoids font cache rebuild)
    mpl_config = os.path.join(os.path.expanduser("~"), ".local", "share", "faceid", "matplotlib")
    os.makedirs(mpl_config, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", mpl_config)

    # Parse command line arguments
    import argparse

    parser = argparse.ArgumentParser(description="Ansikten Backend Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=5001, help="Port to bind to")
    args = parser.parse_args()

    # Set port in environment for the app
    os.environ["ANSIKTEN_PORT"] = str(args.port)

    # Import the app object directly (string imports don't work in PyInstaller)
    # Run uvicorn with app object
    import uvicorn

    from api.server import app

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
