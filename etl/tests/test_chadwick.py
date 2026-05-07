"""Unit tests for Chadwick register ETL (no live DB)."""

from __future__ import annotations

import io
import zipfile

import pandas as pd

from mlbapp_etl.chadwick import (
    _clear_ambiguous_mlbam,
    build_dim_rows,
    filter_chadwick_incremental,
    load_register_from_zip_bytes,
)


def test_load_register_from_zip_concatenates_shards() -> None:
    a = "key_person,key_uuid,name_last,name_first\np1,11111111-1111-1111-1111-111111111111,Alph,A\n"
    b = "key_person,key_uuid,name_last,name_first\np2,22222222-2222-2222-2222-222222222222,Beta,B\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("register-x/data/people-0.csv", a)
        zf.writestr("register-x/data/people-1.csv", b)
    df = load_register_from_zip_bytes(buf.getvalue())
    assert len(df.index) == 2


def test_build_dim_rows_maps_external_ids() -> None:
    header = (
        "key_person,key_uuid,key_mlbam,key_retro,key_bbref,key_fangraphs,"
        "name_last,name_first,birth_year,birth_month,birth_day\n"
    )
    row = (
        "abc,33333333-3333-3333-3333-333333333333,660271,troum001,troutmi01,11576,"
        "Trout,Mike,1991,8,7\n"
    )
    df = pd.read_csv(io.StringIO(header + row))
    rows = build_dim_rows(df)
    assert len(rows) == 1
    r = rows[0]
    assert r["key_uuid"] == "33333333-3333-3333-3333-333333333333"
    assert r["key_mlbam"] == 660271
    assert r["birth_date"] == "1991-08-07"
    assert r["fangraphs"] == "11576"
    assert r["baseball_reference"] == "troutmi01"
    assert r["retrosheet"] == "troum001"


def test_build_dim_rows_skips_invalid_uuid() -> None:
    header = "key_person,key_uuid,name_last,name_first\np1,not-a-uuid,X,Y\n"
    df = pd.read_csv(io.StringIO(header))
    assert build_dim_rows(df) == []


def test_clear_ambiguous_mlbam_nulls_dupes() -> None:
    df = pd.DataFrame(
        {
            "key_uuid": [
                "44444444-4444-4444-4444-444444444444",
                "55555555-5555-5555-5555-555555555555",
            ],
            "key_mlbam": [100, 100],
            "name_last": ["A", "B"],
            "name_first": ["a", "b"],
        }
    )
    out = _clear_ambiguous_mlbam(df)
    assert pd.isna(out.loc[0, "key_mlbam"])
    assert pd.isna(out.loc[1, "key_mlbam"])


def test_filter_chadwick_incremental_new_uuid_only() -> None:
    dim = [
        {"key_uuid": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "key_mlbam": 1},
        {"key_uuid": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "key_mlbam": 2},
    ]
    existing = {"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": 1}
    rows, stats = filter_chadwick_incremental(dim, existing)
    assert len(rows) == 1
    assert rows[0]["key_uuid"] == "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    assert stats["new_key_uuid_rows"] == 1
    assert stats["key_mlbam_change_rows"] == 0
    assert stats["skipped_unchanged_rows"] == 1


def test_filter_chadwick_incremental_mlbam_backfill() -> None:
    dim = [{"key_uuid": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "key_mlbam": 660271}]
    existing = {"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": None}
    rows, stats = filter_chadwick_incremental(dim, existing)
    assert rows == dim
    assert stats["key_mlbam_change_rows"] == 1
    assert stats["new_key_uuid_rows"] == 0


def test_filter_chadwick_incremental_skips_unchanged_mlbam() -> None:
    dim = [{"key_uuid": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "key_mlbam": 660271}]
    existing = {"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": 660271}
    rows, stats = filter_chadwick_incremental(dim, existing)
    assert rows == []
    assert stats["skipped_unchanged_rows"] == 1


def test_normalize_cli_argv_importable() -> None:
    from mlbapp_etl.runtime import normalize_cli_argv

    assert normalize_cli_argv(["--", "--dry-run"]) == ["--dry-run"]
