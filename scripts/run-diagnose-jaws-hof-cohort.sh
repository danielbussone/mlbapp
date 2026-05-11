#!/usr/bin/env bash
# Run JAWS vs HoF diagnostic SQL. Optional: dim player_id; optional: copy output to a file (tee).
#   pnpm db:diagnose-jaws-hof
#   pnpm db:diagnose-jaws-hof -- 660271
#   pnpm db:diagnose-jaws-hof -- -o jaws-hof-diagnose.txt
#   pnpm db:diagnose-jaws-hof -- -o jaws-hof-diagnose.txt 660271
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=load-repo-env.sh
source "$ROOT/scripts/load-repo-env.sh"
load_repo_env "$ROOT"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  exit 1
fi

# pnpm forwards `--` before args: `pnpm db:diagnose-jaws-hof -- 660271` → $1=-- $2=660271
OUTPUT=""
PID=""
want_output_path=false
for arg in "$@"; do
  if [[ "$want_output_path" == true ]]; then
    OUTPUT="$arg"
    want_output_path=false
    continue
  fi
  case "$arg" in
    --) ;;
    -o|--output) want_output_path=true ;;
    *)
      if [[ "$arg" =~ ^[0-9]+$ ]]; then
        PID="$arg"
      fi
      ;;
  esac
done
if [[ "$want_output_path" == true ]]; then
  echo "Missing path after -o/--output." >&2
  exit 1
fi

SQL="$ROOT/scripts/diagnose-jaws-hof-cohort.sql"
if [[ -n "$PID" ]]; then
  PSQL_CMD=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v "player_id=$PID" -f "$SQL")
else
  PSQL_CMD=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL")
fi

if [[ -n "$OUTPUT" ]]; then
  out_dir="$(dirname -- "$OUTPUT")"
  if [[ "$out_dir" != "." ]]; then
    mkdir -p "$out_dir"
  fi
  echo "Writing diagnostic output to: $OUTPUT (and stdout)" >&2
  "${PSQL_CMD[@]}" | tee "$OUTPUT"
else
  exec "${PSQL_CMD[@]}"
fi
