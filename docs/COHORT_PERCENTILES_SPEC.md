# League percentile cohorts (`cohort_spec_version`: **2026.21**)

Versioned definitions for [`GET /players/:id/league-percentiles`](../apps/api/src/routes/players.ts). Percentiles are **empirical** `percent_rank` (Statcast MVs) or **midrank** among small FanGraphs cohorts (fielding, FG season rates), refreshed after loads (see [sql-examples.md](./sql-examples.md)).

**Savant reference (product parity, not identical engine):** Baseball Savant shows leaderboard-style percentiles. This repo combines **Statcast** (`statcast_pitch` + `payload_jsonb`), **FanGraphs season** consolidated MVs / merged pitching view, optional **sprint** table, and **FG fielding** with explicit **metric direction** so the UI never misreads “high percentile” on lower-is-better stats.

---

## Percentile direction (global rule)

- Each `PercentileSlot` includes **`direction`**: `higher_better` | `lower_better`.
- **`p`** is always the **raw cohort percentile** (CDF of the raw stat within the qualified peer set): a **higher raw value** maps to a **higher `p`** when values are sorted ascending for `percent_rank` / midrank.
- **UI** (see `LeaguePercentilesPanel`) uses a **goodness-oriented slider** for `lower_better` metrics (`100 - p`) and a short caption that raw values are better when lower.

### Direction by metric family

| Family | `lower_better` examples | `higher_better` examples |
|--------|-------------------------|---------------------------|
| Batting (process) | Chase %, Whiff %, K% (FG) | BB% (FG), xwOBA / wOBA / wRC+ (FG), AVG/SLG (FG), exit velo, barrel %, hard-hit %, sweet-spot %, bat speed, xBA on contact (Statcast mean) |
| Pitching (process) | xERA (FG), xFIP (FG), BB% (FG), exit velo allowed, barrel/hard-hit/xBA allowed, HR% | K% (FG), Chase %, Whiff %, SwStr %, Zone %, GB % (framed as pitcher skill), FB velo, extension |
| Fielding | — (runs saved: higher better) | DRS, UZR, OAA (FG), FRV |
| Running | — | Sprint speed |

---

## Payload JSON audit (Statcast Savant-adjacent keys)

Run on a recent `game_year` partition to see which keys exist in your warehouse:

```sql
SELECT k, COUNT(*) AS rows_with_key
FROM statcast_pitch s,
     LATERAL jsonb_object_keys(s.payload_jsonb) AS t(k)
WHERE s.game_year = 2024
GROUP BY k
ORDER BY rows_with_key DESC
LIMIT 120;
```

**Keys used in 2026.2 cohort logic:**

| Key | Use |
|-----|-----|
| `estimated_ba_using_speedangle` | Mean **xBA on contact** (BIP) for batter/pitcher Savant BIP MVs |
| `launch_speed_angle` | When value is `barrel` (case-insensitive), counts as barrel; else EV/LA proxy band (see Flyway V16) |
| `bat_speed`, `attack_angle`, `attack_direction`, `swing_path_tilt` | Bat-tracking rows (existing V15 MV) |
| `release_extension` | Pitcher extension (existing V15 MV) |
| `zone`, `bb_type`, `description` | Chase / whiff / BIP classification (V15) |

**Not in `statcast_pitch` today:** sprint speed (see `player_season_sprint_speed`); Savant fielding **range / arm / strength** splits (placeholders in API + UI until approved ingest — see [DATASETS.md](./DATASETS.md)).

---

## Response sections (card scope)

| Section | Returned when | Notes |
|---------|----------------|-------|
| `percentiles` | Batter (Statcast core) | Backward-compatible; same slots as before + `direction` |
| `savant_batting` | Batter | FG season (xwOBA, wOBA, wRC+, slash, ISO, value runs) + Statcast core + Savant BIP MV |
| `savant_running` | Batter, Fielding | Sprint table; omitted if empty / missing |
| `season.percentiles` | Pitcher | Statcast season totals + `direction` |
| `savant_pitching` | Pitcher | FG season (WAR FIP/RA9, xERA, xFIP, K%, BB%) + Statcast season + Savant BIP allowed MV |
| `savant_catching` | Fielding | Catcher framing/blocking/CS/pop when FG `stats_jsonb` exposes numeric keys (see catcher extractor); omitted if empty |
| `by_pitch_type` | Pitcher | Unchanged grain `(game_year, pitcher_mlbam, pitch_type)` |
| `percentiles` | Fielding | Same slots as **`fielding_percentile_groups`[0]** (season **total** block) |
| `savant_fielding` | Fielding | Copy of **`percentiles`** (card UI reads `fielding_percentile_groups` when present) |
| `fielding_percentile_groups` | Fielding | **2026.16:** Array: first entry **`TOTAL`** = summed DRS/UZR/OAA/FRV & inn across summable positions vs league **`id_fg`** season sums; further entries = one per FG position played that year (innings desc), each vs that **single-position** cohort. **2026.17:** If the player has **only one** summable position that season, the first block’s **`label`** is that code (e.g. `CF`) instead of “All positions (season)”. **UZR** / **FRV** are whatever FanGraphs publishes on the fielding API row; UZR is often blank on newer FG fielding feeds (percentiles show `—` when the warehouse has nulls). Re-run **`pnpm etl:fg --fielding-only`** after ETL updates column aliases (`etl/mlbapp_etl/fg_api.py`, `fg.py`) so **`FRV`** maps from alternate API keys when present. |

---

## Batter (`role=batter`)

### A) Statcast core (`statcast_batter_season_percentile_mv`, grain `(game_year, batter_mlbam)`)

| Metric id | Definition | Player qualifies | Cohort |
|-----------|------------|------------------|--------|
| `bip_avg_exit_velo` | `AVG(launch_speed)` among BIP | `bbe ≥ 50` | same |
| `bip_avg_launch_angle` | `AVG(launch_angle)` among BIP | `bbe ≥ 50` | same |
| `bip_hard_hit_pct` | `100 * count(ev≥95) / bbe` | `bbe ≥ 50` | same |
| `swing_avg_bat_speed` … `swing_avg_path_tilt` | JSON means | `tracked_swings ≥ 25` | same |
| `bat_chase_pct` | Swings OOZ ÷ pitches OOZ (known zone) | `pitches_seen ≥ 400` | same |
| `bat_whiff_pct` | Whiffs ÷ swings | `swings ≥ 150` | same |
| `bip_ev90` | 90th percentile `launch_speed` on BIP (`percentile_disc(0.9)`) | `bbe ≥ 50` | same |

### B) Savant BIP extras (`statcast_batter_season_savant_bip_mv`)

| Metric id | Definition | Player qualifies | Cohort |
|-----------|------------|------------------|--------|
| `bip_barrel_pct` | Barrel classification (JSON `launch_speed_angle` = `barrel` **or** EV/LA proxy band in V16 SQL) | `bbe ≥ 50` | `bbe ≥ 50` |
| `bip_sweet_spot_pct` | Share of BIP with launch angle **8–32°** | `bbe ≥ 50` | same |
| `bip_avg_estimated_ba` | Mean `estimated_ba_using_speedangle` on BIP | `bbe_with_est_ba ≥ 50` | same |

### C) FanGraphs batting season (`fg_batting_season_mlb_merged_rates` view, Flyway V19 + **V33** wOBA/wRC+)

PA-weighted typed columns from **`fg_batting_season_current`** (same TOT/split merge as consolidated). **`player_id`** is `MAX(COALESCE(row.player_id, lookup from player_external_identifier))` (**Flyway V20**) so percentiles work before FG ETL backfills `fg_*_season.player_id`. **K%** uses typed `k_pct`, falling back to **`k_pct_from_so`** (SO÷PA from `stats_jsonb`) when the typed rate is missing.

| Metric id | Definition | Player qualifies | Cohort |
|-----------|------------|------------------|--------|
| `fg_season_xwoba` | PA-weighted `xwOBA` | `pa ≥ 200` (prorated from **max MLB player games**), **or** `pa ≥ round(0.1 · that bar)` for early `qualified` (`battingFgSeasonEarlyQualifiedPa`) | **Relaxed** `pa` floor for midrank only: `min(N, ⌊0.52·N⌋)` with prorated `N` (API `cohortPeerFloorForQualifiedMin`). |
| `fg_season_woba` | PA-weighted `wOBA` (**V33**) | same early `qualified` rule | same relaxed floor |
| `fg_season_wrc_plus` | PA-weighted `wRC+` (**V33**) | same early `qualified` rule | same relaxed floor |
| `fg_season_k_pct` | `k_pct` or SO/PA fallback (×100 in API for display) | same early `qualified` rule as `fg_season_xwoba` | same relaxed floor |
| `fg_season_bb_pct` | PA-weighted `bb_pct` | same | same relaxed floor |
| `fg_season_avg` | PA-weighted `AVG` | same | same relaxed floor |
| `fg_season_slg` | PA-weighted `SLG` | same | same relaxed floor |
| `fg_season_iso` | **ISO** = `season_slg − season_avg` on merged rates row | same | same relaxed floor |

**Value block (midrank from `fg_batting_season_mlb_consolidated`):** `fg_season_bsr`, `fg_season_off`, `fg_season_def`, `fg_season_bat_war` — season sums after TOT merge; same PA qualification / relaxed cohort floor as other FG batting metrics.

**Note:** FG **AVG/SLG** are FanGraphs slash (PA-weighted across splits). **`fg_season_iso`** uses the same merged PA-weighted **AVG** and **SLG** as SLG − AVG (FanGraphs ISO). **xBA on contact** remains `bip_avg_estimated_ba` from Statcast.

---

## Pitcher

### A) Season totals (`statcast_pitcher_season_totals_percentile_mv`)

Same definitions as **2026.1** (chase/whiff/zone, EV allowed, GB%, extension, FF velo, …). From **Flyway V18**, the MV also projects **`val_chase_pct`**, **`val_whiff_pct`**, **`val_swstr_pct`**, **`val_zone_pct`**, **`val_swing_pct`**, **`val_gb_pct`**, **`val_fb_pct`**, **`val_hr_pct`** so the API can display raw rates (percentiles were already present). Each slot includes `direction` (e.g. exit velo allowed → `lower_better`).

**2026.5 / 2026.6:** The MV only assigns **`pct_*`** at **fixed** pitch/swing/BIP cutoffs baked into SQL (e.g. chase / SwStr / zone / swing at **`pitches >= 800`**). Qualification in the API uses **prorated** thresholds from `REFERENCE_SCHEDULE_GAMES`, so a pitcher can be **qualified** with a non-null **`val_*`** while **`pct_*` is still null**. The API then fills **`p`** with runtime midrank (`needsHypothetical` when `value` set and `p` null). **2026.6:** those midrank queries use **`cohortPeerFloorForQualifiedMin`** for the `pitches` / `swings` / `bbe` filters so the cohort is not empty when the prorated qualification floor is still large vs early-season pitch counts (see `leaguePercentilesQualification.ts`).

### B) Savant BIP allowed (`statcast_pitcher_season_savant_bip_mv`)

| Metric id | Definition | Player qualifies | Cohort |
|-----------|------------|------------------|--------|
| `pitch_barrel_pct_allowed` | Barrel rate on BIP allowed | `bbe ≥ 50` | same |
| `pitch_sweet_spot_pct_allowed` | Sweet-spot rate allowed (8–32°) | `bbe ≥ 50` | same |
| `pitch_avg_estimated_ba_allowed` | Mean estimated BA on BIP allowed | `bbe_with_est_ba ≥ 50` | same |
| `pitch_hard_hit_pct_allowed` | Hard-hit% allowed (EV ≥ 95) | `bbe ≥ 50` | same |

### C) FanGraphs pitching season (`fg_pitching_season_mlb_merged_stats`, Flyway V17 + V20 + **V32** xFIP)

**xERA**, **xFIP**, **K%**, **BB%**, and qualification **TBF** all use `fg_pitching_season_mlb_merged_stats`: TBF-based rates from merged MLB rows, IP-weighted xERA / xFIP with typed **`MAX(xera)`** / **`MAX(xfip)`** fallback when IP-outs are missing (**V20**, **V32**). **`player_id`** resolves via `player_external_identifier` when null on FG rows (**V20**). The consolidated MV alone is not used here—its `player_id` is only `MAX(fg_pitching_season_current.player_id)`, so pitchers missing that backfill had no row for `player_id = :id` lookups. **Qualification** uses the prorated TBF floor (e.g. 150 full season); **midrank cohorts** for xERA/xFIP/K%/BB% use a **relaxed** TBF floor `min(N, ⌊0.52·N⌋)` with the same prorated `N` so early-season percentiles are not unstable 0/100 tails against a handful of high-workload arms only (**2026.4**).

| Metric id | Source |
|-----------|--------|
| `fg_season_pit_xera` | `fg_pitching_season_mlb_merged_stats.xera` |
| `fg_season_pit_xfip` | `fg_pitching_season_mlb_merged_stats.xfip` |
| `fg_season_pit_k_pct` | `fg_pitching_season_mlb_merged_stats.k_pct` |
| `fg_season_pit_bb_pct` | `fg_pitching_season_mlb_merged_stats.bb_pct` |

**Value block:** `fg_season_pit_war_fip` ← summed typed **`war`** (FIP-based); `fg_season_pit_war_ra9` ← sum over merged rows of `COALESCE(stats_jsonb 'RA9-WAR' / 'RA9 WAR', typed **`war_ra9`)** per row (**V34**). When the JSON keys are absent, RA9-WAR still flows from ETL’s **`war_ra9`** column on `fg_pitching_season`. Same TBF qualification as other FG pitching metrics.

### D) Pitch-type (`statcast_pitcher_season_pitchtype_percentile_mv`)

**Prorated full-season floor** remains `pitches ≥ 250` per type (2026.1). **2026.9:** API `qualified` on each pitch-type metric is true when that floor is met **or** the pitcher has thrown at least **`PITCH_TYPE_NON_PROVISIONAL_TYPE_PITCHES` (50)** pitches of that type (no “provisional” tag in the UI between 50 and the prorated 250 bar). **2026.7–2026.8:** Runtime midrank for missing MV `pct_*` uses **`pitchTypeMidrankPeerPitchFloor`**: relaxed fraction **0.30**, capped at **50** type pitches for peers (`leaguePercentilesQualification.ts`).

---

## Fielding (`role=fielding`)

`fg_fielding_season_current` (`leaguePercentiles.ts`). **Player** rows match **`player_id`** **or** **`player_external_identifier`** (Fangraphs `id_fg`), like `GET /players/:id/fg-fielding`. **Total block:** `SUM(drs|uzr|oaa|frv)` and `SUM(inn)` across summable positions (excludes `ALL`/`UNK`/empty); **cohort** = same sums **GROUP BY `id_fg`**, `HAVING SUM(inn) ≥` prorated **100**-inn bar. **Per-position blocks:** one cohort per FG `position` code with that bar at **that** position only; player row = highest-innings line at that position. **`position` query param** is optional and ignored for fielding (server discovers positions). **`position=OF`** in **`fieldingPercentilesSingleGroup`** (internal) still maps to **LF∪CF∪RF** when used from tools/tests.

---

## Running

Table **`player_season_sprint_speed`** (`key_mlbam`, `game_year`, `sprint_speed`). Populate with **`pnpm etl:sprint`** (Savant sprint leaderboard via pybaseball). Cohort midrank when **≥ 10** rows in season. Metric id: `running_sprint_speed`.

Optional companion store **`player_season_running_splits`** (Flyway V21): same ETL loads Savant **90 ft split** rows as jsonb (`split_variant` **`raw`** | **`percent`**); not used by percentile API today.

---

## Refresh

After Statcast bulk ingest (from repo root; **`.env`** supplies `DATABASE_URL`):

```bash
pnpm db:refresh-percentiles
```

Refreshes **V15** percentile MVs and **V16** Savant BIP MVs (`scripts/refresh-statcast-percentile-mvs.sql`). **FanGraphs** consolidated MVs refresh on FG ETL (unchanged).

**Flyway:** V15 (core percentiles), V16 (Savant BIP + sprint table), V17 (FG pitching merged stats **view**), **V18** (pitcher season totals MV: adds `val_*` process columns), **V19** (`fg_batting_season_mlb_merged_rates`), **V20** (FG merge views resolve `player_id` via `player_external_identifier` fangraphs + xERA fallback when IP-weighted xERA is null), **V21** (`player_season_running_splits` for Savant 90 ft splits ingest), **V32** (IP-weighted **xFIP** on `fg_pitching_season_mlb_merged_stats`), **V33** (PA-weighted **wOBA** / **wRC+** on `fg_batting_season_mlb_merged_rates`), **V34** (RA9-WAR merge: **typed `war_ra9` fallback** when `stats_jsonb` keys missing).

**API contract test:** `pnpm --filter @mlbapp/api test` runs `leaguePercentilesPayload.spec.mjs` against `buildPercentileSlot`.
