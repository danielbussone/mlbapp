-- Vs-league percentile slider support matrix (SQL + catalog).
-- Run against the mlbapp DB after Flyway (e.g. psql "$DATABASE_URL" -f scripts/analyze-percentile-slider-support.sql).
-- See docs/COHORT_PERCENTILES_SPEC.md and apps/api/src/repos/leaguePercentiles*.ts for qualification rules.

-- ---------------------------------------------------------------------------
-- 1) Required relations: materialized views, views, tables
-- ---------------------------------------------------------------------------
SELECT 'relation_presence' AS report_section,
       n.nspname AS schema,
       c.relname AS name,
       CASE c.relkind
         WHEN 'm' THEN 'materialized_view'
         WHEN 'v' THEN 'view'
         WHEN 'r' THEN 'table'
         ELSE c.relkind::text
       END AS kind,
       CASE WHEN c.oid IS NOT NULL THEN 'present' ELSE 'missing' END AS status
FROM (VALUES
  ('public', 'statcast_batter_season_percentile_mv'),
  ('public', 'statcast_batter_season_savant_bip_mv'),
  ('public', 'statcast_pitcher_season_totals_percentile_mv'),
  ('public', 'statcast_pitcher_season_pitchtype_percentile_mv'),
  ('public', 'statcast_pitcher_season_savant_bip_mv'),
  ('public', 'fg_batting_season_mlb_merged_rates'),
  ('public', 'fg_pitching_season_mlb_consolidated'),
  ('public', 'fg_pitching_season_mlb_merged_stats'),
  ('public', 'fg_fielding_season_current'),
  ('public', 'player_season_sprint_speed')
) AS req(schema_name, relname)
LEFT JOIN pg_namespace n ON n.nspname = req.schema_name
LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = req.relname
ORDER BY req.relname;

-- ---------------------------------------------------------------------------
-- 2) Catalog: metric_id → API card → SQL / runtime source (authoritative with code)
--    support_class: sql_backed | runtime_midrank | not_implemented
-- ---------------------------------------------------------------------------
WITH catalog(metric_id, card_role, support_class, primary_object, notes) AS (
  VALUES
    -- Batting — Statcast batter MV
    ('bip_avg_exit_velo', 'batter', 'sql_backed', 'statcast_batter_season_percentile_mv', 'bbe≥50; pct_bip_avg_exit_velo'),
    ('bip_avg_launch_angle', 'batter', 'sql_backed', 'statcast_batter_season_percentile_mv', 'bbe≥50'),
    ('bip_hard_hit_pct', 'batter', 'sql_backed', 'statcast_batter_season_percentile_mv', 'bbe≥50'),
    ('swing_avg_bat_speed', 'batter', 'sql_backed', 'statcast_batter_season_percentile_mv', 'tracked_swings≥25'),
    ('swing_avg_attack_angle', 'batter', 'sql_backed', 'statcast_batter_season_percentile_mv', 'tracked≥25'),
    ('swing_avg_attack_direction', 'batter', 'sql_backed', 'statcast_batter_season_percentile_mv', 'tracked≥25'),
    ('swing_avg_path_tilt', 'batter', 'sql_backed', 'statcast_batter_season_percentile_mv', 'tracked≥25'),
    ('bat_chase_pct', 'batter', 'sql_backed', 'statcast_batter_season_percentile_mv', 'pitches_seen≥400; cohort_n_bat_chase'),
    ('bat_whiff_pct', 'batter', 'sql_backed', 'statcast_batter_season_percentile_mv', 'swings≥150'),
    -- Batting — Savant BIP MV
    ('bip_barrel_pct', 'batter', 'sql_backed', 'statcast_batter_season_savant_bip_mv', 'bbe≥50'),
    ('bip_sweet_spot_pct', 'batter', 'sql_backed', 'statcast_batter_season_savant_bip_mv', 'bbe≥50'),
    ('bip_avg_estimated_ba', 'batter', 'sql_backed', 'statcast_batter_season_savant_bip_mv', 'bbe_with_est_ba≥50'),
    -- Batting — FG merged view (runtime midrank in TS; cohort from SQL selects)
    ('fg_season_xwoba', 'batter', 'runtime_midrank', 'fg_batting_season_mlb_merged_rates', 'PA≥200 MLB cohort'),
    ('fg_season_k_pct', 'batter', 'runtime_midrank', 'fg_batting_season_mlb_merged_rates', 'PA≥200'),
    ('fg_season_bb_pct', 'batter', 'runtime_midrank', 'fg_batting_season_mlb_merged_rates', 'PA≥200'),
    ('fg_season_avg', 'batter', 'runtime_midrank', 'fg_batting_season_mlb_merged_rates', 'PA≥200'),
    ('fg_season_slg', 'batter', 'runtime_midrank', 'fg_batting_season_mlb_merged_rates', 'PA≥200'),
    -- Running (table + runtime midrank in API)
    ('running_sprint_speed', 'batter', 'runtime_midrank', 'player_season_sprint_speed', 'Optional table; UI hides block if empty'),
    ('running_sprint_speed', 'fielding', 'runtime_midrank', 'player_season_sprint_speed', 'Same as batter when key_mlbam present'),
    -- Pitching — season totals MV
    ('pitch_avg_exit_velo_on_bip', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'bbe≥50'),
    ('pitch_chase_pct', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'pitches≥800'),
    ('pitch_whiff_pct', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'swings≥200'),
    ('pitch_swstr_pct', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'pitches≥800'),
    ('pitch_zone_pct', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'pitches≥800'),
    ('pitch_swing_pct', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'pitches≥800'),
    ('pitch_gb_pct', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'bbe≥50'),
    ('pitch_fb_pct', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'bbe≥50'),
    ('pitch_hr_pct', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'bbe≥50'),
    ('pitch_avg_release_extension', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'pitches_with_extension≥400'),
    ('pitch_ff_avg_velo', 'pitcher', 'sql_backed', 'statcast_pitcher_season_totals_percentile_mv', 'ff_pitches≥75'),
    -- Pitching — Savant BIP MV
    ('pitch_barrel_pct_allowed', 'pitcher', 'sql_backed', 'statcast_pitcher_season_savant_bip_mv', 'bbe≥50'),
    ('pitch_sweet_spot_pct_allowed', 'pitcher', 'sql_backed', 'statcast_pitcher_season_savant_bip_mv', 'bbe≥50'),
    ('pitch_avg_estimated_ba_allowed', 'pitcher', 'sql_backed', 'statcast_pitcher_season_savant_bip_mv', 'bbe_with_est_ba≥50'),
    ('pitch_hard_hit_pct_allowed', 'pitcher', 'sql_backed', 'statcast_pitcher_season_savant_bip_mv', 'bbe≥50'),
    -- Pitching — FG (runtime midrank)
    ('fg_season_pit_xera', 'pitcher', 'runtime_midrank', 'fg_pitching_season_mlb_merged_stats', 'TBF≥150'),
    ('fg_season_pit_k_pct', 'pitcher', 'runtime_midrank', 'fg_pitching_season_mlb_merged_stats', 'TBF≥150'),
    ('fg_season_pit_bb_pct', 'pitcher', 'runtime_midrank', 'fg_pitching_season_mlb_merged_stats', 'TBF≥150'),
    -- Pitch-type block (same metric ids, per pitch_type row)
    ('pitch_avg_velo', 'pitcher_pitch_type', 'sql_backed', 'statcast_pitcher_season_pitchtype_percentile_mv', 'pitches≥250 per type'),
    ('pitch_avg_spin', 'pitcher_pitch_type', 'sql_backed', 'statcast_pitcher_season_pitchtype_percentile_mv', 'pitches≥250'),
    ('pitch_avg_pfx_x', 'pitcher_pitch_type', 'sql_backed', 'statcast_pitcher_season_pitchtype_percentile_mv', 'pitches≥250'),
    ('pitch_avg_pfx_z', 'pitcher_pitch_type', 'sql_backed', 'statcast_pitcher_season_pitchtype_percentile_mv', 'pitches≥250'),
    ('pitch_zone_pct', 'pitcher_pitch_type', 'sql_backed', 'statcast_pitcher_season_pitchtype_percentile_mv', 'pitches≥250'),
    ('pitch_chase_pct', 'pitcher_pitch_type', 'sql_backed', 'statcast_pitcher_season_pitchtype_percentile_mv', 'pitches≥250'),
    ('pitch_whiff_pct', 'pitcher_pitch_type', 'sql_backed', 'statcast_pitcher_season_pitchtype_percentile_mv', 'pitches≥250'),
    ('pitch_swstr_pct', 'pitcher_pitch_type', 'sql_backed', 'statcast_pitcher_season_pitchtype_percentile_mv', 'pitches≥250'),
    ('pitch_gb_pct', 'pitcher_pitch_type', 'sql_backed', 'statcast_pitcher_season_pitchtype_percentile_mv', 'pitches≥250'),
    -- Fielding — FG only (runtime midrank vs inn≥100 cohort)
    ('pos_drs', 'fielding', 'runtime_midrank', 'fg_fielding_season_current', 'player inn≥100 for percentile'),
    ('pos_uzr', 'fielding', 'runtime_midrank', 'fg_fielding_season_current', 'same'),
    ('pos_oaa', 'fielding', 'runtime_midrank', 'fg_fielding_season_current', 'FG-reported OAA'),
    ('pos_frv', 'fielding', 'runtime_midrank', 'fg_fielding_season_current', 'same'),
    ('pos_inn', 'fielding', 'runtime_midrank', 'fg_fielding_season_current', 'innings; no percentile column'),
    -- Not implemented (no SQL cohort in repo; was API-only placeholder — resolve via Savant fielding ingest)
    ('fld_savant_range_oaa', 'fielding', 'not_implemented', '—', 'Hidden from UI until ETL + cohort exist'),
    ('fld_savant_arm_value', 'fielding', 'not_implemented', '—', 'Hidden from UI until ETL + cohort exist'),
    ('fld_savant_arm_strength', 'fielding', 'not_implemented', '—', 'Hidden from UI until ETL + cohort exist')
)
SELECT 'metric_catalog' AS report_section, *
FROM catalog
ORDER BY
  CASE support_class
    WHEN 'not_implemented' THEN 0
    WHEN 'sql_backed' THEN 1
    ELSE 2
  END,
  card_role,
  metric_id;

-- ---------------------------------------------------------------------------
-- 3) Column spot-check: key pct_/val_ columns (pg_catalog via regclass → oid)
--
-- information_schema.columns often omits materialized-view columns.
-- Resolving (schema.relname)::regclass matches how Postgres resolves the object
-- for SELECT; then pg_attribute(attrelid) is reliable (avoids subtle ns/cl join
-- mismatches on some hosts / name typing).
-- ---------------------------------------------------------------------------
WITH need(schema_name, relname, attname) AS (
  VALUES
    ('public', 'statcast_batter_season_percentile_mv', 'pct_bip_avg_exit_velo'),
    ('public', 'statcast_batter_season_percentile_mv', 'val_bat_chase_pct'),
    ('public', 'statcast_batter_season_savant_bip_mv', 'pct_barrel_pct'),
    ('public', 'statcast_pitcher_season_totals_percentile_mv', 'pct_chase_pct'),
    ('public', 'statcast_pitcher_season_totals_percentile_mv', 'val_swstr_pct'),
    ('public', 'statcast_pitcher_season_pitchtype_percentile_mv', 'pct_avg_velo'),
    ('public', 'statcast_pitcher_season_savant_bip_mv', 'pct_avg_estimated_ba_allowed')
),
rel AS (
  SELECT
    n.schema_name,
    n.relname,
    n.attname,
    (quote_ident(n.schema_name) || '.' || quote_ident(n.relname))::regclass::oid AS rel_oid
  FROM need n
)
SELECT 'column_check' AS report_section,
       r.relname AS table_name,
       r.attname AS column_name,
       CASE
         WHEN EXISTS (
           SELECT 1
           FROM pg_attribute a
           WHERE a.attrelid = r.rel_oid
             AND a.attname = r.attname::name
             AND a.attnum > 0
             AND NOT a.attisdropped
         )
         THEN 'present'
         ELSE 'MISSING'
       END AS status
FROM rel r
ORDER BY status DESC, r.relname, r.attname;

-- ---------------------------------------------------------------------------
-- 4) Full user-column inventory for Statcast percentile MVs (pg_attribute order)
--    Confirms live catalog vs Flyway V15/V16/V18 (e.g. batter MV ~26 cols below).
-- ---------------------------------------------------------------------------
SELECT 'mv_columns' AS report_section,
       c.relname::text AS mv_name,
       a.attnum,
       a.attname::text AS column_name
FROM pg_class c
JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind = 'm'
  AND c.relname IN (
    'statcast_batter_season_percentile_mv',
    'statcast_batter_season_savant_bip_mv',
    'statcast_pitcher_season_totals_percentile_mv',
    'statcast_pitcher_season_pitchtype_percentile_mv',
    'statcast_pitcher_season_savant_bip_mv'
  )
ORDER BY c.relname::text, a.attnum;
