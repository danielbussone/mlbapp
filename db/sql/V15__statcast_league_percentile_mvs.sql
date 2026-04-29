-- Precomputed league percentiles for player cards (see docs/COHORT_PERCENTILES_SPEC.md).
-- Refresh after Statcast bulk loads: scripts/refresh-statcast-percentile-mvs.sql

-- ---------------------------------------------------------------------------
-- Shared pitch-level booleans (mirror apps/api/src/repos/statcast.ts)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW statcast_batter_season_percentile_mv AS
WITH rowf AS (
  SELECT
    s.game_year,
    s.batter_mlbam,
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
    NULLIF(TRIM(s.payload_jsonb->>'bat_speed'), '')::double precision AS bat_speed,
    NULLIF(TRIM(s.payload_jsonb->>'attack_angle'), '')::double precision AS attack_angle,
    NULLIF(TRIM(s.payload_jsonb->>'attack_direction'), '')::double precision AS attack_direction,
    NULLIF(TRIM(s.payload_jsonb->>'swing_path_tilt'), '')::double precision AS swing_path_tilt
  FROM statcast_pitch s
),
bip AS (
  SELECT
    game_year,
    batter_mlbam,
    COUNT(*) FILTER (WHERE is_bip)::bigint AS bbe,
    ROUND(AVG(launch_speed::double precision) FILTER (WHERE is_bip)::numeric, 3) AS val_bip_avg_exit_velo,
    ROUND(AVG(launch_angle::double precision) FILTER (WHERE is_bip)::numeric, 2) AS val_bip_avg_launch_angle,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_bip AND launch_speed::double precision >= 95.0)
        / NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric,
      2
    ) AS val_bip_hard_hit_pct
  FROM rowf
  GROUP BY game_year, batter_mlbam
),
disc AS (
  SELECT
    game_year,
    batter_mlbam,
    COUNT(*)::bigint AS pitches_seen,
    COUNT(*) FILTER (WHERE is_swing)::bigint AS swings,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND out_zone AND is_swing)
        / NULLIF(COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND out_zone), 0))::numeric,
      2
    ) AS val_bat_chase_pct,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_whiff)
        / NULLIF(COUNT(*) FILTER (WHERE is_swing), 0))::numeric,
      2
    ) AS val_bat_whiff_pct
  FROM rowf
  GROUP BY game_year, batter_mlbam
),
bt AS (
  SELECT
    game_year,
    batter_mlbam,
    COUNT(*)::bigint AS tracked_swings,
    ROUND(AVG(bat_speed)::numeric, 2) AS val_swing_avg_bat_speed,
    ROUND(AVG(attack_angle)::numeric, 2) AS val_swing_avg_attack_angle,
    ROUND(AVG(attack_direction)::numeric, 2) AS val_swing_avg_attack_direction,
    ROUND(AVG(swing_path_tilt)::numeric, 2) AS val_swing_avg_path_tilt
  FROM rowf
  WHERE bat_speed IS NOT NULL
  GROUP BY game_year, batter_mlbam
),
cohort_bip AS (
  SELECT game_year, COUNT(*) FILTER (WHERE bbe >= 50)::bigint AS n
  FROM bip
  GROUP BY game_year
),
cohort_bt AS (
  SELECT game_year, COUNT(*) FILTER (WHERE tracked_swings >= 25)::bigint AS n
  FROM bt
  GROUP BY game_year
),
cohort_disc AS (
  SELECT game_year, COUNT(*) FILTER (WHERE pitches_seen >= 400)::bigint AS n
  FROM disc
  GROUP BY game_year
),
cohort_whiff AS (
  SELECT game_year, COUNT(*) FILTER (WHERE swings >= 150)::bigint AS n
  FROM disc
  GROUP BY game_year
),
rank_bip_ev AS (
  SELECT game_year, batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_bip_avg_exit_velo))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe >= 50 AND val_bip_avg_exit_velo IS NOT NULL
),
rank_bip_la AS (
  SELECT game_year, batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_bip_avg_launch_angle))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe >= 50 AND val_bip_avg_launch_angle IS NOT NULL
),
rank_bip_hh AS (
  SELECT game_year, batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_bip_hard_hit_pct))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe >= 50 AND val_bip_hard_hit_pct IS NOT NULL
),
rank_bt_bs AS (
  SELECT game_year, batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_swing_avg_bat_speed))::numeric, 0)::int AS pr
  FROM bt
  WHERE tracked_swings >= 25
),
rank_bt_aa AS (
  SELECT game_year, batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_swing_avg_attack_angle))::numeric, 0)::int AS pr
  FROM bt
  WHERE tracked_swings >= 25
),
rank_bt_ad AS (
  SELECT game_year, batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_swing_avg_attack_direction))::numeric, 0)::int AS pr
  FROM bt
  WHERE tracked_swings >= 25
),
rank_bt_st AS (
  SELECT game_year, batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_swing_avg_path_tilt))::numeric, 0)::int AS pr
  FROM bt
  WHERE tracked_swings >= 25
),
rank_chase AS (
  SELECT game_year, batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_bat_chase_pct))::numeric, 0)::int AS pr
  FROM disc
  WHERE pitches_seen >= 400 AND val_bat_chase_pct IS NOT NULL
),
rank_whiff AS (
  SELECT game_year, batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_bat_whiff_pct))::numeric, 0)::int AS pr
  FROM disc
  WHERE swings >= 150 AND val_bat_whiff_pct IS NOT NULL
),
keys AS (
  SELECT game_year, batter_mlbam FROM bip
  UNION
  SELECT game_year, batter_mlbam FROM bt
  UNION
  SELECT game_year, batter_mlbam FROM disc
)
SELECT
  k.game_year,
  k.batter_mlbam,
  bip.bbe,
  bip.val_bip_avg_exit_velo,
  bip.val_bip_avg_launch_angle,
  bip.val_bip_hard_hit_pct,
  cb.n AS cohort_n_bip,
  CASE WHEN bip.bbe >= 50 THEN r_ev.pr END AS pct_bip_avg_exit_velo,
  CASE WHEN bip.bbe >= 50 THEN r_la.pr END AS pct_bip_avg_launch_angle,
  CASE WHEN bip.bbe >= 50 THEN r_hh.pr END AS pct_bip_hard_hit_pct,
  bt.tracked_swings,
  bt.val_swing_avg_bat_speed,
  bt.val_swing_avg_attack_angle,
  bt.val_swing_avg_attack_direction,
  bt.val_swing_avg_path_tilt,
  cbt.n AS cohort_n_bat_track,
  CASE WHEN bt.tracked_swings >= 25 THEN r_bs.pr END AS pct_swing_avg_bat_speed,
  CASE WHEN bt.tracked_swings >= 25 THEN r_aa.pr END AS pct_swing_avg_attack_angle,
  CASE WHEN bt.tracked_swings >= 25 THEN r_ad.pr END AS pct_swing_avg_attack_direction,
  CASE WHEN bt.tracked_swings >= 25 THEN r_st.pr END AS pct_swing_avg_path_tilt,
  disc.pitches_seen,
  disc.swings,
  disc.val_bat_chase_pct,
  disc.val_bat_whiff_pct,
  cd.n AS cohort_n_bat_chase,
  cw.n AS cohort_n_bat_whiff,
  CASE WHEN disc.pitches_seen >= 400 THEN r_ch.pr END AS pct_bat_chase_pct,
  CASE WHEN disc.swings >= 150 THEN r_wf.pr END AS pct_bat_whiff_pct
FROM keys k
LEFT JOIN bip ON bip.game_year = k.game_year AND bip.batter_mlbam = k.batter_mlbam
LEFT JOIN bt ON bt.game_year = k.game_year AND bt.batter_mlbam = k.batter_mlbam
LEFT JOIN disc ON disc.game_year = k.game_year AND disc.batter_mlbam = k.batter_mlbam
LEFT JOIN cohort_bip cb ON cb.game_year = k.game_year
LEFT JOIN cohort_bt cbt ON cbt.game_year = k.game_year
LEFT JOIN cohort_disc cd ON cd.game_year = k.game_year
LEFT JOIN cohort_whiff cw ON cw.game_year = k.game_year
LEFT JOIN rank_bip_ev r_ev ON r_ev.game_year = k.game_year AND r_ev.batter_mlbam = k.batter_mlbam
LEFT JOIN rank_bip_la r_la ON r_la.game_year = k.game_year AND r_la.batter_mlbam = k.batter_mlbam
LEFT JOIN rank_bip_hh r_hh ON r_hh.game_year = k.game_year AND r_hh.batter_mlbam = k.batter_mlbam
LEFT JOIN rank_bt_bs r_bs ON r_bs.game_year = k.game_year AND r_bs.batter_mlbam = k.batter_mlbam
LEFT JOIN rank_bt_aa r_aa ON r_aa.game_year = k.game_year AND r_aa.batter_mlbam = k.batter_mlbam
LEFT JOIN rank_bt_ad r_ad ON r_ad.game_year = k.game_year AND r_ad.batter_mlbam = k.batter_mlbam
LEFT JOIN rank_bt_st r_st ON r_st.game_year = k.game_year AND r_st.batter_mlbam = k.batter_mlbam
LEFT JOIN rank_chase r_ch ON r_ch.game_year = k.game_year AND r_ch.batter_mlbam = k.batter_mlbam
LEFT JOIN rank_whiff r_wf ON r_wf.game_year = k.game_year AND r_wf.batter_mlbam = k.batter_mlbam;

CREATE UNIQUE INDEX statcast_batter_season_percentile_mv_pk
  ON statcast_batter_season_percentile_mv (game_year, batter_mlbam);

COMMENT ON MATERIALIZED VIEW statcast_batter_season_percentile_mv IS
  'Batter-season Statcast percentiles vs league (see docs/COHORT_PERCENTILES_SPEC.md). REFRESH after statcast ingest.';

-- ---------------------------------------------------------------------------
-- Pitcher season totals (Savant-style row: velo, chase, whiff, EV against, …)
-- ---------------------------------------------------------------------------
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
  'Pitcher-season Statcast percentiles (totals). REFRESH after statcast ingest.';

-- ---------------------------------------------------------------------------
-- Pitcher by pitch_type (min 250 pitches per type)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW statcast_pitcher_season_pitchtype_percentile_mv AS
WITH rowf AS (
  SELECT
    s.game_year,
    s.pitcher_mlbam,
    TRIM(s.pitch_type) AS pitch_type,
    s.release_speed,
    s.pfx_x,
    s.pfx_z,
    s.launch_speed,
    s.launch_angle,
    s.description,
    s.events,
    NULLIF(TRIM(s.payload_jsonb->>'zone'), '')::numeric AS zone_num,
    NULLIF(TRIM(s.payload_jsonb->>'release_spin_rate'), '')::double precision AS release_spin_rate,
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
    END AS is_fb
  FROM statcast_pitch s
  WHERE s.pitch_type IS NOT NULL AND TRIM(s.pitch_type) <> ''
),
agg AS (
  SELECT
    game_year,
    pitcher_mlbam,
    pitch_type,
    COUNT(*)::bigint AS pitches,
    ROUND(AVG(release_speed::double precision)::numeric, 2) AS val_avg_velo,
    ROUND(AVG(release_spin_rate) FILTER (WHERE release_spin_rate IS NOT NULL)::numeric, 0) AS val_avg_spin,
    ROUND(AVG(pfx_x::double precision) FILTER (WHERE pfx_x IS NOT NULL AND pfx_z IS NOT NULL)::numeric, 3) AS val_avg_pfx_x,
    ROUND(AVG(pfx_z::double precision) FILTER (WHERE pfx_x IS NOT NULL AND pfx_z IS NOT NULL)::numeric, 3) AS val_avg_pfx_z,
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
    ) AS val_hr_pct
  FROM rowf
  GROUP BY game_year, pitcher_mlbam, pitch_type
),
cohort AS (
  SELECT game_year, pitch_type, COUNT(*)::bigint AS n
  FROM agg
  WHERE pitches >= 250
  GROUP BY game_year, pitch_type
),
r_velo AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_avg_velo))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_avg_velo IS NOT NULL
),
r_spin AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_avg_spin))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_avg_spin IS NOT NULL
),
r_x AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_avg_pfx_x))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_avg_pfx_x IS NOT NULL
),
r_z AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_avg_pfx_z))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_avg_pfx_z IS NOT NULL
),
r_zone AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_zone_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_zone_pct IS NOT NULL
),
r_chase AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_chase_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_chase_pct IS NOT NULL
),
r_swing AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_swing_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_swing_pct IS NOT NULL
),
r_whiff AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_whiff_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_whiff_pct IS NOT NULL
),
r_swstr AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_swstr_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_swstr_pct IS NOT NULL
),
r_gb AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_gb_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_gb_pct IS NOT NULL
),
r_fb AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_fb_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_fb_pct IS NOT NULL
),
r_hr AS (
  SELECT game_year, pitcher_mlbam, pitch_type,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year, pitch_type ORDER BY val_hr_pct))::numeric, 0)::int AS pr
  FROM agg WHERE pitches >= 250 AND val_hr_pct IS NOT NULL
)
SELECT
  a.game_year,
  a.pitcher_mlbam,
  a.pitch_type,
  a.pitches,
  c.n AS cohort_n,
  a.val_avg_velo,
  a.val_avg_spin,
  a.val_avg_pfx_x,
  a.val_avg_pfx_z,
  a.val_zone_pct,
  a.val_chase_pct,
  a.val_swing_pct,
  a.val_whiff_pct,
  a.val_swstr_pct,
  a.val_gb_pct,
  a.val_fb_pct,
  a.val_hr_pct,
  CASE WHEN a.pitches >= 250 THEN rv.pr END AS pct_avg_velo,
  CASE WHEN a.pitches >= 250 THEN rs.pr END AS pct_avg_spin,
  CASE WHEN a.pitches >= 250 THEN rx.pr END AS pct_avg_pfx_x,
  CASE WHEN a.pitches >= 250 THEN rz.pr END AS pct_avg_pfx_z,
  CASE WHEN a.pitches >= 250 THEN rzone.pr END AS pct_zone_pct,
  CASE WHEN a.pitches >= 250 THEN rch.pr END AS pct_chase_pct,
  CASE WHEN a.pitches >= 250 THEN rsw.pr END AS pct_swing_pct,
  CASE WHEN a.pitches >= 250 THEN rwh.pr END AS pct_whiff_pct,
  CASE WHEN a.pitches >= 250 THEN rsws.pr END AS pct_swstr_pct,
  CASE WHEN a.pitches >= 250 THEN rgb.pr END AS pct_gb_pct,
  CASE WHEN a.pitches >= 250 THEN rfb.pr END AS pct_fb_pct,
  CASE WHEN a.pitches >= 250 THEN rhr.pr END AS pct_hr_pct
FROM agg a
LEFT JOIN cohort c ON c.game_year = a.game_year AND c.pitch_type = a.pitch_type
LEFT JOIN r_velo rv ON rv.game_year = a.game_year AND rv.pitcher_mlbam = a.pitcher_mlbam AND rv.pitch_type = a.pitch_type
LEFT JOIN r_spin rs ON rs.game_year = a.game_year AND rs.pitcher_mlbam = a.pitcher_mlbam AND rs.pitch_type = a.pitch_type
LEFT JOIN r_x rx ON rx.game_year = a.game_year AND rx.pitcher_mlbam = a.pitcher_mlbam AND rx.pitch_type = a.pitch_type
LEFT JOIN r_z rz ON rz.game_year = a.game_year AND rz.pitcher_mlbam = a.pitcher_mlbam AND rz.pitch_type = a.pitch_type
LEFT JOIN r_zone rzone ON rzone.game_year = a.game_year AND rzone.pitcher_mlbam = a.pitcher_mlbam AND rzone.pitch_type = a.pitch_type
LEFT JOIN r_chase rch ON rch.game_year = a.game_year AND rch.pitcher_mlbam = a.pitcher_mlbam AND rch.pitch_type = a.pitch_type
LEFT JOIN r_swing rsw ON rsw.game_year = a.game_year AND rsw.pitcher_mlbam = a.pitcher_mlbam AND rsw.pitch_type = a.pitch_type
LEFT JOIN r_whiff rwh ON rwh.game_year = a.game_year AND rwh.pitcher_mlbam = a.pitcher_mlbam AND rwh.pitch_type = a.pitch_type
LEFT JOIN r_swstr rsws ON rsws.game_year = a.game_year AND rsws.pitcher_mlbam = a.pitcher_mlbam AND rsws.pitch_type = a.pitch_type
LEFT JOIN r_gb rgb ON rgb.game_year = a.game_year AND rgb.pitcher_mlbam = a.pitcher_mlbam AND rgb.pitch_type = a.pitch_type
LEFT JOIN r_fb rfb ON rfb.game_year = a.game_year AND rfb.pitcher_mlbam = a.pitcher_mlbam AND rfb.pitch_type = a.pitch_type
LEFT JOIN r_hr rhr ON rhr.game_year = a.game_year AND rhr.pitcher_mlbam = a.pitcher_mlbam AND rhr.pitch_type = a.pitch_type;

CREATE UNIQUE INDEX statcast_pitcher_season_pitchtype_percentile_mv_pk
  ON statcast_pitcher_season_pitchtype_percentile_mv (game_year, pitcher_mlbam, pitch_type);

COMMENT ON MATERIALIZED VIEW statcast_pitcher_season_pitchtype_percentile_mv IS
  'Pitcher-season pitch-type Statcast percentiles. REFRESH after statcast ingest.';
