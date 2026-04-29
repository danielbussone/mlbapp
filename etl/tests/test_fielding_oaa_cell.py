"""Tests for Savant Directional OAA → savant_fielding_oaa_cell mapping."""

from __future__ import annotations

import io

import pandas as pd

from mlbapp_etl.fielding_oaa_cell import (
    dataframe_directional_if_to_cells,
    dataframe_directional_of_to_cells,
)


def test_directional_of_explodes_six_slices() -> None:
    buf = io.StringIO(
        "player_id,attempts,n_outs_above_average,n_oaa_slice_back_left,n_oaa_slice_back,"
        "n_oaa_slice_back_right,n_oaa_slice_back_all,n_oaa_slice_in_left,n_oaa_slice_in,"
        "n_oaa_slice_in_right,n_oaa_slice_in_all\n"
        "123456,400,5,1,0,-1,0,2,3,4,10\n",
    )
    df = pd.read_csv(buf)
    rows = dataframe_directional_of_to_cells(df, 2024)
    by_cell = {r["cell_id"]: r for r in rows}
    assert len(by_cell) == 6
    assert by_cell["of_dir_back_left"]["oaa"] == 1
    assert by_cell["of_dir_back"]["oaa"] == 0
    assert by_cell["of_dir_back_right"]["oaa"] == -1
    assert by_cell["of_dir_in_left"]["oaa"] == 2
    assert by_cell["of_dir_in"]["oaa"] == 3
    assert by_cell["of_dir_in_right"]["oaa"] == 4
    for r in rows:
        assert r["player_mlbam"] == 123456
        assert r["game_year"] == 2024
        assert r["attempts"] is None


def test_skips_row_without_player_id() -> None:
    df = pd.DataFrame(
        {
            "n_oaa_slice_back": [1],
        },
    )
    assert dataframe_directional_of_to_cells(df, 2024) == []


def test_directional_if_explodes_dir_and_splits() -> None:
    buf = io.StringIO(
        "player_id,year,outs_above_average_infront,outs_above_average_lateral_toward3bline,"
        "outs_above_average_lateral_toward1bline,outs_above_average_behind,"
        "outs_above_average_rhh,outs_above_average_lhh\n"
        "123456,2024,-1,2,-3,4,-5,6\n",
    )
    df = pd.read_csv(buf)
    rows = dataframe_directional_if_to_cells(df, 2024)
    by_cell = {r["cell_id"]: r for r in rows}
    assert len(by_cell) == 6
    assert by_cell["if_dir_in"]["oaa"] == -1
    assert by_cell["if_dir_toward_3b"]["oaa"] == 2
    assert by_cell["if_dir_toward_1b"]["oaa"] == -3
    assert by_cell["if_dir_behind"]["oaa"] == 4
    assert by_cell["if_split_rhh"]["oaa"] == -5
    assert by_cell["if_split_lhh"]["oaa"] == 6
    assert all(r["player_mlbam"] == 123456 and r["game_year"] == 2024 for r in rows)


def test_directional_if_fallback_game_year_when_year_blank() -> None:
    buf = io.StringIO(
        "player_id,year,outs_above_average_infront\n"
        '654321,"",5\n',
    )
    df = pd.read_csv(buf)
    rows = dataframe_directional_if_to_cells(df, 2023)
    assert len(rows) == 1
    assert rows[0]["game_year"] == 2023
