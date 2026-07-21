#!/usr/bin/env bash
# Run all ETLs that are meaningfully scoped to one MLB calendar season so the
# warehouse stays current as games are played. Intended for a nightly or weekly
# cron / CI job.
#
# Usage (repo root):
#   pnpm etl:season-refresh
#   pnpm etl:season-refresh -- 2026
#   ./scripts/run-season-etl-refresh.sh --with-chadwick 2026
#
# Prerequisites: pnpm etl:install, DATABASE_URL (env or .env), network access
# to FanGraphs / Savant.
#
# Steps (default):
#   1. FanGraphs batting + pitching + fielding for [Y,Y]
#   2. Statcast league window for season Y (default 03-01–11-30; see statcast ETL env)
#      With --incremental: instead pull only from the last loaded game_date (minus a
#      few overlap days for late corrections) through today — cheap for a weekly cron.
#   3. Refresh Statcast percentile materialized views (after pitch data)
#   4. Savant sprint / running leaderboards for Y
#   5. Savant directional OAA — outfield and infield for Y (--replace-season)
#
# Not season-scoped (opt-in): Chadwick register (--with-chadwick; uses --incremental
# so only new UUIDs / MLBAM changes are upserted after the full zip is downloaded),
# Hall of Fame (--with-hall-of-fame).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WITH_CHADWICK=0
WITH_HOF=0
SKIP_STATCAST=0
SKIP_SPRINT=0
SKIP_FIELDING=0
SKIP_PERCENTILES=0
SKIP_FG=0
INCREMENTAL=0
SEASON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-chadwick) WITH_CHADWICK=1; shift ;;
    --with-hall-of-fame) WITH_HOF=1; shift ;;
    --incremental) INCREMENTAL=1; shift ;;
    --skip-statcast) SKIP_STATCAST=1; shift ;;
    --skip-sprint) SKIP_SPRINT=1; shift ;;
    --skip-fielding) SKIP_FIELDING=1; shift ;;
    --skip-percentiles) SKIP_PERCENTILES=1; shift ;;
    --skip-fg) SKIP_FG=1; shift ;;
    -h|--help)
      sed -n '1,35p' "$0"
      exit 0
      ;;
    -*)
      echo "Unknown option: $1 (use --help)" >&2
      exit 1
      ;;
    *)
      if [[ -n "$SEASON" ]]; then
        echo "Extra argument: $1" >&2
        exit 1
      fi
      SEASON="$1"
      shift
      ;;
  esac
done

if [[ -z "$SEASON" ]]; then
  SEASON="$(date +%Y)"
fi

if [[ ! "$SEASON" =~ ^[0-9]{4}$ ]]; then
  echo "Season must be a four-digit year, got: $SEASON" >&2
  exit 1
fi

# Python used to run the ETL modules. Defaults to `python` (works when the package is
# installed on PATH, e.g. after `pnpm etl:install`, and inside the ETL container). Override
# with MLBAPP_ETL_PYTHON to point at a specific interpreter/venv (no pnpm/node required).
PY="${MLBAPP_ETL_PYTHON:-python}"
if ! PYTHONPATH="$ROOT/etl" "$PY" -c "import mlbapp_etl" >/dev/null 2>&1; then
  echo "ETL package not importable with '$PY'." >&2
  echo "Run: pnpm etl:install (or pip install ./etl), or set MLBAPP_ETL_PYTHON." >&2
  exit 1
fi

# Invoke an ETL module: run_py <module> [args...]  ->  python -m mlbapp_etl.<module> [args]
run_py() {
  PYTHONPATH="$ROOT/etl" "$PY" -m "mlbapp_etl.$1" "${@:2}"
}

log() {
  printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "Season ETL refresh starting for calendar year $SEASON"

if [[ "$WITH_CHADWICK" -eq 1 ]]; then
  log "Chadwick register (incremental upsert; full zip download; not season-scoped)"
  run_py chadwick --incremental
fi

if [[ "$WITH_HOF" -eq 1 ]]; then
  log "Hall of Fame (static table; not season-scoped)"
  run_py hall_of_fame
fi

if [[ "$SKIP_FG" -eq 0 ]]; then
  log "FanGraphs batting, pitching, fielding ($SEASON)"
  run_py fg --start-season "$SEASON" --end-season "$SEASON" --link-players
else
  log "Skipping FanGraphs (--skip-fg)"
fi

if [[ "$SKIP_STATCAST" -eq 0 ]]; then
  if [[ "$INCREMENTAL" -eq 1 ]]; then
    log "Statcast incremental (from last loaded game_date through today)"
    run_py statcast --mode league --incremental --link-players --no-progress
  else
    log "Statcast league window (season $SEASON)"
    run_py statcast --mode league --season "$SEASON" --link-players --no-progress
  fi
else
  log "Skipping Statcast league (--skip-statcast)"
fi

if [[ "$SKIP_PERCENTILES" -eq 0 ]]; then
  log "Refresh Statcast percentile materialized views"
  bash "$ROOT/scripts/run-refresh-statcast-percentile-mvs.sh"
else
  log "Skipping percentile MV refresh (--skip-percentiles)"
fi

if [[ "$SKIP_SPRINT" -eq 0 ]]; then
  log "Sprint / running leaderboards ($SEASON)"
  run_py sprint_running --season "$SEASON"
else
  log "Skipping sprint ETL (--skip-sprint)"
fi

if [[ "$SKIP_FIELDING" -eq 0 ]]; then
  log "Savant directional OAA — outfield ($SEASON, replace season)"
  run_py fielding_oaa_cell --season "$SEASON" --replace-season
  log "Savant directional OAA — infield ($SEASON, replace season)"
  run_py fielding_oaa_cell --feed infield --season "$SEASON" --replace-season
else
  log "Skipping fielding OAA (--skip-fielding)"
fi

log "Season $SEASON ETL refresh finished OK"
