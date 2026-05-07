# Batted Ball (retrospective PRD)

**Surface:** Player card **Statcast** column, **batting** role — collapsible section **“Batted ball”** (`RailCollapsibleSection` in `PlayerCardPanel`).

## Summary

Show a **compact season summary** of how often the batter put the ball in play (tracked exit velocity), **season-average launch metrics** (EV/LA), and an **EV×LA polar chart** with **Tango Tiger** contact buckets (barrel, solid, flare/burner, topped, hit under, weak) plus **bucket percentages**.

## How it works

1. **Statcast summary:** The card loads `GET /api/players/:playerId/statcast-summary?role=batter&game_year=…` (via `usePlayerCardCoreQueries` / statcast summary hook).
2. **Payload field:** Server attaches **`batted_ball`** when batter aggregates are requested (`statcastBatterBattedBall`).
3. **UI:** Three **MUI Chips** (`BBE`, `EV`, `LA`) plus **`BattedBallContactChart`** when `bbe_classified > 0` (see payload).

The Statcast rail only expands when `statcast_available` is true; for batters, **batted-ball row with BBE > 0** is one of the conditions that counts as renderable data (`statcastSummaryHasRenderableData`).

## Data source

| Layer | Detail |
|-------|--------|
| Table | `statcast_pitch` — MLB Statcast pitch/BIP rows ingested via ETL |
| Query | `statcastBatterBattedBall` in `apps/api/src/repos/statcast.ts` |

## Calculations

### Chip row (unchanged aggregates)

For the selected **`game_year`** and **`batter_mlbam`**:

- **`bbe`:** `COUNT(*)` where `launch_speed IS NOT NULL` (BBE with measured EV — same as before).
- **`avg_ev`:** `AVG(launch_speed)` over those rows, rounded to **1 decimal**.
- **`avg_la`:** `AVG(launch_angle)` over the same filter, **1 decimal** (null LA excluded from the average by SQL).

### Contact-quality overlay (Tango Tiger)

Classification uses **`speedAngleCode`** in `@mlbapp/shared`, implementing the **SpeedAngle_Code** CASE order published by Tango Tiger (Barrel → Solid → Weak → Flare/Burner variants → Hit under → Topped). Implementation matches that ordering **exactly** — see [`packages/shared/src/speedAngleCode.ts`](../../packages/shared/src/speedAngleCode.ts).

**Population:**

- **`bbe_classified`:** Count of rows where **`launch_speed IS NOT NULL` AND `launch_angle IS NOT NULL`**. All bucket counts and percentages use this denominator (not `bbe`, since rare rows can have EV without LA).
- **`contact_quality.denominator`:** Same integer as `bbe_classified`.
- **`contact_quality.buckets[]`:** Per-code **count**, **pct** (one decimal), and **`league_percentile`** (0–100, `PERCENT_RANK` style vs same-season qualified hitters with **50+** classified EV+LA BBE) when aggregate **bbe** ≥ 50. Barrel/solid/flare: higher bucket % → higher percentile. Hit under/topped/weak: lower bucket % → higher percentile. Unclassified uses ascending order.
- **`contact_points[]`:** `{ ev, la, code }` for plotting (subsampled to **8000** rows when needed; bucket math uses the **full** classified set before subsampling).
- **`contact_truncated`:** `true` when the EV/LA fetch hits the **50_000** row safety cap (extremely rare); percentages then reflect loaded rows only.

### Distinction from league percentiles (`bip_barrel_pct`)

Materialized Savant BIP metrics (e.g. [`db/sql/V16__statcast_savant_bip_sprint.sql`](../../db/sql/V16__statcast_savant_bip_sprint.sql)) may use **`payload_jsonb`** barrel flags or alternate definitions. **This chart uses Tango Tiger rules only** — do not assume parity with **`bip_barrel_pct`** on the league percentiles panel.

## Limitations

- Reflects **Statcast coverage** for that player-season; empty or missing payload if ETL has no rows.
- **Not** spray geometry — that is the **Spray chart** feature (`hc_x` / `hc_y` sample). Spray rows are a **different** row filter than EV×LA classification.

## Key implementation files

- `packages/shared/src/speedAngleCode.ts` — classifier + display colors
- `apps/api/src/repos/statcast.ts` — `statcastBatterBattedBall`
- `apps/web/src/features/batted-ball/BattedBallContactChart.tsx` — polar zones + scatter + legend
- `apps/web/src/features/player-card/PlayerCardPanel.tsx` — Batted ball section
- `apps/api/src/routes/players.ts` — `statcast-summary` assembly for batters
