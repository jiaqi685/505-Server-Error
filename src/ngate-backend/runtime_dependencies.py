"""Expose Replit's installed Nix Python packages when Python omits them."""
import importlib.util
from pathlib import Path
import subprocess
import sys


def ensure_runtime_dependencies():
    # Normal Python installations already expose their dependencies.
    if all(importlib.util.find_spec(name) is not None for name in ("flask", "reportlab")):
        return

    store = Path("/nix/store")
    version = f"{sys.version_info.major}.{sys.version_info.minor}"
    paths = set()
    if store.is_dir():
        for package in ("flask", "reportlab"):
            for output in sorted(store.glob(f"*-python{version}-{package}-*")):
                if output.name.endswith(("-dist", "-testout")):
                    continue
                closure = subprocess.run(
                    ["nix-store", "-qR", str(output)],
                    check=True, capture_output=True, text=True,
                )
                for dependency in closure.stdout.splitlines():
                    candidate = Path(dependency) / f"lib/python{version}/site-packages"
                    if candidate.is_dir():
                        paths.add(str(candidate))

    sys.path.extend(sorted(paths))
    importlib.invalidate_caches()
    missing = [
        name for name in ("flask", "reportlab")
        if importlib.util.find_spec(name) is None
    ]
    if missing:
        raise RuntimeError(
            "NGate runtime dependencies are unavailable: " + ", ".join(missing)
            + ". Install the packages listed in requirements.txt."
        )
