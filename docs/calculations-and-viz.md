# Calculations and visualization data (where and when)

This doc answers **where** pitch movement clocks, percentile sliders, and similar derived work should run: **ETL**, **Postgres (views / materialized views / SQL)**, **API (Node)**, or **browser** — and ties that to [SCHEMA_PROPOSAL.md](./SCHEMA_PROPOSAL.md) (raw `statcast_pitch`, optional rollups).

We had only a **light** placeholder before (`statcast_pitch_rollup_daily` in the schema proposal). The framework below is the explicit design space.

### Cohort spec ownership

**Owner:** project owner (you). **Percentile / cohort definitions** (e.g. which pitch types, SP vs RP, minimum sample sizes, season scope) should be **written down and agreed before implementation** — not invented ad hoc in SQL during the first slider PR. When ready, add a versioned artifact (e.g. `docs/cohort-spec.yaml` or a section in this file) and reference it from the rollup refresh job.

---

## Savant row corrections (plain English)

**What it means:** Baseball Savant sometimes **changes historical pitch rows** after the fact (measurement fix, classification fix, missing field filled in). The row is still “that pitch” in the game (`game_pk`, `at_bat_number`, `pitch_number`), but **numbers in columns can change**.

**Why it matters for you:** Anything **derived from many pitches** — league percentiles, pitch-type averages, heatmap bins, materialized rollups — can become **slightly wrong** until you recompute them after Savant fixes data.

**“Full re-rollup” vs “lazy refresh”**

| Strategy | Meaning | Good for |
|----------|---------|----------|
| **Full re-rollup (affected scope)** | After ingest detects changed rows for season *S*, **recompute all** materialized summaries / percentiles that depend on *S* (or the whole league-year). | When you need **tight accuracy** or public-facing comparability. |
| **Lazy refresh (MVP)** | Ingest still **UPSERTs** raw `statcast_pitch` when you reload windows; rollups/percentiles refresh **on a schedule** (nightly) or **next time** a heavy job runs — not instantly after every tiny Savant edit. | **Local-first MVP** where “good enough soon” beats “perfect immediately”. |

**Recorded decision:** lazy refresh is **acceptable** for this MVP; tighten later if users notice stale league ranks.

---

## Layers (recommended mental model)

| Layer | Holds | Good for |
|-------|--------|----------|
| **Raw facts** | `statcast_pitch` (+ `payload_jsonb`), `fg_*` | Immutable-ish Savant rows; replay; audits. |
| **Stable derived facts** (same definition forever, reused everywhere) | New tables or columns populated in **ETL** or **SQL batch** after each ingest | Things you never want recomputed two different ways (e.g. normalized movement in a standard basis if you freeze a convention). |
| **Reusable aggregates** (player–season, pitch-type mix, league cohorts) | **Materialized views** or **summary tables** refreshed after ingest or nightly | Percentiles vs league, movement profiles, heatmap bins — **anything that scans lots of pitches** and is shown on every card. |
| **Request-scoped transforms** (cheap, deterministic, small N) | **API** or **SQL** in a single-player query | Movement “clock” angle/magnitude from `pfx_x` / `pfx_z` **per pitch** when you already filtered to `pitcher_mlbam` + date range + indexes. |
| **Pure presentation** (pixel layout, animation, slider UI) | **Browser** (React) | No new baseball truth; map already-fetched numbers to SVG/Canvas. |

**Rule of thumb:** if it needs a **league-wide or year-wide scan** to rank or percentile a player, **do not** do that on every HTTP request without cache — **precompute or materialize**. If it is **O(pitches for one player)** with a tight index and a fixed formula, **runtime SQL or API** is fine.

### PostgreSQL: `VIEW` vs `MATERIALIZED VIEW` (freshness)

| Object | When base table rows change (e.g. `UPSERT` into `statcast_pitch`) |
|--------|-------------------------------------------------------------------|
| **Ordinary `VIEW`** | Next `SELECT` **re-runs** the view definition against **current** rows — always up to date, at the cost of **recomputing** that query every time. |
| **`MATERIALIZED VIEW`** | Stored **snapshot** on disk. It does **not** auto-update when underlying data changes. You must run **`REFRESH MATERIALIZED VIEW`** (optionally **`CONCURRENTLY`**) or rebuild — typically chained **after ingest** in the same job, or on a schedule. |

So: **upserting pitches does not refresh a matview by itself.** “Lazy MVP” still means **calling refresh** (or swapping a summary table) on your own cadence — it just does not have to be synchronous with every single row upsert.

**End-of-ETL refresh (recommended):** Yes — run **`REFRESH MATERIALIZED VIEW`** on each dependent matview **after** the ETL batch finishes loading `statcast_pitch` (and any other inputs), **in the same job**, so you know the snapshot matches that run. Order: **facts committed → refresh matviews** (same connection/transaction policy you choose: often refresh **after** `COMMIT` of the load so the matview sees committed rows). Use **`REFRESH MATERIALIZED VIEW CONCURRENTLY`** only where Postgres allows it (requires a **unique index** on the matview); otherwise non-concurrent refresh briefly blocks `SELECT` on that matview during rebuild.

**Alternatives if you want “always current” without manual refresh:** use a **normal `VIEW`** (pay query cost each read), **summary tables** updated by your ETL step after each batch, or extensions such as **incremental matview** tooling (evaluate separately; not required for MVP).

---

## Example: pitch movement “clock”

**Math:** Savant Search CSV gives **`pfx_x`** and **`pfx_z`** in **feet** (catcher perspective per [csv-docs](https://baseballsavant.mlb.com/csv-docs)); we persist that unit in `statcast_pitch`. Inch-denominated charts (e.g. ±24″ rings like Savant’s movement view) should **multiply by 12**. A “clock” is usually a **2D transform**: magnitude + angle (or horizontal/vertical components for a plot).

| Option | When to use |
|--------|-------------|
| **Runtime (SQL or API)** | Fetching **one pitcher’s** pitches for a season/card; compute angle/mag in `SELECT` or in Node from the result set. **Low risk** if the formula is version-controlled in one place (shared lib or SQL view). |
| **ETL column** | You want the **exact** clock values stored for analytics parity or to avoid repeating trig in multiple clients. Adds migration + backfill whenever the convention changes. |
| **Generated column / view** | Same as runtime SQL but **centralized** in Postgres: `CREATE VIEW statcast_pitch_display AS SELECT ..., atan2(...) AS movement_angle, ...` so API and future tools stay aligned. |

**Recommendation:** start with a **view or shared pure function** (SQL or TS) used by the API; promote to **stored generated columns** only if volume or latency forces it.

### Arm angle as an overlay on movement

**Product goal:** On the movement plot (`pfx_x` / `pfx_z` or a polar “clock” of the same pair), show **how each pitch’s induced movement sits relative to the slot it was released from** — readers intuit “sidearm + big horizontal run” vs “over the top + drop” when both layers are visible.

**Data (Savant):**

- **`pfx_x` / `pfx_z`** — **Induced movement** in the plate plane (how the ball *moves* after release toward the plate), **stored in feet** per Savant. Card/UI transforms should match [csv-docs](https://baseballsavant.mlb.com/csv-docs) (e.g. ×12 for inch-scale visuals).
- **`arm_angle`** (when present on the pitch row) — Savant-style **release arm angle** (shoulder-to-ball at release; ~0° sidearm, ~90° over the top). In `mlbapp` it usually lives in **`payload_jsonb`** until promoted to a typed column.
- **`release_pos_x` / `release_pos_y` / `release_pos_z`** — **Release point** in feet (catcher’s frame). Useful if `arm_angle` is missing or for custom geometry; not identical to the published arm-angle definition.

**Design note:** Arm angle and “movement angle” from `atan2(pfx_z, pfx_x)` are **different physical angles**. The overlay is a **visual encoding** choice (e.g. radial reference line or wedge at **`arm_angle`**, points colored by pitch type, movement as vectors from a common origin; or a **small multiples** row per pitch type with mean arm angle + movement cloud). Version the drawing spec next to the SQL/TS movement transform so the card does not mix conventions across releases.

---

## Example: percentile sliders (velocity, movement, spin, etc.)

**Hard part:** a percentile is **always relative to a cohort** (e.g. same `game_year`, same pitch type `FF`, same role RHP, min pitch count). Computing cohort CDFs on the fly over **all** Statcast rows per request is **expensive**.

| Option | When to use |
|--------|-------------|
| **Materialized summary + percentiles** | **Default for sliders on cards.** After ingest (or nightly), refresh a table such as `pitcher_season_pitchtype_percentiles` or a **MATERIALIZED VIEW** keyed by `(game_year, pitch_type, p_throws, …)` with precomputed quantiles or histogram buckets. Player row joins on keys + value. |
| **ETL into JSON** | Acceptable for prototypes: ETL writes percentile snapshots into a blob keyed by player-season; less queryable than relational columns. |
| **Runtime** | Only with **strict limits**: pre-aggregated cohort already small, or **Redis/cache** keyed `(year, pitch_type, metric)` with TTL, or **approximate** percentiles — still avoid full table scan per page load. |

**Recommendation:** define **explicit cohort definitions** in code (versioned), implement **one** batch job or `REFRESH MATERIALIZED VIEW` that runs when `statcast_pitch` data for that window changes, and serve sliders from that layer.

---

## Freshness vs cost

| Trigger | Action |
|---------|--------|
| New **Savant snapshot** / chunk loaded | Incremental **rollup job** for affected `game_year` (or full refresh if simpler at your scale). |
| **Mid-season** corrections (Savant edits rows) | Same as above; raw table **UPSERT** already planned in [DATASETS.md](./DATASETS.md) — rollups must **re-run** for touched windows. |
| **FG-only** card stats | Mostly from **`fg_*` first-class columns**; percentiles across league FG leaders are **small** (thousands of rows) — **SQL at request time** or a small MV is usually enough. |

---

## What we had already vs this doc

| Before | Now |
|--------|-----|
| [SCHEMA_PROPOSAL.md](./SCHEMA_PROPOSAL.md) optional `statcast_pitch_rollup_daily` | Same idea, generalized: **any** heavy aggregate belongs in that family (table or MV), not implied to be “daily” only. |
| Raw `statcast_pitch` typed columns | Enough for **per-pitch** viz; **not** enough alone for **league percentile** UI without another layer. |

---

## Suggested next artifacts (when you implement)

1. **Cohort spec** (markdown or YAML): dimensions for each published percentile (e.g. “FF / RHP / SP / min 200 pitches / regular season”).
2. **One refresh entrypoint**: `pnpm` script or cron that runs after ETL: `refresh_card_aggregates.sql`.
3. **API contract**: card endpoint returns `{ rawSample?, aggregates, percentiles }` so the client only does layout.

None of that is Flyway-mandated until you pick concrete tables; keep this doc as the **architecture agreement**, then add migrations when the first slider ships.
