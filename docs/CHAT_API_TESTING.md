# Chat API + Ollama tools — manual testing notes

`POST /chat` on the Fastify API (`http://localhost:3001/chat` when running locally). Response is **SSE** (`text/event-stream`): `tool_start`, `tool_result`, `token`, `error`, `done`.

## Request body (beyond `message`)

- **`active_player_id`** / **`active_season`** (optional, positive integers): sent by the web UI when a player card is open. The host injects a synthetic `resolve_player` result for that `player_id` when the message does **not** name a different player (no bio/bare-name intent). Use this for follow-ups like “What was his best WAR season?” without repeating the name.
- **Grounding:** When the message **does** match player intent (e.g. “Tell me about …”, “Talk about …”, bare `First Last`, or inline “what was X in 2024”), the host runs **`resolve_player` before the first Ollama turn** so the model cannot answer with made-up FanGraphs lines before tools run. If `resolve_player` returns **multiple** `candidates`, the host does **not** auto-run `get_fg_season_line` until there is exactly one match; the model should ask the user to disambiguate.
- **Statcast host inject:** Phrases like **`Statcast pitch mix for {Name} in {YYYY}`** / **`pitch mix for {Name} in {YYYY}`** (pitcher) and **`What is {Name}'s average exit velocity in {YYYY}?`** (batter) trigger **`resolve_player`** plus **`statcast_pitcher_pitch_mix`** or **`statcast_batter_batted_ball`** before the first model turn when the name resolves to exactly one player.
- **Compare with a year:** `How do A and B differ in 2024?` passes **`season_from` / `season_to`** into **`compare_players_career`** on the server. The web compare sidebar calls **`GET /players/compare/fg-career?...&season=YYYY`** for a **single-season** FanGraphs table when a year is detected.

Example with an open card:

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Summarize his last three seasons.","active_player_id":12345,"active_season":2024}'
```

## `GET /players/named` (sidebar resolve)

- **200:** `{ "player_id": <number> }` — unique match.
- **404:** `{ "error": "…" }` — no match.
- **409:** `{ "error": "…", "candidates": [ … ] }` — ambiguous name; each candidate includes `player_id`, `name_first`, `name_last`, `birth_date`, `key_mlbam`, `externals`, plus **`career_hint`** (e.g. `14 seasons with SEA and NYY` or `22 seasons with SEA, NYY, and TEX`) derived from FanGraphs distinct season counts and up to five team abbreviations ranked by combined batting + pitching games.

## Prerequisites

- **`DATABASE_URL`** set (without it the API returns **503** + SSE `error` + `done`).
- **Flyway** applied through **V5** (so `fg_*_season_current` exposes `rate_stat_qualified` after V4).
- **ETL data** for scenarios you test: Chadwick (`dim_player` / `player_external_identifier`), FanGraphs (`fg_*_season_current`), Statcast (`statcast_pitch`) for the players and years you mention.
- **Ollama** reachable at `OLLAMA_HOST`; **`OLLAMA_MODEL`** supports tool calling.

Optional: filter events only:

```bash
curl -sN ... | grep -E '^event:'
```

## Example chat queries to try

Use these in the web UI or as the `message` field in `POST /chat`. After each send, confirm early **`tool_start` / `tool_result`** for `resolve_player` (and often `get_fg_season_line`) on player-intent prompts, and that assistant numbers match tool JSON (no invented slash lines or awards).

**Player intent + card / host pre-resolve (wording variants)**

1. `Tell me about Shohei Ohtani`
2. `Talk about Mookie Betts`
3. `Who is Mike Trout?`
4. `About Ronald Acuña Jr.` (generational suffix handling)
5. `Shohei Ohtani` (bare two-word search)
6. `What was Freddie Freeman like in 2020?` (inline year)
7. `How did Juan Soto do in 2019?`

**Role / season hints**

8. `Tell me about Jacob deGrom’s pitching in 2018`
9. `Tell me about Shohei Ohtani’s batting in 2021` (batting-only phrasing)
10. `Fangraphs batting line for Bryce Harper in 2015`

**Two-player compare**

11. `Compare Mike Trout and Ken Griffey Jr.`
12. `How do Mookie Betts and Ronald Acuña Jr. differ in 2024?` (explicit year + compare phrasing)

**Statcast-style (model or tools)**

13. `Statcast pitch mix for Gerrit Cole in 2023`
14. `What is Aaron Judge’s average exit velocity in 2024?` (batted-ball / Statcast path if model chooses it)

**Active card context** (`active_player_id` / `active_season` in JSON — web sends these automatically when a card is open)

15. Open a player card, then: `What was his best WAR season?`
16. Same, with a specific year on the card: `How did he do that year?` (should respect `active_season` when the message does not name another year)

**Ambiguity / disambiguation**

17. A name your DB returns as **multiple** `candidates` (see checklist “Ambiguous name”); expect **no** auto `get_fg_season_line` until one player is chosen, and assistant text that lists options.

**Negative / non-player (should not open the sidebar as a name search)**

18. `What is WAR?`
19. `Explain ERA and FIP`
20. `Compare launch angle and exit velocity` (no two player names — behavior depends on model; not a sidebar name open)

## Tool test checklist (quick pass)

Optional: set once, then copy the bodies only.

```bash
export CHAT='http://localhost:3001/chat'
```

For each item: run the `curl`, confirm `tool_start` / `tool_result` `name`, no `invalid_args` / `tool_execution_failed`, and payload shape. More context: **Per-tool scenarios** below.

### Automated runner + marking `[x]`

From repo root (API + Ollama up; same defaults as curls):

```bash
pnpm chat:checklist
# or: CHAT=http://localhost:5173/api/chat pnpm chat:checklist
```

- **Persisted log:** each run writes **`logs/chat-checklist-YYYYMMDD-HHMMSS.log`** under the repo (stdout + stderr, including the header with `CHAT`, timeouts, `git_head`, and the footer with `PASS`/`FAIL`). Override with **`CHAT_CHECK_LOG_FILE=/path/to/run.log`** or **`CHAT_CHECK_LOG_DIR=/path/to/dir`** (file name still auto unless `CHAT_CHECK_LOG_FILE` is set). Same terminal output as before (`tee`). `*.log` is gitignored.
- Exit **0** ⇒ every stream check passed (no `tool_execution_failed`, no `invalid_args`, saw `event: done`). Then set each matching `- [ ]` below to `- [x]` (or record a row in the validation log).
- Exit **1** ⇒ fix stack or prompts; leave boxes unchecked until green.
- **Slow Ollama / large compare:** default `curl --max-time` tiers (**420s** / **600s** / **900s**) are heuristics, not measured from your API. Each script line prints **wall seconds** for that request so you can tune `CHAT_CHECK_TIMEOUT*` from real runs. If you still see `FAIL (curl exit=28 …)`, raise those env vars and re-run.
- **503 row** is manual: start API **without** `DATABASE_URL`, `RUN_503_CHECK=1 pnpm chat:checklist`, expect HTTP **503** for that optional phase; mark that box separately.

### Checklist validation log

| Date | Who / where | Command | Outcome |
|------|----------------|---------|---------|
| 2026-04-20 | Cursor agent | `pnpm chat:checklist` | Not validated here (no reachable `CHAT` from agent env). Run locally when dev stack is up, then mark `[x]` or append a row. |
| 2026-04-20 | Local dev | `pnpm chat:checklist` (180s era) | 15 OK, 5 `FAIL (curl)` on heavy prompts (timeouts). Script defaults raised + per-test long timeouts; re-run. |

### Core tools — `resolve_player`

- [ ] **By full name**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve the player Mike Trout."}'
```

- [ ] **By `key_mlbam` (MLBAM)**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Look up player key_mlbam 545361."}'
```

- [ ] **By `id_fangraphs` (FanGraphs id)**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve the player with FanGraphs id 10155."}'
```

- [ ] **Ambiguous name (≥2 `candidates`)** — adjust the name if your DB returns 0 or 1 row.

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve the player John Smith."}'
```

- [ ] **Accented name**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Ronald Acuña."}'
```

- [ ] **Generational suffix (`Jr.`) — last name in DB usually omits suffix**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Ronald Acuña Jr."}'
```

- [ ] **ASCII spelling vs accented DB (`Acuna` → `Acuña`)**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Ronald Acuna Jr."}'
```

- [ ] **Sr/Jr disambiguation (same `name_first` / `name_last` in Chadwick, e.g. Griffey)** — `resolve` + `compare` should pick Jr when the query ends in `Jr.`

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Compare Mike Trout and Ken Griffey Jr. on FanGraphs career batting only."}'
```

### Core tools — `get_fg_season_line`

- [ ] **Batting + single `season`**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Mike Trout and show his 2024 FanGraphs batting line from the database."}'
```

- [ ] **Pitching + `season`** — needs that player/year in `fg_pitching_season_current`.

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Shohei Ohtani and show his 2024 FanGraphs pitching line."}'
```

- [ ] **`season_from` / `season_to` range**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Mike Trout and list his FanGraphs batting lines from 2018 through 2020."}'
```

- [ ] **Empty `rows` + `meta.note` (no rows for filter)**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Mike Trout and show his FanGraphs batting line for season 2099."}'
```

### Core tools — `compare_players_career`

- [ ] **Two players, career FG (large payload; may show `truncated: true`)**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Compare Mike Trout and Ronald Acuña Jr. on FanGraphs career batting and pitching."}'
```

- [ ] **Batting-focused prompt (`include_pitching` often false)**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Compare Mike Trout and Ronald Acuna Jr. on FanGraphs career batting only; omit pitching."}'
```

- [ ] **`season_from` / `season_to` sloppy (`0` / huge) still validates**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Compare Mike Trout and Ronald Acuna Jr. on FanGraphs career batting with season_from 0 and season_to 99999."}'
```

### Statcast tools

- [ ] **`statcast_pitcher_pitch_mix` (has data)**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Gerrit Cole and show his 2024 Statcast pitch mix by pitch type."}'
```

- [ ] **`statcast_pitcher_pitch_mix` (empty `rows` — year/player with no pitch data)**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Mike Trout and show his Statcast pitch mix as a pitcher in 1980."}'
```

- [ ] **`statcast_batter_batted_ball`**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Mike Trout and his 2024 Statcast batted-ball summary (exit velo and launch angle)."}'
```

- [ ] **`statcast_sample_rows` — pitcher**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Gerrit Cole and show me 20 recent Statcast pitch rows for him in 2024."}'
```

- [ ] **`statcast_sample_rows` — batter**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Mike Trout and show 15 recent Statcast pitch rows from his 2024 plate appearances."}'
```

### Cross-cutting (see [Cross-cutting checks](#cross-cutting-checks))

- [ ] **SSE order (`tool_start` → `tool_result` → `token` → `done`)**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Mike Trout."}' | grep -E '^event:'
```

- [ ] **503 without Postgres — restart API with `DATABASE_URL` unset, then same URL**

```bash
curl -sN -w "\nhttp_code:%{http_code}\n" -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Mike Trout."}'
```

- [ ] **Large `tool_result` / `truncated` flag** — use the career compare curl above; grep for truncation.

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Compare Mike Trout and Ronald Acuña Jr. on FanGraphs career batting and pitching."}' \
  | grep -E 'truncated|"name":"compare_players_career"'
```

- [ ] **Honest failure (no invented stat)**

```bash
curl -sN -X POST "${CHAT:-http://localhost:3001/chat}" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Resolve Mike Trout and tell me his career NFL passing yards from the database tools only."}'
```

---

## Curl template

```bash
curl -sN -X POST http://localhost:3001/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"<your prompt here>"}'
```

Through the Vite dev proxy (web on 5173):

```bash
curl -sN -X POST http://localhost:5173/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"<your prompt here>"}'
```

---

## Per-tool scenarios

Confirm **`tool_start`** / **`tool_result`** `name` matches the tool under test (or the expected chain order).

### 1. `resolve_player`

Resolves to `player_id`, `key_mlbam`, `externals` (e.g. `fangraphs`, `mlbam`).

| Case | Example `message` | Expect |
|------|-------------------|--------|
| By name | `{"message":"Resolve the player Mike Trout."}` | `resolve_player`; `tool_result` has `candidates` with `player_id`, `key_mlbam`, `externals`. |
| Heuristic name | `{"message":"Resolve Mike Trout and tell me his MLBAM id."}` | `resolve_player`; host may fill `name_query` from “Resolve … and” pattern. |
| By MLBAM | `{"message":"Look up player key_mlbam 545361."}` | `resolve_player` using `key_mlbam` or equivalent; matches that player. |
| Ambiguous | Use names that return 2+ candidates in your DB | `candidates.length > 1`; downstream tools should not assume a single player without disambiguation. |

### 2. `get_fg_season_line`

FanGraphs rows from `fg_batting_season_current` / `fg_pitching_season_current` (includes `rate_stat_qualified` when schema is current).

| Case | Example `message` | Expect |
|------|-------------------|--------|
| Batting + year | `{"message":"Resolve Mike Trout and show his 2024 FanGraphs batting line from the database."}` | `resolve_player` then `get_fg_season_line` (`role` batting, `season` 2024). `rows` with stats when data exists; `rate_stat_qualified` may be `false` for short seasons. |
| Pitching | `{"message":"Resolve Shohei Ohtani and show his 2024 FanGraphs pitching line."}` | `get_fg_season_line` with `role: pitching` (player must exist in DB). |
| Career slice | `{"message":"Resolve Mike Trout and list his FanGraphs batting lines from 2018 through 2020."}` | Model passes `season_from` / `season_to` (or equivalent); multiple seasons in `rows`. |
| Empty filter | Year/team combination with no row | `rows: []` and optional `meta.note`; assistant must **not** claim `resolve_player` failed if candidates were non-empty. |

**Host fallback:** If the model omits `get_fg_season_line` after a successful resolve and the user asked for FanGraphs stats, **`maybeServerDrivenFgSeasonLine`** should still emit `get_fg_season_line` once.

### 3. `compare_players_career`

Two name queries → single `player_id` each → merged FG payload.

| Case | Example `message` | Expect |
|------|-------------------|--------|
| Happy path | `{"message":"Compare Mike Trout and Ronald Acuña Jr. on FanGraphs career batting and pitching."}` | `compare_players_career`; `tool_result` includes `players`, `batting`, `pitching` keyed by `player_id`. (Ollama may send `include_*` and years as strings; the API coerces them.) |
| Jr vs Sr | `{"message":"Compare Mike Trout and Ken Griffey Jr. on FanGraphs career batting only."}` | Should resolve **Jr** (not Sr) when both share `Ken`/`Griffey` in `dim_player`; ambiguous errors list `birth_date` hints. |
| Ambiguous | Two queries that each match multiple players | `tool_result` includes `error` / disambiguation from compare path. |

### 4. `statcast_pitcher_pitch_mix`

Per `pitch_type`: pitch counts, `pct`, `avg_velo` for `pitcher_mlbam` + `game_year`.

| Case | Example `message` | Expect |
|------|-------------------|--------|
| Typical | `{"message":"Resolve Gerrit Cole and show his 2024 Statcast pitch mix by pitch type."}` | `resolve_player` then `statcast_pitcher_pitch_mix` with `pitcher_mlbam` = resolved **`key_mlbam`**. |
| No data | Player/year with no `statcast_pitch` rows | `rows: []`; assistant must not invent pitch mix numbers. |

### 5. `statcast_batter_batted_ball`

Summary: `bbe`, `avg_ev`, `avg_la` for `batter_mlbam` + `game_year`.

| Case | Example `message` | Expect |
|------|-------------------|--------|
| Typical | `{"message":"Resolve Mike Trout and his 2024 Statcast batted-ball summary (exit velo and launch angle)."}` | `resolve_player` then `statcast_batter_batted_ball` with `batter_mlbam` from **`key_mlbam`**. |

### 6. `statcast_sample_rows`

Recent pitch-level rows (`limit` ≤ 200).

| Case | Example `message` | Expect |
|------|-------------------|--------|
| As pitcher | `{"message":"Resolve Gerrit Cole and show me 20 recent Statcast pitch rows for him in 2024."}` | `statcast_sample_rows` with `role: pitcher`, `mlbam`, `game_year: 2024`, `limit` ≤ 200. |
| As batter | `{"message":"Resolve Mike Trout and show 15 recent Statcast pitch rows from his 2024 plate appearances."}` | `role: batter`, same pattern. |

---

## Cross-cutting checks

| Check | How |
|--------|-----|
| **SSE order** | `tool_start` → `tool_result` pairs; then `token`(s); finally `done`. On failure: `error` then `done`. |
| **503 without DB** | Unset `DATABASE_URL`, restart API → `POST /chat` returns **503** with SSE `error` describing missing Postgres. |
| **503 + SSE in browser** | Web client should still parse SSE when status is 503 and `Content-Type` is `text/event-stream`. |
| **Honest numerics** | Ask for a statistic that never appears in any `tool_result`; assistant should say it is not in the payload or call an appropriate tool—not invent values. |
| **`tool_result` truncation** | Large FG payloads: SSE may show `truncated: true` on `tool_result`; the **full** JSON is still sent to Ollama in the `tool` message body. |
| **`tool_calls` replay** | Multi-turn tool loops should not produce Ollama **400** JSON errors on `function.arguments` (arguments must replay as **objects**). |

---

## Related docs

- Execution plan (architecture, deviations, file map): [CHAT_EXECUTION_PLAN.md](./CHAT_EXECUTION_PLAN.md)
- SQL patterns: [sql-examples.md](./sql-examples.md)
- FG qualification / `rate_stat_qualified`: [DATASETS.md](./DATASETS.md), [SCHEMA_PROPOSAL.md](./SCHEMA_PROPOSAL.md)
- Project runbook: [README.md](../README.md)
