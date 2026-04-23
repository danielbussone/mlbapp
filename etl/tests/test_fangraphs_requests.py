from unittest.mock import patch

import pytest
import requests

from mlbapp_etl.fangraphs_requests import build_fangraphs_browser_headers, browser_like_requests_for_fangraphs


def test_build_fangraphs_browser_headers_adds_user_agent() -> None:
    h = build_fangraphs_browser_headers(None)
    assert "User-Agent" in h
    assert "Chrome" in h["User-Agent"]
    assert h["Referer"] == "https://www.fangraphs.com/"


def test_build_fangraphs_browser_headers_preserves_existing() -> None:
    h = build_fangraphs_browser_headers({"X-Custom": "1"})
    assert h["X-Custom"] == "1"
    assert "User-Agent" in h


def test_build_fangraphs_browser_headers_cookie_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLBAPP_FG_COOKIE", "a=b")
    h = build_fangraphs_browser_headers(None)
    assert h["Cookie"] == "a=b"


def test_browser_like_context_restores_get() -> None:
    before = requests.get
    with browser_like_requests_for_fangraphs():
        assert requests.get is not before
    assert requests.get is before


def test_browser_like_skips_fangraphs_api_url() -> None:
    captured: dict = {}

    def fake_get(url: str, **kwargs: object) -> object:
        captured["url"] = url
        captured.update(kwargs)
        class R:
            status_code = 200
            content = b"{}"

        return R()

    with patch("requests.get", fake_get):
        with browser_like_requests_for_fangraphs():
            requests.get(
                "https://www.fangraphs.com/api/leaders/major-league/data",
                params={"stats": "bat"},
            )
    assert "headers" not in captured or "User-Agent" not in (captured.get("headers") or {})


def test_browser_like_wraps_fangraphs_url() -> None:
    captured: dict = {}

    def fake_get(url: str, **kwargs: object) -> object:
        captured["url"] = url
        captured.update(kwargs)
        class R:
            status_code = 200
            content = b"<html></html>"

        return R()

    with patch("requests.get", fake_get):
        with browser_like_requests_for_fangraphs():
            requests.get("https://www.fangraphs.com/leaders-legacy.aspx", params={"x": 1})
    assert "fangraphs.com" in captured["url"]
    assert "headers" in captured
    assert "Chrome" in captured["headers"]["User-Agent"]
    assert captured["timeout"] == (15, 120)
