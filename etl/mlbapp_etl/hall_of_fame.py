"""Load Lahman-style Hall of Fame voting rows into ``hall_of_fame_player``.

Rows kept: ``inducted == 'Y'`` and ``category == 'Player'`` (excludes managers, umpires, executives).
``lahman_player_id`` is Lahman / Baseball-Reference ``playerID``. After upsert, ``player_id`` is
set from ``player_external_identifier`` where ``id_system = 'baseball_reference'``.

**Data source:** The upstream ``chadwickbureau/baseballdatabank`` GitHub zip (used by pybaseball's
Lahman helpers) **404s** as of 2026, so this ETL fetches by default an **Internet Archive** snapshot
of that zip. Override with ``MLBAPP_HALL_OF_FAME_CSV_URL`` / ``MLBAPP_HALL_OF_FAME_CSV_FILE`` or
``MLBAPP_BASEBALL_DATABANK_ZIP_URL``. Run: ``pnpm etl:hall-of-fame``.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import uuid
import zipfile
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg
import requests

from mlbapp_etl.runtime import load_repo_dotenv

# GitHub removed / renamed ``chadwickbureau/baseballdatabank``; pybaseball's Lahman zip URL returns 404.
# This archive capture contains ``baseballdatabank-master/core/HallOfFame.csv`` (Lahman-compatible columns).
_DEFAULT_BASEBALL_DATABANK_ZIP_URL = (
    "https://web.archive.org/web/20220128170417if_/"
    "https://github.com/chadwickbureau/baseballdatabank/archive/master.zip"
)


def normalize_cli_argv(argv: list[str] | None) -> list[str]:
    if argv is None:
        out = sys.argv[1:]
    else:
        out = list(argv)
    while out and out[0] == "--":
        out = out[1:]
    return out


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def fetch_hall_of_fame_lahman_csv() -> pd.DataFrame:
    """Return the raw HallOfFame table (all rows), Lahman-style columns."""
    csv_file = os.environ.get("MLBAPP_HALL_OF_FAME_CSV_FILE")
    if csv_file:
        path = Path(csv_file).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f"MLBAPP_HALL_OF_FAME_CSV_FILE not found: {path}")
        return pd.read_csv(path, low_memory=False)

    csv_url = os.environ.get("MLBAPP_HALL_OF_FAME_CSV_URL")
    if csv_url:
        r = requests.get(csv_url, timeout=120)
        r.raise_for_status()
        return pd.read_csv(io.BytesIO(r.content), low_memory=False)

    zip_url = os.environ.get("MLBAPP_BASEBALL_DATABANK_ZIP_URL", _DEFAULT_BASEBALL_DATABANK_ZIP_URL)
    r = requests.get(zip_url, timeout=180)
    r.raise_for_status()
    if len(r.content) < 1000 or r.content[:2] != b"PK":
        raise ValueError(
            "Download was not a zip file (bad URL or HTML error page). "
            "Set MLBAPP_HALL_OF_FAME_CSV_URL to a direct HallOfFame.csv or fix MLBAPP_BASEBALL_DATABANK_ZIP_URL."
        )
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = [n for n in z.namelist() if n.rpartition("/")[2].lower() == "halloffame.csv"]
    if not names:
        raise ValueError(
            "No HallOfFame.csv in zip. Set MLBAPP_HALL_OF_FAME_CSV_URL to a Lahman-format CSV, "
            "or MLBAPP_BASEBALL_DATABANK_ZIP_URL to a databank archive containing HallOfFame.csv."
        )
    names.sort(key=lambda p: (0 if "/contrib/" in p.replace("\\", "/") else 1, len(p)))
    with z.open(names[0]) as fh:
        return pd.read_csv(fh, low_memory=False)


def load_hof_inducted_players() -> pd.DataFrame:
    df = fetch_hall_of_fame_lahman_csv()
    if df.empty:
        return df
    col_player = "playerID" if "playerID" in df.columns else "player_id"
    col_year = "yearID" if "yearID" in df.columns else "year_id"
    col_ind = "inducted" if "inducted" in df.columns else "Inducted"
    col_cat = "category" if "category" in df.columns else "Category"
    col_vote = "votedBy" if "votedBy" in df.columns else "votedby"
    sub = df.loc[(df[col_ind].astype(str).str.upper() == "Y") & (df[col_cat].astype(str) == "Player")].copy()
    if sub.empty:
        return pd.DataFrame(columns=[col_player, col_year, col_vote, col_cat])
    # One row per player: latest induction year among inducted rows.
    one = (
        sub.assign(_y=pd.to_numeric(sub[col_year], errors="coerce"))
        .sort_values([col_player, "_y"], ascending=[True, False])
        .drop_duplicates(subset=[col_player], keep="first")
    )
    out = one[[col_player, col_year, col_vote, col_cat]].rename(
        columns={col_player: "lahman_player_id", col_year: "inducted_year", col_vote: "voted_by", col_cat: "category"}
    )
    out["lahman_player_id"] = out["lahman_player_id"].astype(str).str.strip()
    out["inducted_year"] = pd.to_numeric(out["inducted_year"], errors="coerce").astype("Int64")
    out["voted_by"] = out["voted_by"].astype(str).where(out["voted_by"].notna(), None)
    out["category"] = out["category"].astype(str)
    return out


def run_hof_etl(dsn: str, *, dry_run: bool) -> dict[str, Any] | None:
    df = load_hof_inducted_players()
    if df.empty:
        print(json.dumps({"error": "No Hall of Fame rows after filter", "row_count": 0}, indent=2))
        return None

    rows: list[dict[str, Any]] = []
    for _, r in df.iterrows():
        iy = r["inducted_year"]
        if pd.isna(iy):
            continue
        vy = int(iy)
        vb = r["voted_by"]
        if isinstance(vb, str) and vb.strip().lower() in ("nan", "none", ""):
            vb = None
        elif not isinstance(vb, str):
            vb = None
        rows.append(
            {
                "lahman_player_id": str(r["lahman_player_id"]).strip(),
                "inducted_year": vy,
                "voted_by": vb,
                "category": str(r["category"]),
            }
        )
    if dry_run:
        print(json.dumps({"dry_run": True, "row_count": len(rows), "sample": rows[:5]}, indent=2))
        return None

    snapshot_id = uuid.uuid4()
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ingest_snapshot (snapshot_id, source, params, row_count, notes)
                VALUES (%s, %s, %s::jsonb, %s, %s)
                """,
                (
                    str(snapshot_id),
                    "lahman_hall_of_fame",
                    json.dumps({"row_count": len(rows)}),
                    len(rows),
                    "lahman HallOfFame.csv inducted=Y category=Player",
                ),
            )
            cur.executemany(
                """
                INSERT INTO hall_of_fame_player (
                  lahman_player_id, inducted_year, voted_by, category, source, ingested_at
                )
                VALUES (%(lahman_player_id)s, %(inducted_year)s, %(voted_by)s, %(category)s, 'lahman_hall_of_fame', now())
                ON CONFLICT (lahman_player_id) DO UPDATE SET
                  inducted_year = EXCLUDED.inducted_year,
                  voted_by = EXCLUDED.voted_by,
                  category = EXCLUDED.category,
                  source = EXCLUDED.source,
                  ingested_at = now()
                """,
                rows,
            )
            cur.execute(
                """
                UPDATE hall_of_fame_player h
                SET player_id = m.player_id
                FROM player_external_identifier m
                WHERE m.id_system = 'baseball_reference'
                  AND m.id_value = h.lahman_player_id
                """
            )
            linked = cur.rowcount
        conn.commit()
    return {"row_count": len(rows), "player_id_rows_updated": linked, "snapshot_id": str(snapshot_id)}


def main() -> None:
    load_repo_dotenv(_repo_root())
    argv = normalize_cli_argv(None)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true", help="Fetch and print counts only.")
    args = p.parse_args(argv)

    dsn = os.environ.get("DATABASE_URL")
    if not dsn and not args.dry_run:
        print(
            "DATABASE_URL is required unless --dry-run "
            "(set in the environment or in .env at the repo root).",
            file=sys.stderr,
        )
        sys.exit(1)
    out = run_hof_etl(dsn, dry_run=args.dry_run)
    if out is not None:
        print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
