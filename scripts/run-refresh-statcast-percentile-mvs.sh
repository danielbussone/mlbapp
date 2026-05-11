#!/usr/bin/env bash
# Run from repo root: pnpm db:refresh-percentiles
# Loads DATABASE_URL from repo .env and optional MLBAPP_DOTENV overlay (see .env.example).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=load-repo-env.sh
source "$ROOT/scripts/load-repo-env.sh"
load_repo_env "$ROOT"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  echo "Copy .env.example to .env, or export DATABASE_URL before running this script." >&2
  echo "Docker Compose maps Postgres to host port 5433, e.g.:" >&2
  echo "  export DATABASE_URL=postgresql://mlbapp:mlbapp@localhost:5433/mlbapp" >&2
  exit 1
fi
exec psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/refresh-statcast-percentile-mvs.sql"
