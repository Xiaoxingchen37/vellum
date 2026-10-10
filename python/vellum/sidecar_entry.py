"""Entry point for the frozen (PyInstaller) sidecar.

The Tauri shell runs ``python -m vellum serve --port N`` during development.
In a packaged build there is no Python on the user's machine, so we ship a
frozen ``vellum-sidecar.exe`` that behaves the same: it defaults to ``serve``
and reads the port from ``--port``.

Kept deliberately tiny: PyInstaller analyses this module, so anything imported
here ends up in the bundle.
"""
from __future__ import annotations

import sys

from vellum.app.cli import main

if __name__ == "__main__":
    if len(sys.argv) == 1:
        sys.argv.append("serve")
    main()
