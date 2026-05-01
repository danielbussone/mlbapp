# mlbapp

Local-first baseball chat + Savant-style player cards (FanGraphs + Statcast). Stack: **pnpm**, **React + MUI + Vite**, **Fastify**, **Postgres (pgvector)**, **Flyway**, **Ollama** (SSE streaming from first boot).

**Project status:** Dataset analysis + schema proposal **done**; **Flyway V1–V13+** in [`db/sql/`](db/sql) (V4 `rate_stat_qualified`; V5 `fg_*_season_current` refresh; **V7–V10** FanGraphs **career** views + FG-aligned **OBP/BB%** — [docs/FG_CAREER_AGGREGATE_VIEWS.md](docs/FG_CAREER_AGGREGATE_VIEWS.md); **V11+** player-card API indexes and consolidated MVs). **ETL complete (validated):** `pnpm etl:fg` (FanGraphs, default `qual=1` + computed `rate_stat_qualified`), `pnpm etl:chadwick` (identity), `pnpm etl:hall-of-fame` (Lahman HOF → `hall_of_fame_player`), `pnpm etl:statcast` → **`statcast_pitch`** ([`etl/mlbapp_etl/statcast.py`](etl/mlbapp_etl/statcast.py)). Validation: [`docs/sql-examples.md`](docs/sql-examples.md), spec [`docs/STATCAST_REQUIREMENTS.md`](docs/STATCAST_REQUIREMENTS.md). **Player cards v1:** REST under `/players/...` + MUI — [docs/PLAYER_CARDS_REQUIREMENTS.md](docs/PLAYER_CARDS_REQUIREMENTS.md). **Chat:** `POST /api/chat` uses **Ollama tool calling** against Postgres (`DATABASE_URL` required); the host **pre-injects** `resolve_player` (and often FanGraphs `get_fg_season_line` for batting + pitching) for player-intent phrasing so answers stay grounded. Optional **`active_player_id` / `active_season`** tie the thread to the open player card. Tools: `resolve_player`, `get_fg_season_line`, `compare_players_career`, `statcast_pitcher_pitch_mix`, `statcast_batter_batted_ball`, `statcast_sample_rows`. SSE events include `tool_start` / `tool_result` (truncated preview) plus `token` / `error` / `done`. Plan + file map: [docs/CHAT_EXECUTION_PLAN.md](docs/CHAT_EXECUTION_PLAN.md); manual tests: [docs/CHAT_API_TESTING.md](docs/CHAT_API_TESTING.md). **Next:** conversation memory, RAG + optional constrained NL2SQL, structured `ui_attachment` on chat SSE (cards already load via API).

## Prerequisites

- **Node 20+** (required — the API uses **Fastify 5**, which relies on `diagnostics_channel.tracingChannel`, not available on older Node 18.x)
- pnpm 9+ (or compatible; lockfile may be generated with pnpm 7+ locally)
- Docker Desktop (or another Docker daemon) — **only** for `docker compose` services and `pnpm db:migrate`. **Not required** to run `pnpm dev` (API + Vite work on the host alone).

## Quick start (recommended dev)

1. Copy env: `cp .env.example .env` and adjust if needed.
2. **Optional — Postgres + Ollama in Docker:** start **Docker Desktop** (or your engine) first. If you see `Cannot connect to the Docker daemon`, the daemon is not running — open Docker Desktop and wait until it is “running”, then retry.

   Postgres is published on **host port 5433** (not 5432) so it does not conflict with another local Postgres. Use `DATABASE_URL=...@localhost:5433/mlbapp` in `.env` when the API runs on the host.

   ```bash
   docker compose up -d db ollama
   ```

3. **Optional — Flyway migrations** (needs the `db` container up):

   ```bash
   pnpm db:migrate
   ```

   If Flyway reports a **checksum mismatch** on an already-applied version (common after an applied migration file was edited in git), the database schema is usually still correct — update Flyway’s history to match the current files:

   ```bash
   pnpm db:repair
   pnpm db:migrate
   ```

   Use **`db:repair`** only when you intend to **reconcile metadata** with the SQL on disk; if the database is actually missing objects relative to the repo, add a **new** Flyway version (e.g. `V9__...sql`) instead of rewriting old migrations.

4. Install and run API + web on the host (hot reload):

   ```bash
   pnpm install
   pnpm dev
   ```

**Without Docker:** skip steps 2–3. **`POST /api/chat` returns HTTP 503** (SSE `error` event) if **`DATABASE_URL` is unset**, so the assistant does not answer stats without Postgres. With `DATABASE_URL` set, if **Ollama** is not reachable at `OLLAMA_HOST`, the API streams a **stub** reply so the SSE path is still verified. Use a **tool-capable** model (`OLLAMA_MODEL`, e.g. `llama3.2`); install [Ollama](https://ollama.com/download) and `ollama pull` your model.

**Monitoring Ollama / memory:** `GET http://localhost:3001/health/ollama` returns **`tagsLatencyMs`** / **`modelCount`** from **`/api/tags`**, plus **`runningModels`** from **`/api/ps`** (loaded weights **`size_gb`**, GPU **`size_vram_gb`**, **`context_length`**, **`expires_at`**). It also includes **`apiProcessMemoryMb`** for this **Node** process only (Ollama is a separate process — use host Activity Monitor or `docker stats` on the `ollama` container for daemon RSS). HTTP **503** only when **`/api/tags`** fails (Ollama down); if **`/api/ps`** fails you still get **200** with **`psError`**. Each chat round logs **`step: ollama_performance`**. Set **`CHAT_LOG_OLLAMA_PERF=off`** to turn off per-round performance logs. Set **`CHAT_LOG_PROCESS_MEMORY=on`** to log **`step: chat_process_memory`** at stream start/end (Node heap/RSS per request).

### Docker: “Cannot connect to the Docker daemon” (macOS)

That path (`~/.docker/run/docker.sock`) is created when **Docker Desktop** (or another engine) is actually running.

1. **Install / open Docker Desktop** — from Applications, or [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/). Wait until the whale icon is steady and **“Docker Desktop is running”** (not “Starting…”).
2. **Sanity check in this terminal:**

   ```bash
   docker info
   ```

   If this fails, Compose and Flyway will fail too — fix Docker first, not the repo.

3. **Wrong context (rare):** `docker context ls` — active line should be `default` pointing at **docker-desktop**. If not: `docker context use default`.

4. **Alternatives to Docker Desktop:** [Colima](https://github.com/abiosoft/colima) / Rancher Desktop — after `colima start`, run `docker info` again until it succeeds.

Until `docker info` works, **skip** `docker compose` and `pnpm db:migrate`. **`pnpm dev` still runs** the API and web, but **chat** needs **`DATABASE_URL`** (and migrations + ETL data) for grounded answers.

- Web: http://localhost:5173 (proxies `/api` → API)
- API: http://localhost:3001
- Ollama UI default: http://localhost:11434 (pull a model: `docker compose exec ollama ollama pull llama3.2`)

With **Postgres + `DATABASE_URL` + Ollama** running, **Chat** runs a tool loop: each Ollama round uses **`stream: false`** so `tool_calls` and JSON arguments are complete, then the API forwards the assistant **`content` as one `token` event** per round (tool rounds also emit **`tool_start`** / **`tool_result`** with a truncated JSON preview). Without Ollama, the API returns a short **stub** stream.

## Full stack in Docker

```bash
docker compose --profile full up --build
```

Uses `OLLAMA_HOST=http://ollama:11434` inside the API container. GPU: set `deploy.resources` / `runtime: nvidia` in `docker-compose.yml` if you use NVIDIA on Linux.

## Phase A

See [docs/DATASETS.md](docs/DATASETS.md) (inventory + sign-off), [docs/SCHEMA_PROPOSAL.md](docs/SCHEMA_PROPOSAL.md) (tables + ERD), [docs/STATCAST_REQUIREMENTS.md](docs/STATCAST_REQUIREMENTS.md) (Statcast ETL requirements + sign-off), [docs/calculations-and-viz.md](docs/calculations-and-viz.md) (derived metrics / viz), and [docs/data-sources/README.md](docs/data-sources/README.md) (ingest: **Python + pybaseball**). **Domain schema is owner-approved** — add Flyway `V2+` migrations when you implement Postgres-backed FG/Statcast.
