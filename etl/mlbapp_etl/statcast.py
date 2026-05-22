"""Load Baseball Savant Statcast pitch rows into ``statcast_pitch``.

Uses ``pybaseball`` (``statcast``, ``statcast_pitcher``, ``statcast_batter``).
See ``docs/STATCAST_REQUIREMENTS.md`` for keys, UPSERT semantics, and CLI.

Environment: ``DATABASE_URL`` unless ``--dry-run``. Reads repo ``.env`` via
``load_repo_dotenv`` when variables are unset.

**Retries:** up to ``MLBAPP_STATCAST_MAX_RETRIES`` (default ``4``) per Savant
chunk with exponential backoff on transient failures.

**Throttle:** ``MLBAPP_STATCAST_THROTTLE_SECONDS`` (default ``0.75``) between
league date chunks; ``0`` disables.

**League chunking:** ``MLBAPP_STATCAST_CHUNK_DAYS`` (default ``1``) — days per
``statcast(start,end)`` call; use ``7`` for faster runs when Savant tolerates it.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

import pandas as pd
import psycopg
import requests
from psycopg.types.json import Json

from mlbapp_etl.columns import as_int, as_numeric, as_smallint, as_text
from mlbapp_etl.jsonutil import json_safe
from mlbapp_etl.runtime import load_repo_dotenv, normalize_cli_argv


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


# Savant column names → first-class DB columns (remainder → payload_jsonb).
_TYPED_SAVANT_COLS = frozenset(
    {
        "game_pk",
        "at_bat_number",
        "pitch_number",
        "sv_id",
        "game_date",
        "game_year",
        "pitcher",
        "batter",
        "pitch_type",
        "release_speed",
        "pfx_x",
        "pfx_z",
        "plate_x",
        "plate_z",
        "launch_speed",
        "launch_angle",
        "events",
        "description",
    }
)

_SNAPSHOT_SOURCE = {
    "league": "statcast_league",
    "pitcher": "statcast_pitcher",
    "batter": "statcast_batter",
}


def _parse_date(s: str) -> date:
    return datetime.strptime(s.strip(), "%Y-%m-%d").date()


def _season_window(
    season: int,
    *,
    start_mmdd: str | None,
    end_mmdd: str | None,
) -> tuple[date, date]:
    sm = start_mmdd or os.environ.get("MLBAPP_STATCAST_SEASON_START_MMDD", "03-01")
    em = end_mmdd or os.environ.get("MLBAPP_STATCAST_SEASON_END_MMDD", "11-30")
    start = _parse_date(f"{season}-{sm}")
    end = _parse_date(f"{season}-{em}")
    if end < start:
        msg = f"season window end before start: {start} {end}"
        raise ValueError(msg)
    return start, end


def _daterange_chunks(start: date, end: date, chunk_days: int) -> Iterator[tuple[date, date]]:
    if chunk_days < 1:
        msg = "chunk_days must be >= 1"
        raise ValueError(msg)
    cur = start
    while cur <= end:
        tail = min(cur + timedelta(days=chunk_days - 1), end)
        yield cur, tail
        cur = tail + timedelta(days=1)


def _throttle_seconds() -> float:
    raw = os.environ.get("MLBAPP_STATCAST_THROTTLE_SECONDS", "0.75").strip()
    return float(raw) if raw else 0.0


def _max_retries() -> int:
    return max(1, int(os.environ.get("MLBAPP_STATCAST_MAX_RETRIES", "4")))


def _chunk_days() -> int:
    return max(1, int(os.environ.get("MLBAPP_STATCAST_CHUNK_DAYS", "1")))


def _sleep_throttle() -> None:
    sec = _throttle_seconds()
    if sec > 0:
        time.sleep(sec)


def _retry_fetch(label: str, fn: Any) -> pd.DataFrame:
    from pybaseball.statcast import StatcastException

    attempts = _max_retries()
    delay = 1.0
    last_exc: BaseException | None = None
    for i in range(attempts):
        try:
            df = fn()
            if df is None:
                return pd.DataFrame()
            return df if isinstance(df, pd.DataFrame) else pd.DataFrame(df)
        except (
            StatcastException,
            OSError,
            ValueError,
            requests.RequestException,
        ) as exc:
            last_exc = exc
            if i == attempts - 1:
                break
            jitter = random.uniform(0, 0.25 * delay)
            time.sleep(delay + jitter)
            delay = min(delay * 2, 60.0)
    assert last_exc is not None
    msg = f"{label} failed after {attempts} attempts: {last_exc}"
    raise RuntimeError(msg) from last_exc


def _fetch_league(start: date, end: date, *, progress: bool) -> pd.DataFrame:
    from pybaseball import statcast as statcast_fn

    parts: list[pd.DataFrame] = []
    cd = _chunk_days()
    chunks = list(_daterange_chunks(start, end, cd))
    total = len(chunks)
    for idx, (cs, ce) in enumerate(chunks, start=1):
        s, e = cs.strftime("%Y-%m-%d"), ce.strftime("%Y-%m-%d")

        def _one() -> pd.DataFrame:
            return statcast_fn(s, e, team=None, verbose=False, parallel=False)

        df = _retry_fetch(f"statcast({s},{e})", _one)
        parts.append(df)
        if progress:
            n = 0 if df is None or df.empty else len(df.index)
            print(
                json.dumps(
                    {"chunk": idx, "chunks": total, "start": s, "end": e, "rows": n},
                ),
                flush=True,
            )
        if idx < total:
            _sleep_throttle()
    if not parts:
        return pd.DataFrame()
    out = pd.concat(parts, axis=0, ignore_index=True)
    return out


def _fetch_pitcher(start: date, end: date, player_mlbam: int, *, progress: bool) -> pd.DataFrame:
    from pybaseball import statcast_pitcher as statcast_pitcher_fn

    s, e = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

    def _one() -> pd.DataFrame:
        return statcast_pitcher_fn(s, e, player_mlbam)

    df = _retry_fetch(f"statcast_pitcher({s},{e},{player_mlbam})", _one)
    if progress:
        n = 0 if df is None or df.empty else len(df.index)
        print(json.dumps({"mode": "pitcher", "rows": n}), flush=True)
    return df if isinstance(df, pd.DataFrame) else pd.DataFrame()


def _fetch_batter(start: date, end: date, player_mlbam: int, *, progress: bool) -> pd.DataFrame:
    from pybaseball import statcast_batter as statcast_batter_fn

    s, e = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

    def _one() -> pd.DataFrame:
        return statcast_batter_fn(s, e, player_mlbam)

    df = _retry_fetch(f"statcast_batter({s},{e},{player_mlbam})", _one)
    if progress:
        n = 0 if df is None or df.empty else len(df.index)
        print(json.dumps({"mode": "batter", "rows": n}), flush=True)
    return df if isinstance(df, pd.DataFrame) else pd.DataFrame()


def _parse_game_date_value(v: Any) -> date | None:
    if v is None:
        return None
    if hasattr(v, "date") and callable(getattr(v, "date", None)):
        try:
            d = v.date()  # type: ignore[union-attr]
            if isinstance(d, date):
                return d
        except (ValueError, OSError):
            pass
    s = as_text(v)
    if not s:
        return None
    try:
        return _parse_date(s[:10])
    except ValueError:
        return None



def dataframe_to_pitch_rows(df: pd.DataFrame, snapshot_id: uuid.UUID) -> list[dict[str, Any]]:
    """Map a Savant dataframe to ``statcast_pitch`` row dicts for upsert."""
    if df is None or df.empty:
        return []
    df = df.copy()
    df.columns = df.columns.str.strip()

    snap_str = str(snapshot_id)
    payload_keys = [c for c in df.columns if c not in _TYPED_SAVANT_COLS]

    # to_dict('records') is 10-20x faster than iterrows() for large dataframes
    # because it avoids constructing a Series object per row.
    records = df.to_dict("records")

    rows: list[dict[str, Any]] = []
    skipped = 0
    for rec in records:
        game_pk = as_int(rec.get("game_pk"))
        at_bat_number = as_int(rec.get("at_bat_number"))
        pitch_number = as_int(rec.get("pitch_number"))
        game_year = as_smallint(rec.get("game_year"))
        pitcher_mlbam = as_int(rec.get("pitcher"))
        batter_mlbam = as_int(rec.get("batter"))
        gdate = _parse_game_date_value(rec.get("game_date"))
        if game_year is None and gdate is not None:
            game_year = gdate.year
        if (
            game_pk is None
            or at_bat_number is None
            or pitch_number is None
            or game_year is None
            or pitcher_mlbam is None
            or batter_mlbam is None
        ):
            skipped += 1
            continue
        payload = {k: json_safe(rec[k]) for k in payload_keys}
        rows.append(
            {
                "game_pk": game_pk,
                "at_bat_number": at_bat_number,
                "pitch_number": pitch_number,
                "sv_id": as_text(rec.get("sv_id")),
                "game_date": gdate,
                "game_year": game_year,
                "pitcher_mlbam": pitcher_mlbam,
                "batter_mlbam": batter_mlbam,
                "pitch_type": as_text(rec.get("pitch_type")),
                "release_speed": as_numeric(rec.get("release_speed")),
                "pfx_x": as_numeric(rec.get("pfx_x")),
                "pfx_z": as_numeric(rec.get("pfx_z")),
                "plate_x": as_numeric(rec.get("plate_x")),
                "plate_z": as_numeric(rec.get("plate_z")),
                "launch_speed": as_numeric(rec.get("launch_speed")),
                "launch_angle": as_numeric(rec.get("launch_angle")),
                "events": as_text(rec.get("events")),
                "description": as_text(rec.get("description")),
                "payload_jsonb": Json(payload),
                "snapshot_id": snap_str,
            },
        )
    if skipped:
        print(
            json.dumps({"warning": "skipped_rows_missing_required_fields", "count": skipped}),
            flush=True,
        )
    return rows


def _dedupe_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Dedupe by natural key, then by sv_id.

    Savant data occasionally has two rows with different (game_pk, at_bat_number,
    pitch_number) tuples sharing the same sv_id. The schema has a partial unique
    index on (game_year, sv_id) WHERE sv_id IS NOT NULL, so the second row would
    violate it even though ON CONFLICT on the PK doesn't fire.
    """
    keyed: dict[tuple[int, int, int, int], dict[str, Any]] = {}
    for r in rows:
        k = (int(r["game_year"]), int(r["game_pk"]), int(r["at_bat_number"]), int(r["pitch_number"]))
        keyed[k] = r
    result: list[dict[str, Any]] = []
    sv_id_seen: set[tuple[int, str]] = set()
    for r in keyed.values():
        sv_id = r.get("sv_id")
        if sv_id is not None:
            sv_key = (int(r["game_year"]), str(sv_id))
            if sv_key in sv_id_seen:
                continue
            sv_id_seen.add(sv_key)
        result.append(r)
    return result


_CREATE_STAGE = """
CREATE TEMP TABLE IF NOT EXISTS _statcast_stage (
    game_pk         bigint,
    at_bat_number   int,
    pitch_number    int,
    sv_id           text,
    game_date       date,
    game_year       smallint,
    pitcher_mlbam   int,
    batter_mlbam    int,
    pitch_type      text,
    release_speed   numeric,
    pfx_x           numeric,
    pfx_z           numeric,
    plate_x         numeric,
    plate_z         numeric,
    launch_speed    numeric,
    launch_angle    numeric,
    events          text,
    description     text,
    payload_jsonb   text,
    snapshot_id     text
) ON COMMIT DELETE ROWS
"""

_COPY_STAGE = (
    "COPY _statcast_stage"
    " (game_pk, at_bat_number, pitch_number, sv_id, game_date, game_year,"
    "  pitcher_mlbam, batter_mlbam, pitch_type, release_speed, pfx_x, pfx_z,"
    "  plate_x, plate_z, launch_speed, launch_angle, events, description,"
    "  payload_jsonb, snapshot_id)"
    " FROM STDIN"
)

_UPSERT_FROM_STAGE = """
INSERT INTO statcast_pitch (
    game_pk, at_bat_number, pitch_number, sv_id, game_date, game_year,
    pitcher_mlbam, batter_mlbam, pitch_type, release_speed, pfx_x, pfx_z,
    plate_x, plate_z, launch_speed, launch_angle, events, description,
    payload_jsonb, snapshot_id
)
SELECT
    game_pk, at_bat_number, pitch_number, sv_id, game_date, game_year,
    pitcher_mlbam, batter_mlbam, pitch_type, release_speed, pfx_x, pfx_z,
    plate_x, plate_z, launch_speed, launch_angle, events, description,
    payload_jsonb::jsonb, snapshot_id::uuid
FROM _statcast_stage
ON CONFLICT (game_year, game_pk, at_bat_number, pitch_number) DO UPDATE SET
    sv_id          = EXCLUDED.sv_id,
    game_date      = EXCLUDED.game_date,
    pitcher_mlbam  = EXCLUDED.pitcher_mlbam,
    batter_mlbam   = EXCLUDED.batter_mlbam,
    pitch_type     = EXCLUDED.pitch_type,
    release_speed  = EXCLUDED.release_speed,
    pfx_x          = EXCLUDED.pfx_x,
    pfx_z          = EXCLUDED.pfx_z,
    plate_x        = EXCLUDED.plate_x,
    plate_z        = EXCLUDED.plate_z,
    launch_speed   = EXCLUDED.launch_speed,
    launch_angle   = EXCLUDED.launch_angle,
    events         = EXCLUDED.events,
    description    = EXCLUDED.description,
    payload_jsonb  = EXCLUDED.payload_jsonb,
    snapshot_id    = EXCLUDED.snapshot_id,
    ingested_at    = now()
"""


_LINK_PITCHER = """
UPDATE statcast_pitch s
SET player_id_pitcher = dp.player_id
FROM dim_player dp
WHERE s.snapshot_id = %s::uuid
  AND dp.key_mlbam IS NOT NULL
  AND dp.key_mlbam = s.pitcher_mlbam
  AND s.player_id_pitcher IS DISTINCT FROM dp.player_id
"""

_LINK_BATTER = """
UPDATE statcast_pitch s
SET player_id_batter = dp.player_id
FROM dim_player dp
WHERE s.snapshot_id = %s::uuid
  AND dp.key_mlbam IS NOT NULL
  AND dp.key_mlbam = s.batter_mlbam
  AND s.player_id_batter IS DISTINCT FROM dp.player_id
"""


def _link_players(cur: Any, snapshot_id: uuid.UUID) -> dict[str, int]:
    cur.execute(_LINK_PITCHER, (str(snapshot_id),))
    pit = cur.rowcount
    cur.execute(_LINK_BATTER, (str(snapshot_id),))
    bat = cur.rowcount
    return {"player_id_pitcher_updates": pit, "player_id_batter_updates": bat}


def _pybaseball_version() -> str | None:
    try:
        import importlib.metadata as im

        return im.version("pybaseball")
    except Exception:
        return None


def run_statcast_etl(
    dsn: str,
    *,
    mode: str,
    start: date,
    end: date,
    player_mlbam: int | None,
    dry_run: bool,
    link_players: bool,
    notes: str | None,
    progress: bool,
) -> dict[str, Any] | None:
    import importlib.util

    if importlib.util.find_spec("pybaseball") is None:
        raise RuntimeError(
            "pybaseball is required for Statcast ETL. Install with: "
            "pip install -e './etl' from repo root (adds pybaseball).",
        )

    source = _SNAPSHOT_SOURCE[mode]
    if mode == "league":
        df = _fetch_league(start, end, progress=progress)
    elif mode == "pitcher":
        if player_mlbam is None:
            msg = "player_mlbam is required for pitcher mode"
            raise ValueError(msg)
        _sleep_throttle()
        df = _fetch_pitcher(start, end, player_mlbam, progress=progress)
    elif mode == "batter":
        if player_mlbam is None:
            msg = "player_mlbam is required for batter mode"
            raise ValueError(msg)
        _sleep_throttle()
        df = _fetch_batter(start, end, player_mlbam, progress=progress)
    else:
        msg = f"unknown mode {mode!r}"
        raise ValueError(msg)

    snap_id = uuid.uuid4()
    params_obj: dict[str, Any] = {
        "transport": "pybaseball",
        "mode": mode,
        "start_dt": start.isoformat(),
        "end_dt": end.isoformat(),
        "chunk_days_league": _chunk_days() if mode == "league" else None,
        "player_mlbam": player_mlbam,
        "pybaseball_version": _pybaseball_version(),
    }
    _log(f"Fetch complete — converting dataframe to row dicts …")
    rows = _dedupe_rows(dataframe_to_pitch_rows(df, snap_id))
    row_count = len(rows)
    _log(f"Converted {row_count:,} rows (after dedupe)")

    if dry_run:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "source": source,
                    "snapshot_id": str(snap_id),
                    "row_count": row_count,
                    "params": params_obj,
                },
                indent=2,
            ),
        )
        return None

    linked: dict[str, int] = {}
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(_CREATE_STAGE)
            cur.execute(
                """
                INSERT INTO ingest_snapshot (snapshot_id, source, params, row_count, notes)
                VALUES (%s::uuid, %s, %s::jsonb, %s, %s)
                """,
                (str(snap_id), source, json.dumps(params_obj), row_count, notes),
            )
            _log(f"COPY {row_count:,} rows to staging …")
            with cur.copy(_COPY_STAGE) as copy:
                for r in rows:
                    payload = r["payload_jsonb"]
                    payload_str = json.dumps(payload.obj) if hasattr(payload, "obj") else json.dumps(payload)
                    copy.write_row((
                        r["game_pk"], r["at_bat_number"], r["pitch_number"],
                        r.get("sv_id"), r.get("game_date"), r["game_year"],
                        r["pitcher_mlbam"], r["batter_mlbam"],
                        r.get("pitch_type"), r.get("release_speed"),
                        r.get("pfx_x"), r.get("pfx_z"),
                        r.get("plate_x"), r.get("plate_z"),
                        r.get("launch_speed"), r.get("launch_angle"),
                        r.get("events"), r.get("description"),
                        payload_str, r["snapshot_id"],
                    ))
            _log("Upserting from staging into statcast_pitch …")
            cur.execute(_UPSERT_FROM_STAGE)
            if link_players:
                _log("Linking players …")
                linked = _link_players(cur, snap_id)
        _log("Committing …")
        conn.commit()
        _log("Done.")

    out: dict[str, Any] = {
        "snapshot_id": str(snap_id),
        "source": source,
        "row_count": row_count,
    }
    if linked:
        out["linked"] = linked
    print(json.dumps(out, indent=2))
    return out


def main(argv: list[str] | None = None) -> None:
    argv = normalize_cli_argv(argv)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        required=True,
        choices=["league", "pitcher", "batter"],
        help="league: statcast range; pitcher/batter: player-scoped pulls.",
    )
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument(
        "--season",
        type=int,
        metavar="Y",
        help="Calendar season: load default window (MLBAPP_STATCAST_SEASON_*_MMDD or 03-01–11-30).",
    )
    g.add_argument(
        "--start-date",
        type=str,
        metavar="YYYY-MM-DD",
        help="Inclusive start (use with --end-date).",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        metavar="YYYY-MM-DD",
        help="Inclusive end (required with --start-date).",
    )
    parser.add_argument(
        "--player-mlbam",
        type=int,
        default=None,
        help="MLBAM id; required for pitcher and batter modes.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--link-players",
        action="store_true",
        help="After upsert, set player_id_pitcher / player_id_batter from dim_player.key_mlbam.",
    )
    parser.add_argument("--notes", default=None)
    parser.add_argument(
        "--no-progress",
        action="store_true",
        help="Suppress chunk progress JSON lines on stderr for league mode.",
    )
    ns = parser.parse_args(argv)

    if ns.season is not None:
        start, end = _season_window(ns.season, start_mmdd=None, end_mmdd=None)
    else:
        if not ns.end_date:
            parser.error("--end-date is required when using --start-date")
        start = _parse_date(ns.start_date)
        end = _parse_date(ns.end_date)

    if ns.mode in ("pitcher", "batter") and ns.player_mlbam is None:
        parser.error("--player-mlbam is required for pitcher and batter modes")

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
        run_statcast_etl(
            dsn or "",
            mode=ns.mode,
            start=start,
            end=end,
            player_mlbam=ns.player_mlbam,
            dry_run=ns.dry_run,
            link_players=ns.link_players,
            notes=ns.notes,
            progress=not ns.no_progress,
        )
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
