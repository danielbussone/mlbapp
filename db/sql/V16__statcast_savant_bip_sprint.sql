-- Savant-style BIP extras (barrel %, sweet-spot %, mean estimated BA, squared-up prob) + sprint speed store.
-- Refresh with scripts/refresh-statcast-percentile-mvs.sql after Statcast ingest.
-- See docs/COHORT_PERCENTILES_SPEC.md (cohort_spec_version 2026.2).

-- ---------------------------------------------------------------------------
-- Sprint speed (ingest TBD; table supports savant_running percentiles)
-- ---------------------------------------------------------------------------
CREATE TABLE player_season_sprint_speed (
  key_mlbam integer NOT NULL,
  game_year smallint NOT NULL,
  sprint_speed numeric(6, 2) NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_mlbam, game_year)
);

CREATE INDEX player_season_sprint_speed_year_idx
  ON player_season_sprint_speed (game_year);

COMMENT ON TABLE player_season_sprint_speed IS
  'MLBAM + season sprint speed (ft/s). Populate via approved ingest; used for league percentile cohort.';

-- ---------------------------------------------------------------------------
-- Batter-season BIP extras (grain: game_year, batter_mlbam)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW statcast_batter_season_savant_bip_mv AS
WITH rowf AS (
  SELECT
    s.game_year,
    s.batter_mlbam,
    (s.launch_speed IS NOT NULL) AS is_bip,
    s.launch_speed::double precision AS ev,
    s.launch_angle::double precision AS la,
    NULLIF(TRIM(s.payload_jsonb->>'estimated_ba_using_speedangle'), '')::double precision AS est_ba,
    NULLIF(TRIM(s.payload_jsonb->>'squared_up_probability'), '')::double precision AS sq_prob,
    (
      LOWER(TRIM(COALESCE(s.payload_jsonb->>'launch_speed_angle', ''))) = 'barrel'
      OR (
        s.launch_speed IS NOT NULL
        AND s.launch_angle IS NOT NULL
        AND s.launch_speed::double precision >= 97
        AND s.launch_angle::double precision BETWEEN 24 AND 33
      )
    ) AS is_barrel,
    (
      s.launch_speed IS NOT NULL
      AND s.launch_angle IS NOT NULL
      AND s.launch_angle::double precision BETWEEN 8 AND 32
    ) AS is_sweet_spot
  FROM statcast_pitch s
),
bip AS (
  SELECT
    game_year,
    batter_mlbam,
    COUNT(*) FILTER (WHERE is_bip)::bigint AS bbe,
    COUNT(*) FILTER (WHERE is_bip AND est_ba IS NOT NULL)::bigint AS bbe_with_est_ba,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_bip AND is_barrel) / NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric,
      2
    ) AS val_barrel_pct,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_bip AND is_sweet_spot) / NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric,
      2
    ) AS val_sweet_spot_pct,
    ROUND(AVG(est_ba) FILTER (WHERE is_bip AND est_ba IS NOT NULL)::numeric, 4) AS val_avg_estimated_ba,
    COUNT(*) FILTER (WHERE sq_prob IS NOT NULL)::bigint AS sq_n,
    ROUND(AVG(sq_prob) FILTER (WHERE sq_prob IS NOT NULL)::numeric, 3) AS val_avg_squared_up_prob
  FROM rowf
  GROUP BY game_year, batter_mlbam
),
cohort_bip AS (
  SELECT game_year, COUNT(*) FILTER (WHERE bbe >= 50)::bigint AS n
  FROM bip
  GROUP BY game_year
),
cohort_est AS (
  SELECT game_year, COUNT(*) FILTER (WHERE bbe_with_est_ba >= 50)::bigint AS n
  FROM bip
  GROUP BY game_year
),
cohort_sq AS (
  SELECT game_year, COUNT(*) FILTER (WHERE sq_n >= 25)::bigint AS n
  FROM bip
  GROUP BY game_year
),
r_barrel AS (
  SELECT
    game_year,
    batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_barrel_pct))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe >= 50 AND val_barrel_pct IS NOT NULL
),
r_sweet AS (
  SELECT
    game_year,
    batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_sweet_spot_pct))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe >= 50 AND val_sweet_spot_pct IS NOT NULL
),
r_est AS (
  SELECT
    game_year,
    batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_avg_estimated_ba))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe_with_est_ba >= 50 AND val_avg_estimated_ba IS NOT NULL
),
r_sq AS (
  SELECT
    game_year,
    batter_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_avg_squared_up_prob))::numeric, 0)::int AS pr
  FROM bip
  WHERE sq_n >= 25 AND val_avg_squared_up_prob IS NOT NULL
)
SELECT
  b.game_year,
  b.batter_mlbam,
  b.bbe,
  b.bbe_with_est_ba,
  b.sq_n,
  b.val_barrel_pct,
  b.val_sweet_spot_pct,
  b.val_avg_estimated_ba,
  b.val_avg_squared_up_prob,
  cb.n AS cohort_n_bip,
  ce.n AS cohort_n_est_ba,
  csq.n AS cohort_n_sq,
  CASE WHEN b.bbe >= 50 THEN r_barrel.pr END AS pct_barrel_pct,
  CASE WHEN b.bbe >= 50 THEN r_sweet.pr END AS pct_sweet_spot_pct,
  CASE WHEN b.bbe_with_est_ba >= 50 THEN r_est.pr END AS pct_avg_estimated_ba,
  CASE WHEN b.sq_n >= 25 THEN r_sq.pr END AS pct_avg_squared_up_prob
FROM bip b
LEFT JOIN cohort_bip cb ON cb.game_year = b.game_year
LEFT JOIN cohort_est ce ON ce.game_year = b.game_year
LEFT JOIN cohort_sq csq ON csq.game_year = b.game_year
LEFT JOIN r_barrel r_barrel ON r_barrel.game_year = b.game_year AND r_barrel.batter_mlbam = b.batter_mlbam
LEFT JOIN r_sweet r_sweet ON r_sweet.game_year = b.game_year AND r_sweet.batter_mlbam = b.batter_mlbam
LEFT JOIN r_est r_est ON r_est.game_year = b.game_year AND r_est.batter_mlbam = b.batter_mlbam
LEFT JOIN r_sq r_sq ON r_sq.game_year = b.game_year AND r_sq.batter_mlbam = b.batter_mlbam;

CREATE UNIQUE INDEX statcast_batter_season_savant_bip_mv_pk
  ON statcast_batter_season_savant_bip_mv (game_year, batter_mlbam);

COMMENT ON MATERIALIZED VIEW statcast_batter_season_savant_bip_mv IS
  'Batter-season barrel%, sweet-spot% (8–32° LA on BIP), mean Statcast estimated BA on BIP, squared-up probability. REFRESH with other Statcast percentile MVs.';

-- ---------------------------------------------------------------------------
-- Pitcher-season BIP extras (allowed)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW statcast_pitcher_season_savant_bip_mv AS
WITH rowf AS (
  SELECT
    s.game_year,
    s.pitcher_mlbam,
    (s.launch_speed IS NOT NULL) AS is_bip,
    s.launch_speed::double precision AS ev,
    s.launch_angle::double precision AS la,
    NULLIF(TRIM(s.payload_jsonb->>'estimated_ba_using_speedangle'), '')::double precision AS est_ba,
    (
      LOWER(TRIM(COALESCE(s.payload_jsonb->>'launch_speed_angle', ''))) = 'barrel'
      OR (
        s.launch_speed IS NOT NULL
        AND s.launch_angle IS NOT NULL
        AND s.launch_speed::double precision >= 97
        AND s.launch_angle::double precision BETWEEN 24 AND 33
      )
    ) AS is_barrel,
    (
      s.launch_speed IS NOT NULL
      AND s.launch_angle IS NOT NULL
      AND s.launch_angle::double precision BETWEEN 8 AND 32
    ) AS is_sweet_spot,
    (s.launch_speed IS NOT NULL AND s.launch_speed::double precision >= 95.0) AS is_hard_hit
  FROM statcast_pitch s
),
bip AS (
  SELECT
    game_year,
    pitcher_mlbam,
    COUNT(*) FILTER (WHERE is_bip)::bigint AS bbe,
    COUNT(*) FILTER (WHERE is_bip AND est_ba IS NOT NULL)::bigint AS bbe_with_est_ba,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_bip AND is_barrel) / NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric,
      2
    ) AS val_barrel_pct_allowed,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_bip AND is_sweet_spot) / NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric,
      2
    ) AS val_sweet_spot_pct_allowed,
    ROUND(AVG(est_ba) FILTER (WHERE is_bip AND est_ba IS NOT NULL)::numeric, 4) AS val_avg_estimated_ba_allowed,
    ROUND(
      (100.0 * COUNT(*) FILTER (WHERE is_bip AND is_hard_hit) / NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric,
      2
    ) AS val_hard_hit_pct_allowed
  FROM rowf
  GROUP BY game_year, pitcher_mlbam
),
cohort_bip AS (
  SELECT game_year, COUNT(*) FILTER (WHERE bbe >= 50)::bigint AS n
  FROM bip
  GROUP BY game_year
),
cohort_est AS (
  SELECT game_year, COUNT(*) FILTER (WHERE bbe_with_est_ba >= 50)::bigint AS n
  FROM bip
  GROUP BY game_year
),
r_barrel AS (
  SELECT
    game_year,
    pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_barrel_pct_allowed))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe >= 50 AND val_barrel_pct_allowed IS NOT NULL
),
r_sweet AS (
  SELECT
    game_year,
    pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_sweet_spot_pct_allowed))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe >= 50 AND val_sweet_spot_pct_allowed IS NOT NULL
),
r_est AS (
  SELECT
    game_year,
    pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_avg_estimated_ba_allowed))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe_with_est_ba >= 50 AND val_avg_estimated_ba_allowed IS NOT NULL
),
r_hh AS (
  SELECT
    game_year,
    pitcher_mlbam,
    ROUND((100.0 * PERCENT_RANK() OVER (PARTITION BY game_year ORDER BY val_hard_hit_pct_allowed))::numeric, 0)::int AS pr
  FROM bip
  WHERE bbe >= 50 AND val_hard_hit_pct_allowed IS NOT NULL
)
SELECT
  b.game_year,
  b.pitcher_mlbam,
  b.bbe,
  b.bbe_with_est_ba,
  b.val_barrel_pct_allowed,
  b.val_sweet_spot_pct_allowed,
  b.val_avg_estimated_ba_allowed,
  b.val_hard_hit_pct_allowed,
  cb.n AS cohort_n_bip,
  ce.n AS cohort_n_est_ba,
  CASE WHEN b.bbe >= 50 THEN r_barrel.pr END AS pct_barrel_pct_allowed,
  CASE WHEN b.bbe >= 50 THEN r_sweet.pr END AS pct_sweet_spot_pct_allowed,
  CASE WHEN b.bbe_with_est_ba >= 50 THEN r_est.pr END AS pct_avg_estimated_ba_allowed,
  CASE WHEN b.bbe >= 50 THEN r_hh.pr END AS pct_hard_hit_pct_allowed
FROM bip b
LEFT JOIN cohort_bip cb ON cb.game_year = b.game_year
LEFT JOIN cohort_est ce ON ce.game_year = b.game_year
LEFT JOIN r_barrel r_barrel ON r_barrel.game_year = b.game_year AND r_barrel.pitcher_mlbam = b.pitcher_mlbam
LEFT JOIN r_sweet r_sweet ON r_sweet.game_year = b.game_year AND r_sweet.pitcher_mlbam = b.pitcher_mlbam
LEFT JOIN r_est r_est ON r_est.game_year = b.game_year AND r_est.pitcher_mlbam = b.pitcher_mlbam
LEFT JOIN r_hh r_hh ON r_hh.game_year = b.game_year AND r_hh.pitcher_mlbam = b.pitcher_mlbam;

CREATE UNIQUE INDEX statcast_pitcher_season_savant_bip_mv_pk
  ON statcast_pitcher_season_savant_bip_mv (game_year, pitcher_mlbam);

COMMENT ON MATERIALIZED VIEW statcast_pitcher_season_savant_bip_mv IS
  'Pitcher-season barrel%/sweet-spot%/hard-hit%/mean xBA allowed on BIP. REFRESH with other Statcast percentile MVs.';
