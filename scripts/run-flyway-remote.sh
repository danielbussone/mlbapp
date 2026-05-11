#!/usr/bin/env bash
# Run Flyway against DATABASE_URL (e.g. RDS from .env.remote). Does not use local Compose Postgres.
#
#   MLBAPP_DOTENV=.env.remote pnpm db:migrate:remote
#   MLBAPP_DOTENV=.env.remote pnpm db:repair:remote
#
# Or any overlay file: MLBAPP_DOTENV=.env.staging bash scripts/run-flyway-remote.sh migrate
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=load-repo-env.sh
source "$ROOT/scripts/load-repo-env.sh"
load_repo_env "$ROOT"
exec python3 "$ROOT/scripts/flyway_from_database_url.py" "${1:-migrate}"
