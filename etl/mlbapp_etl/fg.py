"""Load FanGraphs batting/pitching season leaderboards into Postgres.

Uses FanGraphs' **JSON** leaders API (``/api/leaders/major-league/data``), the
same route as baseballr ``fg_batter_leaders`` / ``fg_pitcher_leaders``, not the
legacy HTML leaderboard. Writes ``ingest_snapshot`` rows with ``source``
``fangraphs_batting`` and/or ``fangraphs_pitching``, plus ``fg_*`` rows (typed
v1 columns + ``stats_jsonb`` + ``rate_stat_qualified``).

By default the API is called with ``qual=1`` so **all** player-season lines with
any PA/IP appear; ``rate_stat_qualified`` encodes the usual MLB rate-stat bar
(3.1 PA per scheduled team game / 1 IP per game). Use ``--fangraphs-qualified-fetch``
for the smaller ``qual=y`` feed only.

Typed columns follow ``docs/SCHEMA_PROPOSAL.md`` (player-card v1 subset).
**Every other field** from the API response is stored unchanged in
``stats_jsonb`` (hundreds of columns in live data); committed JSON fixtures are
only small offline samples.

After a successful write (non-dry-run), **refreshes** the materialized views
``fg_batting_season_mlb_consolidated`` / ``fg_pitching_season_mlb_consolidated``
(``REFRESH … CONCURRENTLY`` when the matching facet loaded; Flyway **V13**),
then JAWS matviews when present (**V26** cohort, **V28** primary position / role, **V27** peak sum).
Use ``--skip-consolidated-mview-refresh`` to skip (e.g. bulk backfill scripts).
From repo root you can refresh the same matviews without HTTP ingest:
``pnpm db:refresh-fg-mviews`` (see ``scripts/run-refresh-fg-mviews.sh``).

With **no** ``--start-season`` / ``--end-season``, the CLI defaults to **1871** through the **current calendar year** (full historical load; may take a long time with default throttling). Pass a narrow range for incremental loads, e.g. ``--start-season 2024 --end-season 2024``.

Environment: ``DATABASE_URL`` (Postgres DSN) except with ``--dry-run``.
If unset, the ETL reads ``<repo>/.env`` like the Node apps (no override of
already-exported variables). ``HTTPS_PROXY`` is honored by ``requests``.
Optional ``MLBAPP_FG_COOKIE`` adds a ``Cookie`` header (legacy HTML only; see
``mlbapp_etl.fangraphs_requests``). Between FanGraphs HTTP calls (pagination
pages and batting vs pitching), the ETL sleeps ``MLBAPP_FG_THROTTLE_SECONDS``
(default ``10``; set to ``0`` to disable).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import date
from pathlib import Path
from typing import Any

import psycopg
import psycopg.errors
import requests
from psycopg.types.json import Json

from mlbapp_etl.columns import (
    as_fraction,
    as_int,
    as_numeric,
    as_smallint,
    as_text,
    pick,
)
from mlbapp_etl.fg_api import (
    fetch_fg_leaderboard_json,
    normalize_api_batting_df,
    normalize_api_fielding_df,
    normalize_api_pitching_df,
    throttle_between_fg_requests,
)
from mlbapp_etl.fg_qualify import batting_rate_stat_qualified, pitching_rate_stat_qualified
from mlbapp_etl.jsonutil import row_to_stats_json
from mlbapp_etl.runtime import load_repo_dotenv

# Default lower bound when ``pnpm etl:fg`` is run with no season flags (major-league FG history).
_DEFAULT_FG_START_SEASON = 1871


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def refresh_fg_consolidated_mviews(
    dsn: str, *, load_batting: bool, load_pitching: bool
) -> list[str]:
    """Refresh MLB consolidated-season MVs so card queries see new ``fg_*_season`` data.

    Uses ``REFRESH MATERIALIZED VIEW CONCURRENTLY`` (requires unique indexes from Flyway V13).
    Runs in **autocommit** — ``CONCURRENTLY`` cannot run inside a transaction block.
    """
    refreshed: list[str] = []
    if not load_batting and not load_pitching:
        return refreshed
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            if load_batting:
                cur.execute(
                    "REFRESH MATERIALIZED VIEW CONCURRENTLY fg_batting_season_mlb_consolidated"
                )
                refreshed.append("fg_batting_season_mlb_consolidated")
            if load_pitching:
                cur.execute(
                    "REFRESH MATERIALIZED VIEW CONCURRENTLY fg_pitching_season_mlb_consolidated"
                )
                refreshed.append("fg_pitching_season_mlb_consolidated")
            for mv_sql, mv_name, facet in (
                (
                    "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fg_batter_jaws_primary_pos",
                    "mv_fg_batter_jaws_primary_pos",
                    "batting",
                ),
                (
                    "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fg_batter_jaws_cohort",
                    "mv_fg_batter_jaws_cohort",
                    "batting",
                ),
                (
                    "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fg_pitcher_jaws_primary_role",
                    "mv_fg_pitcher_jaws_primary_role",
                    "pitching",
                ),
                (
                    "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fg_pitcher_jaws_cohort",
                    "mv_fg_pitcher_jaws_cohort",
                    "pitching",
                ),
            ):
                if facet == "batting" and not load_batting:
                    continue
                if facet == "pitching" and not load_pitching:
                    continue
                try:
                    cur.execute(mv_sql)
                    refreshed.append(mv_name)
                except psycopg.errors.UndefinedTable:
                    # Flyway not applied yet (e.g. V28 primary matviews)
                    pass
    return refreshed


def normalize_cli_argv(argv: list[str] | None) -> list[str]:
    """Drop leading ``--`` tokens (pnpm/npm pass them through to the script)."""
    if argv is None:
        out = sys.argv[1:]
    else:
        out = list(argv)
    while out and out[0] == "--":
        out = out[1:]
    return out


def _fetch_batting(
    start_season: int,
    end_season: int,
    *,
    league: str,
    qual: int | None,
) -> Any:
    raw = fetch_fg_leaderboard_json(
        "bat", start_season, end_season, league=league, qual=qual
    )
    return normalize_api_batting_df(raw)


def _fetch_pitching(
    start_season: int,
    end_season: int,
    *,
    league: str,
    qual: int | None,
) -> Any:
    raw = fetch_fg_leaderboard_json(
        "pit", start_season, end_season, league=league, qual=qual
    )
    return normalize_api_pitching_df(raw)


def _fetch_fielding(
    start_season: int,
    end_season: int,
    *,
    league: str,
    qual: int | None,
) -> Any:
    raw = fetch_fg_leaderboard_json(
        "fld", start_season, end_season, league=league, qual=qual
    )
    return normalize_api_fielding_df(raw)


def _pick_pitching_ra9_war(row: Any) -> float | None:
    """FanGraphs leaders JSON uses inconsistent column names for RA9-based pitching WAR."""
    v = pick(
        row,
        "RA9-WAR",
        "RA9 WAR",
        "RA9_WAR",
        "RA9WAR",
        "WAR_RA9",
        # Major-league API omits ``RA9-WAR``; leaderboard \"RA9-WAR\" column matches this field.
        "RA9-Wins",
    )
    if v is not None:
        return as_numeric(v, 2)
    try:
        cols = list(row.index)
    except AttributeError:
        return None
    for col in cols:
        c_low = str(col).lower()
        if "ra9" in c_low and "war" in c_low:
            return as_numeric(row[col], 2)
    return None


def _batting_row(snapshot_id: uuid.UUID, row: Any) -> dict[str, Any]:
    id_fg = as_int(pick(row, "IDfg"))
    if id_fg is None:
        msg = "missing IDfg in FanGraphs batting row"
        raise ValueError(msg)
    season = as_smallint(pick(row, "Season"))
    if season is None:
        msg = "missing Season in FanGraphs batting row"
        raise ValueError(msg)
    team = as_text(pick(row, "Team")) or "UNKNOWN"
    level = as_text(pick(row, "Level")) or "MLB"
    stats_jsonb = Json(row_to_stats_json(row))
    pa = as_int(pick(row, "PA"))
    rate_q = batting_rate_stat_qualified(int(season), level, pa)
    return {
        "snapshot_id": str(snapshot_id),
        "id_fg": id_fg,
        "season": season,
        "team": team,
        "level": level,
        "age": as_smallint(pick(row, "Age")),
        "games": as_smallint(pick(row, "G")),
        "pa": pa,
        "hr": as_smallint(pick(row, "HR")),
        "r": as_smallint(pick(row, "R")),
        "rbi": as_smallint(pick(row, "RBI")),
        "sb": as_smallint(pick(row, "SB")),
        "bb_pct": as_fraction(pick(row, "BB%")),
        "k_pct": as_fraction(pick(row, "K%")),
        "iso": as_numeric(pick(row, "ISO"), 4),
        "babip": as_numeric(pick(row, "BABIP"), 4),
        "avg": as_numeric(pick(row, "AVG"), 4),
        "obp": as_numeric(pick(row, "OBP"), 4),
        "slg": as_numeric(pick(row, "SLG"), 4),
        "woba": as_numeric(pick(row, "wOBA"), 4),
        "xwoba": as_numeric(pick(row, "xwOBA", "xWOBA"), 4),
        "wrc_plus": as_numeric(pick(row, "wRC+"), 2),
        "bsr": as_numeric(pick(row, "BsR"), 2),
        "off_runs": as_numeric(pick(row, "Off"), 2),
        "def_runs": as_numeric(pick(row, "Def"), 2),
        "war": as_numeric(pick(row, "WAR"), 2),
        "rate_stat_qualified": rate_q,
        "stats_jsonb": stats_jsonb,
    }


def _pitching_row(snapshot_id: uuid.UUID, row: Any) -> dict[str, Any]:
    id_fg = as_int(pick(row, "IDfg"))
    if id_fg is None:
        msg = "missing IDfg in FanGraphs pitching row"
        raise ValueError(msg)
    season = as_smallint(pick(row, "Season"))
    if season is None:
        msg = "missing Season in FanGraphs pitching row"
        raise ValueError(msg)
    team = as_text(pick(row, "Team")) or "UNKNOWN"
    level = as_text(pick(row, "Level")) or "MLB"
    stats_jsonb = Json(row_to_stats_json(row))
    ip_raw = pick(row, "IP")
    rate_q = pitching_rate_stat_qualified(int(season), level, ip_raw)
    return {
        "snapshot_id": str(snapshot_id),
        "id_fg": id_fg,
        "season": season,
        "team": team,
        "level": level,
        "age": as_smallint(pick(row, "Age")),
        "w": as_smallint(pick(row, "W")),
        "l": as_smallint(pick(row, "L")),
        "sv": as_smallint(pick(row, "SV")),
        "games": as_smallint(pick(row, "G")),
        "games_started": as_smallint(pick(row, "GS")),
        "ip": as_numeric(ip_raw, 1),
        "k_per_9": as_numeric(pick(row, "K/9"), 2),
        "bb_per_9": as_numeric(pick(row, "BB/9"), 2),
        "hr_per_9": as_numeric(pick(row, "HR/9"), 2),
        "babip": as_numeric(pick(row, "BABIP"), 4),
        "lob_pct": as_fraction(pick(row, "LOB%")),
        "gb_pct": as_fraction(pick(row, "GB%")),
        "hr_fb_pct": as_fraction(pick(row, "HR/FB")),
        "vfa": as_numeric(pick(row, "vFA"), 1),
        "era": as_numeric(pick(row, "ERA"), 2),
        "xera": as_numeric(pick(row, "xERA"), 2),
        "fip": as_numeric(pick(row, "FIP"), 2),
        "xfip": as_numeric(pick(row, "xFIP"), 2),
        "war": as_numeric(pick(row, "WAR"), 2),
        "war_ra9": _pick_pitching_ra9_war(row),
        "rate_stat_qualified": rate_q,
        "stats_jsonb": stats_jsonb,
    }


def _fielding_row(snapshot_id: uuid.UUID, row: Any) -> dict[str, Any]:
    id_fg = as_int(pick(row, "IDfg"))
    if id_fg is None:
        msg = "missing IDfg in FanGraphs fielding row"
        raise ValueError(msg)
    season = as_smallint(pick(row, "Season"))
    if season is None:
        msg = "missing Season in FanGraphs fielding row"
        raise ValueError(msg)
    team = as_text(pick(row, "Team")) or "UNKNOWN"
    level = as_text(pick(row, "Level")) or "MLB"
    pos_raw = as_text(pick(row, "Pos")) or as_text(pick(row, "Position")) or "UNK"
    position = (pos_raw or "UNK")[:64]
    stats_jsonb = Json(row_to_stats_json(row))
    return {
        "snapshot_id": str(snapshot_id),
        "id_fg": id_fg,
        "season": season,
        "team": team,
        "level": level,
        "position": position,
        "age": as_smallint(pick(row, "Age")),
        "games": as_smallint(pick(row, "G")),
        "inn": as_numeric(pick(row, "Inn"), 1),
        "po": as_int(pick(row, "PO")),
        "assists": as_int(pick(row, "A")),
        "errors": as_smallint(pick(row, "E")),
        "drs": as_numeric(pick(row, "DRS"), 2),
        "uzr": as_numeric(pick(row, "UZR"), 2),
        "oaa": as_numeric(pick(row, "OAA"), 2),
        "frv": as_numeric(pick(row, "FRV", "Statcast FRV", "FldRV", "Fld"), 2),
        "war": as_numeric(pick(row, "WAR"), 2),
        "stats_jsonb": stats_jsonb,
    }


_BAT_SQL = """
INSERT INTO fg_batting_season (
  snapshot_id, id_fg, season, team, level, player_id,
  age, games, pa, hr, r, rbi, sb,
  bb_pct, k_pct, iso, babip, avg, obp, slg, woba, xwoba, wrc_plus, bsr, off_runs, def_runs, war,
  rate_stat_qualified, stats_jsonb
) VALUES (
  %(snapshot_id)s::uuid, %(id_fg)s, %(season)s, %(team)s, %(level)s, NULL,
  %(age)s, %(games)s, %(pa)s, %(hr)s, %(r)s, %(rbi)s, %(sb)s,
  %(bb_pct)s, %(k_pct)s, %(iso)s, %(babip)s, %(avg)s, %(obp)s, %(slg)s, %(woba)s, %(xwoba)s,
  %(wrc_plus)s, %(bsr)s, %(off_runs)s, %(def_runs)s, %(war)s,
  %(rate_stat_qualified)s, %(stats_jsonb)s
)
"""

_PIT_SQL = """
INSERT INTO fg_pitching_season (
  snapshot_id, id_fg, season, team, level, player_id,
  age, w, l, sv, games, games_started, ip,
  k_per_9, bb_per_9, hr_per_9, babip, lob_pct, gb_pct, hr_fb_pct,
  vfa, era, xera, fip, xfip, war, war_ra9,
  rate_stat_qualified, stats_jsonb
) VALUES (
  %(snapshot_id)s::uuid, %(id_fg)s, %(season)s, %(team)s, %(level)s, NULL,
  %(age)s, %(w)s, %(l)s, %(sv)s, %(games)s, %(games_started)s, %(ip)s,
  %(k_per_9)s, %(bb_per_9)s, %(hr_per_9)s, %(babip)s, %(lob_pct)s, %(gb_pct)s, %(hr_fb_pct)s,
  %(vfa)s, %(era)s, %(xera)s, %(fip)s, %(xfip)s, %(war)s, %(war_ra9)s,
  %(rate_stat_qualified)s, %(stats_jsonb)s
)
"""

_FLD_SQL = """
INSERT INTO fg_fielding_season (
  snapshot_id, id_fg, season, team, level, position, player_id,
  age, games, inn, po, assists, errors, drs, uzr, oaa, frv, war,
  stats_jsonb
) VALUES (
  %(snapshot_id)s::uuid, %(id_fg)s, %(season)s, %(team)s, %(level)s, %(position)s, NULL,
  %(age)s, %(games)s, %(inn)s, %(po)s, %(assists)s, %(errors)s, %(drs)s, %(uzr)s, %(oaa)s, %(frv)s, %(war)s,
  %(stats_jsonb)s
)
"""


_LINK_BAT = """
UPDATE fg_batting_season f
SET player_id = m.player_id
FROM player_external_identifier m
WHERE f.snapshot_id = %s
  AND m.id_system = 'fangraphs'
  AND m.id_value = f.id_fg::text
  AND f.player_id IS DISTINCT FROM m.player_id
"""

_LINK_PIT = """
UPDATE fg_pitching_season f
SET player_id = m.player_id
FROM player_external_identifier m
WHERE f.snapshot_id = %s
  AND m.id_system = 'fangraphs'
  AND m.id_value = f.id_fg::text
  AND f.player_id IS DISTINCT FROM m.player_id
"""

_LINK_FLD = """
UPDATE fg_fielding_season f
SET player_id = m.player_id
FROM player_external_identifier m
WHERE f.snapshot_id = %s
  AND m.id_system = 'fangraphs'
  AND m.id_value = f.id_fg::text
  AND f.player_id IS DISTINCT FROM m.player_id
"""


def _link_fg_table(cur: Any, table: str, snapshot_id: uuid.UUID) -> int:
    if table == "fg_batting_season":
        sql = _LINK_BAT
    elif table == "fg_pitching_season":
        sql = _LINK_PIT
    elif table == "fg_fielding_season":
        sql = _LINK_FLD
    else:
        msg = "invalid table for player link"
        raise ValueError(msg)
    cur.execute(sql, (str(snapshot_id),))
    return cur.rowcount


def run_fg_etl(
    dsn: str,
    *,
    start_season: int,
    end_season: int,
    league: str,
    qual: int | None,
    load_batting: bool,
    load_pitching: bool,
    load_fielding: bool,
    dry_run: bool,
    link_players: bool,
    notes: str | None,
    refresh_consolidated_mviews: bool,
) -> list[tuple[str, uuid.UUID]] | None:
    league_arg = league.lower()

    bat_df = None
    pit_df = None
    fld_df = None
    if load_batting:
        bat_df = _fetch_batting(start_season, end_season, league=league_arg, qual=qual)
    if load_pitching:
        if load_batting:
            throttle_between_fg_requests()
        pit_df = _fetch_pitching(start_season, end_season, league=league_arg, qual=qual)
    if load_fielding:
        if load_batting or load_pitching:
            throttle_between_fg_requests()
        fld_df = _fetch_fielding(start_season, end_season, league=league_arg, qual=qual)

    params_obj: dict[str, Any] = {
        "transport": "fangraphs_major_league_json_api",
        "start_season": start_season,
        "end_season": end_season,
        "league": league_arg,
        "api_qual": qual if qual is not None else "y",
        "rate_stat_qualified_rule": "mlb_3_1_pa_per_schedule_game_batting_1_ip_per_game_pitching",
    }

    if dry_run:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "batting_rows": 0 if bat_df is None else len(bat_df.index),
                    "pitching_rows": 0 if pit_df is None else len(pit_df.index),
                    "fielding_rows": 0 if fld_df is None else len(fld_df.index),
                },
                indent=2,
            )
        )
        return None

    out: list[tuple[str, uuid.UUID]] = []
    linked: dict[str, int] = {}
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            if bat_df is not None:
                sid = uuid.uuid4()
                cur.execute(
                    """
                    INSERT INTO ingest_snapshot (snapshot_id, source, params, row_count, notes)
                    VALUES (%s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        str(sid),
                        "fangraphs_batting",
                        json.dumps({**params_obj, "facet": "batting"}),
                        len(bat_df.index),
                        notes,
                    ),
                )
                for _, row in bat_df.iterrows():
                    cur.execute(_BAT_SQL, _batting_row(sid, row))
                out.append(("fangraphs_batting", sid))
                if link_players:
                    linked["fangraphs_batting"] = _link_fg_table(cur, "fg_batting_season", sid)
            if pit_df is not None:
                sid = uuid.uuid4()
                cur.execute(
                    """
                    INSERT INTO ingest_snapshot (snapshot_id, source, params, row_count, notes)
                    VALUES (%s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        str(sid),
                        "fangraphs_pitching",
                        json.dumps({**params_obj, "facet": "pitching"}),
                        len(pit_df.index),
                        notes,
                    ),
                )
                for _, row in pit_df.iterrows():
                    cur.execute(_PIT_SQL, _pitching_row(sid, row))
                out.append(("fangraphs_pitching", sid))
                if link_players:
                    linked["fangraphs_pitching"] = _link_fg_table(cur, "fg_pitching_season", sid)
            if fld_df is not None:
                sid = uuid.uuid4()
                cur.execute(
                    """
                    INSERT INTO ingest_snapshot (snapshot_id, source, params, row_count, notes)
                    VALUES (%s, %s, %s::jsonb, %s, %s)
                    """,
                    (
                        str(sid),
                        "fangraphs_fielding",
                        json.dumps({**params_obj, "facet": "fielding"}),
                        len(fld_df.index),
                        notes,
                    ),
                )
                for _, row in fld_df.iterrows():
                    cur.execute(_FLD_SQL, _fielding_row(sid, row))
                out.append(("fangraphs_fielding", sid))
                if link_players:
                    linked["fangraphs_fielding"] = _link_fg_table(cur, "fg_fielding_season", sid)
        conn.commit()

    summary: dict[str, Any] = {"snapshots": [{"source": s, "snapshot_id": str(i)} for s, i in out]}
    if linked:
        summary["linked_rows"] = linked
    if refresh_consolidated_mviews and out:
        try:
            summary["refreshed_materialized_views"] = refresh_fg_consolidated_mviews(
                dsn,
                load_batting=load_batting,
                load_pitching=load_pitching,
            )
        except psycopg.Error as exc:
            print(
                "FanGraphs load committed but consolidated MV refresh failed "
                f"(apply Flyway V13+ or run REFRESH manually): {exc}",
                file=sys.stderr,
            )
            raise SystemExit(3) from exc
    print(json.dumps(summary, indent=2))
    return out


def main(argv: list[str] | None = None) -> None:
    argv = normalize_cli_argv(argv)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--start-season",
        type=int,
        default=None,
        metavar="YEAR",
        help=(
            f"First season (inclusive). Omit for full historical load ({_DEFAULT_FG_START_SEASON} "
            "through --end-season or current year)."
        ),
    )
    parser.add_argument(
        "--end-season",
        type=int,
        default=None,
        metavar="YEAR",
        help=(
            "Last season (inclusive). If omitted: same as --start-season when you passed "
            "--start-season; otherwise the current calendar year (when --start-season is also omitted)."
        ),
    )
    parser.add_argument(
        "--league",
        default="all",
        choices=["all", "al", "nl", "mnl"],
        help="FanGraphs league filter (all, al, nl, mnl).",
    )
    parser.add_argument(
        "--qual",
        type=int,
        default=1,
        metavar="N",
        help=(
            "FanGraphs API ``qual`` (minimum PA / IP× for a row to appear). "
            "Default 1 keeps injury-short seasons in the feed; higher values shrink the payload."
        ),
    )
    parser.add_argument(
        "--fangraphs-qualified-fetch",
        action="store_true",
        help=(
            "Use FanGraphs ``qual=y`` (qualified leaderboard only). "
            "Omits most sub-qualified seasons from the API; prefer default ``--qual 1`` + ``rate_stat_qualified``."
        ),
    )
    parser.add_argument("--batting-only", action="store_true")
    parser.add_argument("--pitching-only", action="store_true")
    parser.add_argument(
        "--fielding-only",
        action="store_true",
        help="Load FanGraphs fielding leaderboard only (writes fg_fielding_season).",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--link-players",
        action="store_true",
        help="After insert, set player_id from player_external_identifier (fangraphs).",
    )
    parser.add_argument(
        "--skip-consolidated-mview-refresh",
        action="store_true",
        help=(
            "Do not REFRESH fg_*_season_mlb_consolidated materialized views after load "
            "(default: refresh batting/pitching MV for whichever facet(s) ran)."
        ),
    )
    parser.add_argument("--notes", default=None)
    ns = parser.parse_args(argv)

    start_season = _DEFAULT_FG_START_SEASON if ns.start_season is None else ns.start_season
    if ns.end_season is not None:
        end_season = ns.end_season
    elif ns.start_season is not None:
        end_season = ns.start_season
    else:
        end_season = date.today().year

    if ns.start_season is None and ns.end_season is None:
        print(
            f"FanGraphs ETL: no --start-season/--end-season; using {start_season}–{end_season} "
            "(pass a smaller range for faster runs).",
            file=sys.stderr,
        )
    if sum(1 for x in (ns.batting_only, ns.pitching_only, ns.fielding_only) if x) > 1:
        parser.error("use at most one of --batting-only / --pitching-only / --fielding-only")
    load_fielding = ns.fielding_only
    load_batting = not ns.pitching_only and not ns.fielding_only
    load_pitching = not ns.batting_only and not ns.fielding_only

    load_repo_dotenv(_repo_root())
    dsn = os.environ.get("DATABASE_URL")
    if not dsn and not ns.dry_run:
        print(
            "DATABASE_URL is required unless --dry-run "
            "(set in the environment or in .env at the repo root).",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        run_fg_etl(
            dsn or "",
            start_season=start_season,
            end_season=end_season,
            league=ns.league,
            qual=None if ns.fangraphs_qualified_fetch else ns.qual,
            load_batting=load_batting,
            load_pitching=load_pitching,
            load_fielding=load_fielding,
            dry_run=ns.dry_run,
            link_players=ns.link_players,
            notes=ns.notes,
            refresh_consolidated_mviews=not ns.skip_consolidated_mview_refresh,
        )
    except requests.HTTPError as exc:
        print("FanGraphs API HTTP error:", exc, file=sys.stderr)
        print(
            "Check network, ``HTTPS_PROXY``, and FanGraphs availability; see docs/DATASETS.md.",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
