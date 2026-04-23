"""Optional browser-like headers for FanGraphs **HTML** leaderboard requests.

FanGraphs' **JSON** leaders API (``/api/leaders/...``) returns **403** if we spoof a
Chrome ``User-Agent`` in testing; it accepts the default ``python-requests`` UA.
We only attach browser headers for non-``/api/`` FanGraphs URLs (e.g. legacy HTML).
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any

import requests

# Generic current desktop Chrome UA; avoids default ``python-requests/…`` which FG often 403s.
_DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_DEFAULT_FG_HEADERS: dict[str, str] = {
    "User-Agent": _DEFAULT_UA,
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.fangraphs.com/",
}


def _url_str(url: str | bytes) -> str:
    return url.decode("utf-8", errors="replace") if isinstance(url, bytes) else str(url)


def build_fangraphs_browser_headers(existing: Any) -> dict[str, str]:
    """Merge optional ``existing`` request headers with FanGraphs-friendly defaults."""
    merged: dict[str, str] = {}
    if existing is not None and hasattr(existing, "items"):
        for k, v in existing.items():
            merged[str(k)] = v if isinstance(v, str) else str(v)
    for key, val in _DEFAULT_FG_HEADERS.items():
        merged.setdefault(key, val)
    # Optional: paste a ``Cookie`` header from an authenticated browser session if FG still 403s.
    cookie = os.environ.get("MLBAPP_FG_COOKIE", "").strip()
    if cookie:
        merged["Cookie"] = cookie
    return merged


@contextmanager
def browser_like_requests_for_fangraphs() -> Any:
    """
    Temporarily wrap ``requests.get`` so FanGraphs URLs get browser-like headers
    and a bounded timeout. Restores the original ``get`` on exit.
    """
    original = requests.get

    def wrapped(url: str | bytes, *args: Any, **kwargs: Any) -> Any:
        u = _url_str(url).lower()
        if "fangraphs.com" in u and "/api/" not in u:
            kwargs["headers"] = build_fangraphs_browser_headers(kwargs.get("headers"))
            kwargs.setdefault("timeout", (15, 120))
        return original(url, *args, **kwargs)

    requests.get = wrapped  # type: ignore[method-assign]
    try:
        yield
    finally:
        requests.get = original  # type: ignore[method-assign]
