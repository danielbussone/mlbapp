# SQL examples (FanGraphs + Chadwick + Statcast validation)

Use **`fg_batting_season_current`** and **`fg_pitching_season_current`** for application queries: one row per FanGraphs grain `(id_fg, season, team, level)` from the **latest** ingest (`ingest_snapshot.pulled_at`). Raw `fg_*` tables keep every load for audit.

See [SCHEMA_PROPOSAL.md](./SCHEMA_PROPOSAL.md) (FanGraphs section) and Flyway [`../db/sql/V3__fg_season_current_views.sql`](../db/sql/V3__fg_season_current_views.sql). Column **`rate_stat_qualified`** (V4) is set at ETL for MLB rows when PA/IP clears the usual rate-stat bar; **`NULL`** means legacy row or non-MLB `level`.

---

## Batting: FG current season line + Chadwick / MLBAM

```sql
SELECT
  b.season,
  b.team,
  b.id_fg,
  b.war,
  b.ingest_pulled_at,
  p.key_mlbam,
  p.name_last,
  p.name_first
FROM fg_batting_season_current b
JOIN player_external_identifier m
  ON m.id_system = 'fangraphs'
 AND m.id_value = b.id_fg::text
JOIN dim_player p
  ON p.player_id = m.player_id
WHERE b.season = 2024
LIMIT 50;
```

---

## Pitching: same pattern

```sql
SELECT
  f.season,
  f.team,
  f.id_fg,
  f.ip,
  f.war,
  f.ingest_pulled_at,
  p.key_mlbam,
  p.name_last,
  p.name_first
FROM fg_pitching_season_current f
JOIN player_external_identifier m
  ON m.id_system = 'fangraphs'
 AND m.id_value = f.id_fg::text
JOIN dim_player p
  ON p.player_id = m.player_id
WHERE f.season = 2024
LIMIT 50;
```

---

## Coverage: FG rows that resolve to `dim_player`

Batting (current view):

```sql
SELECT
  COUNT(*) AS fg_batting_rows,
  COUNT(p.player_id) AS rows_with_dim_player
FROM fg_batting_season_current b
LEFT JOIN player_external_identifier m
  ON m.id_system = 'fangraphs'
 AND m.id_value = b.id_fg::text
LEFT JOIN dim_player p
  ON p.player_id = m.player_id
WHERE b.season = 2024;
```

---

## Batting: qualified seasons only (rate stats comparable to FG leaderboards)

```sql
SELECT b.season, b.team, b.pa, b.war, b.rate_stat_qualified
FROM fg_batting_season_current b
JOIN player_external_identifier m
  ON m.id_system = 'fangraphs' AND m.id_value = b.id_fg::text
JOIN dim_player p ON p.player_id = m.player_id
WHERE p.name_last = 'Trout' AND p.name_first = 'Mike'
ORDER BY b.season DESC, b.team;
```

Filter to “would appear on a qualified leaderboard” lines:

```sql
SELECT *
FROM fg_batting_season_current b
WHERE b.season = 2023
  AND b.rate_stat_qualified IS TRUE;
```

---

## FanGraphs career rollups (V7–V12)

Career views aggregate **`fg_*_season_current`** with **`TOT`-first** season logic; batting **OBP / BB%** follow FanGraphs-style walk and SF handling (see [FG_CAREER_AGGREGATE_VIEWS.md](./FG_CAREER_AGGREGATE_VIEWS.md)).

**Batting career** (slash, `K%` / `BB%` / `HR%` as decimal fractions vs PA):

```sql
SELECT
  c.id_fg,
  c.career_pa,
  c.career_h,
  c.career_ab,
  c.career_hr,
  c.career_war,
  c.career_avg,
  c.career_obp,
  c.career_slg,
  c.career_ops,
  c.career_k_pct,
  c.career_bb_pct,
  c.career_hr_pct,
  c.first_season,
  c.last_season
FROM fg_batting_career_mlb c
JOIN player_external_identifier m
  ON m.id_system = 'fangraphs' AND m.id_value = c.id_fg::text
JOIN dim_player p ON p.player_id = m.player_id
WHERE p.name_last = 'Trout' AND p.name_first = 'Mike';
```

**Pitching career** (`career_era`, innings-weighted `career_fip`, rates vs `TBF`):

```sql
SELECT
  c.id_fg,
  c.career_ip_outs,
  c.career_w,
  c.career_l,
  c.career_sv,
  c.career_war,
  c.career_era,
  c.career_fip,
  c.career_k_pct,
  c.career_bb_pct,
  c.career_hr_pct,
  c.first_season,
  c.last_season
FROM fg_pitching_career_mlb c
JOIN player_external_identifier m
  ON m.id_system = 'fangraphs' AND m.id_value = c.id_fg::text
JOIN dim_player p ON p.player_id = m.player_id
WHERE p.name_last = 'Verlander' AND p.name_first = 'Justin';
```

---

## Optional: FG `player_id` vs Chadwick map (after `pnpm etl:fg -- --link-players`)

```sql
SELECT
  COUNT(*) FILTER (WHERE b.player_id IS NOT NULL) AS fg_has_player_id,
  COUNT(*) FILTER (
    WHERE b.player_id IS NOT NULL
      AND b.player_id = m.player_id
  ) AS matches_chadwick_fangraphs_map
FROM fg_batting_season_current b
LEFT JOIN player_external_identifier m
  ON m.id_system = 'fangraphs'
 AND m.id_value = b.id_fg::text
WHERE b.season = 2024;
```

---

## Raw tables + lineage (audit)

All rows from a specific ingest (replace UUID with a value from `SELECT snapshot_id, source, pulled_at FROM ingest_snapshot ORDER BY pulled_at DESC`):

```sql
SELECT f.*, s.pulled_at, s.params
FROM fg_batting_season f
JOIN ingest_snapshot s ON s.snapshot_id = f.snapshot_id
WHERE f.snapshot_id = '00000000-0000-0000-0000-000000000000'::uuid;
```

List recent FanGraphs loads:

```sql
SELECT snapshot_id, source, pulled_at, row_count
FROM ingest_snapshot
WHERE source IN ('fangraphs_batting', 'fangraphs_pitching')
ORDER BY pulled_at DESC
LIMIT 20;
```

---

## Statcast: validate one ingest (snapshot vs `statcast_pitch`)

Replace the UUID with your run’s `snapshot_id` from the ETL JSON (or copy from `ingest_snapshot`). **`declared_rows`** is `ingest_snapshot.row_count`; **`actual_rows`** counts pitches whose **`snapshot_id`** matches (last writer after upserts). **`delta`** should be **0** for a healthy single run.

```sql
WITH target AS (
  SELECT snapshot_id, source, row_count AS declared_rows, params, pulled_at, notes
  FROM ingest_snapshot
  WHERE snapshot_id = '20f54a31-77a4-4d3a-ba2f-4c6b37e8a740'::uuid
)
SELECT
  t.snapshot_id,
  t.source,
  t.declared_rows,
  c.actual_rows,
  (c.actual_rows - t.declared_rows) AS delta,
  t.pulled_at,
  t.notes,
  t.params
FROM target t
CROSS JOIN LATERAL (
  SELECT COUNT(*)::bigint AS actual_rows
  FROM statcast_pitch p
  WHERE p.snapshot_id = t.snapshot_id
) c;
```

Optional: same snapshot, rows per **`game_year`** (should match the seasons you loaded).

```sql
SELECT p.game_year, COUNT(*) AS pitch_rows
FROM statcast_pitch p
WHERE p.snapshot_id = '20f54a31-77a4-4d3a-ba2f-4c6b37e8a740'::uuid
GROUP BY p.game_year
ORDER BY p.game_year;
```

---

## Statcast: player card–style examples

**How this fits a card:** FanGraphs views (`fg_*_season_current`) supply the **season line** (rate stats, WAR, etc.). `statcast_pitch` supplies **Savant panels**: pitch mix, velocity/movement, batted-ball outcomes, and (from `payload_jsonb`) spray coordinates when present. The API or UI usually fixes **`game_year`** (or a date range) and **`pitcher_mlbam`** or **`batter_mlbam`** from the card’s player. Replace sample IDs / years with your target.

*Owner-checked example:* **`game_year = 2026`**, pitcher **`pitcher_mlbam = 808967`** (Yoshinobu Yamamoto) against a partial-season Statcast load.

**Pitcher — usage and average velo by pitch type** (donut / table on a pitcher card):

```sql
SELECT
  pitch_type,
  COUNT(*) AS pitches,
  ROUND((100.0 * COUNT(*) / SUM(COUNT(*)) OVER ())::numeric, 1) AS pct,
  ROUND(AVG(release_speed)::numeric, 1) AS avg_velo
FROM statcast_pitch
WHERE game_year = 2026
  AND pitcher_mlbam = 808967
  AND pitch_type IS NOT NULL
GROUP BY pitch_type
ORDER BY pitches DESC;
```

**Pitcher — movement scatter** (client draws `pfx_x` / `pfx_z` — Savant **feet**; ×12 for inch rings; polar “clock” in [calculations-and-viz.md](./calculations-and-viz.md)):

```sql
SELECT release_speed, pfx_x, pfx_z, pitch_type, game_date
FROM statcast_pitch
WHERE game_year = 2026
  AND pitcher_mlbam = 808967
  AND pfx_x IS NOT NULL
  AND pfx_z IS NOT NULL
ORDER BY game_date DESC, game_pk, at_bat_number, pitch_number
LIMIT 2000;
```

**Pitcher — movement + arm angle / release point** (for an **arm-angle overlay** on the movement plot; `arm_angle` is degrees when Savant includes it — check `payload_jsonb ? 'arm_angle'` on your data first):

```sql
SELECT
  release_speed,
  pfx_x,
  pfx_z,
  pitch_type,
  CASE
    WHEN payload_jsonb ? 'arm_angle'
    THEN (NULLIF(payload_jsonb->>'arm_angle', ''))::double precision
  END AS arm_angle_deg,
  CASE
    WHEN payload_jsonb ? 'release_pos_x'
    THEN (NULLIF(payload_jsonb->>'release_pos_x', ''))::double precision
  END AS release_pos_x_ft,
  CASE
    WHEN payload_jsonb ? 'release_pos_z'
    THEN (NULLIF(payload_jsonb->>'release_pos_z', ''))::double precision
  END AS release_pos_z_ft
FROM statcast_pitch
WHERE game_year = 2026
  AND pitcher_mlbam = 808967
  AND pfx_x IS NOT NULL
  AND pfx_z IS NOT NULL
ORDER BY game_date DESC, game_pk, at_bat_number, pitch_number
LIMIT 2000;
```

**Batter — quality of contact summary** (typed `launch_speed` / `launch_angle`; filter to rows with a batted ball):

```sql
SELECT
  COUNT(*) FILTER (WHERE launch_speed IS NOT NULL) AS bbe,
  ROUND(AVG(launch_speed)::numeric, 1) AS avg_ev,
  ROUND(AVG(launch_angle)::numeric, 1) AS avg_la
FROM statcast_pitch
WHERE game_year = 2024
  AND batter_mlbam = 660271
  AND launch_speed IS NOT NULL;
```

**Batter — spray chart raw points** (Savant `hc_x` / `hc_y` are usually in **`payload_jsonb`** when present):

```sql
SELECT
  (payload_jsonb->>'hc_x')::double precision AS hc_x,
  (payload_jsonb->>'hc_y')::double precision AS hc_y,
  launch_speed,
  launch_angle,
  events
FROM statcast_pitch
WHERE game_year = 2024
  AND batter_mlbam = 660271
  AND launch_speed IS NOT NULL
  AND payload_jsonb ? 'hc_x'
LIMIT 2000;
```

**Optional name join** (same player row as the rest of the app when `dim_player.key_mlbam` is set):

```sql
SELECT p.name_first, p.name_last, t.pitch_type, COUNT(*) AS n
FROM statcast_pitch t
JOIN dim_player p ON p.key_mlbam = t.pitcher_mlbam
WHERE t.game_year = 2026
  AND t.pitcher_mlbam = 808967
GROUP BY p.name_first, p.name_last, t.pitch_type
ORDER BY n DESC;
```

---

## Statcast: row counts by season (after Statcast ETL loads; see [STATCAST_REQUIREMENTS.md](./STATCAST_REQUIREMENTS.md))

Partition key + card filters often slice on `game_year`.

```sql
SELECT game_year, COUNT(*) AS pitch_rows
FROM statcast_pitch
GROUP BY game_year
ORDER BY game_year;
```

---

## Statcast: primary-key uniqueness spot-check

Should return **no rows** if `(game_year, game_pk, at_bat_number, pitch_number)` is unique.

```sql
SELECT game_year, game_pk, at_bat_number, pitch_number, COUNT(*) AS n
FROM statcast_pitch
GROUP BY 1, 2, 3, 4
HAVING COUNT(*) > 1;
```

---

## Statcast: MLBAM rows missing `dim_player` (coverage / Chadwick prerequisite)

Share of pitches whose **pitcher** MLBAM does not appear in `dim_player.key_mlbam` (run after ingest; lower is better once Chadwick is loaded). Swap `pitcher_mlbam` / `player_id_pitcher` for batter-side checks.

```sql
SELECT
  COUNT(*) AS total_pitches,
  COUNT(*) FILTER (
    WHERE dp.player_id IS NULL
  ) AS rows_pitcher_mlbam_not_in_dim_player
FROM statcast_pitch s
LEFT JOIN dim_player dp ON dp.key_mlbam = s.pitcher_mlbam
WHERE s.game_year = 2024;
```

---

## Statcast: link quality (after ETL `--link-players`)

Pitches where `dim_player` **exists** for the pitcher MLBAM but **`player_id_pitcher` was not set** (ETL link gap). Expect zero when linking succeeded.

```sql
SELECT COUNT(*) AS linkable_but_unlinked_pitcher_rows
FROM statcast_pitch s
JOIN dim_player dp ON dp.key_mlbam = s.pitcher_mlbam
WHERE s.game_year = 2024
  AND s.player_id_pitcher IS NULL;
```

---

## FanGraphs: position field validation (`stats_jsonb`)

**Use case:** Player card bio may show **position** from the full FanGraphs row stored in `stats_jsonb`. The JSON **key name** follows the upstream CSV / pybaseball column set — **confirm** it once:

```sql
SELECT jsonb_object_keys(stats_jsonb) AS k
FROM fg_batting_season_current
WHERE stats_jsonb IS NOT NULL
LIMIT 200;
-- Or inspect one row: SELECT stats_jsonb FROM fg_batting_season_current LIMIT 1;
```

Then replace `'<KEY>'` below (common candidates: `Pos`, `Position`). **Sanity check:** row counts and sample names per position should look like MLB (not thousands of garbage strings).

```sql
-- Sanity: row counts and sample names per extracted position (MLB, one season).
SELECT
  NULLIF(TRIM(b.stats_jsonb->>'<KEY>'), '') AS pos,
  COUNT(*)::bigint AS fg_rows,
  COUNT(DISTINCT b.player_id) AS distinct_players,
  ARRAY_AGG(DISTINCT LEFT(p.name_last || ', ' || p.name_first, 40) ORDER BY LEFT(p.name_last || ', ' || p.name_first, 40))
    FILTER (WHERE p.player_id IS NOT NULL) AS sample_names
FROM fg_batting_season_current b
LEFT JOIN dim_player p ON p.player_id = b.player_id
WHERE b.level = 'MLB' AND b.season = 2024
GROUP BY 1
ORDER BY fg_rows DESC NULLS LAST;
```

See [PLAYER_CARDS_REQUIREMENTS.md](./PLAYER_CARDS_REQUIREMENTS.md) §10.

---

## Statcast: `payload_jsonb` keys (V2 pitch mix / movement overlays)

Typed columns on `statcast_pitch` are limited to the set in [`V2__domain_schema.sql`](../db/sql/V2__domain_schema.sql) and `_TYPED_SAVANT_COLS` in [`etl/mlbapp_etl/statcast.py`](../etl/mlbapp_etl/statcast.py). **All other Savant CSV columns** land in `payload_jsonb` under their **original names**.

**Commonly present (pybaseball Statcast search) — use for extended mix and release overlays:**

| Key | Use |
|-----|-----|
| `zone` | Strike-zone grid (1–9 in-zone; 11–14 chase band); drives zone% / chase% |
| `type` | Pitch result code (`B`, `S`, `X`, …); optional swing inference |
| `description` | Text outcome (`swinging_strike`, `called_strike`, `hit_into_play`, …); whiff% / swing flags |
| `bb_type` | Batted-ball type (`ground_ball`, `fly_ball`, `line_drive`, `popup`, …) when BIP |
| `release_pos_x`, `release_pos_z` | Release position (feet); arm-angle / release plot |
| `release_extension` | Extension (feet) |
| `release_spin_rate`, `spin_axis` | Spin (rpm) and axis |
| `stand`, `p_throws` | Batter / pitcher handedness for cohorts |

**Audit on your database** (key frequency on a recent partition):

```sql
SELECT k, COUNT(*) AS rows_with_key
FROM statcast_pitch s,
     LATERAL jsonb_object_keys(s.payload_jsonb) AS t(k)
WHERE s.game_year = 2024
GROUP BY k
ORDER BY rows_with_key DESC
LIMIT 80;
```

**Refresh league movement MV** (after large Statcast ingest):

```sql
REFRESH MATERIALIZED VIEW statcast_league_pitch_movement_rollup;
```

See materialized view [`V14__statcast_league_movement_fg_fielding_oaa.sql`](../db/sql/V14__statcast_league_movement_fg_fielding_oaa.sql).

---

## Statcast: recent ingest snapshots

Sources are fixed in [STATCAST_REQUIREMENTS.md](./STATCAST_REQUIREMENTS.md) §7.

```sql
SELECT snapshot_id, source, pulled_at, row_count, params
FROM ingest_snapshot
WHERE source IN ('statcast_league', 'statcast_pitcher', 'statcast_batter')
ORDER BY pulled_at DESC
LIMIT 20;
```
