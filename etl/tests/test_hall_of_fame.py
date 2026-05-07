"""Unit tests for Hall of Fame ETL helpers (no Lahman network)."""

from mlbapp_etl.runtime import normalize_cli_argv


def test_normalize_cli_argv_strips_leading_dashes() -> None:
    assert normalize_cli_argv(["--", "--dry-run"]) == ["--dry-run"]
    assert normalize_cli_argv([]) == []
