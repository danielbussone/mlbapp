"""Process-local defaults before importing third-party scrape libraries."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path


def normalize_cli_argv(argv: list[str] | None) -> list[str]:
    """Prepare argv for ``argparse`` after npm/pnpm ``run`` forwarding.

    Removes standalone ``--`` tokens. pnpm often injects ``--`` before extra script
    arguments (``pnpm run x -- --season 2026``). When the npm script already
    contains fixed flags (e.g. ``--feed infield``), that delimiter can appear
    **mid-argv**, which plain argparse rejects unless stripped.
    """
    if argv is None:
        out = sys.argv[1:]
    else:
        out = list(argv)
    return [a for a in out if a != "--"]

_EXPORT_PREFIX = re.compile(r"^export\s+", re.IGNORECASE)


def _apply_env_file(path: Path, *, override: bool) -> None:
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
        if not key:
            continue
        if not override and key in os.environ:
            continue
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        os.environ[key] = val


def load_repo_dotenv(repo_root: Path, *, filename: str = ".env") -> None:
    """
    Populate ``os.environ`` from ``<repo_root>/.env`` for keys not already set.
    Matches common ``KEY=value`` / ``export KEY=value`` lines (no override of
    existing process env).

    If ``MLBAPP_DOTENV`` is set (in the process environment or by the first file),
    loads ``<repo_root>/<MLBAPP_DOTENV>`` next and **overrides** keys from that file
    (same behavior as ``apps/api`` ``loadEnv.ts`` with dotenv ``override``).
    ``MLBAPP_DOTENV`` may be an absolute path.
    """
    _apply_env_file(repo_root / filename, override=False)
    extra = os.environ.get("MLBAPP_DOTENV", "").strip()
    if not extra:
        return
    overlay = Path(extra) if extra.startswith("/") else repo_root / extra
    _apply_env_file(overlay, override=True)


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
