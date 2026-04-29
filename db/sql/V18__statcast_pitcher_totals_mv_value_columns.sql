-- Expose raw process/BIP rate values on pitcher season totals MV (apps/api reads val_*).
-- Replaces MV from V15 with identical logic + extra projected columns.

DROP MATERIALIZED VIEW IF EXISTS statcast_pitcher_season_totals_percentile_mv;

CREATE MATERIALIZED VIEW statcast_pitcher_season_totals_percentile_mv AS
WITH rowf AS (
  SELECT
    s.game_year,
    s.pitcher_mlbam,
    s.pitch_type,
    s.release_speed,
    s.launch_speed,
    s.launch_angle,
    s.description,
    s.events,
    NULLIF(TRIM(s.payload_jsonb->>'zone'), '')::numeric AS zone_num,
    (s.description IN (
      'swinging_strike', 'swinging_strike_blocked', 'foul', 'foul_tip',
      'hit_into_play', 'hit_into_play_no_out', 'hit_into_play_score',
      'foul_bunt', 'missed_bunt', 'bunt_foul_tip'
    )) AS is_swing,
    (s.description IN ('swinging_strike', 'swinging_strike_blocked')) AS is_whiff,
    (NULLIF(TRIM(s.payload_jsonb->>'zone'), '')::numeric IS NOT NULL
      AND NULLIF(TRIM(s.payload_jsonb->>'zone'), '')::numeric BETWEEN 1 AND 9) AS in_zone,
    (NULLIF(TRIM(s.payload_jsonb->>'zone'), '')::numeric IS NOT NULL
      AND NOT (NULLIF(TRIM(s.payload_jsonb->>'zone'), '')::numeric BETWEEN 1 AND 9)) AS out_zone,
    (s.launch_speed IS NOT NULL) AS is_bip,
    (LOWER(COALESCE(s.events, '')) LIKE '%home_run%') AS is_hr,
    CASE
      WHEN LOWER(TRIM(COALESCE(s.payload_jsonb->>'bb_type', ''))) = 'ground_ball' THEN TRUE
      WHEN s.payload_jsonb->>'bb_type' IS NULL AND s.launch_speed IS NOT NULL AND s.launch_angle IS NOT NULL
        AND s.launch_angle::double precision <= 10 THEN TRUE
      ELSE FALSE
    END AS is_gb,
    CASE
      WHEN LOWER(TRIM(COALESCE(s.payload_jsonb->>'bb_type', ''))) IN ('fly_ball', 'popup') THEN TRUE
      WHEN s.payload_jsonb->>'bb_type' IS NULL AND s.launch_speed IS NOT NULL AND s.launch_angle IS NOT NULL
        AND s.launch_angle::double precision >= 25 THEN TRUE
      ELSE FALSE
    END AS is_fb,
    NULLIF(TRIM(s.payload_jsonb->>'release_extension'), '')::double precision AS release_extension
  FROM statcast_pitch s
),
agg AS (
  SELECT
    game_year,
    pitcher_mlbam,
    COUNT(*)::bigint AS pitches,
    COUNT(*) FILTER (WHERE is_swing)::bigint AS swings,
    COUNT(*) FILTER (WHERE is_bip)::bigint AS bbe,
    ROUND(AVG(launch_speed::double precision) FILTER (WHERE is_bip)::numeric, 2) AS val_avg_exit_velo_on_bip,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND in_zone)
        / NULLIF(COUNT(*) FILTER (WHERE zone_num IS NOT NULL), 0))::numeric,
      2
    ) AS val_zone_pct,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND out_zone AND is_swing)
        / NULLIF(COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND out_zone), 0))::numeric,
      2
    ) AS val_chase_pct,
    ROUND((100.0 * COUNT(*) FILTER (WHERE is_swing) / NULLIF(COUNT(*), 0))::numeric, 2) AS val_swing_pct,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_whiff) / NULLIF(COUNT(*) FILTER (WHERE is_swing), 0))::numeric,
      2
    ) AS val_whiff_pct,
    ROUND((100.0 * COUNT(*) FILTER (WHERE is_whiff) / NULLIF(COUNT(*), 0))::numeric, 2) AS val_swstr_pct,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_bip AND is_gb) / NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric,
      2
    ) AS val_gb_pct,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_bip AND is_fb) / NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric,
      2
    ) AS val_fb_pct,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_bip AND is_hr) / NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric,
      2
    ) AS val_hr_pct,
    ROUND(AVG(release_extension) FILTER (WHERE release_extension IS NOT NULL)::numeric, 2) AS val_avg_release_extension,
    COUNT(*) FILTER (WHERE release_extension IS NOT NULL)::bigint AS pitches_with_extension
  FROM rowf
  GROUP BY game_year, pitcher_mlbam
),
ff AS (
  SELECT
    game_year,
    pitcher_mlbam,
    ROUND(AVG(release_speed::double precision)::numeric, 1) AS val_ff_avg_velo,
    COUNT(*)::bigint AS ff_pitches
  FROM rowf
  WHERE pitch_type IS NOT NULL AND TRIM(pitch_type) = 'FF' AND release_speed IS NOT NULL
  GROUP BY game_year, pitcher_mlbam
),
cohort_p AS (SELECT game_year, COUNT(*) FILTER (WHERE pitches >= 800)::bigint AS n FROM agg GROUP BY game_year),
cohort_bbe AS (SELECT game_year, COUNT(*) FILTER (WHERE bbe >= 50)::bigint AS n FROM agg GROUP BY game_year),
cohort_sw AS (SELECT game_year, COUNT(*) FILTER (WHERE swings >= 200)::bigint AS n FROM agg GROUP BY game_year),
cohort_ext AS (
  SELECT game_year, COUNT(*) FILTER (WHERE pitches_with_extension >= 400)::bigint AS n FROM agg GROUP BY game_year
),
cohort_ff AS (SELECT game_year, COUNT(*) FILTER (WHERE ff_pitches >= 75)::bigint AS n FROM ff GROUP BY game_year),
r_ev AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_avg_exit_velo_on_bip))::numeric, 0)::int AS pr
  FROM agg WHERE bbe >= 50 AND val_avg_exit_velo_on_bip IS NOT NULL
),
r_ch AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_chase_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 800 AND val_chase_pct IS NOT NULL
),
r_wh AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_whiff_pct))::numeric, 0)::int AS pr
  FROM agg WHERE swings >= 200 AND val_whiff_pct IS NOT NULL
),
r_swstr AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_swstr_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 800 AND val_swstr_pct IS NOT NULL
),
r_zone AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_zone_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 800 AND val_zone_pct IS NOT NULL
),
r_swing AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_swing_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 800 AND val_swing_pct IS NOT NULL
),
r_gb AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_gb_pct))::numeric, 0)::int AS pr
  FROM agg WHERE bbe >= 50 AND val_gb_pct IS NOT NULL
),
r_fb AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_fb_pct))::numeric, 0)::int AS pr
  FROM agg WHERE bbe >= 50 AND val_fb_pct IS NOT NULL
),
r_hr AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_hr_pct))::numeric, 0)::int AS pr
  FROM agg WHERE bbe >= 50 AND val_hr_pct IS NOT NULL
),
r_ext AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_avg_release_extension))::numeric, 0)::int AS pr
  FROM agg
  WHERE pitches_with_extension >= 400 AND val_avg_release_extension IS NOT NULL
),
r_ff AS (
  SELECT game_year, pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_ff_avg_velo))::numeric, 0)::int AS pr
  FROM ff
  WHERE ff_pitches >= 75 AND val_ff_avg_velo IS NOT NULL
)
SELECT
  a.game_year,
  a.pitcher_mlbam,
  a.pitches,
  a.swings,
  a.bbe,
  a.val_avg_exit_velo_on_bip,
  a.val_chase_pct,
  a.val_whiff_pct,
  a.val_swstr_pct,
  a.val_zone_pct,
  a.val_swing_pct,
  a.val_gb_pct,
  a.val_fb_pct,
  a.val_hr_pct,
  cp.n AS cohort_n_pitch_process,
  cb.n AS cohort_n_bip,
  cs.n AS cohort_n_swings_whiff,
  ce.n AS cohort_n_extension,
  cf.n AS cohort_n_ff_velo,
  CASE WHEN a.bbe >= 50 THEN r_ev.pr END AS pct_avg_exit_velo_on_bip,
  CASE WHEN a.pitches >= 800 THEN r_ch.pr END AS pct_chase_pct,
  CASE WHEN a.swings >= 200 THEN r_wh.pr END AS pct_whiff_pct,
  CASE WHEN a.pitches >= 800 THEN r_swstr.pr END AS pct_swstr_pct,
  CASE WHEN a.pitches >= 800 THEN r_zone.pr END AS pct_zone_pct,
  CASE WHEN a.pitches >= 800 THEN r_swing.pr END AS pct_swing_pct,
  CASE WHEN a.bbe >= 50 THEN r_gb.pr END AS pct_gb_pct,
  CASE WHEN a.bbe >= 50 THEN r_fb.pr END AS pct_fb_pct,
  CASE WHEN a.bbe >= 50 THEN r_hr.pr END AS pct_hr_pct,
  a.val_avg_release_extension,
  a.pitches_with_extension,
  CASE WHEN a.pitches_with_extension >= 400 THEN r_ext.pr END AS pct_avg_release_extension,
  f.val_ff_avg_velo,
  f.ff_pitches,
  CASE WHEN f.ff_pitches >= 75 THEN r_ff.pr END AS pct_ff_avg_velo
FROM agg a
LEFT JOIN ff f ON f.game_year = a.game_year AND f.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN cohort_p cp ON cp.game_year = a.game_year
LEFT JOIN cohort_bbe cb ON cb.game_year = a.game_year
LEFT JOIN cohort_sw cs ON cs.game_year = a.game_year
LEFT JOIN cohort_ext ce ON ce.game_year = a.game_year
LEFT JOIN cohort_ff cf ON cf.game_year = a.game_year
LEFT JOIN r_ev ON r_ev.game_year = a.game_year AND r_ev.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN r_ch ON r_ch.game_year = a.game_year AND r_ch.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN r_wh ON r_wh.game_year = a.game_year AND r_wh.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN r_swstr ON r_swstr.game_year = a.game_year AND r_swstr.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN r_zone ON r_zone.game_year = a.game_year AND r_zone.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN r_swing ON r_swing.game_year = a.game_year AND r_swing.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN r_gb ON r_gb.game_year = a.game_year AND r_gb.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN r_fb ON r_fb.game_year = a.game_year AND r_fb.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN r_hr ON r_hr.game_year = a.game_year AND r_hr.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN r_ext ON r_ext.game_year = a.game_year AND r_ext.pitcher_mlbam = a.pitcher_mlbam
LEFT JOIN r_ff ON r_ff.game_year = a.game_year AND r_ff.pitcher_mlbam = a.pitcher_mlbam;

CREATE UNIQUE INDEX statcast_pitcher_season_totals_percentile_mv_pk
  ON statcast_pitcher_season_totals_percentile_mv (game_year, pitcher_mlbam);

COMMENT ON MATERIALIZED VIEW statcast_pitcher_season_totals_percentile_mv IS
  'Pitcher-season Statcast percentiles (totals). REFRESH after statcast ingest. Includes val_chase_pct, val_swstr_pct, … for API display.';
