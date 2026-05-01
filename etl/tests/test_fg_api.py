"""Offline tests using committed JSON fixtures (avoid repeat FanGraphs traffic)."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from mlbapp_etl.fg import _batting_row, _pitching_row
from mlbapp_etl.fg_api import (
    _inclusive_year_chunks,
    _season_api_pair,
    fg_http_throttle_seconds,
    fg_season_chunk_years,
    normalize_api_batting_df,
    normalize_api_pitching_df,
)
from mlbapp_etl.jsonutil import row_to_stats_json

_FIX = Path(__file__).resolve().parent / "fixtures"


def _load_rows(name: str) -> pd.DataFrame:
    path = _FIX / name
    body = json.loads(path.read_text(encoding="utf-8"))
    return pd.json_normalize(body["data"])


def test_normalize_api_batting_aliases() -> None:
    df = normalize_api_batting_df(_load_rows("fg_api_bat_sample.json"))
    assert len(df) == 1
    row = df.iloc[0]
    assert row["IDfg"] == 12345
    assert row["Team"] == "TST"
    assert row["Off"] == 25.0
    assert row["Def"] == -1.0
    assert row["BsR"] == 1.2
    # Long-tail columns from the fixture must survive normalize (not dropped).
    assert "Barrels" in df.columns and row["Barrels"] == 22.0
    assert "pfx_wFA" in df.columns


def test_stats_jsonb_contains_full_api_row_long_tail() -> None:
    """Typed INSERT columns are a subset; stats_jsonb must keep every API field."""
    df = normalize_api_batting_df(_load_rows("fg_api_bat_sample.json"))
    blob = row_to_stats_json(df.iloc[0])
    assert blob["Barrels"] == 22.0
    assert blob["pfx_vFA"] == 94.5
    assert blob["wRAA"] == 28.5
    pit = normalize_api_pitching_df(_load_rows("fg_api_pit_sample.json"))
    pit_blob = row_to_stats_json(pit.iloc[0])
    assert pit_blob["SIERA"] == 3.45
    assert pit_blob["pfx_wFA"] == 12.0


def test_normalize_api_pitching_vfa_from_fbv() -> None:
    df = normalize_api_pitching_df(_load_rows("fg_api_pit_sample.json"))
    row = df.iloc[0]
    assert row["IDfg"] == 23456
    assert row["vFA"] == 95.2
    assert row["K/9"] == 9.5


def test_batting_row_from_normalized_fixture() -> None:
    import uuid

    df = normalize_api_batting_df(_load_rows("fg_api_bat_sample.json"))
    sid = uuid.uuid4()
    payload = _batting_row(sid, df.iloc[0])
    assert payload["id_fg"] == 12345
    assert payload["season"] == 2024
    assert payload["team"] == "TST"
    assert payload["war"] == 4.5
    assert payload["rate_stat_qualified"] is False  # 400 PA < 503 for 162-game bar


def test_fg_http_throttle_seconds_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLBAPP_FG_THROTTLE_SECONDS", "0")
    assert fg_http_throttle_seconds() == 0.0
    monkeypatch.setenv("MLBAPP_FG_THROTTLE_SECONDS", "2.5")
    assert fg_http_throttle_seconds() == 2.5


def test_season_api_pair_upper_is_first_param() -> None:
    """FG API uses ``season`` = high year, ``season1`` = low year."""
    assert _season_api_pair(2023, 2024) == (2024, 2023)
    assert _season_api_pair(2024, 2024) == (2024, 2024)


def test_inclusive_year_chunks_single_when_small_or_disabled() -> None:
    assert _inclusive_year_chunks(2000, 2005, 10) == [(2000, 2005)]
    assert _inclusive_year_chunks(2000, 2005, 0) == [(2000, 2005)]


def test_inclusive_year_chunks_wide_span() -> None:
    assert _inclusive_year_chunks(2000, 2026, 10) == [
        (2000, 2009),
        (2010, 2019),
        (2020, 2026),
    ]


def test_fg_season_chunk_years_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLBAPP_FG_SEASON_CHUNK_YEARS", "7")
    assert fg_season_chunk_years() == 7
    monkeypatch.setenv("MLBAPP_FG_SEASON_CHUNK_YEARS", "0")
    assert fg_season_chunk_years() == 0
    monkeypatch.delenv("MLBAPP_FG_SEASON_CHUNK_YEARS", raising=False)
    assert fg_season_chunk_years() == 10


def test_pitching_row_from_normalized_fixture() -> None:
    import uuid

    df = normalize_api_pitching_df(_load_rows("fg_api_pit_sample.json"))
    sid = uuid.uuid4()
    payload = _pitching_row(sid, df.iloc[0])
    assert payload["id_fg"] == 23456
    assert payload["k_per_9"] == 9.5
    assert payload["vfa"] == 95.2
    assert payload["war"] == 5.0
    assert payload["war_ra9"] == 4.6
    assert payload["rate_stat_qualified"] is True  # 190.1 IP clears 162-game outs bar


def test_normalize_api_pitching_promotes_ra9_war_underscore() -> None:
    base = _load_rows("fg_api_pit_sample.json").drop(columns=["RA9-WAR"])
    base["RA9_WAR"] = 4.6
    df = normalize_api_pitching_df(base)
    assert "RA9-WAR" in df.columns
    assert df["RA9-WAR"].iloc[0] == 4.6


def test_pitching_row_war_ra9_fuzzy_column_name() -> None:
    """When API omits standard RA9-WAR keys, accept any column containing ra9 and war."""
    import uuid

    df = normalize_api_pitching_df(_load_rows("fg_api_pit_sample.json"))
    row = df.iloc[0].drop(labels=["RA9-WAR"], errors="ignore")
    row["Ra9WarAlt"] = 3.14
    payload = _pitching_row(uuid.uuid4(), row)
    assert payload["war_ra9"] == 3.14


def test_pitching_row_war_ra9_from_ra9_wins() -> None:
    """Live FG JSON uses RA9-Wins for the leaderboard RA9-WAR column when RA9-WAR key is absent."""
    import uuid

    base = _load_rows("fg_api_pit_sample.json").drop(columns=["RA9-WAR"])
    base["RA9-Wins"] = 4.6
    df = normalize_api_pitching_df(base)
    payload = _pitching_row(uuid.uuid4(), df.iloc[0])
    assert payload["war_ra9"] == 4.6
