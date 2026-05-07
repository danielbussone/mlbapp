# Pitch Mix (retrospective PRD)

**Surfaces:**

1. **Player card** (pitching role): Collapsible **Pitch mix** section — usage/velo table (`PitchMixVeloTable`), link to **Pitch usage & process rates** supplement page, and optional **PitchMixCareerTrendSpark** when configured.
2. **Supplement page** `/players/:playerId/pitch-mix?season=` — larger **handedness usage plot** (`PitchMixHandednessPlot`) and/or full **velo + L/R table**, plus **`PitchMixRatesTable`** for Statcast process rates.

All data flows from **`GET /api/players/:playerId/statcast-summary?role=pitcher&enhanced=1`** (and timeseries for career spark).

## Summary

Describe **what the pitcher throws**, **how often**, **how hard**, **vs L/R**, **velocity distribution**, and **process outcomes** (zone%, chase%, whiff%, etc.) — derived from **`statcast_pitch`** for the card season.

## How it works (card)

1. **Basic mix:** `mix` — per **`pitch_type`**: pitch count, **`pct`** of all pitches, **`avg_velo`** (`statcastPitcherPitchMix`).
2. **Extended mix:** `mix_extended` — adds **zone_pct**, **chase_pct**, **swing_pct**, **whiff_pct**, **swstr_pct**, **gb_pct**, **fb_pct**, **hr_pct** with explicit denominators (see SQL comments in `statcastPitcherPitchMixExtended`).
3. **Platoon split:** `mix_extended_by_stand` — same rates partitioned by **`batter_stand`** (L/R); **`pct`** is within-hand usage.
4. **Velocity:** `velo_dist` — 1 mph bins per pitch type (`statcastPitcherVeloHistogram`).
5. **League velo column:** `league_avg_velo_by_pitch` — league average release speed by pitch type for the year.
6. **UI filtering:** Pitch types below **1%** usage (`PITCH_CARD_MIN_USAGE_PCT`) are dropped from card tables unless that would empty the set — then originals are kept.

## Calculations (extended mix — definitions in repo)

From `statcastPitcherPitchMixExtended` header comment:

- **zone_pct / chase_pct:** Built from known **`payload_jsonb.zone`** (1–14); in-zone vs chase logic as implemented in SQL.
- **whiff_pct:** swinging strikes ÷ **swings** on pitch type (fouls count as swings).
- **swstr_pct:** swinging strikes ÷ **all pitches** of that type.
- **swing_pct:** swings ÷ all pitches of type.
- **gb_pct / fb_pct:** Among **BIP** (`launch_speed` present); GB/FB use **`bb_type`** when present else launch-angle heuristics (≤10° GB, ≥25° FB fly/pop).
- **hr_pct:** HR among BIP (`events` LIKE `%home_run%`).

## Data source

| Layer | Detail |
|-------|--------|
| Table | `statcast_pitch` |
| Pitcher handedness for paired visuals | `pitcher_throws` from dominant `payload_jsonb.p_throws` |

## Supplement page behavior

- Fetches **`statcast-summary`** with optional higher **`limit`** for sample-backed charts if needed.
- **`MIN_USAGE_PCT = 1`** filters pitch types for some views.
- **Career trends:** `useStatcastTimeseriesQuery` with **`metric=pitch_mix`** plots usage % over seasons (`PitchMixCareerTrendSpark`).

## Key implementation files

- `apps/api/src/repos/statcast.ts` — `statcastPitcherPitchMix`, `statcastPitcherPitchMixExtended`, `statcastPitcherPitchMixExtendedByBatterStand`, `statcastPitcherVeloHistogram`, `statcastLeagueAvgVeloByPitchType`
- `apps/web/src/features/pitch-mix/PitchMixVeloTable.tsx`
- `apps/web/src/features/pitch-mix/PitchMixRatesTable.tsx`
- `apps/web/src/pages/PlayerPitchMixSupplementPage.tsx`
- `apps/web/src/features/player-card/PlayerCardPanel.tsx` — wiring and filters
