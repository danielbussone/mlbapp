"""Load Savant **directional OAA** into ``savant_fielding_oaa_cell``.

**Outfield** — six 60° slices — source ``pybaseball.statcast_outfield_directional_oaa``
(Savant ``directional_outs_above_average?…&csv=true``). Cell prefix ``of_dir_*``.

**Infield** — four directional buckets + optional RHB/LHB splits — source
``pybaseball.statcast_outs_above_average(year, pos='if', …)`` (Savant
``leaderboard/outs_above_average?…&pos=if&…&csv=true``). Cell prefixes ``if_dir_*``,
``if_split_*``.

Per-slice ``attempts`` are **NULL** when the export does not attribute opportunities to
each slice.

Use ``--feed outfield`` (default) or ``--feed infield``. Compliance: ``docs/DATASETS.md``.

Environment: ``DATABASE_URL`` unless ``--dry-run``. Reads repo ``.env`` via ``load_repo_dotenv``.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Final

import pandas as pd
import psycopg

from mlbapp_etl.columns import as_int, as_numeric, as_smallint, pick
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


# Savant CSV columns (after strip) → stable cell_id suffix (namespace of_dir_).
_SLICE_SCHEMA: Final[tuple[tuple[str, str], ...]] = (
    ("n_oaa_slice_back_left", "back_left"),
    ("n_oaa_slice_back", "back"),
    ("n_oaa_slice_back_right", "back_right"),
    ("n_oaa_slice_in_left", "in_left"),
    ("n_oaa_slice_in", "in"),
    ("n_oaa_slice_in_right", "in_right"),
)

_CELL_PREFIX: Final[str] = "of_dir_"

_IF_DIR_SCHEMA: Final[tuple[tuple[str, str], ...]] = (
    ("outs_above_average_infront", "if_dir_in"),
    ("outs_above_average_lateral_toward3bline", "if_dir_toward_3b"),
    ("outs_above_average_lateral_toward1bline", "if_dir_toward_1b"),
    ("outs_above_average_behind", "if_dir_behind"),
)

_IF_SPLIT_SCHEMA: Final[tuple[tuple[str, str], ...]] = (
    ("outs_above_average_rhh", "if_split_rhh"),
    ("outs_above_average_lhh", "if_split_lhh"),
)


def _strip_df_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.columns = out.columns.astype(str).str.strip()
    return out


def dataframe_directional_of_to_cells(df: pd.DataFrame, game_year: int) -> list[dict[str, Any]]:
    """Explode each Savant directional-OAA row into up to six ``savant_fielding_oaa_cell`` rows."""
    if df is None or df.empty:
        return []
    df = _strip_df_columns(df)
    gy = as_smallint(game_year)
    if gy is None:
        return []
    rows: list[dict[str, Any]] = []
    skipped = 0
    for _, row in df.iterrows():
        mlbam = as_int(pick(row, "player_id", "player_id_mlbam", "batter"))
        if mlbam is None:
            skipped += 1
            continue
        for col, suffix in _SLICE_SCHEMA:
            if col not in df.columns:
                continue
            oaa = as_numeric(pick(row, col), ndigits=3)
            if oaa is None:
                continue
            rows.append(
                {
                    "player_mlbam": mlbam,
                    "game_year": gy,
                    "cell_id": f"{_CELL_PREFIX}{suffix}",
                    "oaa": oaa,
                    "attempts": None,
                },
            )
    if skipped:
        print(
            json.dumps({"warning": "skipped_rows_missing_player_id", "count": skipped}),
            flush=True,
        )
    return rows


def dataframe_directional_if_to_cells(df: pd.DataFrame, game_year: int) -> list[dict[str, Any]]:
    """Explode Savant infield OAA leaderboard rows into ``if_dir_*`` / ``if_split_*`` cell rows."""
    if df is None or df.empty:
        return []
    df = _strip_df_columns(df)
    gy_default = as_smallint(game_year)
    if gy_default is None:
        return []
    rows: list[dict[str, Any]] = []
    skipped = 0
    for _, row in df.iterrows():
        mlbam = as_int(pick(row, "player_id", "player_id_mlbam", "batter"))
        if mlbam is None:
            skipped += 1
            continue
        gy_row = as_smallint(pick(row, "year", "season", "game_year"))
        gy = gy_row if gy_row is not None else gy_default

        def emit(col: str, cell_slug: str) -> None:
            if col not in df.columns:
                return
            oaa = as_numeric(pick(row, col), ndigits=3)
            if oaa is None:
                return
            rows.append(
                {
                    "player_mlbam": mlbam,
                    "game_year": gy,
                    "cell_id": cell_slug,
                    "oaa": oaa,
                    "attempts": None,
                },
            )

        for col, slug in _IF_DIR_SCHEMA:
            emit(col, slug)
        for col, slug in _IF_SPLIT_SCHEMA:
            emit(col, slug)

    if skipped:
        print(
            json.dumps({"warning": "skipped_rows_missing_player_id", "count": skipped}),
            flush=True,
        )
    return rows


_READ_CSV_KW: Final[dict[str, Any]] = {"encoding": "utf-8", "low_memory": False}


def _load_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, **_READ_CSV_KW)


def _load_csv_from_stdin() -> pd.DataFrame:
    raw = sys.stdin.buffer.read()
    return pd.read_csv(io.BytesIO(raw), **_READ_CSV_KW)


_UPSERT_SQL = """
INSERT INTO savant_fielding_oaa_cell (player_mlbam, game_year, cell_id, oaa, attempts)
VALUES (%(player_mlbam)s, %(game_year)s, %(cell_id)s, %(oaa)s, %(attempts)s)
ON CONFLICT (player_mlbam, game_year, cell_id) DO UPDATE SET
  oaa = EXCLUDED.oaa,
  attempts = EXCLUDED.attempts,
  ingested_at = now()
"""

_DELETE_OF_DIR_SEASON = """
DELETE FROM savant_fielding_oaa_cell
WHERE game_year = %s
  AND cell_id LIKE 'of_dir_%'
"""

_DELETE_IF_NAMESPACE_SEASON = """
DELETE FROM savant_fielding_oaa_cell
WHERE game_year = %s
  AND (cell_id LIKE 'if_dir_%' OR cell_id LIKE 'if_split_%')
"""


def _pybaseball_version() -> str | None:
    try:
        import importlib.metadata as im

        return im.version("pybaseball")
    except Exception:
        return None


def run_fielding_oaa_directional_of(
    dsn: str,
    *,
    game_year: int,
    dry_run: bool,
    replace_season: bool,
    notes: str | None,
    df: pd.DataFrame | None = None,
    min_opp: int | str | None = None,
    transport: str = "pybaseball",
    csv_path_note: str | None = None,
) -> dict[str, Any] | None:
    import importlib.util

    if df is None:
        if importlib.util.find_spec("pybaseball") is None:
            raise RuntimeError(
                "pybaseball is required for remote fetch. Install with: pip install -e './etl' from repo root, "
                "or pass --csv for a local Savant export.",
            )
        if min_opp is None:
            msg = "min_opp is required when df is not provided"
            raise ValueError(msg)
        from pybaseball import statcast_outfield_directional_oaa

        def _pull() -> pd.DataFrame:
            return statcast_outfield_directional_oaa(game_year, min_opp=min_opp)

        df = _retry_fetch(f"statcast_outfield_directional_oaa({game_year})", _pull)
        eff_transport = "pybaseball"
    else:
        eff_transport = transport

    cell_rows = dataframe_directional_of_to_cells(df, game_year)
    snap_id = uuid.uuid4()
    params_obj: dict[str, Any] = {
        "transport": eff_transport,
        "game_year": game_year,
        "min_opp": min_opp,
        "pybaseball_version": _pybaseball_version(),
        "csv_path": csv_path_note,
        "slice_rows": len(cell_rows),
        "replace_season": replace_season,
        "cell_namespace": _CELL_PREFIX.rstrip("_"),
    }

    if dry_run:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "snapshot_id": str(snap_id),
                    "params": params_obj,
                    "cell_rows": len(cell_rows),
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
                (
                    str(snap_id),
                    "statcast_fielding_oaa_directional_of",
                    json.dumps(params_obj),
                    len(cell_rows),
                    notes,
                ),
            )
            if replace_season:
                cur.execute(_DELETE_OF_DIR_SEASON, (game_year,))
            for i in range(0, len(cell_rows), 500):
                batch = cell_rows[i : i + 500]
                cur.executemany(_UPSERT_SQL, batch)
        conn.commit()

    out: dict[str, Any] = {
        "snapshot_id": str(snap_id),
        "source": "statcast_fielding_oaa_directional_of",
        "game_year": game_year,
        "cell_rows": len(cell_rows),
    }
    print(json.dumps(out, indent=2))
    return out


def run_fielding_oaa_directional_if(
    dsn: str,
    *,
    game_year: int,
    dry_run: bool,
    replace_season: bool,
    notes: str | None,
    df: pd.DataFrame | None = None,
    min_att: int | str | None = None,
    transport: str = "pybaseball",
    csv_path_note: str | None = None,
) -> dict[str, Any] | None:
    import importlib.util

    if df is None:
        if importlib.util.find_spec("pybaseball") is None:
            raise RuntimeError(
                "pybaseball is required for remote fetch. Install with: pip install -e './etl' from repo root, "
                "or pass --csv for a local Savant export.",
            )
        if min_att is None:
            msg = "min_att is required when df is not provided"
            raise ValueError(msg)
        from pybaseball import statcast_outs_above_average

        def _pull() -> pd.DataFrame:
            return statcast_outs_above_average(game_year, "if", min_att=min_att)

        df = _retry_fetch(f"statcast_outs_above_average({game_year}, 'if')", _pull)
        eff_transport = "pybaseball"
    else:
        eff_transport = transport

    cell_rows = dataframe_directional_if_to_cells(df, game_year)
    snap_id = uuid.uuid4()
    params_obj: dict[str, Any] = {
        "transport": eff_transport,
        "game_year": game_year,
        "min_att": min_att,
        "pybaseball_version": _pybaseball_version(),
        "csv_path": csv_path_note,
        "slice_rows": len(cell_rows),
        "replace_season": replace_season,
        "cell_namespace": "if_dir_if_split",
    }

    if dry_run:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "snapshot_id": str(snap_id),
                    "params": params_obj,
                    "cell_rows": len(cell_rows),
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
                (
                    str(snap_id),
                    "statcast_fielding_oaa_if_directional",
                    json.dumps(params_obj),
                    len(cell_rows),
                    notes,
                ),
            )
            if replace_season:
                cur.execute(_DELETE_IF_NAMESPACE_SEASON, (game_year,))
            for i in range(0, len(cell_rows), 500):
                batch = cell_rows[i : i + 500]
                cur.executemany(_UPSERT_SQL, batch)
        conn.commit()

    out: dict[str, Any] = {
        "snapshot_id": str(snap_id),
        "source": "statcast_fielding_oaa_if_directional",
        "game_year": game_year,
        "cell_rows": len(cell_rows),
    }
    print(json.dumps(out, indent=2))
    return out


def _parse_min_opp(s: str) -> int | str:
    t = s.strip().lower()
    if t in ("q", "qualified"):
        return "q"
    return int(t, 10)


def main(argv: list[str] | None = None) -> None:
    argv = normalize_cli_argv(argv)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--feed",
        choices=("outfield", "infield"),
        default="outfield",
        help="Savant feed: outfield directional grid (default) or infield leaderboard directional buckets.",
    )
    src = p.add_mutually_exclusive_group()
    src.add_argument(
        "--season",
        type=int,
        action="append",
        metavar="Y",
        help="Calendar season (repeat for multiple years). Fetch from Savant via pybaseball.",
    )
    src.add_argument(
        "--csv",
        type=str,
        metavar="PATH",
        help="Read a Savant CSV from disk (OF: directional OAA; IF: outs_above_average "
        "leaderboard with pos=infield). Use '-' for stdin.",
    )
    p.add_argument(
        "--game-year",
        type=int,
        metavar="Y",
        help="Required with --csv when the file contains multiple seasons or no year column "
        "(single-season export from Savant for one year).",
    )
    p.add_argument(
        "--min-opp",
        type=str,
        default="1",
        metavar="N|q",
        help='Minimum opportunities / Savant "min" param (integer, or "q" for qualified). '
        "Default 1 = broadest player coverage. Applies to both outfield and infield feeds.",
    )
    p.add_argument(
        "--replace-season",
        action="store_true",
        help="Before upsert, delete existing rows for this season in this feed's namespace "
        "(of_dir_* for outfield; if_dir_* / if_split_* for infield).",
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

    min_opp = _parse_min_opp(ns.min_opp)

    paths_and_years: list[tuple[Path | None, int]] = []
    if ns.csv:
        raw = ns.csv.strip()
        path_obj = Path("-") if raw == "-" else Path(raw)
        gy = ns.game_year
        if gy is None:
            # Single-year Savant exports are for one season; require explicit year for stdin/file.
            p.error("--game-year is required with --csv")
        paths_and_years.append((path_obj, gy))
    elif ns.season:
        for y in sorted(set(ns.season)):
            paths_and_years.append((None, y))
    else:
        p.error("Provide --season Y … and/or use --csv PATH with --game-year Y")

    try:
        for i, (csv_path, gy) in enumerate(paths_and_years):
            if csv_path is None:
                if ns.feed == "outfield":
                    run_fielding_oaa_directional_of(
                        dsn or "",
                        game_year=gy,
                        dry_run=ns.dry_run,
                        replace_season=ns.replace_season,
                        notes=ns.notes,
                        df=None,
                        min_opp=min_opp,
                    )
                else:
                    run_fielding_oaa_directional_if(
                        dsn or "",
                        game_year=gy,
                        dry_run=ns.dry_run,
                        replace_season=ns.replace_season,
                        notes=ns.notes,
                        df=None,
                        min_att=min_opp,
                    )
            else:
                if csv_path != Path("-") and not csv_path.is_file():
                    msg = f"CSV not found: {csv_path}"
                    raise FileNotFoundError(msg)
                if csv_path == Path("-"):
                    loaded = _load_csv_from_stdin()
                    note = "<stdin>"
                    tport = "stdin"
                else:
                    loaded = _load_csv(csv_path)
                    note = str(csv_path)
                    tport = "csv_file"
                if ns.feed == "outfield":
                    run_fielding_oaa_directional_of(
                        dsn or "",
                        game_year=gy,
                        dry_run=ns.dry_run,
                        replace_season=ns.replace_season,
                        notes=ns.notes,
                        df=loaded,
                        min_opp=None,
                        transport=tport,
                        csv_path_note=note,
                    )
                else:
                    run_fielding_oaa_directional_if(
                        dsn or "",
                        game_year=gy,
                        dry_run=ns.dry_run,
                        replace_season=ns.replace_season,
                        notes=ns.notes,
                        df=loaded,
                        min_att=None,
                        transport=tport,
                        csv_path_note=note,
                    )
            if i < len(paths_and_years) - 1:
                _sleep_throttle()
    except (RuntimeError, FileNotFoundError, ValueError) as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
