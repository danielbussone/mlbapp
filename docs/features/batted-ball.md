# Batted Ball (retrospective PRD)

**Surface:** Player card **Statcast** column, **batting** role — collapsible section **“Batted ball”** (`RailCollapsibleSection` in `PlayerCardPanel`).

## Summary

Show a **compact season summary** of how often the batter put the ball in play (balls in play with tracked exit data) and **season-average launch metrics**: exit velocity and launch angle.

## How it works

1. **Statcast summary:** The card loads `GET /api/players/:playerId/statcast-summary?role=batter&game_year=…` (via `usePlayerCardCoreQueries` / statcast summary hook).
2. **Payload field:** Server attaches **`batted_ball`** when batter aggregates are requested (`statcastBatterBattedBall`).
3. **UI:** Three **MUI Chips**: `BBE` (balls in play count), `EV` (average exit velocity), `LA` (average launch angle).

The Statcast rail only expands when `statcast_available` is true; for batters, **batted-ball row with BBE > 0** is one of the conditions that counts as renderable data (`statcastSummaryHasRenderableData`).

## Data source

| Layer | Detail |
|-------|--------|
| Table | `statcast_pitch` — MLB Statcast pitch/BIP rows ingested via ETL |
| Query | `statcastBatterBattedBall` in `apps/api/src/repos/statcast.ts` |

## Calculations (exact SQL semantics)

For the selected **`game_year`** and **`batter_mlbam`**:

- **`bbe`:** `COUNT(*)` where `launch_speed IS NOT NULL` (treated as a ball-in-play / contact-quality row with EV).
- **`avg_ev`:** `AVG(launch_speed)` over those rows, rounded to **1 decimal**.
- **`avg_la`:** `AVG(launch_angle)` over the same filter, **1 decimal**.

No league comparison in this chip row (league context lives under **League percentiles** for BIP metrics).

## Limitations

- Reflects **Statcast coverage** for that player-season; empty or missing payload if ETL has no rows.
- **Not** spray geometry — that is the **Spray chart** feature (`hc_x` / `hc_y` sample).

## Key implementation files

- `apps/api/src/repos/statcast.ts` — `statcastBatterBattedBall`
- `apps/web/src/features/player-card/PlayerCardPanel.tsx` — Batted ball chips
- `apps/api/src/routes/players.ts` — `statcast-summary` assembly for batters
