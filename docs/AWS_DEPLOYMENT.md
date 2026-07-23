# AWS Deployment

How to run mlbapp on AWS: a Fastify API, a static React SPA, an Aurora PostgreSQL
warehouse, and a weekly ETL job that keeps the data fresh.

Status legend: ✅ built & verified in this repo · 🔧 you provision on AWS.

---

## Architecture

```
                        ┌──────────────────────────────┐
   users ──────────────▶│  CloudFront                  │
                        │   /*      → S3 (web SPA)      │  ✅ apps/web image (or S3 static)
                        │   /api/*  → ALB → API (strip  │
                        └──────────┬───────────────────┘   the /api prefix)
                                   │
                                   ▼
                        ┌──────────────────────────────┐
                        │  ECS Fargate: API (Fastify)   │  ✅ apps/api image
                        │  GET /health for ALB checks   │
                        └──────────┬───────────────────┘
                                   │  (VPC, SG :5432, TLS)
                                   ▼
                        ┌──────────────────────────────┐
   EventBridge (weekly) │  Aurora PostgreSQL 16         │
        │               │  extensions: vector, unaccent │
        └── Fargate RunTask ─────▶ (same VPC)            │
            ETL container  ✅     └──────────────────────┘
            (writes + Savant/FG egress via NAT)
```

Chat runs on **OpenAI or Amazon Bedrock** (provider-neutral) — no Ollama/GPU needed in prod.

---

## 0. Prerequisites

- An **Aurora PostgreSQL 16** cluster (you have this). The master user needs `rds_superuser`
  so migrations can `CREATE EXTENSION`.
- An **ECR** repository per image (`mlbapp-api`, `mlbapp-web`, `mlbapp-etl`).
- A VPC where the API/ETL tasks can reach Aurora (SG ingress on 5432) and the ETL task can
  reach the internet (NAT) for FanGraphs/Baseball Savant.
- Secrets in **Secrets Manager / SSM** (see [§4](#4-runtime-configuration)).

---

## 1. Build & push images  ✅

All three Dockerfiles use the **repo root** as build context. Build context normalization is
handled by [`.gitattributes`](../.gitattributes) (forces LF for `*.sh`/`Dockerfile`) so Windows
CRLF checkouts don't break scripts inside the Linux images.

```bash
ACCOUNT=<id>; REGION=us-east-1; REPO=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REPO

docker build -f apps/api/Dockerfile -t $REPO/mlbapp-api:latest .
docker build -f apps/web/Dockerfile -t $REPO/mlbapp-web:latest .   # or build web static + upload to S3
docker build -f etl/Dockerfile      -t $REPO/mlbapp-etl:latest .

docker push $REPO/mlbapp-api:latest
docker push $REPO/mlbapp-web:latest
docker push $REPO/mlbapp-etl:latest
```

Image facts (measured):

| Image | Base | Size | Notes |
|---|---|---|---|
| `mlbapp-api` | node:20-slim | ~336 MB | multi-stage `pnpm deploy`; non-root; `HEALTHCHECK /health` |
| `mlbapp-web` | nginx:1.27-alpine | ~75 MB | SPA + `/api` reverse proxy (SSE-tuned) |
| `mlbapp-etl` | python:3.13-slim | ~1.1 GB | pandas/pybaseball; non-root; `psql` client |

The **web** image serves the SPA and reverse-proxies `/api` for a co-located deploy. For the
recommended split deploy, skip it and upload `apps/web/dist` (from `pnpm --filter @mlbapp/web build`)
to S3 behind CloudFront instead.

---

## 2. Database: migrations  🔧

38 Flyway migrations live in [`db/sql`](../db/sql). `V1` creates the **`vector`** extension
(pgvector; used by `rag_document_chunk.embedding vector(1536)` + an ivfflat index) and `V6`
creates **`unaccent`** (accent-insensitive player search). Confirm your Aurora version ships
pgvector before you start.

Run migrations against Aurora with the existing remote-Flyway path (put the Aurora DSN, with
`sslmode=require`, in a `.env.remote`):

```bash
# .env.remote:  DATABASE_URL=postgresql://USER:PASS@<aurora-endpoint>:5432/mlbapp?sslmode=require
MLBAPP_DOTENV=.env.remote pnpm db:migrate:remote
```

This drives [`scripts/run-flyway-remote.sh`](../scripts/run-flyway-remote.sh), which reads
`DATABASE_URL` and invokes Flyway. Re-run after any deploy that adds migrations. Use
`db:repair:remote` if a checksum mismatch occurs.

---

## 3. Database: load data  🔧

A migrated-but-empty warehouse serves nothing. Run the ETL against Aurora once to backfill,
then let the [weekly job](#6-weekly-etl-schedule) keep it current.

Run the ETL container (or `pnpm etl:season-refresh -- <year>` locally) pointed at Aurora:

```bash
# First backfill — a specific season, or historical ranges (Statcast is large/slow):
docker run --rm -e DATABASE_URL="postgresql://…?sslmode=require" \
  $REPO/mlbapp-etl:latest 2026
```

The refresh sequence is: FanGraphs (season) → Statcast (league) → **refresh Statcast
percentile MVs** → sprint → OAA. The FanGraphs step also refreshes the FG consolidated + JAWS
materialized views.

> **Timing (measured on ~5.3M Statcast rows):** the percentile MV refresh alone takes **~8 min**;
> a full weekly `--incremental` run is **~15 min**. Size any task timeout at **≥30 min**.

For big historical Statcast loads, prefer a one-off ECS/Batch task, not the request path.

---

## 4. Runtime configuration

Inject via env from Secrets Manager / SSM. See [`.env.example`](../.env.example) for the full list.

**API** (`mlbapp-api`):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Aurora DSN |
| `DATABASE_SSL` | `require` (encrypt) or `verify-full` (verify against RDS CA) — **required for Aurora** |
| `DATABASE_SSL_CA` | RDS CA bundle (path or PEM) — only for `verify-full` ([global-bundle.pem](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem)) |
| `PORT` | default 3001 |
| `CHAT_PROVIDER` | `openai` \| `bedrock` \| `ollama` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` | OpenAI or an OpenAI-compatible gateway |
| `AWS_BEARER_TOKEN_BEDROCK` / `AWS_REGION` / `BEDROCK_MODEL` | Bedrock (OpenAI-compatible endpoint) |

**ETL** (`mlbapp-etl`): `DATABASE_URL` (with `?sslmode=require`). Optional tuning:
`MLBAPP_STATCAST_CHUNK_DAYS` (default 7 in the image), `MLBAPP_STATCAST_INCREMENTAL_OVERLAP_DAYS`
(default 3), `MLBAPP_FG_THROTTLE_SECONDS`.

> **DB TLS is not optional on Aurora.** node-postgres won't infer TLS from the URL, so the API
> pool reads `DATABASE_SSL` explicitly ([`apps/api/src/db/pool.ts`](../apps/api/src/db/pool.ts)).
> The Python ETL honors `sslmode=require` in the DSN.

---

## 5. Deploy compute  🔧

**API** → ECS Fargate service behind an ALB (target group health check: `GET /health`, which
needs no DB). App Runner is a lower-ops alternative — use a **VPC connector** so it can reach
Aurora in private subnets.

**Web** → upload `apps/web/dist` to **S3 + CloudFront** (it's a static SPA).

**Routing the `/api` prefix (gotcha):** the SPA calls `/api/chat`, `/api/players/…`, but the API
serves those at **root** (`/chat`, `/players/…`). The nginx image strips `/api` via
`proxy_pass http://api:3001/`. In a CloudFront/ALB split deploy you must reproduce that: route
`/api/*` to the API origin **and strip the `/api` prefix** (CloudFront Function or ALB rule).
`/chat` streams via SSE — disable response buffering on that path.

---

## 6. Weekly ETL schedule  🔧

**EventBridge Scheduler → ECS Fargate `RunTask`**, weekly.

- Task definition: `mlbapp-etl:latest`, `DATABASE_URL` (+`sslmode=require`) from Secrets Manager,
  task role, in a subnet with a NAT (outbound to FanGraphs/Savant).
- The image's default command is the cheap incremental path:

  ```
  ENTRYPOINT ["bash", "scripts/run-season-etl-refresh.sh"]
  CMD ["--incremental"]
  ```

  Statcast pulls only from the last loaded `game_date` (minus a 3-day overlap) forward — see
  [`etl/mlbapp_etl/statcast.py`](../etl/mlbapp_etl/statcast.py) `--incremental`. FanGraphs/sprint/OAA
  repull the current season (idempotent).
- Set the task **stopTimeout / schedule flexible window ≥ 30 min** (percentile MV refresh is ~8 min).
- The orchestrator is pnpm/node-free in the container (`MLBAPP_ETL_PYTHON`, default `python`), so
  the same [`scripts/run-season-etl-refresh.sh`](../scripts/run-season-etl-refresh.sh) runs locally and in the image.

Cadence: weekly is fine; in-season, 2–3×/week keeps the site fresher (each run is cheap).

---

## 7. Chat provider auth

`CHAT_PROVIDER=openai` with `OPENAI_BASE_URL` pointed at a Bedrock OpenAI-compatible gateway works
today, but **beware token expiry**: Bedrock/SigV4 credentials are time-limited. An expired token
surfaces as a clear message (see [`openai.ts`](../apps/api/src/services/chat/providers/openai.ts)):

> `openai auth failed (401): the API key/token is expired — refresh OPENAI_API_KEY and restart the API.`

Options, most durable first:

1. **Native Bedrock via IAM role** — the Fargate task role signs requests (SigV4), auto-rotating,
   nothing to refresh. Requires a native `BedrockProvider` (AWS SDK); the OpenAI SDK only sends a
   static bearer. *(Not yet built — recommended for a hands-off deploy.)*
2. **Long-lived Bedrock API key** in Secrets Manager, rotated before expiry — works with the current
   OpenAI adapter unchanged.
3. Short-lived token + a refresh job — fragile; last resort.

> After changing the token in a local `.env`, **restart** the API — `tsx watch` may not re-read `.env`.

---

## 8. Verification

```bash
# API up + DB path
curl -fsS https://<domain>/api/health          # {"ok":true,...}

# Grounded chat round (exercises the full tool loop against Aurora)
curl -N https://<domain>/api/chat -H 'content-type: application/json' \
  --data-binary '{"message":"Mike Trout 2019 FanGraphs batting line"}'
# expect: tool_start/tool_result (resolve_player, get_fg_season_line) then a grounded token stream

# Data freshness (psql to Aurora)
psql "$DATABASE_URL" -c "select max(game_date) from statcast_pitch;
                         select source, max(pulled_at) from ingest_snapshot group by source;"
```

---

## Gotchas learned

- **CRLF breaks container scripts.** A Windows checkout gives `*.sh` CRLF endings; Docker copies
  them and bash fails with `set: pipefail: invalid option name`. Fixed by `.gitattributes` (LF) +
  a defensive `sed` in `etl/Dockerfile`. Building on Linux CI avoids it entirely.
- **Aurora needs explicit TLS** — set `DATABASE_SSL` (API) and `?sslmode=require` (ETL/Flyway).
  A missing-TLS connection fails as an empty-message `AggregateError` (ECONNREFUSED-style).
- **Percentile MV refresh is ~8 min** — don't put a short timeout on the ETL task.
- **The `/api` prefix must be stripped** before requests reach the API (it serves at root).
- **Bedrock tokens expire** — plan rotation or move to IAM-role auth (§7).
