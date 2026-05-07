"""Load Chadwick Bureau **full** player register into ``dim_player`` and
``player_external_identifier``.

Uses the official `register` GitHub **zip** (same archive as pybaseball’s
lookup helper) and concatenates every ``data/people*.csv`` shard. This keeps
``key_uuid`` and all crosswalk columns; ``pybaseball.chadwick_register()`` in
current upstream builds **drops** ``key_uuid`` and filters to a major-league
subset, so it is **not** used here.

Writes one ``ingest_snapshot`` row per run with ``source`` ``chadwick_register``
and version metadata in ``params`` (zip URL/ref, row counts, optional
``artifact_sha256``).

**Incremental mode** (``--incremental``): Chadwick does not publish a delta feed;
the full zip is still downloaded and parsed. After that, only rows that are
**new** ``key_uuid`` values in ``dim_player``, or rows whose register
``key_mlbam`` **differs** from the stored ``dim_player.key_mlbam``, are upserted.
That cuts DB time for routine refreshes (new debuts and MLBAM backfills). It
does **not** pick up crosswalk-only edits (e.g. new FanGraphs id with the same
MLBAM); run a full load occasionally for that.

Environment: ``DATABASE_URL`` unless ``--dry-run``. Repo-root ``.env`` is read
via ``mlbapp_etl.runtime.load_repo_dotenv`` (same pattern as FanGraphs ETL).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import uuid
import zipfile
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg
import psycopg.errors
import requests

from mlbapp_etl.columns import as_int, as_text
from mlbapp_etl.runtime import load_repo_dotenv, normalize_cli_argv

_PEOPLE_FILE_PATTERN = re.compile(r"register[^/]+/data/people[^/]+\.csv$")

# ``player_external_identifier`` + FG link job use ``id_system='fangraphs'``.
_ID_SYSTEM_BY_COLUMN: dict[str, str] = {
    "key_mlbam": "mlbam",
    "key_fangraphs": "fangraphs",
    "key_bbref": "baseball_reference",
    "key_bbref_minors": "baseball_reference_minors",
    "key_retro": "retrosheet",
    "key_npb": "npb",
    "key_wikidata": "wikidata",
    "key_sr_nfl": "sr_nfl",
    "key_sr_nba": "sr_nba",
    "key_sr_nhl": "sr_nhl",
}

_MANAGED_ID_SYSTEMS = frozenset(
    {
        *_ID_SYSTEM_BY_COLUMN.values(),
        "chadwick_person",
        "chadwick_uuid",
    }
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _extract_people_frames(zip_archive: zipfile.ZipFile) -> list[pd.DataFrame]:
    frames: list[pd.DataFrame] = []
    for info in zip_archive.infolist():
        if not info.filename.endswith(".csv"):
            continue
        if not _PEOPLE_FILE_PATTERN.search(info.filename.replace("\\", "/")):
            continue
        raw = zip_archive.read(info.filename)
        frames.append(pd.read_csv(io.BytesIO(raw), low_memory=False))
    if not frames:
        msg = "no people*.csv files found in register zip (expected register-*/data/people-*.csv)"
        raise ValueError(msg)
    return frames


def load_register_from_zip_bytes(data: bytes) -> pd.DataFrame:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        dfs = _extract_people_frames(zf)
    return pd.concat(dfs, axis=0, ignore_index=True)


def fetch_register_zip(
    url: str,
    *,
    session: requests.Session | None = None,
    timeout: int = 120,
) -> bytes:
    sess = session or requests.Session()
    resp = sess.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.content


def _parse_uuid(val: Any) -> str | None:
    t = as_text(val)
    if not t:
        return None
    try:
        u = uuid.UUID(t)
    except ValueError:
        return None
    return str(u)


def _birth_date(row: pd.Series) -> str | None:
    y = as_int(row.get("birth_year"))
    m = as_int(row.get("birth_month"))
    d = as_int(row.get("birth_day"))
    if y is None or m is None or d is None:
        return None
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return None
    return f"{y:04d}-{m:02d}-{d:02d}"


def _clear_ambiguous_mlbam(df: pd.DataFrame) -> pd.DataFrame:
    """If ``key_mlbam`` maps to more than one ``key_uuid``, null it for ``dim_player``."""
    out = df.copy()
    if "key_mlbam" not in out.columns or "key_uuid" not in out.columns:
        return out
    mlb = out["key_mlbam"]
    mask = mlb.notna() & (mlb.astype(str).str.strip() != "")
    subset = out.loc[mask, ["key_uuid", "key_mlbam"]].copy()
    subset["key_mlbam"] = pd.to_numeric(subset["key_mlbam"], errors="coerce").astype("Int64")
    dup_keys = subset["key_mlbam"][subset["key_mlbam"].duplicated(keep=False)]
    bad = dup_keys.dropna().unique()
    if len(bad):
        amb = out["key_mlbam"].isin(bad) & out["key_mlbam"].notna()
        out.loc[amb, "key_mlbam"] = pd.NA
    return out


def build_dim_rows(df: pd.DataFrame) -> list[dict[str, Any]]:
    """One dict per register row with canonical ``dim_player`` + external keys."""
    df = _clear_ambiguous_mlbam(df)
    rows: list[dict[str, Any]] = []
    for _, r in df.iterrows():
        ku = _parse_uuid(r.get("key_uuid"))
        if ku is None:
            continue
        last = as_text(r.get("name_last")) or "UNKNOWN"
        first = as_text(r.get("name_first")) or "UNKNOWN"
        mlb_raw = r.get("key_mlbam")
        mlb = None
        if mlb_raw is not None and not (isinstance(mlb_raw, float) and pd.isna(mlb_raw)):
            mlb = as_int(mlb_raw)
        bd = _birth_date(r)
        rows.append(
            {
                "key_uuid": ku,
                "key_mlbam": mlb,
                "name_last": last,
                "name_first": first,
                "birth_date": bd,
                "key_person": as_text(r.get("key_person")),
                **_external_source_values(r),
            }
        )
    return rows


def _external_source_values(row: pd.Series) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for col, sys_name in _ID_SYSTEM_BY_COLUMN.items():
        if col not in row.index:
            continue
        raw = row.get(col)
        if raw is None or (isinstance(raw, float) and pd.isna(raw)):
            continue
        s = as_text(raw)
        if not s or s == "":
            continue
        if col in ("key_mlbam", "key_fangraphs"):
            n = as_int(raw)
            if n is None or n <= 0:
                continue
            out[sys_name] = str(n)
        else:
            out[sys_name] = s
    return out


def _external_tuples(
    player_id: int,
    key_uuid: str,
    key_person: str | None,
    extras: dict[str, Any],
) -> list[tuple[int, str, str]]:
    """(player_id, id_system, id_value) rows to insert."""
    pairs: list[tuple[int, str, str]] = []
    pairs.append((player_id, "chadwick_uuid", key_uuid))
    if key_person:
        pairs.append((player_id, "chadwick_person", key_person))
    for sys_name in _ID_SYSTEM_BY_COLUMN.values():
        v = extras.get(sys_name)
        if v:
            pairs.append((player_id, sys_name, v))
    return pairs


_DIM_UPSERT = """
INSERT INTO dim_player (key_uuid, key_mlbam, name_last, name_first, birth_date)
VALUES (%(key_uuid)s::uuid, %(key_mlbam)s, %(name_last)s, %(name_first)s, %(birth_date)s::date)
ON CONFLICT (key_uuid) DO UPDATE SET
  name_last = EXCLUDED.name_last,
  name_first = EXCLUDED.name_first,
  birth_date = COALESCE(EXCLUDED.birth_date, dim_player.birth_date),
  key_mlbam = CASE
    WHEN EXCLUDED.key_mlbam IS NOT NULL THEN EXCLUDED.key_mlbam
    ELSE dim_player.key_mlbam
  END,
  updated_at = now()
RETURNING player_id
"""

_EXT_UPSERT = """
INSERT INTO player_external_identifier (player_id, id_system, id_value, valid_from)
VALUES (%s, %s, %s, now())
ON CONFLICT (id_system, id_value) DO UPDATE SET
  player_id = EXCLUDED.player_id,
  valid_from = now()
"""


def _fetch_dim_uuid_mlbam(cur: Any) -> dict[str, int | None]:
    """Map ``key_uuid`` (text) → ``key_mlbam`` for incremental filtering."""
    cur.execute("SELECT key_uuid::text, key_mlbam FROM dim_player")
    out: dict[str, int | None] = {}
    for ku, mlb in cur.fetchall():
        mid: int | None
        if mlb is None:
            mid = None
        else:
            mid = int(mlb)
        out[str(ku)] = mid
    return out


def filter_chadwick_incremental(
    dim_input: list[dict[str, Any]],
    existing_uuid_to_mlbam: dict[str, int | None],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Keep register rows that need an upsert: new UUID or changed ``key_mlbam``."""
    selected: list[dict[str, Any]] = []
    new_uuids = 0
    mlbam_changes = 0
    for rec in dim_input:
        ku = rec["key_uuid"]
        reg_mlb = rec.get("key_mlbam")
        if ku not in existing_uuid_to_mlbam:
            selected.append(rec)
            new_uuids += 1
            continue
        old_mlb = existing_uuid_to_mlbam[ku]
        if reg_mlb is not None and old_mlb != reg_mlb:
            selected.append(rec)
            mlbam_changes += 1
    stats = {
        "new_key_uuid_rows": new_uuids,
        "key_mlbam_change_rows": mlbam_changes,
        "skipped_unchanged_rows": len(dim_input) - len(selected),
    }
    return selected, stats


def _upsert_dim_player(cur: Any, rec: dict[str, Any]) -> int | None:
    params = {
        "key_uuid": rec["key_uuid"],
        "key_mlbam": rec["key_mlbam"],
        "name_last": rec["name_last"],
        "name_first": rec["name_first"],
        "birth_date": rec["birth_date"],
    }
    cur.execute("SAVEPOINT chadwick_dim_player")
    try:
        cur.execute(_DIM_UPSERT, params)
    except psycopg.errors.UniqueViolation as exc:
        cname = getattr(getattr(exc, "diag", None), "constraint_name", "") or ""
        if "key_mlbam" not in cname.lower():
            raise
        cur.execute("ROLLBACK TO SAVEPOINT chadwick_dim_player")
        cur.execute(_DIM_UPSERT, {**params, "key_mlbam": None})
    row = cur.fetchone()
    cur.execute("RELEASE SAVEPOINT chadwick_dim_player")
    if not row:
        return None
    return int(row[0])


def run_chadwick_etl(
    dsn: str,
    *,
    register_zip_url: str,
    register_zip_bytes: bytes | None,
    dry_run: bool,
    notes: str | None,
    chunk_size: int,
    incremental: bool,
) -> dict[str, Any] | None:
    if register_zip_bytes is None:
        register_zip_bytes = fetch_register_zip(register_zip_url)
    artifact_sha256 = hashlib.sha256(register_zip_bytes).hexdigest()
    df = load_register_from_zip_bytes(register_zip_bytes)
    dim_input = build_dim_rows(df)

    params_obj: dict[str, Any] = {
        "transport": "chadwick_register_zip",
        "register_zip_url": register_zip_url,
        "artifact_sha256": artifact_sha256,
        "register_row_count": int(len(df.index)),
        "dim_row_count": len(dim_input),
        "incremental": incremental,
    }

    work_rows = dim_input
    if incremental:
        if not dsn and dry_run:
            print(
                "DATABASE_URL is required for --incremental --dry-run "
                "(need dim_player to compute the row filter).",
                file=sys.stderr,
            )
            sys.exit(1)
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                existing = _fetch_dim_uuid_mlbam(cur)
        work_rows, inc_stats = filter_chadwick_incremental(dim_input, existing)
        params_obj["incremental_stats"] = inc_stats
        params_obj["upsert_row_count"] = len(work_rows)

    if dry_run:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "register_row_count": len(df.index),
                    "dim_row_count": len(dim_input),
                    "upsert_row_count": len(work_rows),
                    "params": params_obj,
                },
                indent=2,
            )
        )
        return None

    snapshot_id = uuid.uuid4()
    deleted_maps = 0
    inserted_maps = 0

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ingest_snapshot (snapshot_id, source, params, row_count, notes)
                VALUES (%s, %s, %s::jsonb, %s, %s)
                """,
                (
                    str(snapshot_id),
                    "chadwick_register",
                    json.dumps(params_obj),
                    len(work_rows),
                    notes,
                ),
            )

            for i in range(0, len(work_rows), chunk_size):
                chunk = work_rows[i : i + chunk_size]
                for rec in chunk:
                    extras = {k: rec[k] for k in _ID_SYSTEM_BY_COLUMN.values() if k in rec}
                    pid = _upsert_dim_player(cur, rec)
                    if pid is None:
                        continue
                    tuples = _external_tuples(
                        pid,
                        rec["key_uuid"],
                        rec.get("key_person"),
                        extras,
                    )
                    if not tuples:
                        continue
                    cur.execute(
                        """
                        DELETE FROM player_external_identifier
                        WHERE player_id = %s
                          AND id_system = ANY(%s)
                        """,
                        (pid, list(_MANAGED_ID_SYSTEMS)),
                    )
                    deleted_maps += cur.rowcount
                    cur.executemany(_EXT_UPSERT, tuples)
                    inserted_maps += len(tuples)

        conn.commit()

    summary = {
        "snapshot_id": str(snapshot_id),
        "source": "chadwick_register",
        "register_row_count": len(df.index),
        "dim_row_count": len(dim_input),
        "upsert_row_count": len(work_rows),
        "external_id_deleted_rows": deleted_maps,
        "external_id_inserted_rows": inserted_maps,
        "params": params_obj,
    }
    print(json.dumps(summary, indent=2))
    return summary


def main(argv: list[str] | None = None) -> None:
    argv = normalize_cli_argv(argv)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--register-zip-url",
        default=os.environ.get(
            "MLBAPP_CHADWICK_REGISTER_ZIP_URL",
            "https://github.com/chadwickbureau/register/archive/refs/heads/master.zip",
        ),
        help="HTTP(S) URL to the register zip (default: Chadwick master branch).",
    )
    parser.add_argument(
        "--register-zip-file",
        default=os.environ.get("MLBAPP_CHADWICK_REGISTER_ZIP_FILE"),
        help="Read register from a local zip instead of downloading (optional).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch/parse only; print counts (no DATABASE_URL required if file path given).",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=int(os.environ.get("MLBAPP_CHADWICK_CHUNK_SIZE", "2000")),
        help="Rows per DB transaction chunk (default 2000).",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help=(
            "After loading the full register, upsert only new key_uuid rows or rows whose "
            "key_mlbam changed vs dim_player (faster DB; still downloads full zip)."
        ),
    )
    parser.add_argument("--notes", default=None)
    ns = parser.parse_args(argv)

    load_repo_dotenv(_repo_root())
    dsn = os.environ.get("DATABASE_URL")
    zip_bytes: bytes | None = None
    if ns.register_zip_file:
        zip_bytes = Path(ns.register_zip_file).expanduser().read_bytes()
    if not dsn and (not ns.dry_run or ns.incremental):
        print(
            "DATABASE_URL is required unless --dry-run without --incremental "
            "(set in the environment or in .env at the repo root).",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        run_chadwick_etl(
            dsn or "",
            register_zip_url=ns.register_zip_url,
            register_zip_bytes=zip_bytes,
            dry_run=ns.dry_run,
            notes=ns.notes,
            chunk_size=max(1, ns.chunk_size),
            incremental=ns.incremental,
        )
    except requests.HTTPError as exc:
        print("Chadwick register HTTP error:", exc, file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
