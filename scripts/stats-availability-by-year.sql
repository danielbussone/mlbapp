-- Stats / percentile inputs available by MLB season (game_year or season).
-- Use for era-aware scouting (which tools have Statcast vs FG-only vs absent).
-- Run: psql "$DATABASE_URL" -f scripts/stats-availability-by-year.sql
--
-- Interpreting columns:
--   statcast_pitch_*     Raw pitch table coverage (not cohort-qualified).
--   bat_mv_* / pit_mv_*  Share of player-seasons in percentile MVs with a non-null
--                        percentile for that metric (after MV gates like bbe≥50).
--   *_cohort_n_*        League cohort size baked into MV for that year (max across rows).
--   fg_*               Row counts on merged FG views (any PA/TBF row with player_id).

WITH y AS (
  SELECT game_year::int AS yr
  FROM statcast_pitch
  UNION
  SELECT season::int FROM fg_batting_season_mlb_merged_rates
  UNION
  SELECT season::int FROM fg_pitching_season_mlb_merged_stats
  UNION
  SELECT game_year::int FROM player_season_sprint_speed
),
pitch_raw AS (
  SELECT
    s.game_year::int AS yr,
    COUNT(*)::bigint AS pitches,
    ROUND(100.0 * COUNT(*) FILTER (WHERE s.launch_speed IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_pitch_rows_with_exit_velo,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE NULLIF(TRIM(s.payload_jsonb ->> 'zone'), '') IS NOT NULL) / NULLIF(COUNT(*), 0),
      1
    ) AS pct_pitch_rows_with_zone,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE NULLIF(TRIM(s.payload_jsonb ->> 'estimated_ba_using_speedangle'), '') IS NOT NULL)
        / NULLIF(COUNT(*) FILTER (WHERE s.launch_speed IS NOT NULL), 0),
      1
    ) AS pct_bip_rows_with_estimated_ba,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE NULLIF(TRIM(s.payload_jsonb ->> 'bat_speed'), '') IS NOT NULL) / NULLIF(COUNT(*), 0),
      1
    ) AS pct_pitch_rows_with_bat_speed_json,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE NULLIF(TRIM(s.payload_jsonb ->> 'release_extension'), '') IS NOT NULL) / NULLIF(COUNT(*), 0),
      1
    ) AS pct_pitch_rows_with_release_extension
  FROM statcast_pitch s
  GROUP BY s.game_year
),
bat_mv AS (
  SELECT
    m.game_year::int AS yr,
    COUNT(*)::bigint AS batter_season_rows,
    ROUND(100.0 * COUNT(*) FILTER (WHERE m.pct_bip_avg_exit_velo IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_bip_avg_exit_velo,
    ROUND(100.0 * COUNT(*) FILTER (WHERE m.pct_bip_ev90 IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_bip_ev90,
    ROUND(100.0 * COUNT(*) FILTER (WHERE m.pct_bat_chase_pct IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_bat_chase,
    ROUND(100.0 * COUNT(*) FILTER (WHERE m.pct_bat_whiff_pct IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_bat_whiff,
    ROUND(100.0 * COUNT(*) FILTER (WHERE m.pct_swing_avg_bat_speed IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_bat_track_speed,
    MAX(m.cohort_n_bip)::bigint AS cohort_n_bip_qualified,
    MAX(m.cohort_n_bat_chase)::bigint AS cohort_n_bat_chase_qualified,
    MAX(m.cohort_n_bat_whiff)::bigint AS cohort_n_bat_whiff_qualified,
    MAX(m.cohort_n_bat_track)::bigint AS cohort_n_bat_track_qualified
  FROM statcast_batter_season_percentile_mv m
  GROUP BY m.game_year
),
bat_bip AS (
  SELECT
    b.game_year::int AS yr,
    COUNT(*)::bigint AS batter_bip_mv_rows,
    ROUND(100.0 * COUNT(*) FILTER (WHERE b.pct_barrel_pct IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_barrel,
    ROUND(100.0 * COUNT(*) FILTER (WHERE b.pct_avg_estimated_ba IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_estimated_ba,
    MAX(b.cohort_n_bip)::bigint AS savant_bip_cohort_n,
    MAX(b.cohort_n_est_ba)::bigint AS savant_est_ba_cohort_n
  FROM statcast_batter_season_savant_bip_mv b
  GROUP BY b.game_year
),
pit_mv AS (
  SELECT
    p.game_year::int AS yr,
    COUNT(*)::bigint AS pitcher_season_rows,
    ROUND(100.0 * COUNT(*) FILTER (WHERE p.pct_avg_exit_velo_on_bip IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_ev_on_bip,
    ROUND(100.0 * COUNT(*) FILTER (WHERE p.pct_chase_pct IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_pitch_chase,
    ROUND(100.0 * COUNT(*) FILTER (WHERE p.pct_whiff_pct IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_pitch_whiff,
    ROUND(100.0 * COUNT(*) FILTER (WHERE p.pct_zone_pct IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_zone,
    ROUND(100.0 * COUNT(*) FILTER (WHERE p.pct_ff_avg_velo IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_ff_velo,
    ROUND(100.0 * COUNT(*) FILTER (WHERE p.pct_avg_release_extension IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_release_extension,
    MAX(p.cohort_n_pitch_process)::bigint AS cohort_n_pitch_ge_800,
    MAX(p.cohort_n_bip)::bigint AS pit_cohort_n_bip_ge_50,
    MAX(p.cohort_n_swings_whiff)::bigint AS pit_cohort_n_swings_ge_200
  FROM statcast_pitcher_season_totals_percentile_mv p
  GROUP BY p.game_year
),
pit_bip AS (
  SELECT
    p.game_year::int AS yr,
    COUNT(*)::bigint AS pitcher_bip_mv_rows,
    ROUND(100.0 * COUNT(*) FILTER (WHERE p.pct_barrel_pct_allowed IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_barrel_allowed,
    ROUND(100.0 * COUNT(*) FILTER (WHERE p.pct_avg_estimated_ba_allowed IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_rows_pct_estimated_ba_allowed
  FROM statcast_pitcher_season_savant_bip_mv p
  GROUP BY p.game_year
),
pit_pt AS (
  SELECT p.game_year::int AS yr, COUNT(*)::bigint AS pitcher_pitchtype_mv_rows
  FROM statcast_pitcher_season_pitchtype_percentile_mv p
  GROUP BY p.game_year
),
fg_bat AS (
  SELECT
    r.season::int AS yr,
    COUNT(*)::bigint AS fg_batting_rows,
    COUNT(*) FILTER (WHERE r.pa >= 200)::bigint AS fg_batting_rows_pa_ge_200,
    COUNT(*) FILTER (WHERE r.xwoba_pa_weighted IS NOT NULL)::bigint AS fg_rows_with_xwoba
  FROM fg_batting_season_mlb_merged_rates r
  GROUP BY r.season
),
fg_pit AS (
  SELECT
    f.season::int AS yr,
    COUNT(*)::bigint AS fg_pitching_rows,
    COUNT(*) FILTER (WHERE f.tbf >= 1)::bigint AS fg_pitching_rows_with_tbf,
    COUNT(*) FILTER (WHERE f.xera IS NOT NULL)::bigint AS fg_rows_with_xera,
    COUNT(*) FILTER (WHERE f.xfip IS NOT NULL)::bigint AS fg_rows_with_xfip
  FROM fg_pitching_season_mlb_merged_stats f
  GROUP BY f.season
),
sprint AS (
  SELECT sp.game_year::int AS yr, COUNT(*)::bigint AS sprint_speed_player_seasons
  FROM player_season_sprint_speed sp
  GROUP BY sp.game_year
)
SELECT
  y.yr AS season,
  pr.pitches AS statcast_pitches,
  pr.pct_pitch_rows_with_exit_velo,
  pr.pct_pitch_rows_with_zone,
  pr.pct_bip_rows_with_estimated_ba,
  pr.pct_pitch_rows_with_bat_speed_json,
  pr.pct_pitch_rows_with_release_extension,
  bm.batter_season_rows,
  bm.pct_rows_pct_bip_avg_exit_velo,
  bm.pct_rows_pct_bip_ev90,
  bm.pct_rows_pct_bat_chase,
  bm.pct_rows_pct_bat_whiff,
  bm.pct_rows_pct_bat_track_speed,
  bm.cohort_n_bip_qualified,
  bm.cohort_n_bat_chase_qualified,
  bm.cohort_n_bat_whiff_qualified,
  bm.cohort_n_bat_track_qualified,
  bb.batter_bip_mv_rows,
  bb.pct_rows_pct_barrel,
  bb.pct_rows_pct_estimated_ba,
  bb.savant_bip_cohort_n,
  bb.savant_est_ba_cohort_n,
  pm.pitcher_season_rows,
  pm.pct_rows_pct_ev_on_bip,
  pm.pct_rows_pct_pitch_chase,
  pm.pct_rows_pct_pitch_whiff,
  pm.pct_rows_pct_zone,
  pm.pct_rows_pct_ff_velo,
  pm.pct_rows_pct_release_extension,
  pm.cohort_n_pitch_ge_800,
  pm.pit_cohort_n_bip_ge_50,
  pm.pit_cohort_n_swings_ge_200,
  pb.pitcher_bip_mv_rows,
  pb.pct_rows_pct_barrel_allowed,
  pb.pct_rows_pct_estimated_ba_allowed,
  ppt.pitcher_pitchtype_mv_rows,
  fb.fg_batting_rows,
  fb.fg_batting_rows_pa_ge_200,
  fb.fg_rows_with_xwoba,
  fp.fg_pitching_rows,
  fp.fg_pitching_rows_with_tbf,
  fp.fg_rows_with_xera,
  fp.fg_rows_with_xfip,
  sp.sprint_speed_player_seasons
FROM y
LEFT JOIN pitch_raw pr ON pr.yr = y.yr
LEFT JOIN bat_mv bm ON bm.yr = y.yr
LEFT JOIN bat_bip bb ON bb.yr = y.yr
LEFT JOIN pit_mv pm ON pm.yr = y.yr
LEFT JOIN pit_bip pb ON pb.yr = y.yr
LEFT JOIN pit_pt ppt ON ppt.yr = y.yr
LEFT JOIN fg_bat fb ON fb.yr = y.yr
LEFT JOIN fg_pit fp ON fp.yr = y.yr
LEFT JOIN sprint sp ON sp.yr = y.yr
ORDER BY y.yr;
