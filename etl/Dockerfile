# syntax=docker/dockerfile:1
# Build context is the repo root (see the weekly ETL task definition).
#
# Runs the warehouse refresh (scripts/run-season-etl-refresh.sh) against Aurora/RDS on a
# schedule. Default command is the cheap weekly path: FanGraphs current season + targeted
# incremental Statcast + materialized-view refreshes. DATABASE_URL (with sslmode=require)
# is injected at runtime; no pnpm/node needed — the script drives python directly.
FROM python:3.13-slim

# psql: the percentile MV refresh runs SQL via psql. ca-certificates: TLS to Aurora + Savant/FG.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Non-root with a writable HOME (pybaseball caches under HOME).
RUN useradd --create-home --shell /bin/bash etl
WORKDIR /app

# Install the ETL package + deps (pandas, psycopg[binary], pybaseball) from wheels.
COPY etl/ ./etl/
RUN pip install --no-cache-dir ./etl

# Orchestration: season refresh + percentile MV refresh + env loader + SQL.
COPY scripts/ ./scripts/
# Defensive: strip CR if the build context was checked out with CRLF (Windows autocrlf),
# so bash doesn't choke on '\r'. .gitattributes normally keeps these LF already.
RUN sed -i 's/\r$//' scripts/*.sh

ENV MLBAPP_ETL_PYTHON=python \
    PYTHONUNBUFFERED=1 \
    # Statcast weekly chunk size — larger = fewer Savant requests per run.
    MLBAPP_STATCAST_CHUNK_DAYS=7

USER etl

# Default: weekly incremental refresh. Override args at run time, e.g.
#   docker run --rm -e DATABASE_URL=... mlbapp-etl --incremental --skip-fielding
#   docker run --rm -e DATABASE_URL=... mlbapp-etl 2026   (full season backfill)
ENTRYPOINT ["bash", "scripts/run-season-etl-refresh.sh"]
CMD ["--incremental"]
