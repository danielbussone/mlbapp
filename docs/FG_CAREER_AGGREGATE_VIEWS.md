# FanGraphs career aggregate views — requirements

**Status:** Flyway **`V7`–`V10`**: career views + rate stats; **`V9`** fixes walk double-count for **BB%**; **`V10`** matches FanGraphs **OBP** (sacrifice flies in denominator only); **`V12`** adds **`career_h`** / **`career_ab`** to **`fg_batting_career_mlb`**; **`V13`** replaces **`fg_*_season_mlb_consolidated`** with **materialized views** (unique `(id_fg, season)` for `REFRESH CONCURRENTLY`); **`pnpm etl:fg`** refreshes them after each successful load unless `--skip-consolidated-mview-refresh`. **Scope:** MLB (`level = 'MLB'`) only; keyed by **`id_fg`** (join to `dim_player` via `player_external_identifier` where `id_system = 'fangraphs'`).

## Goals

1. **One row per player–career** (batting and pitching separately) for chat, compare tools, and player UI without shipping full season grids.
2. **Correct counting totals** across seasons where FanGraphs uses **`TOT`** for multi-team years.
3. **Career rate stats** from summed counting components (not averages of season rates), aligned with common leaderboard math.

## Season consolidation (`TOT` vs splits)

- Per `(id_fg, season, level)` on **`fg_batting_season_current`** / **`fg_pitching_season_current`**:
  - If **any** row has `team = 'TOT'`, **only** that row contributes to that season’s totals.
  - If **no** `TOT` row exists, **sum** numeric counting stats across team rows for that season (partial multi-team seasons).
- **Rationale:** Matches the product rule in [DATASETS.md](./DATASETS.md) (prefer `TOT` when present) and avoids double-counting when `TOT` exists.

## SQL helper

- **`mlb_ip_display_to_outs(ip double precision) → integer`:** converts FanGraphs display IP (`.1` / `.2` = thirds) to **outs**, matching `etl/mlbapp_etl/fg_qualify.ip_stat_to_outs`.

## Supporting views (`*_season_mlb_consolidated`)

- One logical row per **`(id_fg, season)`** after `TOT`/split rules.
- **Batting:** sums `H`, `AB`, `BB`, `IBB`, `HBP`, `SF`, `SH`, `SO`, `TB` from **`stats_jsonb`** (TB falls back to `1B + 2*2B + 3*3B + 4*HR` using typed `hr` when `TB` is absent).
- **Pitching:** sums `ER`, `SO`, `BB`, `IBB`, `HR`, `TBF` from **`stats_jsonb`**; sums **IP outs** via `mlb_ip_display_to_outs(ip)` from typed **`ip`**. Season-level **`era`**, **`fip_innings_weighted`**, **`k_pct`**, **`bb_pct`**, **`hr_pct`** are computed on that consolidated row.

## Career batting (`fg_batting_career_mlb`)

- **Grain:** one row per `id_fg`.
- **Counting sums:** `career_pa`, **`career_h`**, **`career_ab`** (same Σ H / Σ AB used for `career_avg` / OBP), `career_hr`, `career_r`, `career_rbi`, `career_sb`, `career_war`, `career_off_runs`, `career_def_runs`, `career_bsr`, `career_games`.
- **`career_games` caveat:** Summing `games` across split rows in a **no-`TOT`** season can overstate games played; rare when `TOT` is missing.
- **Rates (decimal fractions where noted):**
  - **`career_avg`** = `SUM(H) / SUM(AB)`.
  - **Walks for OBP / BB% (V9):** per season–line, **`walks_bb_pct_pa = Σ (bb_pct × PA)`** on the merged rows (typed `bb_pct` is FanGraphs’ BB% denominator). Fallback when `bb_pct` is null: **`stats_jsonb->>'BB'` only** (do **not** add `IBB` there — the leaders JSON `BB` often already includes intentional walks while `IBB` is still present, so **`BB + IBB` double-counts**).
  - **`career_obp`** = `(H + walks + HBP) / (AB + walks + HBP + SF + SH)` with **`walks = Σ walks_bb_pct_pa`** (**SF only in the denominator**, matching FanGraphs’ published career OBP for cross-checks like Trout).
  - **`career_slg`** = `SUM(TB) / SUM(AB)`.
  - **`career_ops`** = `career_obp + career_slg`.
  - **`career_k_pct`** = `SUM(SO) / career_pa` (same scale as stored FG `K%`: 0–1).
  - **`career_bb_pct`** = **`(Σ walks_bb_pct_pa) / career_pa`** (matches FG career BB% when `bb_pct` is populated).
  - **`career_hr_pct`** = `career_hr / career_pa`.
- **Also:** `career_wrc_plus_pa_weighted`, `career_woba_pa_weighted`, `career_xwoba_pa_weighted` (PA-weighted across seasons from consolidated numerators/denominators).
- **Nulls:** If required JSONB keys are missing for a player, corresponding sums/rates may be **NULL**.

## Career pitching (`fg_pitching_career_mlb`)

- **Counting sums:** `career_w`, `career_l`, `career_sv`, `career_war`, `career_games`, `career_games_started`, **`career_ip_outs`**, `career_er`, `career_so`, `career_bb`, `career_ibb`, `career_hr`, `career_tbf`.
- **`career_era`** = `27 * SUM(ER) / SUM(ip_outs)` (= **9 × ER / innings** with innings = outs/3).
- **`career_fip`** = **innings-weighted mean of season typed `fip`**: `SUM(season_fip × season_innings) / SUM(season_innings)` where `season_innings = ip_outs/3` on the consolidated season row. This is **not** the same as recomputing FIP from career totals with a league-specific constant; it matches “what you'd get by weighting FG’s season FIPs by innings.”
- **Rates (vs `SUM(TBF)`):**
  - **`career_k_pct`** = `SUM(SO) / career_tbf`
  - **`career_bb_pct`** = `(BB + IBB) / career_tbf`
  - **`career_hr_pct`** = `SUM(HR) / career_tbf`
- **No display `career_ip`:** use `career_ip_outs / 3.0` in the app if you need decimal innings (still not perfect string display of `.1`/`.2` without formatting).

## Metadata

- **`first_season`**, **`last_season`**, **`seasons_count`**, **`seasons_rate_stat_qualified`**, **`latest_ingest_pulled_at`**, **`player_id`** (`MAX` across seasons).

## Out of scope (later)

- Non-MLB levels, league-specific (`AL`/`NL`) slices.
- Statcast career rollups.
- FIP recomputed from raw `cFIP` / league constants per era.
- Materialized views + indexes for very large dashboards.

## References

- [CHAT_COMPARE_TOOL_CRITIQUE_AND_REQUIREMENTS.md](./CHAT_COMPARE_TOOL_CRITIQUE_AND_REQUIREMENTS.md) — R1 career rollup shape.
- [sql-examples.md](./sql-examples.md) — example queries.
