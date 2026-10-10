"""Freeze the Python sidecar into ``src-tauri/binaries/vellum-sidecar.exe``.

The packaged MSI bundles this executable as a resource, so an installed Vellum
needs no Python on the user's machine. Run it before ``npm run tauri build``:

    <venv>/python build_sidecar.py

Requirements: the `vellum` runtime dependencies plus PyInstaller
(``pip install pyinstaller``).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PYTHON_DIR = ROOT / "python"
ENTRY = PYTHON_DIR / "vellum" / "sidecar_entry.py"
DIST = ROOT / "src-tauri" / "binaries"


def main() -> int:
    if not ENTRY.is_file():
        sys.exit(f"entry point not found: {ENTRY}")
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        sys.exit("PyInstaller 未安装：pip install pyinstaller")

    DIST.mkdir(parents=True, exist_ok=True)
    # The package lives under python/, not beside this script, so put it on
    # PYTHONPATH: PyInstaller must be able to import `vellum` for
    # `--collect-data` to pull in the web assets (reader.html, CSS, JS). Without
    # this, the bundled sidecar starts but every page request 500s.
    env = dict(os.environ, PYTHONPATH=str(PYTHON_DIR), PYTHONIOENCODING="utf-8")
    # Sanity check: the data we rely on must be importable before we build.
    pkgs = subprocess.run(
        [sys.executable, "-c", "import vellum, pathlib; print(pathlib.Path(vellum.__file__).parent / 'web')"],
        env=env, capture_output=True, text=True,
    )
    if pkgs.returncode != 0 or not Path(pkgs.stdout.strip()).is_dir():
        sys.exit(f"无法定位 vellum.web（检查 PYTHONPATH）：{pkgs.stderr.strip()}")

    args = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--onefile",
        "--name", "vellum-sidecar",
        "--distpath", str(DIST),
        "--workpath", str(ROOT / "build" / "pyi"),
        "--specpath", str(ROOT / "build"),
        # Ship the web assets (reader/library HTML+JS+CSS) inside the exe.
        "--collect-data", "vellum",
        str(ENTRY),
    ]
    print(" ".join(args), flush=True)
    code = subprocess.call(args, cwd=ROOT, env=env)
    if code != 0:
        return code
    out = DIST / "vellum-sidecar.exe"
    print(f"built {out} ({out.stat().st_size / 1024 ** 2:.1f} MB)", flush=True)
    # Keep the build tree out of the repo.
    shutil.rmtree(ROOT / "build" / "pyi", ignore_errors=True)

    # Smoke check: the frozen exe must serve the reader page and its CSS. Without
    # the bundled web assets every page request 500s, which is easy to miss
    # until someone opens a paper.
    if not _smoke(out):
        sys.exit("打包出来的 sidecar 无法提供网页资源（reader.html / css 缺失）")
    return 0


def _smoke(exe: Path) -> bool:
    """Start the frozen sidecar on a free port and fetch two static assets."""
    import json
    import socket
    import tempfile
    import time
    import urllib.request

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    home = Path(tempfile.mkdtemp(prefix="vellum-smoke-"))
    env = dict(os.environ, VELLUM_HOME=str(home), PYTHONIOENCODING="utf-8")
    env.pop("VELLUM_LIBRARY", None)
    proc = subprocess.Popen([str(exe), "serve", "--port", str(port)], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f"http://127.0.0.1:{port}"
        for _ in range(60):
            if proc.poll() is not None:
                return False
            try:
                with urllib.request.urlopen(base + "/health", timeout=2) as r:
                    json.loads(r.read())
                break
            except Exception:  # noqa: BLE001
                time.sleep(0.5)
        else:
            return False
        for path in ("/read/x?embed=1", "/web/css/reader.css"):
            with urllib.request.urlopen(base + path, timeout=5) as r:
                if r.status != 200 or not r.read(64):
                    return False
        return True
    except Exception as e:  # noqa: BLE001
        print(f"smoke 失败：{e}", flush=True)
        return False
    finally:
        proc.kill()
        proc.wait()
        shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
