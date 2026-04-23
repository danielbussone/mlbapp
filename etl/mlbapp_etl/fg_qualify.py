"""MLB rate-stat qualification vs schedule length (FanGraphs-style PA / IP rules).

Used when ingesting with a low FanGraphs ``qual`` so all player-season lines are
persisted; ``rate_stat_qualified`` is then computed from ``PA`` / ``IP`` on each row.

**Schedule length** is a league-wide **approximation** of regular-season games per
team for the qualification denominator (3.1 PA per game batting; 1 IP per game
pitching). Real MLB counts vary by club in strike years; FanGraphs may differ
slightly—extend ``_SCHEDULE_GAMES`` for stricter parity.

Rough timeline (see SABR / standard references):

- **Pre-1904:** Schedules varied widely (~70–140 games). We use **140** as a mid
  estimate only; extend the per-year dict if you ingest 19th-century rows.
- **1904–1960:** **154** games (standard), except **1919** (140) and dict overrides.
- **1961–present:** **162** games, except dict overrides (**1981**, **1994–1995**,
  **2020**). **1961** was AL 162 / NL 154 before the NL moved to 162 in **1962**;
  we use **162** for all of 1961+ so NL-only 1961 thresholds may be off by ~8 PA.
"""

from __future__ import annotations

import math
from typing import Any

# Per-year overrides: approximate typical team games (regular season).
_SCHEDULE_GAMES: dict[int, int] = {
    # Pandemic
    2020: 60,
    # Strike / shortened (approximate mid of published team-game ranges)
    1995: 144,
    1994: 115,  # season cut short; clubs often ~112–117 games
    1981: 108,  # split schedule; most teams ~102–111 games
    # WWI / post-war
    1919: 140,
}


def schedule_games_mlb(season: int) -> int:
    """Regular-season schedule length (games per team) for qualification math."""
    if season in _SCHEDULE_GAMES:
        return _SCHEDULE_GAMES[season]
    if season < 1904:
        return 140
    if 1904 <= season <= 1960:
        return 154
    return 162


def ip_stat_to_outs(ip: Any) -> int | None:
    """
    FanGraphs ``IP`` uses .1 / .2 for thirds of an inning (not decimals).
    Returns total outs, or None if ``ip`` is missing or invalid.
    """
    if ip is None:
        return None
    try:
        x = float(ip)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or x < 0:
        return None
    whole = int(x)
    frac = round(x - whole, 2)
    extra = 0
    if 0.04 <= frac <= 0.16:
        extra = 1
    elif 0.17 <= frac <= 0.26:
        extra = 2
    elif frac > 0.26:
        return None
    return whole * 3 + extra


def batting_pa_threshold(season: int) -> int:
    """Minimum PA to qualify for batting rate stats (3.1 PA per scheduled team game)."""
    g = schedule_games_mlb(season)
    return int(math.ceil(g * 3.1))


def pitching_ip_outs_threshold(season: int) -> int:
    """Minimum outs pitched to qualify for ERA-style rate stats (1 IP per scheduled game)."""
    return schedule_games_mlb(season) * 3


def batting_rate_stat_qualified(season: int, level: str | None, pa: int | None) -> bool | None:
    if (level or "MLB") != "MLB":
        return None
    if pa is None:
        return None
    return pa >= batting_pa_threshold(season)


def pitching_rate_stat_qualified(season: int, level: str | None, ip: Any) -> bool | None:
    if (level or "MLB") != "MLB":
        return None
    outs = ip_stat_to_outs(ip)
    if outs is None:
        return None
    return outs >= pitching_ip_outs_threshold(season)
