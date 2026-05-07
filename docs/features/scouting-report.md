# Scouting Report (retrospective PRD)

**Status (as implemented):** Prototype UI labeled **“Scouting (prototype)”** on the player card (`PlayerCardPanel` → `ScoutingToolsPrototype`). Grades are **derived from existing league-percentile payloads**, not from a separate scouting API.

## Summary

Present **20–80 style scouting grades** (rounded to the nearest 5 on the 20–80 scale) for **Hitting**, **Pitching**, or **Fielding** card roles. Users can **click a grade** to open a dialog with the formula and per-metric inputs (`scoutingToolsFromPercentiles.ts`).

## How it works

1. **Data fetch:** `useLeaguePercentilesQuery` calls `GET /api/players/:playerId/league-percentiles` with `game_year` and `role` mapped from card role (`batter` | `pitcher` | `fielding`).
2. **Slot merge:** Percentile slots are merged per role via `mergeSlotsForScouting` (= `mergePercentileSlotsForRole`).
3. **Goodness mapping:** For each metric, the UI uses **goodness percentiles** (0–100, higher = better). Raw cohort percentile `p` is flipped to `(100 − p)` when the metric is **lower-is-better** (`percentileGoodnessColor` / `goodnessDisplayPercentile`).
4. **Grade mapping:**  
   - Mean goodness across the **used** metrics for that row (missing metrics omitted, not zeroed).  
   - `raw = 20 + 60 × (mean ÷ 100)`, then **round to nearest 5**, clamp **[20, 80]** (`goodnessToScoutingGrade20_80`).
5. **Row definitions** differ by role (see below). Pitching **pre-2002** uses a reduced three-row layout (Stuff & miss, Command & control, Overall); **2002+** uses Stuff, Command, Control, Limit damage, Overall. Pitching **Overall** logic branches on whether **FanGraphs +** bundle (Stuff+, Location+, Pitching+) cohort slots are all usable and on season year (ERA/FIP/xERA/xFIP/Pitching+ mixes — see `pitchingScoutingLines`).

## Data sources

| Layer | Source |
|-------|--------|
| Percentiles | Same as **League Percentiles** feature: Statcast materialized views + FanGraphs season/merged views + fielding/sprint as documented in `docs/COHORT_PERCENTILES_SPEC.md` |
| API | `GET /players/:playerId/league-percentiles` |

No separate database table or ETL for scouting; it is a **pure transformation** of percentile JSON.

## Metric IDs by category (source: `scoutingToolsFromPercentiles.ts`)

League-percentile **`metricId`** strings come from `GET /players/:id/league-percentiles`. Each cell’s grade is the **mean goodness percentile** over the metrics that end up **used** for that row (missing metrics are dropped, not averaged as zero).

**Selection rules**

| Rule | Behavior |
|------|----------|
| **Mean** | Average goodness over **all listed** metrics that have a usable goodness percentile. |
| **Fallback** | Try **primary** set first; if **no** metric in primary has usable goodness, use **fallback** set instead (`explainGradeWithFallback`). |
| **First tier** | Try tier groups **in order**; the **first** tier with **at least one** usable goodness percentile wins—only that tier’s metrics contribute (`explainFirstTier`). |

### Batting (`battingScoutingLines`)

| Category | Column | Percentile `metricId`(s) | Selection |
|----------|--------|---------------------------|-----------|
| Hit | Process | `bat_whiff_pct`, `bip_avg_estimated_ba` | Fallback → `fg_season_k_pct` |
| Hit | Result | `fg_season_avg` | Mean |
| Eye | Process | `bat_chase_pct` | Fallback → `fg_season_bb_pct` |
| Eye | Result | `fg_season_bb_pct` | Mean |
| Power | Process | `bip_barrel_pct`, `bip_hard_hit_pct`, `bip_ev90`, `bip_avg_exit_velo` | Fallback → `fg_season_iso`, `fg_season_slg` |
| Power | Result | `fg_season_iso` | Mean |
| Overall | Process | `fg_season_xwoba` | Fallback → `fg_season_woba`, `fg_season_wrc_plus` |
| Overall | Result | `fg_season_woba`, `fg_season_wrc_plus` | Mean |
| Run | Process | `running_sprint_speed` | Mean |
| Run | Result | `fg_season_bsr` | Mean |

### Pitching — season **&lt; 2002** (`pitchingScoutingLines`, `ancient`)

| Category | Column | Percentile `metricId`(s) | Selection |
|----------|--------|---------------------------|-----------|
| Stuff & miss | Process | `fg_season_pit_k_pct` | Mean |
| Command & control | Process | `fg_season_pit_bb_pct` | Mean |
| Overall | Process | `fg_season_pit_era`, `fg_season_pit_fip` | Mean |

No **Result** column for pitching (process-only rows).

### Pitching — season **≥ 2002** (`pitchingScoutingLines`)

**Triple+ mode:** When **all three** of `fg_season_pit_stuff_plus`, `fg_season_pit_location_plus`, and `fg_season_pit_pitching_plus` have usable goodness percentiles, **Stuff** uses **only** Stuff+ and **Command** uses **only** Location+ (single-metric rows).

| Category | Column | Percentile `metricId`(s) | Selection (when not Triple+) |
|----------|--------|---------------------------|------------------------------|
| Stuff | Process | See tiers below | **First tier** |
| Command | Process | See tiers below | **First tier** |
| Control | Process | `fg_season_pit_bb_pct` | Mean |
| Limit damage | Process | See tiers below | **First tier** |
| Overall | Process | See **Overall** subsection below | Conditional mean |

**Stuff — tiers** (order): (1) `pitch_ff_avg_velo`, `pitch_whiff_pct`, `pitch_swstr_pct` → (2) if season ≥ 2020: `fg_season_pit_stuff_plus` → (3) `fg_season_pit_fbv`, `fg_season_pit_fg_o_swing_pct`, `fg_season_pit_fg_swstr_pct` → (4) `fg_season_pit_k_pct`.

**Command — tiers** (order): (1) `pitch_zone_pct` → (2) if season ≥ 2020: `fg_season_pit_location_plus` → (3) `fg_season_pit_fg_zone_pct`.

**Limit damage — tiers** (order): (1) `pitch_barrel_pct_allowed`, `pitch_hard_hit_pct_allowed`, `pitch_sweet_spot_pct_allowed` → (2) `fg_season_pit_fg_gb_pct`, `fg_season_pit_fg_iffb_pct`, `fg_season_pit_fg_hard_pct` → (3) `fg_season_pit_fg_gb_pct`, `fg_season_pit_hr_fb_pct` → (4) `fg_season_pit_babip`.

**Overall — pitching** (`explainGradeOverallPitch`, not Triple+ path):

- **Season ≥ 2020:** Prefer mean of `fg_season_pit_xera`, `fg_season_pit_xfip`, `fg_season_pit_pitching_plus`, `fg_season_pit_era`, `fg_season_pit_fip` (metrics without usable percentiles omitted). If that yields nothing useful, fall back to **`fg_season_pit_era`**, **`fg_season_pit_fip`** only.
- **Season &lt; 2020:** `fg_season_pit_era`, `fg_season_pit_fip` (and Pitching+ when Triple+ branch applies—see code).

**Overall — pitching** when **Triple+** and season **≥ 2002**:

- **Season ≥ 2020:** Mean of `fg_season_pit_xera`, `fg_season_pit_xfip`, `fg_season_pit_pitching_plus`, `fg_season_pit_era`, `fg_season_pit_fip`.
- **2002 ≤ season &lt; 2020:** Mean of `fg_season_pit_era`, `fg_season_pit_fip`, `fg_season_pit_pitching_plus`.

### Fielding (`fieldingScoutingLines`)

| Category | Column | Percentile `metricId`(s) | Selection |
|----------|--------|---------------------------|-----------|
| Range | Process | `pos_oaa`, `pos_drs`, `pos_uzr`, `pos_frv` | Mean |
| Arm | Process | `catch_pop_time_sec`, `catch_cs_above_avg` | Mean |

No **Result** column. Arm grade may be **null** when catcher arm metrics are missing (UI note: “non-C or no arm stats”).

## UI copy / caveats

- Blurb in UI: batting uses **“20–80 style grades from league percentiles (nearest 5). Prototype weights — see docs/plan.”** Pitching mentions **era-based rows** and pre-2002 vs 2002+ tool rows.
- **Result** column is populated for batting rows; pitching rows use **process-only** columns in the current prototype (`showResultColumn={false}` for pitching).

## Key implementation files

- `apps/web/src/features/scouting-tools/ScoutingToolsPrototype.tsx`
- `apps/web/src/features/scouting-tools/scoutingToolsFromPercentiles.ts`
- `apps/web/src/features/league-percentiles/mergePercentileSlotsForRole.ts`
- `docs/COHORT_PERCENTILES_SPEC.md` (underlying percentile definitions)
