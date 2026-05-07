import sys

import pytest

from mlbapp_etl.runtime import normalize_cli_argv


def test_normalize_cli_argv_strips_pnpm_separator():
    assert normalize_cli_argv(["--", "--start-season", "2024"]) == ["--start-season", "2024"]


def test_normalize_cli_argv_strips_multiple():
    assert normalize_cli_argv(["--", "--", "--start-season", "2024"]) == ["--start-season", "2024"]


def test_normalize_cli_argv_strips_mid_argv_separator_after_fixed_script_flags():
    """pnpm can place ``--`` after built-in flags (e.g. ``--feed infield`` in package.json)."""
    assert normalize_cli_argv(
        ["--feed", "infield", "--", "--season", "2026", "--replace-season"],
    ) == ["--feed", "infield", "--season", "2026", "--replace-season"]


def test_normalize_cli_argv_noop():
    assert normalize_cli_argv(["--start-season", "2024"]) == ["--start-season", "2024"]


def test_normalize_cli_argv_from_sys_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", ["prog", "--", "--start-season", "2024"])
    assert normalize_cli_argv(None) == ["--start-season", "2024"]
