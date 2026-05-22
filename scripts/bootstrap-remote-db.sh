#!/usr/bin/env bash
# Bootstrap a fresh remote database: run Flyway migrations then load all ETL
# sources from scratch. Intended for a one-time initial load of an empty RDS
# (or any remote Postgres) pointed to by .env.remote (or MLBAPP_DOTENV).
#
# Resumable: completed steps are written to a state file (.bootstrap-remote.state
# in the repo root). Re-running the script skips anything already marked done,
# so you can safely interrupt and pick up where you left off.
# Delete the state file (or individual lines) to re-run specific steps.
#
# Usage (repo root):
#   pnpm db:bootstrap-remote
#   MLBAPP_DOTENV=.env.remote bash scripts/bootstrap-remote-db.sh
#   bash scripts/bootstrap-remote-db.sh --start-season 2020
#   bash scripts/bootstrap-remote-db.sh --reset          # clear state and start over
#   bash scripts/bootstrap-remote-db.sh --show-state     # print completed steps and exit
#
# Order of operations:
#   1. Flyway migrations (creates schema)
#   2. Chadwick register (full player identity map; required by all facts)
#   3. Hall of Fame
#   4. FanGraphs batting + pitching (--fg-start-season through --end-season in one call)
#   5. Statcast league (per season; --start-season through --end-season)
#   6. Refresh Statcast percentile materialized views
#   7. Sprint / running leaderboards (per season)
#   8. Savant directional OAA — outfield + infield (per season)
#
# Key flags:
#   --start-season YEAR     First season for Statcast / Sprint / OAA (default 2015)
#   --fg-start-season YEAR  First season for FanGraphs (default 2002)
#   --end-season YEAR       Last season for all ETLs (default current year)
#   --state-file PATH       State file path (default .bootstrap-remote.state)
#   --reset                 Delete the state file and start over
#   --show-state            Print completed steps and exit
#   --skip-migrate          Skip Flyway
#   --skip-chadwick         Skip Chadwick register
#   --skip-hof              Skip Hall of Fame
#   --skip-fg               Skip FanGraphs
#   --skip-statcast         Skip Statcast pitch data
#   --skip-percentiles      Skip percentile MV refresh
#   --skip-sprint           Skip sprint / running splits
#   --skip-fielding         Skip directional OAA
#
# Prerequisites: pnpm etl:install, .env.remote with DATABASE_URL, Docker (for Flyway),
#   network access to FanGraphs / Savant / GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=load-repo-env.sh
source "$ROOT/scripts/load-repo-env.sh"

# Default MLBAPP_DOTENV to .env.remote so callers can omit the prefix.
if [[ -z "${MLBAPP_DOTENV:-}" ]]; then
  if [[ -f "$ROOT/.env.remote" ]]; then
    export MLBAPP_DOTENV=.env.remote
    echo "[bootstrap] No MLBAPP_DOTENV set — defaulting to .env.remote"
  else
    echo "[bootstrap] WARNING: MLBAPP_DOTENV is not set and .env.remote does not exist." >&2
    echo "            Create .env.remote from .env.remote.example and set DATABASE_URL." >&2
    exit 1
  fi
fi

load_repo_env "$ROOT"

SKIP_MIGRATE=0
SKIP_CHADWICK=0
SKIP_HOF=0
SKIP_FG=0
SKIP_STATCAST=0
SKIP_PERCENTILES=0
SKIP_SPRINT=0
SKIP_FIELDING=0
DO_RESET=0
SHOW_STATE=0

START_SEASON="2015"
FG_START_SEASON="2002"
END_SEASON="$(date +%Y)"
STATE_FILE="$ROOT/.bootstrap-remote.state"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-migrate)     SKIP_MIGRATE=1; shift ;;
    --skip-chadwick)    SKIP_CHADWICK=1; shift ;;
    --skip-hof)         SKIP_HOF=1; shift ;;
    --skip-fg)          SKIP_FG=1; shift ;;
    --skip-statcast)    SKIP_STATCAST=1; shift ;;
    --skip-percentiles) SKIP_PERCENTILES=1; shift ;;
    --skip-sprint)      SKIP_SPRINT=1; shift ;;
    --skip-fielding)    SKIP_FIELDING=1; shift ;;
    --reset)            DO_RESET=1; shift ;;
    --show-state)       SHOW_STATE=1; shift ;;
    --start-season)     START_SEASON="$2"; shift 2 ;;
    --fg-start-season)  FG_START_SEASON="$2"; shift 2 ;;
    --end-season)       END_SEASON="$2"; shift 2 ;;
    --state-file)       STATE_FILE="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,50p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (use --help)" >&2
      exit 1
      ;;
  esac
done

# ── State file helpers ────────────────────────────────────────────────────────

step_done() {
  grep -qxF "$1" "$STATE_FILE" 2>/dev/null
}

mark_done() {
  echo "$1" >> "$STATE_FILE"
}

if [[ "$DO_RESET" -eq 1 ]]; then
  rm -f "$STATE_FILE"
  echo "[bootstrap] State file cleared — will run all steps from scratch."
fi

if [[ "$SHOW_STATE" -eq 1 ]]; then
  if [[ -f "$STATE_FILE" ]]; then
    echo "[bootstrap] Completed steps in $STATE_FILE:"
    cat "$STATE_FILE"
  else
    echo "[bootstrap] No state file found ($STATE_FILE) — nothing completed yet."
  fi
  exit 0
fi

# ── Pre-flight checks ─────────────────────────────────────────────────────────

for var in START_SEASON FG_START_SEASON END_SEASON; do
  val="${!var}"
  if [[ ! "$val" =~ ^[0-9]{4}$ ]]; then
    echo "--${var//_/-} must be a four-digit year, got: $val" >&2
    exit 1
  fi
done

if [[ "$START_SEASON" -gt "$END_SEASON" ]]; then
  echo "--start-season ($START_SEASON) must be <= --end-season ($END_SEASON)" >&2
  exit 1
fi

if ! python -c "import mlbapp_etl" 2>/dev/null; then
  echo "mlbapp_etl not importable. Run: pnpm etl:install" >&2
  exit 1
fi

log() {
  printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

log "Bootstrap starting — target: ${MLBAPP_DOTENV} | seasons ${START_SEASON}–${END_SEASON} | FG from ${FG_START_SEASON}"
[[ -f "$STATE_FILE" ]] && echo "[bootstrap] Resuming from state file: $STATE_FILE"

# ── 1. Flyway ─────────────────────────────────────────────────────────────────
if step_done "migrate"; then
  log "Flyway: already done — skipping"
elif [[ "$SKIP_MIGRATE" -eq 1 ]]; then
  log "Skipping Flyway migrations (--skip-migrate)"
else
  log "Flyway: running migrations against remote DB"
  MLBAPP_DOTENV="$MLBAPP_DOTENV" bash "$ROOT/scripts/run-flyway-remote.sh" migrate
  mark_done "migrate"
fi

# ── 2. Chadwick register (full — not incremental) ─────────────────────────────
if step_done "chadwick"; then
  log "Chadwick: already done — skipping"
elif [[ "$SKIP_CHADWICK" -eq 1 ]]; then
  log "Skipping Chadwick (--skip-chadwick)"
else
  log "Chadwick: full player register (required by all fact tables)"
  MLBAPP_DOTENV="$MLBAPP_DOTENV" pnpm etl:chadwick -- --incremental
  mark_done "chadwick"
fi

# ── 3. Hall of Fame ───────────────────────────────────────────────────────────
if step_done "hof"; then
  log "Hall of Fame: already done — skipping"
elif [[ "$SKIP_HOF" -eq 1 ]]; then
  log "Skipping Hall of Fame (--skip-hof)"
else
  log "Hall of Fame"
  MLBAPP_DOTENV="$MLBAPP_DOTENV" pnpm etl:hall-of-fame
  mark_done "hof"
fi

# ── 4. FanGraphs (full range in one call) ─────────────────────────────────────
if step_done "fg"; then
  log "FanGraphs: already done — skipping"
elif [[ "$SKIP_FG" -eq 1 ]]; then
  log "Skipping FanGraphs (--skip-fg)"
else
  log "FanGraphs batting + pitching ($FG_START_SEASON–$END_SEASON)"
  MLBAPP_DOTENV="$MLBAPP_DOTENV" pnpm etl:fg -- \
    --start-season "$FG_START_SEASON" \
    --end-season   "$END_SEASON" \
    --link-players \
    --skip-consolidated-mview-refresh
  mark_done "fg"
fi

# ── 5. FanGraphs consolidated + JAWS materialized views ──────────────────────
if step_done "fg_mviews"; then
  log "FanGraphs MVs: already done — skipping"
elif [[ "$SKIP_FG" -eq 1 ]]; then
  log "Skipping FanGraphs MVs (--skip-fg)"
else
  log "Refresh FanGraphs consolidated + JAWS materialized views"
  MLBAPP_DOTENV="$MLBAPP_DOTENV" pnpm etl:fg -- --refresh-mviews-only
  mark_done "fg_mviews"
fi

# ── 7. Statcast (per season — data volume is large) ───────────────────────────
if [[ "$SKIP_STATCAST" -eq 1 ]]; then
  log "Skipping Statcast (--skip-statcast)"
else
  for season in $(seq "$START_SEASON" "$END_SEASON"); do
    if step_done "statcast:$season"; then
      log "Statcast $season: already done — skipping"
      continue
    fi
    log "Statcast league window — season $season"
    MLBAPP_DOTENV="$MLBAPP_DOTENV" pnpm etl:statcast -- \
      --mode league \
      --season "$season" \
      --link-players
    mark_done "statcast:$season"
  done
fi

# ── 8. Percentile MVs (after all pitch data is loaded) ────────────────────────
if step_done "percentiles"; then
  log "Percentile MVs: already done — skipping"
elif [[ "$SKIP_PERCENTILES" -eq 1 ]]; then
  log "Skipping percentile MV refresh (--skip-percentiles)"
else
  log "Refresh Statcast percentile materialized views"
  MLBAPP_DOTENV="$MLBAPP_DOTENV" bash "$ROOT/scripts/run-refresh-statcast-percentile-mvs.sh"
  mark_done "percentiles"
fi

# ── 9. Sprint / running splits (per season) ───────────────────────────────────
if [[ "$SKIP_SPRINT" -eq 1 ]]; then
  log "Skipping sprint ETL (--skip-sprint)"
else
  for season in $(seq "$START_SEASON" "$END_SEASON"); do
    if step_done "sprint:$season"; then
      log "Sprint $season: already done — skipping"
      continue
    fi
    log "Sprint / running leaderboards — season $season"
    MLBAPP_DOTENV="$MLBAPP_DOTENV" pnpm etl:sprint -- --season "$season"
    mark_done "sprint:$season"
  done
fi

# ── 10. Directional OAA (per season) ──────────────────────────────────────────
if [[ "$SKIP_FIELDING" -eq 1 ]]; then
  log "Skipping fielding OAA (--skip-fielding)"
else
  for season in $(seq "$START_SEASON" "$END_SEASON"); do
    if step_done "fielding:$season"; then
      log "Fielding OAA $season: already done — skipping"
      continue
    fi
    log "Savant directional OAA — outfield, season $season"
    MLBAPP_DOTENV="$MLBAPP_DOTENV" pnpm etl:fielding-oaa -- \
      --season "$season" \
      --replace-season
    log "Savant directional OAA — infield, season $season"
    MLBAPP_DOTENV="$MLBAPP_DOTENV" pnpm etl:fielding-oaa-if -- \
      --season "$season" \
      --replace-season
    mark_done "fielding:$season"
  done
fi

log "Bootstrap finished OK — DB is ready."
