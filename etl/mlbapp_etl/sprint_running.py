"""Load Savant sprint speed leaderboard + 90 ft running splits into Postgres.

Uses pybaseball ``statcast_sprint_speed`` and ``statcast_running_splits`` (Savant CSVs).
See ``docs/STATCAST_REQUIREMENTS.md``. Requires ``DATABASE_URL`` unless ``--dry-run``.

Tables:
  ``player_season_sprint_speed`` (Flyway V16) — one headline ft/s per player-season.
  ``player_season_running_splits`` (Flyway V21) — full CSV row as jsonb, ``raw`` vs ``percent``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg
from psycopg.types.json import Json

from mlbapp_etl.columns import as_int, as_numeric, as_smallint, pick
from mlbapp_etl.jsonutil import row_to_stats_json
from mlbapp_etl.runtime import load_repo_dotenv
from mlbapp_etl.statcast import _retry_fetch, _sleep_throttle


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def normalize_cli_argv(argv: list[str] | None) -> list[str]:
    if argv is None:
        out = sys.argv[1:]
    else:
        out = list(argv)
    while out and out[0] == "--":
        out = out[1:]
    return out


def _strip_df_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.columns = out.columns.astype(str).str.strip()
    return out


def _player_mlbam(row: pd.Series) -> int | None:
    return as_int(pick(row, "player_id", "player_id_mlbam", "batter"))


def dataframe_to_sprint_rows(df: pd.DataFrame, game_year: int) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    df = _strip_df_columns(df)
    gy = as_smallint(game_year)
    if gy is None:
        return []
    rows: list[dict[str, Any]] = []
    skipped = 0
    for _, row in df.iterrows():
        mlbam = _player_mlbam(row)
        spd = as_numeric(pick(row, "sprint_speed", "Sprint_Speed"), ndigits=2)
        if mlbam is None or spd is None:
            skipped += 1
            continue
        rows.append({"key_mlbam": mlbam, "game_year": gy, "sprint_speed": spd})
    if skipped:
        print(
            json.dumps({"warning": "sprint_skipped_missing_id_or_speed", "count": skipped}),
            flush=True,
        )
    return rows


def dataframe_to_splits_rows(
    df: pd.DataFrame,
    game_year: int,
    *,
    split_variant: str,
) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    if split_variant not in ("raw", "percent"):
        msg = f"split_variant must be raw or percent, got {split_variant!r}"
        raise ValueError(msg)
    df = _strip_df_columns(df)
    gy = as_smallint(game_year)
    if gy is None:
        return []
    rows: list[dict[str, Any]] = []
    skipped = 0
    for _, row in df.iterrows():
        mlbam = _player_mlbam(row)
        if mlbam is None:
            skipped += 1
            continue
        payload = row_to_stats_json(row)
        rows.append(
            {
                "key_mlbam": mlbam,
                "game_year": gy,
                "split_variant": split_variant,
                "payload_jsonb": Json(payload),
            },
        )
    if skipped:
        print(
            json.dumps(
                {"warning": "splits_skipped_missing_player_id", "variant": split_variant, "count": skipped},
            ),
            flush=True,
        )
    return rows


_UPSERT_SPRINT_SQL = """
INSERT INTO player_season_sprint_speed (key_mlbam, game_year, sprint_speed)
VALUES (%(key_mlbam)s, %(game_year)s, %(sprint_speed)s)
ON CONFLICT (key_mlbam, game_year) DO UPDATE SET
  sprint_speed = EXCLUDED.sprint_speed,
  inserted_at = now()
"""

_UPSERT_SPLITS_SQL = """
INSERT INTO player_season_running_splits (key_mlbam, game_year, split_variant, payload_jsonb)
VALUES (%(key_mlbam)s, %(game_year)s, %(split_variant)s, %(payload_jsonb)s::jsonb)
ON CONFLICT (key_mlbam, game_year, split_variant) DO UPDATE SET
  payload_jsonb = EXCLUDED.payload_jsonb,
  inserted_at = now()
"""


def _pybaseball_version() -> str | None:
    try:
        import importlib.metadata as im

        return im.version("pybaseball")
    except Exception:
        return None


def run_sprint_running_for_season(
    dsn: str,
    *,
    game_year: int,
    min_opp_sprint: int,
    min_opp_splits: int,
    dry_run: bool,
    notes: str | None,
) -> dict[str, Any] | None:
    import importlib.util

    if importlib.util.find_spec("pybaseball") is None:
        raise RuntimeError(
            "pybaseball is required. Install with: pip install -e './etl' from repo root.",
        )

    from pybaseball import statcast_running_splits, statcast_sprint_speed

    def _pull_sprint() -> pd.DataFrame:
        return statcast_sprint_speed(game_year, min_opp=min_opp_sprint)

    def _pull_splits_raw() -> pd.DataFrame:
        return statcast_running_splits(game_year, min_opp=min_opp_splits, raw_splits=True)

    def _pull_splits_pct() -> pd.DataFrame:
        return statcast_running_splits(game_year, min_opp=min_opp_splits, raw_splits=False)

    df_s = _retry_fetch(f"statcast_sprint_speed({game_year})", _pull_sprint)
    _sleep_throttle()
    df_raw = _retry_fetch(f"statcast_running_splits({game_year},raw)", _pull_splits_raw)
    _sleep_throttle()
    df_pct = _retry_fetch(f"statcast_running_splits({game_year},percent)", _pull_splits_pct)

    sprint_rows = dataframe_to_sprint_rows(df_s, game_year)
    raw_rows = dataframe_to_splits_rows(df_raw, game_year, split_variant="raw")
    pct_rows = dataframe_to_splits_rows(df_pct, game_year, split_variant="percent")
    total_written = len(sprint_rows) + len(raw_rows) + len(pct_rows)

    snap_id = uuid.uuid4()
    params_obj: dict[str, Any] = {
        "transport": "pybaseball",
        "game_year": game_year,
        "min_opp_sprint": min_opp_sprint,
        "min_opp_splits": min_opp_splits,
        "pybaseball_version": _pybaseball_version(),
        "sprint_leaderboard_rows": len(sprint_rows),
        "running_splits_raw_rows": len(raw_rows),
        "running_splits_percent_rows": len(pct_rows),
    }

    if dry_run:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "snapshot_id": str(snap_id),
                    "params": params_obj,
                    "total_rows": total_written,
                },
                indent=2,
            ),
        )
        return None

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ingest_snapshot (snapshot_id, source, params, row_count, notes)
                VALUES (%s::uuid, %s, %s::jsonb, %s, %s)
                """,
                (str(snap_id), "statcast_sprint_running", json.dumps(params_obj), total_written, notes),
            )
            for i in range(0, len(sprint_rows), 500):
                batch = sprint_rows[i : i + 500]
                cur.executemany(_UPSERT_SPRINT_SQL, batch)
            for i in range(0, len(raw_rows), 500):
                batch = raw_rows[i : i + 500]
                cur.executemany(_UPSERT_SPLITS_SQL, batch)
            for i in range(0, len(pct_rows), 500):
                batch = pct_rows[i : i + 500]
                cur.executemany(_UPSERT_SPLITS_SQL, batch)
        conn.commit()

    out = {
        "snapshot_id": str(snap_id),
        "source": "statcast_sprint_running",
        "game_year": game_year,
        "sprint_rows": len(sprint_rows),
        "splits_raw_rows": len(raw_rows),
        "splits_percent_rows": len(pct_rows),
    }
    print(json.dumps(out, indent=2))
    return out


def main(argv: list[str] | None = None) -> None:
    argv = normalize_cli_argv(argv)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--season",
        type=int,
        action="append",
        required=True,
        metavar="Y",
        help="Calendar season (repeat for multiple years).",
    )
    p.add_argument(
        "--min-opp-sprint",
        type=int,
        default=10,
        help="Minimum sprint opportunities for leaderboard (Savant default 10).",
    )
    p.add_argument(
        "--min-opp-splits",
        type=int,
        default=5,
        help="Minimum opportunities for running_splits (pybaseball default 5).",
    )
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--notes", default=None)
    ns = p.parse_args(argv)

    load_repo_dotenv(_repo_root())
    dsn = os.environ.get("DATABASE_URL")
    if not dsn and not ns.dry_run:
        print(
            "DATABASE_URL is required unless --dry-run "
            "(set in the environment or in .env at the repo root).",
            file=sys.stderr,
        )
        sys.exit(1)

    seasons = sorted(set(ns.season))
    try:
        for y in seasons:
            run_sprint_running_for_season(
                dsn or "",
                game_year=y,
                min_opp_sprint=ns.min_opp_sprint,
                min_opp_splits=ns.min_opp_splits,
                dry_run=ns.dry_run,
                notes=ns.notes,
            )
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
