"""FanGraphs rate-stat qualification helpers."""

from __future__ import annotations

import math

import pytest

from mlbapp_etl.fg_qualify import (
    batting_pa_threshold,
    batting_rate_stat_qualified,
    ip_stat_to_outs,
    pitching_ip_outs_threshold,
    pitching_rate_stat_qualified,
    schedule_games_mlb,
)


def test_schedule_games_special_years() -> None:
    assert schedule_games_mlb(2020) == 60
    assert schedule_games_mlb(1995) == 144
    assert schedule_games_mlb(1994) == 115
    assert schedule_games_mlb(1981) == 108
    assert schedule_games_mlb(1919) == 140
    assert schedule_games_mlb(2019) == 162


def test_schedule_games_154_game_era() -> None:
    assert schedule_games_mlb(1955) == 154
    assert schedule_games_mlb(1904) == 154


def test_schedule_games_pre_modern_default() -> None:
    assert schedule_games_mlb(1890) == 140


def test_batting_threshold_162_vs_2020() -> None:
    assert batting_pa_threshold(2019) == int(math.ceil(162 * 3.1))
    assert batting_pa_threshold(2020) == int(math.ceil(60 * 3.1))


def test_ip_stat_to_outs_thirds() -> None:
    assert ip_stat_to_outs(190.1) == 190 * 3 + 1
    assert ip_stat_to_outs(190.2) == 190 * 3 + 2
    assert ip_stat_to_outs(162.0) == 486


def test_pitching_threshold_matches_innings() -> None:
    assert pitching_ip_outs_threshold(2019) == 162 * 3
    assert pitching_ip_outs_threshold(2020) == 60 * 3


@pytest.mark.parametrize(
    ("season", "pa", "expected"),
    [
        (2024, 600, True),
        (2024, 400, False),
        (2020, 200, True),
        (2020, 100, False),
    ],
)
def test_batting_rate_stat_qualified_mlb(season: int, pa: int, expected: bool) -> None:
    assert batting_rate_stat_qualified(season, "MLB", pa) is expected


def test_batting_non_mlb_returns_none() -> None:
    assert batting_rate_stat_qualified(2024, "AAA", 600) is None


def test_pitching_fixture_scale() -> None:
    """190.1 IP vs 162-game bar."""
    assert pitching_rate_stat_qualified(2024, "MLB", 190.1) is True
    assert pitching_rate_stat_qualified(2024, "MLB", 150.0) is False
