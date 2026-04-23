"""FanGraphs major-league JSON leaderboard API (same route as baseballr ``fg_*_leaders``)."""

from __future__ import annotations

import os
import re
import time
from typing import Any, Literal

import pandas as pd
import requests

FG_MAJORS_LEADERS_URL = "https://www.fangraphs.com/api/leaders/major-league/data"


def fg_http_throttle_seconds() -> float:
    """Pause between FanGraphs HTTP calls. Set ``MLBAPP_FG_THROTTLE_SECONDS=0`` to disable."""
    raw = os.environ.get("MLBAPP_FG_THROTTLE_SECONDS", "10").strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 10.0


def throttle_between_fg_requests() -> None:
    delay = fg_http_throttle_seconds()
    if delay > 0:
        time.sleep(delay)


def fg_season_chunk_years() -> int:
    """
    Split wide ``start_season``/``end_season`` spans into this many calendar years
    per FanGraphs API request. Very wide ranges (e.g. 2000–2026) often return HTTP 500;
    chunking avoids that. Set ``MLBAPP_FG_SEASON_CHUNK_YEARS=0`` for one request per load
    (may fail on large spans).
    """
    raw = os.environ.get("MLBAPP_FG_SEASON_CHUNK_YEARS", "10").strip()
    try:
        return int(raw)
    except ValueError:
        return 10


# FanGraphs query uses ``season`` for the upper bound and ``season1`` for the lower bound
# (counter-intuitive vs baseballr arg names; see BillPetti/baseballr ``fg_batter_leaders``).


def _season_api_pair(start_season: int, end_season: int) -> tuple[int, int]:
    lo, hi = min(start_season, end_season), max(start_season, end_season)
    return hi, lo


def _qual_query(qual: int | None) -> str:
    return "y" if qual is None else str(qual)


def _league_query(league: str) -> str:
    return league.strip().lower()


def _strip_html_team(team_val: Any) -> str | None:
    if team_val is None or (isinstance(team_val, float) and pd.isna(team_val)):
        return None
    s = str(team_val)
    m = re.search(r">([^<]+)</a>", s)
    if m:
        return m.group(1).strip()
    return s.strip() or None


def _inclusive_year_chunks(lo: int, hi: int, max_years: int) -> list[tuple[int, int]]:
    """Partition ``[lo, hi]`` into disjoint inclusive year ranges of at most ``max_years``."""
    if max_years <= 0 or hi - lo + 1 <= max_years:
        return [(lo, hi)]
    out: list[tuple[int, int]] = []
    cur = lo
    while cur <= hi:
        end_c = min(cur + max_years - 1, hi)
        out.append((cur, end_c))
        cur = end_c + 1
    return out


def _fetch_fg_leaderboard_json_single_span(
    stats: Literal["bat", "pit"],
    start_season: int,
    end_season: int,
    *,
    league: str,
    qual: int | None,
    pageitems: int,
) -> pd.DataFrame:
    """One API season span (may still paginate by ``pageitems``)."""
    season_hi, season_lo = _season_api_pair(start_season, end_season)
    lg = _league_query(league)
    qual_s = _qual_query(qual)
    all_rows: list[dict[str, Any]] = []
    pagenum = 1
    total: int | None = None

    while True:
        if pagenum > 1:
            throttle_between_fg_requests()
        params: dict[str, str | int] = {
            "age": "",
            "pos": "all",
            "stats": stats,
            "lg": lg,
            "qual": qual_s,
            "season": season_hi,
            "season1": season_lo,
            "startdate": "",
            "enddate": "",
            "month": 0,
            "hand": "",
            "team": 0,
            "pageitems": pageitems,
            "pagenum": pagenum,
            "ind": 1,
            "rost": 0,
            "players": "",
            "type": 8,
            "postseason": "",
            "sortdir": "default",
            "sortstat": "WAR",
        }
        resp = requests.get(
            FG_MAJORS_LEADERS_URL,
            params=params,
            timeout=(15, 120),
        )
        resp.raise_for_status()
        body = resp.json()
        chunk = body.get("data") or []
        all_rows.extend(chunk)
        total = body.get("totalCount", len(all_rows))
        if total is not None and len(all_rows) >= total:
            break
        if not chunk:
            break
        pagenum += 1

    if not all_rows:
        return pd.DataFrame()
    return pd.json_normalize(all_rows)


def fetch_fg_leaderboard_json(
    stats: Literal["bat", "pit"],
    start_season: int,
    end_season: int,
    *,
    league: str,
    qual: int | None,
    pageitems: int = 50000,
) -> pd.DataFrame:
    """
    GET ``/api/leaders/major-league/data`` and return rows as a DataFrame (flattened).

    Wide year ranges are split into multiple requests (see ``fg_season_chunk_years()``)
    because FanGraphs often returns **500** for very large ``season``/``season1`` spans.
    Each chunk still paginates when ``totalCount`` exceeds ``pageitems``.
    """
    lo, hi = min(start_season, end_season), max(start_season, end_season)
    max_years = fg_season_chunk_years()
    chunks = _inclusive_year_chunks(lo, hi, max_years)
    parts: list[pd.DataFrame] = []
    for i, (c_lo, c_hi) in enumerate(chunks):
        if i > 0:
            throttle_between_fg_requests()
        parts.append(
            _fetch_fg_leaderboard_json_single_span(
                stats, c_lo, c_hi, league=league, qual=qual, pageitems=pageitems
            )
        )
    non_empty = [p for p in parts if not p.empty]
    if not non_empty:
        return pd.DataFrame()
    return pd.concat(non_empty, ignore_index=True)


def normalize_api_batting_df(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add column aliases (``IDfg``, ``Team``, ``Off``, …) for typed INSERT mappers.

    **Does not drop columns:** every field returned by the API remains on the
    frame so ``row_to_stats_json`` can persist the full long tail in
    ``stats_jsonb``.
    """
    if df.empty:
        return df
    out = df.copy()
    if "playerid" in out.columns:
        out["IDfg"] = out["playerid"]
    if "TeamNameAbb" in out.columns:
        out["Team"] = out["TeamNameAbb"].astype(str)
    elif "Team" in out.columns:
        out["Team"] = out["Team"].map(lambda x: _strip_html_team(x) or "UNKNOWN")
    else:
        out["Team"] = "UNKNOWN"
    out["Level"] = "MLB"
    if "Offense" in out.columns:
        out["Off"] = out["Offense"]
    if "Defense" in out.columns:
        out["Def"] = out["Defense"]
    if "wBsR" in out.columns:
        out["BsR"] = out["wBsR"]
    return out


def normalize_api_pitching_df(df: pd.DataFrame) -> pd.DataFrame:
    """
    Same as batting: alias-only; **all** API columns are kept for ``stats_jsonb``.
    """
    if df.empty:
        return df
    out = df.copy()
    if "playerid" in out.columns:
        out["IDfg"] = out["playerid"]
    if "TeamNameAbb" in out.columns:
        out["Team"] = out["TeamNameAbb"].astype(str)
    elif "Team" in out.columns:
        out["Team"] = out["Team"].map(lambda x: _strip_html_team(x) or "UNKNOWN")
    else:
        out["Team"] = "UNKNOWN"
    out["Level"] = "MLB"
    if "vFA" not in out.columns and "FBv" in out.columns:
        out["vFA"] = out["FBv"]
    return out
