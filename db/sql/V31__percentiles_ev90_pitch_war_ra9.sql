-- EV90 on batter percentile MV; pitching RA9-WAR column + merged_stats war_fip/war_ra9 for league percentiles.

-- Typed ``war_ra9`` on ``fg_pitching_season`` for ETL; percentile merge reads RA9-WAR from
-- ``stats_jsonb`` here so we do not ``CREATE OR REPLACE`` ``fg_pitching_season_current`` —
-- replacing that view after adding a column shifts ``f.*`` column order and PostgreSQL rejects
-- OR REPLACE (42P16); ``DROP ... CASCADE`` would tear down consolidated MVs.

ALTER TABLE fg_pitching_season
  ADD COLUMN IF NOT EXISTS war_ra9 numeric(5, 2);

CREATE OR REPLACE VIEW fg_pitching_season_mlb_merged_stats AS
WITH has_tot AS (
  SELECT
    id_fg,
    season,
    bool_or(team = 'TOT') AS has_tot
  FROM fg_pitching_season_current
  WHERE level = 'MLB'
  GROUP BY id_fg, season
),
filtered AS (
  SELECT f.*
  FROM fg_pitching_season_current f
  INNER JOIN has_tot h ON h.id_fg = f.id_fg AND h.season = f.season
  WHERE f.level = 'MLB'
    AND ((h.has_tot AND f.team = 'TOT') OR (NOT h.has_tot))
),
merged AS (
  SELECT
    f.id_fg,
    f.season,
    MAX(
      COALESCE(
        f.player_id,
        (
          SELECT pe.player_id
          FROM player_external_identifier pe
          WHERE pe.id_system = 'fangraphs' AND pe.id_value = f.id_fg::text
          LIMIT 1
        )
      )
    ) AS player_id,
    SUM((f.stats_jsonb->>'TBF')::numeric) AS tbf,
    SUM((f.stats_jsonb->>'SO')::numeric) AS so,
    SUM(
      COALESCE((f.stats_jsonb->>'BB')::numeric, 0) + COALESCE((f.stats_jsonb->>'IBB')::numeric, 0)
    ) AS bb_ibb,
    SUM(
      CASE
        WHEN f.xera IS NOT NULL AND mlb_ip_display_to_outs(f.ip::double precision) IS NOT NULL
        THEN f.xera::numeric * mlb_ip_display_to_outs(f.ip::double precision)::numeric
      END
    ) AS xera_ip_num,
    SUM(
      CASE
        WHEN f.xera IS NOT NULL AND mlb_ip_display_to_outs(f.ip::double precision) IS NOT NULL
        THEN mlb_ip_display_to_outs(f.ip::double precision)::numeric
      END
    ) AS xera_ip_den,
    MAX(f.xera::numeric) FILTER (WHERE f.xera IS NOT NULL) AS xera_fallback,
    SUM(f.war::numeric) AS pit_war_fip,
    SUM(
      COALESCE(
        NULLIF(TRIM(f.stats_jsonb->>'RA9-WAR'), '')::numeric,
        NULLIF(TRIM(f.stats_jsonb->>'RA9 WAR'), '')::numeric
      )
    ) AS pit_war_ra9
  FROM filtered f
  GROUP BY f.id_fg, f.season
)
SELECT
  id_fg,
  season,
  player_id,
  COALESCE(
    CASE
      WHEN xera_ip_den IS NOT NULL AND xera_ip_den > 0 THEN (xera_ip_num / xera_ip_den)::numeric(6, 2)
    END,
    xera_fallback::numeric(6, 2)
  ) AS xera,
  tbf,
  CASE
    WHEN tbf IS NOT NULL AND tbf > 0 THEN (so::numeric / tbf)::numeric(8, 4)
  END AS k_pct,
  CASE
    WHEN tbf IS NOT NULL AND tbf > 0 THEN (bb_ibb::numeric / tbf)::numeric(8, 4)
  END AS bb_pct,
  pit_war_fip AS war_fip,
  pit_war_ra9 AS war_ra9
FROM merged
WHERE player_id IS NOT NULL;

COMMENT ON VIEW fg_pitching_season_mlb_merged_stats IS
  'MLB pitching season merge: IP-weighted xERA, TBF-based K%/BB%, FIP-WAR (sum war) and RA9-WAR (sum stats_jsonb RA9-WAR); player_id from row or player_external_identifier (fangraphs).';

DROP MATERIALIZED VIEW IF EXISTS statcast_batter_season_percentile_mv;

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
    ) AS val_bip_hard_hit_pct,
    ROUND(
      (percentile_disc(0.9) WITHIN GROUP (ORDER BY launch_speed::double precision)
        FILTER (WHERE is_bip))::numeric,
      1
    ) AS val_bip_ev90
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
rank_bip_ev90 AS (
  SELECT game_year, batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_bip_ev90))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe >= 50 AND val_bip_ev90 IS NOT NULL
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
  bip.val_bip_ev90,
  cb.n AS cohort_n_bip,
  CASE WHEN bip.bbe >= 50 THEN r_ev.pr END AS pct_bip_avg_exit_velo,
  CASE WHEN bip.bbe >= 50 THEN r_ev90.pr END AS pct_bip_ev90,
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
LEFT JOIN rank_bip_ev90 r_ev90 ON r_ev90.game_year = k.game_year AND r_ev90.batter_mlbam = k.batter_mlbam
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
  'Batter-season Statcast percentiles vs league (see docs/COHORT_PERCENTILES_SPEC.md). V31: EV90. REFRESH after statcast ingest.';
