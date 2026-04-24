# Player cards V2 (Enhanced)

This document summarizes **HTTP APIs** and **UI** shipped for V2 comparison surfaces, extended Statcast pitch analytics, season trends, fielding, and optional OAA grid data.

## REST (Fastify; browser uses `/api` prefix via Vite proxy)

| Endpoint | Purpose |
|----------|---------|
| `GET /players/compare/fg-career?player_ids=1,2` | FanGraphs **career** aggregates for 2–4 players (`compareFgCareer`). |
| `GET /players/compare/statcast-summary?player_ids=1,2&role=pitcher\|batter&game_year=2024&enhanced=1` | Side-by-side Statcast summaries (`compareStatcastSummary`). |
| `GET /players/:id/statcast-timeseries?role=batter&metric=bat_path&from=2020&to=2024` | Yearly bat-path aggregates. `metric=pitch_mix` + `role=pitcher` returns `statcastPitcherMixByYearRange`. |
| `GET /players/:id/fg-fielding?season=2024` | FanGraphs fielding rows from `fg_fielding_season_current` (requires V14 + ETL). |
| `GET /players/:id/fielding-oaa?game_year=2024` | Reads `savant_fielding_oaa_cell` (optional ingest). |
| `GET /players/:id/statcast-summary` | Extended with `mix_extended`, `velo_dist`, `league_movement` when `enhanced=1` (default) and no single `panel` filter. |

For `role=pitcher`, responses may include **`pitcher_throws`** (`'L'` or `'R'`, else omitted), from the dominant `payload_jsonb->>'p_throws'` among that pitcher’s rows. When present, **`league_movement`** is averaged over the **same** `p_throws` cohort so hollow league markers align with the pitcher’s dots (Statcast `pfx_x` stays in the catcher frame; the chart always uses horizontal **−pfx_x**).

## Materialized view

- `statcast_league_pitch_movement_rollup` — refresh after large Statcast loads:  
  `REFRESH MATERIALIZED VIEW statcast_league_pitch_movement_rollup;`  
  See [sql-examples.md](./sql-examples.md).

## FanGraphs fielding ETL

```bash
pnpm etl:fg --start-season 2024 --end-season 2024 --fielding-only --link-players
```

Uses FanGraphs JSON leaders API with `stats=fld` (`mlbapp_etl/fg_api.py`).

## OAA heat map grid

`savant_fielding_oaa_cell` is an **empty placeholder** until an approved **Savant/MLB** (or licensed) export is ingested. Compliance: [DATASETS.md](./DATASETS.md).

## Chat tools

Ollama may call `statcast_compare_statcast_summary` (name queries + `game_year` + optional `role`).

## Web routes

- `/compare/career?player_ids=a,b`
- `/compare/statcast?player_ids=a,b&role=pitcher&game_year=2024`

Chat phrases such as “Compare X and Y” open the **compare sidebar**; Statcast-oriented wording sets `mode=statcast`.
