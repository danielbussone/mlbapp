#!/usr/bin/env bash
# Refresh FanGraphs MLB consolidated MVs + JAWS matviews without re-running HTTP ingest.
#
# From repo root:
#   pnpm db:refresh-fg-mviews
#   pnpm db:refresh-fg-mviews -- --jaws-only
#   pnpm db:refresh-fg-mviews -- --batting-only
#   pnpm db:refresh-fg-mviews -- --pitching-only
#
# Requires DATABASE_URL (see .env). Uses REFRESH … CONCURRENTLY (Flyway unique indexes).
# Order matches etl/mlbapp_etl/fg.py after a successful fg load.
#
# Options:
#   --jaws-only       Skip fg_*_season_mlb_consolidated; only refresh JAWS matviews (V28–V29 + V27).
#   --batting-only    Batting consolidated + batter JAWS matviews only.
#   --pitching-only   Pitching consolidated + pitcher JAWS matviews only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  echo "Copy .env.example to .env, or export DATABASE_URL before running this script." >&2
  exit 1
fi

REFRESH_CONSO=1
DO_BAT=1
DO_PIT=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --jaws-only) REFRESH_CONSO=0 ;;
    --batting-only) DO_PIT=0 ;;
    --pitching-only) DO_BAT=0 ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: pnpm db:refresh-fg-mviews -- [--jaws-only] [--batting-only] [--pitching-only]" >&2
      exit 1
      ;;
  esac
  shift
done

if [[ "$DO_BAT" -eq 0 && "$DO_PIT" -eq 0 ]]; then
  echo "Choose at most one of --batting-only or --pitching-only (not both)." >&2
  exit 1
fi

run_sql() {
  echo "+ $1" >&2
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "$1"
}

if [[ "$REFRESH_CONSO" -eq 1 ]]; then
  if [[ "$DO_BAT" -eq 1 ]]; then
    run_sql "REFRESH MATERIALIZED VIEW CONCURRENTLY fg_batting_season_mlb_consolidated"
  fi
  if [[ "$DO_PIT" -eq 1 ]]; then
    run_sql "REFRESH MATERIALIZED VIEW CONCURRENTLY fg_pitching_season_mlb_consolidated"
  fi
fi

if [[ "$DO_BAT" -eq 1 ]]; then
  run_sql "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fg_batter_jaws_primary_pos"
  run_sql "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fg_batter_jaws_cohort"
fi

if [[ "$DO_PIT" -eq 1 ]]; then
  run_sql "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fg_pitcher_jaws_primary_role"
  run_sql "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fg_pitcher_jaws_cohort"
fi

echo "Done." >&2
echo "" >&2
echo "If JAWS matviews (mv_fg_*_jaws_*) still have 0 rows, FanGraphs base tables are empty — load data first:" >&2
echo "  pnpm etl:fg" >&2
echo "then re-run: pnpm db:refresh-fg-mviews" >&2
