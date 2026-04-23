# Stats data sources (mlbapp)

**Stakeholder lock-in:** production ingest is **Python + `pybaseball`** (recorded in [DATASETS.md](../DATASETS.md)).

Operational detail for **how** FanGraphs, Statcast, and ID data reach Postgres (see [DATASETS.md](../DATASETS.md) for *what* and *why*, [SCHEMA_PROPOSAL.md](../SCHEMA_PROPOSAL.md) for tables, [STATCAST_REQUIREMENTS.md](../STATCAST_REQUIREMENTS.md) for Statcast ETL sign-off requirements).

| Doc | Use when |
|-----|----------|
| [pybaseball.md](./pybaseball.md) | Ingest is written in **Python** (pandas). |
| [baseballr.md](./baseballr.md) | Ingest is written in **R** (tibble / data.frame). |
| [http-and-official-apis.md](./http-and-official-apis.md) | You call **HTTP/JSON** directly (MLB Stats API), or need the **Savant CSV** / FG **behavioral** contract without a wrapper library. |
| [sql-examples.md](../sql-examples.md) | Example **Postgres** queries: FG `*_current` views + Chadwick joins, coverage checks, snapshot audit. |

## Recommendation: Python vs R vs HTTP/API

**Default for `mlbapp`:** use **Python + `pybaseball`** for the main **FanGraphs + Statcast + Chadwick** ingest.

| Approach | When it fits | Tradeoffs |
|----------|----------------|-----------|
| **Python (`pybaseball`)** | **Default.** Sidecar ETL worker, small `venv`, pandas → Postgres (`COPY`, `psycopg`, etc.). Matches a typical “services + data job” shop and keeps one non-TS runtime for baseball scrapes. | You maintain Python env and job packaging (Docker stage, CI, or host cron). |
| **R (`baseballr`)** | Team already ships **R** for modeling/research and wants **one** stack for scrape + analysis; or you need a few **FG helpers** that are still richer on the R side (confirm per release before committing). | Second runtime in the org; parity with pybaseball must be **tested** (column names differ, e.g. `IDfg` vs `playerid`). |
| **Direct HTTP (Savant / FG)** | Avoid only if you have a strong reason: e.g. no third-party scrape dependency, or a compliance review requires **first-party** paths only. | **Highest** maintenance: URL/query changes break you first; you reimplement chunking, retries, and parsing that libraries already encode. |
| **MLB Stats API (JSON)** | **Supplement**, not replacement for pitch logs: **schedules**, **gamePk**, **people** metadata, rosters, sometimes light stats. Official and stable **relative** to raw Savant CSV URLs. | Does **not** replace full **Statcast pitch-row** loads for Savant-style cards; use Savant export path (via pybaseball/baseballr) for that. |

**Summary:** **`pybaseball` for bulk FG + Statcast + IDs; MLB Stats API for MLB metadata and keys where helpful; raw Savant/FG HTTP only if you are forced off libraries.** Pick **`baseballr`** instead of Python only when the team standard is clearly R-first.

### Why Python by default (honest)

- **Underlying data:** FanGraphs and Savant are the **same sources** whether you use `pybaseball`, `baseballr`, or careful raw HTTP. Neither language yields “truer” Statcast rows. Differences show up as **column names**, occasional **parse quirks**, and **how** each library chunks requests — all fixable in ETL tests for either stack.
- **Ease of implementation / maintainability (for this repo):** `mlbapp` is **TypeScript-first** (API + web). A small **Python** ingest job is a very common add-on: `venv` + `pandas` + `psycopg`/`polars`, slim CI images, lots of copy-paste examples for “CSV → Postgres”. **R** is equally capable for the same pipeline (`DBI`, `arrow`, etc.), but in a Node-centric repo it is often a **second** packaging story (R version, system libs, larger images, fewer teammates who touch it by default). That is **ecosystem and team surface area**, not a verdict on R the language.
- **Library maintenance:** Both projects track upstream site changes; you should **pin versions** and add smoke tests either way. `pybaseball` was explicitly modeled after `baseballr`; neither is maintenance-free.

So the default is **not** “Python because the numbers are better,” it is **“Python sidecar is usually the lowest-friction extra runtime next to Node unless you already standardize on R.”** If your org already runs **R in production** or your analysts own ingest, **`baseballr` is a perfectly rational default** — document column mappings once and treat parity as a test concern, not a moral one.

**Versioning:** Pin `pybaseball` / `baseballr` (and capture the version in `ingest_snapshot.params` in the schema proposal) so scraper drift is diagnosable.

**Compliance:** Respect [FanGraphs](https://blogs.fangraphs.com/terms-of-use/) and [MLB.com](https://www.mlb.com/official-information/terms-of-use) terms, robots, and rate limits for any path below.
