"""Unit tests for sprint / running-splits ETL mapping (no Savant HTTP)."""

from __future__ import annotations

import pandas as pd

from mlbapp_etl.sprint_running import dataframe_to_splits_rows, dataframe_to_sprint_rows


def test_dataframe_to_sprint_rows() -> None:
    df = pd.DataFrame(
        [
            {"player_id": 12345, "sprint_speed": 28.7, "team": "NYY"},
            {"player_id": 99999, "sprint_speed": None},
            {"sprint_speed": 27.0},
        ],
    )
    rows = dataframe_to_sprint_rows(df, 2023)
    assert len(rows) == 1
    assert rows[0] == {"key_mlbam": 12345, "game_year": 2023, "sprint_speed": 28.7}


def test_dataframe_to_splits_rows_raw() -> None:
    df = pd.DataFrame(
        [
            {
                "player_id": 111,
                "seconds_since_hit_000": 0.1,
                "seconds_since_hit_005": 0.2,
            },
        ],
    )
    rows = dataframe_to_splits_rows(df, 2024, split_variant="raw")
    assert len(rows) == 1
    assert rows[0]["key_mlbam"] == 111
    assert rows[0]["game_year"] == 2024
    assert rows[0]["split_variant"] == "raw"
    payload = rows[0]["payload_jsonb"].obj
    assert payload["player_id"] == 111
    assert payload["seconds_since_hit_000"] == 0.1


def test_dataframe_to_splits_rows_strips_columns() -> None:
    df = pd.DataFrame([{" player_id ": 222, "x": 1}])
    rows = dataframe_to_splits_rows(df, 2022, split_variant="percent")
    assert len(rows) == 1
    assert rows[0]["key_mlbam"] == 222
