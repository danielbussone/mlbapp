"""Unit tests for Statcast ETL mapping (no Savant HTTP)."""

from __future__ import annotations

import json
import uuid
from datetime import date
from pathlib import Path

import pandas as pd

from mlbapp_etl.statcast import (
    _compute_incremental_window,
    _dedupe_rows,
    _season_window,
    dataframe_to_pitch_rows,
)


def _fixture_df() -> pd.DataFrame:
    path = Path(__file__).resolve().parent / "fixtures" / "statcast_pitches_minimal.json"
    with path.open(encoding="utf-8") as f:
        rows = json.load(f)
    return pd.DataFrame(rows)


def test_dataframe_to_pitch_rows_typed_and_payload() -> None:
    sid = uuid.uuid4()
    df = _fixture_df()
    rows = dataframe_to_pitch_rows(df, sid)
    assert len(rows) == 2
    r0 = rows[0]
    assert r0["game_pk"] == 745555
    assert r0["at_bat_number"] == 3
    assert r0["pitch_number"] == 1
    assert r0["game_year"] == 2024
    assert r0["pitcher_mlbam"] == 477132
    assert r0["batter_mlbam"] == 592450
    assert r0["pitch_type"] == "FF"
    assert r0["release_speed"] == 94.2
    assert r0["snapshot_id"] == str(sid)
    payload = r0["payload_jsonb"].obj  # psycopg.types.json.Json
    assert "release_spin_rate" in payload
    assert payload["release_spin_rate"] == 2300
    assert "stand" in payload
    assert "game_pk" not in payload


def test_dedupe_rows_last_wins() -> None:
    sid = uuid.uuid4()
    df = _fixture_df()
    df2 = pd.concat([df, df.iloc[[0]]], ignore_index=True)
    rows = _dedupe_rows(dataframe_to_pitch_rows(df2, sid))
    assert len(rows) == 2


def test_season_window_defaults() -> None:
    start, end = _season_window(2024, start_mmdd=None, end_mmdd=None)
    assert start.isoformat() == "2024-03-01"
    assert end.isoformat() == "2024-11-30"


def test_incremental_window_from_last_date_with_overlap() -> None:
    # Pull from last game_date minus the overlap through end.
    start, end = _compute_incremental_window(
        date(2026, 7, 10), overlap_days=3, end=date(2026, 7, 18)
    )
    assert start.isoformat() == "2026-07-07"
    assert end.isoformat() == "2026-07-18"


def test_incremental_window_zero_overlap() -> None:
    start, end = _compute_incremental_window(
        date(2026, 7, 10), overlap_days=0, end=date(2026, 7, 18)
    )
    assert start.isoformat() == "2026-07-10"


def test_incremental_window_bootstrap_when_empty() -> None:
    # No data yet -> bootstrap the current calendar season start, not all history.
    start, end = _compute_incremental_window(None, overlap_days=3, end=date(2026, 7, 18))
    assert start.isoformat() == "2026-03-01"
    assert end.isoformat() == "2026-07-18"


def test_incremental_window_clamps_future_last_date() -> None:
    # If the last loaded date is (somehow) ahead of end, don't invert the range.
    start, end = _compute_incremental_window(
        date(2026, 7, 20), overlap_days=0, end=date(2026, 7, 18)
    )
    assert start == end == date(2026, 7, 18)


def test_skips_row_missing_game_pk() -> None:
    sid = uuid.uuid4()
    df = _fixture_df()
    df.loc[0, "game_pk"] = None
    rows = dataframe_to_pitch_rows(df, sid)
    assert len(rows) == 1
    assert rows[0]["pitch_number"] == 2
