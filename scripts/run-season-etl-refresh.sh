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
SEASON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-chadwick) WITH_CHADWICK=1; shift ;;
    --with-hall-of-fame) WITH_HOF=1; shift ;;
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

if [[ ! -x "$ROOT/.venv-etl/bin/python" ]]; then
  echo "Missing ETL venv. Run: pnpm etl:install" >&2
  exit 1
fi

log() {
  printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "Season ETL refresh starting for calendar year $SEASON"

if [[ "$WITH_CHADWICK" -eq 1 ]]; then
  log "Chadwick register (incremental upsert; full zip download; not season-scoped)"
  pnpm etl:chadwick -- --incremental
fi

if [[ "$WITH_HOF" -eq 1 ]]; then
  log "Hall of Fame (static table; not season-scoped)"
  pnpm etl:hall-of-fame
fi

if [[ "$SKIP_FG" -eq 0 ]]; then
  log "FanGraphs batting, pitching, fielding ($SEASON)"
  pnpm etl:fg -- --start-season "$SEASON" --end-season "$SEASON" --link-players
else
  log "Skipping FanGraphs (--skip-fg)"
fi

if [[ "$SKIP_STATCAST" -eq 0 ]]; then
  log "Statcast league window (season $SEASON)"
  pnpm etl:statcast -- --mode league --season "$SEASON" --link-players --no-progress
else
  log "Skipping Statcast league (--skip-statcast)"
fi

if [[ "$SKIP_PERCENTILES" -eq 0 ]]; then
  log "Refresh Statcast percentile materialized views"
  pnpm db:refresh-percentiles
else
  log "Skipping percentile MV refresh (--skip-percentiles)"
fi

if [[ "$SKIP_SPRINT" -eq 0 ]]; then
  log "Sprint / running leaderboards ($SEASON)"
  pnpm etl:sprint -- --season "$SEASON"
else
  log "Skipping sprint ETL (--skip-sprint)"
fi

if [[ "$SKIP_FIELDING" -eq 0 ]]; then
  log "Savant directional OAA — outfield ($SEASON, replace season)"
  pnpm etl:fielding-oaa -- --season "$SEASON" --replace-season
  log "Savant directional OAA — infield ($SEASON, replace season)"
  pnpm etl:fielding-oaa-if -- --season "$SEASON" --replace-season
else
  log "Skipping fielding OAA (--skip-fielding)"
fi

log "Season $SEASON ETL refresh finished OK"
