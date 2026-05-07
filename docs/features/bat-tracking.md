# Bat Tracking (retrospective PRD)

**Surface:** Player card **Statcast** column, **batting** role — collapsible **“Bat tracking”** section containing **`BatPathSummary`** plus a link to career bat-tracking trends.

## Summary

Visualize **Hawk-Eye bat tracking** aggregates for the card season: **bat speed**, **attack angle**, **attack direction**, and **swing path tilt**, each versus **league averages** among pitches where bat tracking exists. Graphics are custom SVG-style tiles (`BatPathMiniGraphics`).

## The four graphics

Tiles appear in a 2×2 grid (order below). Each tile shows the **player** value in the main graphic and an **MLB average** (league mean among tracked swings) in the footer or as a reference (dashed line, second needle, etc.).

| Tile | Description |
|------|-------------|
| **Bat Speed** | Semicircular **0–80 mph** speedometer with **non-linear** mapping along the arc, color **zones** on the dial, tick labels, and two **needles**: player bat speed vs league average. |
| **Attack Angle** | **Side-view** diagram: horizontal **0°** reference from the swing pivot, a **wedge** showing the attack-angle sector, a solid arrow for the player and a **dashed** line for the league—how steeply the barrel moves **up or down** through the ball. |
| **Attack Direction** | **Top-down** view (plate and batter’s boxes): the bat aims **toward the plate**; an arrow shows **hit direction** on the pull–oppo spectrum. **L/R stand** from `batter_stand` flips the layout so “pull” stays intuitive for lefties. |
| **Swing Tilt** | **Catcher’s view** with a **silhouette** body (player card), a **0°** reference line, the bat’s **tilt** in the swing plane, and a shaded **wedge** for path tilt. Left-handed batters are **mirrored** so the diagram matches their perspective. |

## How it works

1. **Statcast summary** includes **`bat_path`** when `statcastBatterBatPathSummary` returns data (`GET …/statcast-summary?role=batter`).
2. **`BatPathSummary`** renders a 2×2 grid (stacks to one column below ~400px container width).
3. **League baselines:** Player stats use only that batter’s rows with non-null **`bat_speed`** in JSON; league stats aggregate **all** bat-tracked rows for the season so averages are true league means for the tracked population.
4. **Stand:** **`batter_stand`** is the most common `stand` among that batter’s tracked swings — used to mirror **attack direction** and **swing tilt** visuals for L vs R hitters.
5. **Career link:** Button navigates to `/players/:playerId/trends?to={season}&from={max(2015, season-7)}` for multi-year trends (bat-speed spark and related tooling on the trends page).

## Data source

| Layer | Detail |
|-------|--------|
| Storage | `statcast_pitch.payload_jsonb` keys (Savant CSV-aligned): `bat_speed`, `attack_angle`, `attack_direction`, `swing_path_tilt` (`STATCAST_BAT_TRACKING_JSON_KEYS`) |
| Query | `statcastBatterBatPathSummary` in `apps/api/src/repos/statcast.ts` |

## Calculations

For **`game_year`**:

**League CTE:** All rows with non-null trimmed `bat_speed` in JSON → counts and **AVG** of `bat_speed`, `attack_angle`, `attack_direction`, `swing_path_tilt` (each rounded to **1 decimal** in SQL).

**Player CTE:** Same metrics filtered to **`batter_mlbam`**.

Output includes **`player_tracked_swings`**, **`league_tracked_swings`**, per-metric player vs league averages, and **`batter_stand`** (modal stand).

If **`league_tracked_swings ≤ 0`**, the UI shows a caption that there are no bat-tracking rows for the season (typical pre–wide-tracking eras or missing ETL).

## Coverage notes

- Messaging in UI references **2024+** seasons after ingest as the common case for population-level tracking.
- **`statcast_available`** for batters treats **`player_tracked_swings > 0`** as renderable bat-path content.

## Key implementation files

- `apps/api/src/repos/statcast.ts` — `statcastBatterBatPathSummary`, `statcastSummaryHasRenderableData`
- `apps/web/src/features/batting-path/BatPathSummary.tsx`
- `apps/web/src/features/batting-path/BatPathMiniGraphics.tsx`
