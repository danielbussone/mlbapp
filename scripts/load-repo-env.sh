# shellcheck shell=bash
# Load repo-root env for bash scripts (matches apps/api loadEnv + ETL load_repo_dotenv).
# Usage from a script after cd to repo root:
#   ROOT="$(cd "$(dirname "$0")/.." && pwd)"
#   # shellcheck source=load-repo-env.sh
#   source "$ROOT/scripts/load-repo-env.sh"
#   load_repo_env "$ROOT"

load_repo_env() {
  local root="$1"
  if [[ -f "$root/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$root/.env"
    set +a
  fi
  if [[ -n "${MLBAPP_DOTENV:-}" ]]; then
    local overlay
    if [[ "$MLBAPP_DOTENV" == /* ]]; then
      overlay="$MLBAPP_DOTENV"
    else
      overlay="$root/$MLBAPP_DOTENV"
    fi
    if [[ -f "$overlay" ]]; then
      set -a
      # shellcheck disable=SC1091
      source "$overlay"
      set +a
    fi
  fi
}
