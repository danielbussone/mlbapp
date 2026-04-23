# Dataset inventory (Phase A)

**Accessor docs (functions + expected outputs / HTTP contracts):** [data-sources/README.md](./data-sources/README.md) → [pybaseball](./data-sources/pybaseball.md), [baseballr](./data-sources/baseballr.md), [HTTP & official APIs](./data-sources/http-and-official-apis.md).

**Status:** Discovery complete. **Owner approved** the proposed domain schema and Flyway domain migrations (see sign-off below). **Ingest:** Python + `pybaseball` (see [data-sources/README.md](./data-sources/README.md)). **Statcast:** [STATCAST_REQUIREMENTS.md](./STATCAST_REQUIREMENTS.md); ETL `pnpm etl:statcast` ([`../etl/mlbapp_etl/statcast.py`](../etl/mlbapp_etl/statcast.py)) — owner sign-off for defaults still recommended.

This pass covers **grain, keys, overlap, rough sizing, access paths (Python vs R), and compliance posture**. Row counts are **order-of-magnitude** unless cited from upstream docs.

## Per-feed matrix

| Dataset | Grain | Primary key | Access path | Row estimate / year | Refresh | MLB vs minors | Compliance notes | Target Postgres table(s) | Overlap with FanGraphs |
|--------|-------|-------------|-------------|---------------------|---------|---------------|------------------|---------------------------|-------------------------|
| FanGraphs batting leaders | Player–season–team–**level** (splits: `Team`, `TOT`; e.g. `Level` = MLB) | `IDfg` + `Season` + `Team` + `Level` (with `snapshot_id` in DB PK); stable id is `IDfg` | `pybaseball.batting_stats`, `batting_stats_range`; `baseballr::fg_batter_leaders()` | ~0.5–3k qualified rows per season (depends on `qual`, league filter) | Re-pull when FG updates; mid-season corrections | Mostly MLB; FG UI can include MiLB in other tools—confirm query params | Scraping FG leaderboard endpoints (libraries or custom): respect rate limits and [FanGraphs Terms of Use](https://blogs.fangraphs.com/terms-of-use/) / robots; prefer caching and bounded refresh | `fg_batting_season` (proposed) | wOBA, wRC+, barrel% / Statcast-tab fields on FG duplicate *themes* from Statcast-derived aggregates |
| FanGraphs pitching leaders | Player–season–team–**level** | `IDfg` + `Season` + `Team` + `Level` | `pybaseball.pitching_stats`, `pitching_stats_range`; `baseballr::fg_pitcher_leaders()` | ~0.5–2k rows per season | Same as batting | Same as batting | Same as batting | `fg_pitching_season` (proposed) | FIP/xFIP/SIERA vs Statcast-based estimators (different definitions); velocity/movement live on Savant, not FG raw exports |
| Statcast pitch log (league window) | Pitch | **`game_pk` + `at_bat_number` + `pitch_number`** (use `sv_id` when present as a revision-friendly surrogate); see [Savant CSV docs](https://baseballsavant.mlb.com/csv-docs) | `pybaseball.statcast(start_dt, end_dt)`; `baseballr::statcast_search()` | **~700k+ pitches / full MLB season** (per pybaseball maintainer notes); grows with playoffs | **Retroactive corrections**—same keys can change metrics; version snapshots or re-sync policy | MLB pitch-level (2015+ for full batted-ball / spin richness; earlier partial) | Data ultimately from **MLB Digital / Baseball Savant**; bulk automated pulls should follow MLB robots/rate guidance; [MLB.com Terms of Use](https://www.mlb.com/official-information/terms-of-use) govern site use; **no implied license to redistribute** a derivative commercial dataset | `statcast_pitch` (proposed; consider partitioning by `game_year` / month) | Underpins FG-reported Statcast-era quality-of-contact summaries where FG surfaces them |
| Statcast pitch log (player-scoped) | Pitch | Same composite | `pybaseball.statcast_pitcher`, `statcast_batter`; `baseballr::statcast_search_pitchers`, `..._batters` | Bounded by player playing time | Same | MLB | Same | Same table as league pull | Same |
| Chadwick player register | Person (career span) | `key_uuid` (Chadwick); join keys include `key_mlbam`, `key_fangraphs`, `key_bbref`, `key_retro` | `pybaseball.chadwick_register`; `baseballr::chadwick_player_lu()` / `chadwick_player_id_lu()` | Full register **~200k+ rows total** (not annual); refresh on register releases | Infrequent version bumps | All affiliated levels in register | [Chadwick register](https://github.com/chadwickbureau/register) terms apply | `ref_player_ids` or `dim_player_external_id` (proposed) | Enables **`key_fangraphs` ↔ `key_mlbam`** joins independent of name matching |

## FanGraphs

- **JSON leaders API:** Very wide `season`/`season1` windows (many years in one request) can return **HTTP 500** from FanGraphs. The ETL splits the requested range into **year chunks** (default 10 calendar years per request; override with `MLBAPP_FG_SEASON_CHUNK_YEARS`, or `0` for a single request) and concatenates results.
- **Leaderboards:** Batting (`bat`) and pitching (`pit`) leader scrapes expose hundreds of columns in modern seasons (including Statcast-era tabs on FG). Use explicit column lists in ETL to avoid schema drift.
- **Qualifiers / coverage:** Default `pnpm etl:fg` uses **`--qual 1`** so FanGraphs returns **every** player-season line with at least one PA (batting) / IP (pitching). Column **`rate_stat_qualified`** (Flyway V4) is set at ingest for **MLB** rows when PA/IP clears the usual rate-stat bar (3.1 PA per scheduled team game; 1 IP per team game). Schedule length follows a small **historical table** in `etl/mlbapp_etl/fg_qualify.py`: **154** games for 1904–1960 (except **1919** = 140 and per-year strike overrides), **162** from 1961 on except **1981** (~108), **1994** (~115), **1995** (144), **2020** (60); pre-1904 defaults to **140** (19th-century schedules varied widely). Use **`--fangraphs-qualified-fetch`** for the old **`qual=y`** behavior (smaller feed, injury seasons omitted from the API). `ingest_snapshot.params` records `api_qual` and the qualification rule id.
- **Multi-team seasons:** Expect separate team rows plus aggregated `TOT`; downstream **player-season** rollups must decide whether to use `TOT` only or sum splits (prefer **`TOT` when present** for rate stats that FG already reconciles).
- **`fangraphs_id` → `mlbam_id`:** Prefer **Chadwick** (`key_fangraphs` / `key_mlbam`) over name-based matching. `pybaseball.playerid_lookup` and `baseballr::playerid_lookup` / Chadwick helpers return the crosswalk; treat ambiguous names as data-quality exceptions, not silent merges.

## Statcast

Full ETL/product requirements: [STATCAST_REQUIREMENTS.md](./STATCAST_REQUIREMENTS.md).

- **Pitch-level fields:** Follow Baseball Savant CSV documentation for definitions. **`pfx_x` / `pfx_z`** are horizontal/vertical movement in **feet** (catcher perspective per [Savant csv-docs](https://baseballsavant.mlb.com/csv-docs)); multiply by 12 for inch-denominated plots (e.g. the player-card movement chart). **`release_spin_rate`**, **`spin_axis`**, **`launch_speed` / `launch_angle`** (where batted-ball event exists), **`estimated_ba_using_speedangle`**, run-value columns, and alignment fields (`if_fielding_alignment`, etc.) drive Savant-style cards.
- **Batted-ball / spray:** `hc_x`, `hc_y` (legacy spray chart coordinates), hit distance, barrel classification (`launch_speed_angle`), and game state columns support rolling and spray analysis at pitch or aggregated level.
- **Query limits:** `pybaseball` documents a **~30,000 row cap per Statcast request** for large pulls—full seasons require **chunking by date** (and deduping on the natural key). Plan ingest windows accordingly.
- **R (`baseballr`) vs Python (`pybaseball`)** — capability matrix and gaps:

| Concern | `pybaseball` (Python) | `baseballr` (R) | Gaps / notes |
|--------|------------------------|-----------------|--------------|
| League Statcast window | `statcast(start_dt, end_dt)` | `statcast_search(start_date, end_date, ...)` | Both hit Savant search CSV flows; chunking required for full seasons in Python; mirror same in R for large windows |
| Player-filtered Statcast | `statcast_pitcher`, `statcast_batter` | `statcast_search_pitchers`, `statcast_search_batters` | Same underlying grain; argument names differ |
| FG season batting / pitching | `batting_stats`, `pitching_stats` (+ `_range`) | `fg_batter_leaders`, `fg_pitcher_leaders` | Column sets may differ slightly by scrape version; **normalize in ETL** |
| ID crosswalk | `playerid_lookup`, `chadwick_register` | `playerid_lookup`, `chadwick_player_lu`, `chadwick_player_id_lu` | Prefer identical Chadwick source for parity |
| Caching | `pybaseball.cache.enable()` optional | Use local `.rds` / `pins` / custom cache in R | **This repo is Node-first**—ingest will likely be a **sidecar Python/R worker** or pre-materialized files consumed by the API; Phase A does not mandate the runtime |
| Non-Statcast FG splits (splits pages, game logs) | Partial / other modules; check current `pybaseball` docs | Richer scrape helpers historically in R ecosystem | **Capability drift**—reconcile per feature before relying on one stack |

## Ingest implications for `mlbapp`

- The application stack is **TypeScript (Fastify + Vite)**. **Ingest:** Python batch under [`../etl/`](../etl) — **FanGraphs**, **Chadwick**, and **Statcast** (`pnpm etl:fg` / `pnpm etl:chadwick` / `pnpm etl:statcast` → `statcast_pitch`) **done** and validated ([sql-examples.md](./sql-examples.md), [STATCAST_REQUIREMENTS.md](./STATCAST_REQUIREMENTS.md)). Not wired into `apps/api` at runtime yet.
- **Postgres + pgvector** is chosen for chat/RAG; **Flyway** migrations under [`../db/sql/`](../db/sql/) (**V1** extensions, **V2** domain, **V3** `fg_*_season_current` views) per [SCHEMA_PROPOSAL.md](./SCHEMA_PROPOSAL.md) (owner sign-off recorded below).
- **Card math and viz** (movement clock, league percentiles, rollups): not part of raw ingest — see [calculations-and-viz.md](./calculations-and-viz.md) for ETL vs materialized view vs API vs client.

## Sign-off

- [x] Owner reviewed parallel block (this doc + hello-world stack)
- [x] Ready for `schema-keys` / Flyway domain migrations (**approved** — implement per [SCHEMA_PROPOSAL.md](./SCHEMA_PROPOSAL.md))
- [x] **Flyway V2** domain DDL landed in repo ([`../db/sql/V2__domain_schema.sql`](../db/sql/V2__domain_schema.sql))
- [x] **FanGraphs ETL** implemented ([`../etl/`](../etl)) — load via `pnpm etl:fg` from repo root
- [x] **Chadwick ETL** implemented — `pnpm etl:chadwick` ([`../etl/mlbapp_etl/chadwick.py`](../etl/mlbapp_etl/chadwick.py)); data imported and validated ([`sql-examples.md`](./sql-examples.md))
- [x] **Statcast ETL** implemented — `pnpm etl:statcast` ([`../etl/mlbapp_etl/statcast.py`](../etl/mlbapp_etl/statcast.py)); `statcast_pitch` loaded and validated ([`sql-examples.md`](./sql-examples.md), [`STATCAST_REQUIREMENTS.md`](./STATCAST_REQUIREMENTS.md))

### Recorded owner decisions (session)

| Topic | Decision |
|-------|----------|
| Domain schema / Flyway | Approve proposed tables and proceed with **V2+** domain migrations. |
| Ingest runtime | **Python + `pybaseball`** (not R for production ingest). |
| FanGraphs **v1** first-class columns | Match **default FanGraphs player page** season tables (batting + pitching); see [SCHEMA_PROPOSAL.md](./SCHEMA_PROPOSAL.md#v1-fangraphs-default-player-page-columns) and archived screenshots [reference/fg-player-page-v1/README.md](./reference/fg-player-page-v1/README.md). |
| Percentile cohort spec | **Owner-authored** before implementation; see [calculations-and-viz.md](./calculations-and-viz.md). |
| Savant correction / rollups | Explained in [calculations-and-viz.md](./calculations-and-viz.md#savant-row-corrections-plain-english); **lazy rollup refresh OK for MVP**. |
