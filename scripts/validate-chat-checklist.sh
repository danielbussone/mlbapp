#!/usr/bin/env bash
# Run from repo root with API + Ollama up: CHAT=http://localhost:3001/chat (default).
# Uses curl SSE; fails on tool_execution_failed, invalid_args, missing event:done, or curl errors.
#
# Default caps are heuristics (tuned after local timeouts at 180s), not from server metrics.
# Each line prints wall seconds for that curl so you can set CHAT_CHECK_TIMEOUT* from data.
# Timeouts (seconds): CHAT_CHECK_TIMEOUT (default per simple prompt, 420),
#   CHAT_CHECK_TIMEOUT_MEDIUM (600) for resolve+get_fg / pitch mix,
#   CHAT_CHECK_TIMEOUT_LONG (900) for compare_players_career (huge tool_result + tokens).
#
# Logs: full run is tee’d to CHAT_CHECK_LOG_FILE (default under repo logs/). Root .gitignore has *.log.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHAT="${CHAT:-http://localhost:3001/chat}"
TIMEOUT_DEFAULT="${CHAT_CHECK_TIMEOUT:-420}"
TIMEOUT_LONG="${CHAT_CHECK_TIMEOUT_LONG:-900}"
TIMEOUT_MEDIUM="${CHAT_CHECK_TIMEOUT_MEDIUM:-600}"

if ! command -v curl >/dev/null; then
  echo "error: curl required" >&2
  exit 2
fi
if ! command -v python3 >/dev/null; then
  echo "error: python3 required (to JSON-encode prompts)" >&2
  exit 2
fi

LOG_DIR="${CHAT_CHECK_LOG_DIR:-$ROOT/logs}"
LOG_FILE="${CHAT_CHECK_LOG_FILE:-$LOG_DIR/chat-checklist-$(date +%Y%m%d-%H%M%S).log}"
mkdir -p "$(dirname "$LOG_FILE")"

json_body() {
  python3 -c 'import json,sys; print(json.dumps({"message": sys.argv[1]}))' "$1"
}

run_one() {
  local id="$1"
  local message="$2"
  local max="${3:-$TIMEOUT_DEFAULT}"
  printf '%-52s' "$id"
  local body
  body=$(json_body "$message")
  local out ec t0 t1 elapsed
  t0=$(date +%s)
  set +e
  out=$(curl -sS --connect-timeout 5 --max-time "$max" -N -X POST "$CHAT" \
    -H 'Content-Type: application/json' \
    -d "$body" 2>&1)
  ec=$?
  set -e
  t1=$(date +%s)
  elapsed=$((t1 - t0))
  if [[ "$ec" -ne 0 ]]; then
    echo " FAIL (curl exit=$ec, ${elapsed}s wall, max_time=${max}s — often 28=timeout; raise CHAT_CHECK_TIMEOUT*)"
    return 1
  fi
  if echo "$out" | grep -q 'tool_execution_failed'; then
    echo " FAIL (tool_execution_failed in stream, ${elapsed}s wall)"
    return 1
  fi
  if echo "$out" | grep -qF '"error":"invalid_args"'; then
    echo " FAIL (invalid_args in tool_result, ${elapsed}s wall)"
    return 1
  fi
  if echo "$out" | grep -q '^event: error'; then
    echo " FAIL (SSE error event, ${elapsed}s wall)"
    return 1
  fi
  if ! echo "$out" | grep -q '^event: done'; then
    echo " FAIL (missing event: done — timeout or hung stream?, ${elapsed}s wall)"
    return 1
  fi
  echo " OK (${elapsed}s wall, max=${max}s)"
  return 0
}

main() {
  echo "================================================================================"
  echo "chat checklist log"
  echo "================================================================================"
  echo "log_file:     $LOG_FILE"
  echo "started_utc:  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "host:         $(hostname 2>/dev/null || true)"
  echo "repo_root:    $ROOT"
  echo "CHAT:         $CHAT"
  echo "timeouts_s:   default=$TIMEOUT_DEFAULT medium=$TIMEOUT_MEDIUM long=$TIMEOUT_LONG"
  if command -v git >/dev/null && [[ -d "$ROOT/.git" ]]; then
    echo "git_head:     $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)$(git -C "$ROOT" diff --quiet 2>/dev/null || echo '-dirty')"
  fi
  echo "================================================================================"
  echo ""

  local failures=0

run_one "resolve_player name" "Resolve the player Mike Trout." || failures=$((failures + 1))
run_one "resolve_player mlbam" "Look up player key_mlbam 545361." || failures=$((failures + 1))
run_one "resolve_player id_fg" "Resolve the player with FanGraphs id 10155." || failures=$((failures + 1))
run_one "resolve_player ambiguous" "Resolve the player John Smith." || failures=$((failures + 1))
run_one "resolve_player accent" "Resolve Ronald Acuña." || failures=$((failures + 1))
run_one "resolve_player Jr" "Resolve Ronald Acuña Jr." || failures=$((failures + 1))
run_one "resolve_player ASCII" "Resolve Ronald Acuna Jr." || failures=$((failures + 1))
run_one "resolve_player Griffey Jr disambig" "Resolve Ken Griffey Jr." || failures=$((failures + 1))

run_one "get_fg batting year" "Resolve Mike Trout and show his 2024 FanGraphs batting line from the database." "$TIMEOUT_MEDIUM" || failures=$((failures + 1))
run_one "get_fg pitching" "Resolve Shohei Ohtani and show his 2024 FanGraphs pitching line." || failures=$((failures + 1))
run_one "get_fg range" "Resolve Mike Trout and list his FanGraphs batting lines from 2018 through 2020." || failures=$((failures + 1))
run_one "get_fg empty year" "Resolve Mike Trout and show his FanGraphs batting line for season 2099." || failures=$((failures + 1))

run_one "compare career" "Compare Mike Trout and Ronald Acuña Jr. on FanGraphs career batting and pitching." "$TIMEOUT_LONG" || failures=$((failures + 1))
run_one "compare batting only" "Compare Mike Trout and Ronald Acuna Jr. on FanGraphs career batting only; omit pitching." "$TIMEOUT_LONG" || failures=$((failures + 1))
run_one "compare sloppy seasons" "Compare Mike Trout and Ronald Acuna Jr. on FanGraphs career batting with season_from 0 and season_to 99999." "$TIMEOUT_LONG" || failures=$((failures + 1))
run_one "compare Trout Griffey Jr" "Compare Mike Trout and Ken Griffey Jr. on FanGraphs career batting only." "$TIMEOUT_LONG" || failures=$((failures + 1))

run_one "statcast pitch mix" "Resolve Gerrit Cole and show his 2024 Statcast pitch mix by pitch type." "$TIMEOUT_MEDIUM" || failures=$((failures + 1))
run_one "statcast pitch mix empty" "Resolve Mike Trout and show his Statcast pitch mix as a pitcher in 1980." || failures=$((failures + 1))
run_one "statcast batted ball" "Resolve Mike Trout and his 2024 Statcast batted-ball summary (exit velo and launch angle)." || failures=$((failures + 1))
run_one "statcast sample pitcher" "Resolve Gerrit Cole and show me 20 recent Statcast pitch rows for him in 2024." || failures=$((failures + 1))
run_one "statcast sample batter" "Resolve Mike Trout and show 15 recent Statcast pitch rows from his 2024 plate appearances." || failures=$((failures + 1))

run_one "SSE resolve" "Resolve Mike Trout." || failures=$((failures + 1))

run_one "honest failure prompt" "Resolve Mike Trout and tell me his career NFL passing yards from the database tools only." || failures=$((failures + 1))

echo ""
echo "---- Optional: large payload / truncated (grep only; same curl as compare career) ----"
body=$(json_body "Compare Mike Trout and Ronald Acuña Jr. on FanGraphs career batting and pitching.")
t0=$(date +%s)
set +e
out=$(curl -sS --connect-timeout 5 --max-time "$TIMEOUT_LONG" -N -X POST "$CHAT" -H 'Content-Type: application/json' -d "$body" 2>&1)
ec=$?
set -e
t1=$(date +%s)
tel=$((t1 - t0))
if [[ "$ec" -ne 0 ]]; then
  echo "compare (truncated check): FAIL (curl exit=$ec, ${tel}s wall, max=${TIMEOUT_LONG}s)"
  failures=$((failures + 1))
elif echo "$out" | grep -q 'tool_execution_failed'; then
  echo "compare (truncated check): FAIL (tool_execution_failed, ${tel}s wall)"
  failures=$((failures + 1))
else
  if echo "$out" | grep -q 'truncated'; then
    echo "compare (truncated check): OK (truncated in stream, ${tel}s wall)"
  else
    echo "compare (truncated check): OK (no truncated flag; ${tel}s wall)"
  fi
fi

echo ""
if [[ "${RUN_503_CHECK:-0}" == "1" ]]; then
  echo "RUN_503_CHECK=1: expecting HTTP 503 from $CHAT"
  code=$(curl -sS --connect-timeout 5 -o /tmp/chat-503-body.txt -w '%{http_code}' --max-time 30 -X POST "$CHAT" \
    -H 'Content-Type: application/json' \
    -d "$(json_body "Resolve Mike Trout.")" || true)
  echo "http_code=$code"
  if [[ "$code" == "503" ]]; then
    echo "503 check: OK"
  else
    echo "503 check: FAIL (expected 503)"
    failures=$((failures + 1))
  fi
else
  echo "503 check: SKIP (start API without DATABASE_URL, set RUN_503_CHECK=1, same CHAT)"
fi

echo ""
echo "================================================================================"
  if [[ "$failures" -eq 0 ]]; then
    echo "result: PASS (0 failures)"
  else
    echo "result: FAIL ($failures failure(s))"
  fi
  echo "finished_utc: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "log_file:     $LOG_FILE"
  echo "================================================================================"

  if [[ "$failures" -eq 0 ]]; then
    return 0
  fi
  return 1
}

set -o pipefail
main 2>&1 | tee -a "$LOG_FILE"
exit "${PIPESTATUS[0]}"
