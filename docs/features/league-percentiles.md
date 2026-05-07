# League Percentiles (retrospective PRD)

**Surface:** Player card **“Vs league”** rail — **`LeaguePercentilesPanel`** — for **batting**, **pitching**, or **fielding** card roles (collapsible sections with **sliders** showing cohort percentile and raw value).

## Summary

Show **where the player sits vs qualified MLB peers** for a long list of **process and outcome** metrics. Each metric is a **`PercentileSlot`**: raw percentile **`p`**, sample size **`n`**, **qualified** flag, **value**, and **`direction`** (`higher_better` | `lower_better`). The UI displays a **goodness-oriented** percentile for sliders (flips lower-is-better stats) and colorizes thumbs (`percentileGoodnessColor.ts`).

Authoritative definitions and cohort versions live in **`docs/COHORT_PERCENTILES_SPEC.md`** (`cohort_spec_version`, currently **2026.21** in that file).

## How it works

1. **Request:** `GET /api/players/:playerId/league-percentiles?game_year=&role=batter|pitcher|fielding` (+ optional fielding `position` / min innings as implemented in route).
2. **Server:** `apps/api/src/repos/leaguePercentiles.ts` composes Statcast percentile materialized views, FanGraphs merged season stats, sprint speed, fielding aggregates, pitch-type breakdowns, etc.
3. **Panel layout (batting example):** Collapsible **Value** (Off, BsR, Def, bat WAR), **Expected stats** (xwOBA, xBA on contact), main metric order (avg/SLG/ISO/wOBA/wRC+, exit velo, barrels, discipline, launch angle…), **Bat path** (tracked swing means), **Running** (sprint speed). Sections hide when empty.
4. **Pitching:** Similar structure — WAR (FIP/RA9), expected (xERA, xFIP, xBA allowed), long Statcast + FG order, optional **`by_pitch_type`** rows (collapsed by default).
5. **Fielding:** Position-grouped percentiles; **`fielding_percentile_groups`** when present (season total vs per-position blocks).

## Data sources (high level)

| Source | Use |
|--------|-----|
| **`statcast_pitch`** (+ JSON keys) | Season aggregates, pitch-type grain, BIP-quality metrics, chase/whiff, bat-path MVs |
| **Materialized views** | Precomputed percentile cohorts (refresh after bulk loads — see `sql-examples.md`, `pnpm db:refresh-percentiles`) |
| **FanGraphs** (ETL → DB) | Season batting/pitching/fielding rates, WAR, +metrics, many FG-published columns |
| **`player_season_sprint_speed`** | Sprint speed percentiles |
| **Fielding** | FG defensive runs components vs cohorts; OAA from FG fielding row where published |

Percentiles are **empirical percent_rank** for large Statcast cohorts or **midrank** for smaller FG cohorts — see spec doc.

## Example metric IDs (non-exhaustive)

**Batting:** `fg_season_wrc_plus`, `bip_barrel_pct`, `bat_chase_pct`, `swing_avg_bat_speed`, …  
**Pitching:** `pitch_whiff_pct`, `fg_season_pit_era`, `pitch_barrel_pct_allowed`, `pitch_ff_avg_velo`, FG +metrics, …  
**Fielding:** `pos_oaa`, `pos_drs`, `pos_uzr`, `pos_frv`, `pos_inn`, …

Full tables: **`COHORT_PERCENTILES_SPEC.md`**.

## Key implementation files

- `apps/api/src/routes/players.ts` — `/players/:playerId/league-percentiles`
- `apps/api/src/repos/leaguePercentiles.ts`
- `apps/web/src/features/league-percentiles/LeaguePercentilesPanel.tsx`
- `apps/web/src/api/playerQueries.ts` — `useLeaguePercentilesQuery`
- `docs/COHORT_PERCENTILES_SPEC.md`

## Relationship to Scouting Report

**Scouting Tools** reuses the **same percentile API** and transforms slots into 20–80 grades (`docs/features/scouting-report.md`).
