"""Process-local defaults before importing third-party scrape libraries."""

from __future__ import annotations

import os
import re
from pathlib import Path

_EXPORT_PREFIX = re.compile(r"^export\s+", re.IGNORECASE)


def load_repo_dotenv(repo_root: Path, *, filename: str = ".env") -> None:
    """
    Populate ``os.environ`` from ``<repo_root>/.env`` for keys not already set.
    Matches common ``KEY=value`` / ``export KEY=value`` lines (no override of
    existing process env).
    """
    path = repo_root / filename
    if not path.is_file():
        return
    text = path.read_text(encoding="utf-8-sig")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        line = _EXPORT_PREFIX.sub("", line, count=1).strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if not key or key in os.environ:
            continue
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        os.environ[key] = val


def configure_pybaseball_cache(repo_root: Path | None = None) -> Path:
    """
    Point pybaseball disk cache at a directory inside the repo so imports work
    in environments where ``~/.pybaseball`` is not writable.
    """
    explicit = os.environ.get("PYBASEBALL_CACHE")
    if explicit:
        path = Path(explicit)
        path.mkdir(parents=True, exist_ok=True)
        return path
    root = repo_root or Path.cwd()
    path = root / ".pybaseball-cache"
    path.mkdir(parents=True, exist_ok=True)
    os.environ["PYBASEBALL_CACHE"] = str(path)
    return path
