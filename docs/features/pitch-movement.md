# Pitch Movement (retrospective PRD)

**Surface:** Player card **Statcast** column, **pitching** role — collapsible **“Pitch movement”** — **`MovementMiniPlot`** (batting role uses the same component with batter sample for comparison contexts where wired).

## Summary

**2D induced movement plot** per pitch: Statcast **`pfx_x`** / **`pfx_z`** (feet in DB) converted to **inches** on a symmetric **±24 inch** Savant-style window. Player pitches render as **colored dots** by pitch type; **league-average** hollow markers overlay **per pitch type**. Optional **arm-angle wedge** shows release-plane direction for context.

## How it works

1. **Sample:** `statcast.sample` from **`statcast-summary?role=pitcher`** — up to **2000** pitches (`MAX_SAMPLE_PITCHER`) with non-null **`pfx_x`** and **`pfx_z`** (ordered recent-first).
2. **Pitch-type filter:** For pitchers, dots may be filtered to pitch types with **≥ 1%** usage (`pitchTypesAtLeastPctFromStatcast`) so overlays stay readable.
3. **Horizontal axis:** Plot uses **−pfx_x** in inches (pitcher-perspective convention documented in `MovementMiniPlot.tsx`).
4. **League overlay:** `league_movement` from API — either from **`statcast_league_pitch_movement_rollup`** (all pitchers) or **hand-split** live aggregate when **`pitcher_throws`** is L/R (`statcastLeagueMovementByYear`). Hand-split keeps hollow markers aligned with **same catcher-frame** semantics as the pitcher’s dots.
5. **Arm overlay:** `computeArmOverlay` in `PlayerCardPanel`:
   - Prefer mean **`arm_angle`** from payload when **≥ 8** pitches have **non-zero** arm_angle (many pre-2020 rows store 0).
   - Else **OLS-style regression** on **`release_pos_x`** / **`release_pos_z`** (feet): documented coefficients; clip **[0°, 95°]**.
   - **Left-handed pitchers:** mirror with **`180° − θ`** for display consistency.

## Data sources

| Layer | Detail |
|-------|--------|
| Player sample | `statcast_pitch` columns `pfx_x`, `pfx_z`; JSON `arm_angle`, `release_pos_x`, `release_pos_z`, … |
| League rollup | MV `statcast_league_pitch_movement_rollup` (**refresh** after bulk loads) or filtered AVG by `game_year`, `pitch_type`, `p_throws` |

## Stats used

- **Movement:** `pfx_x`, `pfx_z` (feet → ×12 for inch plot).
- **League reference:** `avg_pfx_x_ft`, `avg_pfx_z_ft` per pitch type (+ optional std dev in rollup payload).
- **Arm visualization:** `arm_angle` or regression from release positions.

## Limitations

- Documented in **`docs/PLAYER_CARDS_V2.md`**: extreme submarine slots **before 2020** may mislead when **`arm_angle`** is missing and regression is used.

## Key implementation files

- `apps/web/src/features/movement-velo/MovementMiniPlot.tsx`
- `apps/web/src/features/player-card/PlayerCardPanel.tsx` — `computeArmOverlay`, `leagueMovementFromPayload`, sample filtering
- `apps/api/src/repos/statcast.ts` — `statcastSampleRows` (pitcher branch), `statcastLeagueMovementByYear`, `statcastPitcherThrowsHand`
- `db/sql/V14__statcast_league_movement_fg_fielding_oaa.sql` — league movement MV
- `docs/calculations-and-viz.md` — movement units and conventions
