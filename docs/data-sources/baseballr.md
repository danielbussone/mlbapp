# baseballr (R)

[baseballr](https://github.com/BillPetti/baseballr) acquires and tidies baseball data in **R**, returning **`tibble`** / `data.frame` objects. It is a common **R** counterpart to **pybaseball** for FanGraphs leaderboards and Statcast search.

Upstream reference: [package reference](https://billpetti.github.io/baseballr/reference/) (per-function pages; authoritative for signatures and return types).

---

## FanGraphs — leaderboards

### `fg_batter_leaders(...)`

| Aspect | Detail |
|--------|--------|
| **Grain** | One row per **player–season** line on the FG leaderboard export (team splits / `TOT` per FG rules); row count depends on `qual`, `lg`, etc. |
| **Arguments (representative)** | `startseason`, `endseason` (**character** years, e.g. `"2023"`); `lg`: `"all"`, `"al"`, `"nl"`; `qual`: `"y"` qualified or a numeric PA threshold as string; `ind`: `"1"` split by season, `"0"` rolled up; `pos`, `hand`, `team`, `type` (leaderboard “tab” id), `pageitems`, `pagenum`, `sortstat`, `sortdir`, date filters (`startdate`, `enddate`, `month`), etc. See [fg_batter_leaders](https://billpetti.github.io/baseballr/reference/fg_batter_leaders.html). |
| **Expected output** | `tibble` with **hundreds of columns** in current versions (basic + advanced + pitch-type breakdowns). Core identifiers include **`Season`**, **`playerid`** (**FanGraphs id**, not MLBAM), **`PlayerName`**, **`team_name`**, **`team_name_abb`**, **`xMLBAMID`** (MLBAM when FG exposes it), **`Age`**, **`Pos`**, `G`, `PA`, `AVG`, `OBP`, `SLG`, `OPS`, `wOBA`, `wRC_plus`, `WAR`, etc. Column names use underscores in many places (e.g. `BB_pct`, `K_pct`) — align your ETL to [SCHEMA_PROPOSAL.md](../SCHEMA_PROPOSAL.md) snake_case. |

### `fg_pitcher_leaders(...)`

Mirror of batter leaders for **pitching** exports (`IP`, `ERA`, `FIP`, `xFIP`, `WAR`, pitch mix, Statcast-era pitching tabs, etc.). See [fg_pitcher_leaders](https://billpetti.github.io/baseballr/reference/fg_pitcher_leaders.html).

**Crosswalk note:** Prefer **`xMLBAMID`** when populated; otherwise join **`playerid`** (FG) to Chadwick / `playerid_lookup` for MLBAM — same strategy as [DATASETS.md](../DATASETS.md).

---

## Statcast — `statcast_search` family

### `statcast_search(start_date, end_date, playerid = NULL, player_type = "batter", ...)`

| Aspect | Detail |
|--------|--------|
| **Grain** | **One row per pitch** (Savant search export). |
| **Arguments** | `start_date`, `end_date` (`YYYY-MM-DD`); optional `playerid` (**MLBAM**); `player_type`: `"batter"` or `"pitcher"` when filtering by `playerid`. Additional `...` documented as ignored placeholder in current reference. |

### `statcast_search_batters(start_date, end_date, batterid = NULL, ...)`

Same as league search, optionally restricted to **`batterid`** (MLBAM).

### `statcast_search_pitchers(start_date, end_date, pitcherid = NULL, ...)`

Same, optionally restricted to **`pitcherid`** (MLBAM).

### Expected output (all three)

Returns a **`tibble`** whose column set matches Savant’s export (on the order of **90+** columns in recent package docs). Upstream documents **name → type** pairs, including for example:

- Identifiers / context: `game_pk`, `game_date`, `game_year`, `player_name`, `batter`, `pitcher`, `home_team`, `away_team`, `inning`, `inning_topbot`, `at_bat_number`, `pitch_number`, `sv_id`
- Pitch: `pitch_type`, `pitch_name`, `release_speed`, `pfx_x`, `pfx_z`, `plate_x`, `plate_z`, `release_spin_rate`, `spin_axis`, `release_extension`, …
- Batted ball: `launch_speed`, `launch_angle`, `hit_distance_sc`, `hc_x`, `hc_y`, `launch_speed_angle`, …
- Values: `estimated_ba_using_speedangle`, `estimated_woba_using_speedangle`, `woba_value`, `delta_run_exp`, …

Full table: [statcast_search reference](https://billpetti.github.io/baseballr/reference/statcast_search.html).

Treat Savant’s **column dictionary** as the semantic source of truth: [Savant CSV docs](https://baseballsavant.mlb.com/csv-docs).

---

## Chadwick / ID lookup

### `chadwick_player_lu()` / `chadwick_player_id_lu(...)`

Download or query the **Chadwick register** for cross-system ids (MLBAM, FanGraphs, BBREF, Retrosheet, etc.). See package reference pages [`chadwick_player_lu`](https://billpetti.github.io/baseballr/reference/chadwick_player_lu.html) and [`chadwick_player_id_lu`](https://billpetti.github.io/baseballr/reference/chadwick_player_id_lu.html).

### `playerid_lookup(last_name, first_name = NULL, ...)`

Name-based lookup returning multiple id columns; use for disambiguation when FG / Savant ids must be reconciled.

---

## Practical expectations for ETL

1. **FG id column:** baseballr uses **`playerid`** for FanGraphs; pybaseball uses **`IDfg`** — map both to the same `id_system='fangraphs'` key in Postgres.
2. **Types:** R `tibble` columns are typed per reference; watch for `integer` vs `double` on ids when serializing to JSON/CSV for load.
3. **Wide leaderboards:** Same as pybaseball — store full row in **`stats_jsonb`** and populate **first-class card columns** explicitly ([SCHEMA_PROPOSAL.md](../SCHEMA_PROPOSAL.md)).
