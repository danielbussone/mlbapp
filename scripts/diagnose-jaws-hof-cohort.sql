-- Diagnose expanded JAWS HoF cohort: why peer_n=0 / hof_average null.
-- Run from repo root (loads .env yourself or export DATABASE_URL):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/diagnose-jaws-hof-cohort.sql
--
-- Optional: set subject player_id in the CTE below (default NULL skips per-player checks).

-- ---------------------------------------------------------------------------
-- 0) FanGraphs inputs (if these are 0, ``pnpm db:refresh-fg-mviews`` alone cannot fill JAWS MVs — run ``pnpm etl:fg`` first)
-- ---------------------------------------------------------------------------
\echo '--- 0) FG season / career inputs (not HoF-specific) ---'
SELECT
  (SELECT COUNT(*)::bigint FROM fg_batting_season_current WHERE level = 'MLB') AS fg_batting_season_current_mlb_rows,
  (SELECT COUNT(*)::bigint FROM fg_batting_season_mlb_consolidated) AS fg_batting_season_mlb_consolidated_rows,
  (SELECT COUNT(*)::bigint FROM fg_batting_career_mlb) AS fg_batting_career_mlb_view_rows,
  (SELECT COUNT(*)::bigint FROM fg_pitching_season_current WHERE level = 'MLB') AS fg_pitching_season_current_mlb_rows,
  (SELECT COUNT(*)::bigint FROM fg_pitching_season_mlb_consolidated) AS fg_pitching_season_mlb_consolidated_rows,
  (SELECT COUNT(*)::bigint FROM fg_pitching_career_mlb) AS fg_pitching_career_mlb_view_rows;

\echo '--- 0b) player_id on FG career (null here ⇒ run ``pnpm etl:chadwick`` then Flyway V30+ or ``pnpm etl:fg -- --link-players``) ---'
SELECT
  (SELECT COUNT(*) FILTER (WHERE player_id IS NOT NULL)::bigint FROM fg_batting_career_mlb) AS bat_career_with_player_id,
  (SELECT COUNT(*) FILTER (WHERE player_id IS NULL)::bigint FROM fg_batting_career_mlb) AS bat_career_player_id_null,
  (SELECT COUNT(*) FILTER (WHERE player_id IS NOT NULL)::bigint FROM fg_pitching_career_mlb) AS pit_career_with_player_id,
  (SELECT COUNT(*) FILTER (WHERE player_id IS NULL)::bigint FROM fg_pitching_career_mlb) AS pit_career_player_id_null,
  (SELECT COUNT(*)::bigint FROM player_external_identifier WHERE id_system = 'fangraphs') AS pei_fangraphs_rows;

-- ---------------------------------------------------------------------------
-- 1) HoF table shape
-- ---------------------------------------------------------------------------
\echo '--- 1) hall_of_fame_player row counts ---'
SELECT
  COUNT(*) AS hof_rows,
  COUNT(*) FILTER (WHERE player_id IS NOT NULL) AS hof_with_player_id,
  COUNT(*) FILTER (WHERE player_id IS NULL) AS hof_missing_player_id
FROM hall_of_fame_player;

-- ---------------------------------------------------------------------------
-- 2) HoF batters present in JAWS cohort MV (any position)
-- ---------------------------------------------------------------------------
\echo '--- 2) Matview row counts (if 0, run pnpm db:refresh-fg-mviews after migrate + FG ETL) ---'
SELECT
  (SELECT COUNT(*)::bigint FROM mv_fg_batter_jaws_cohort) AS batter_cohort_mv_rows,
  (SELECT COUNT(*)::bigint FROM mv_fg_pitcher_jaws_cohort) AS pitcher_cohort_mv_rows,
  (SELECT COUNT(*)::bigint FROM mv_fg_batter_jaws_primary_pos) AS batter_primary_pos_mv_rows,
  (SELECT COUNT(*)::bigint FROM mv_fg_pitcher_jaws_primary_role) AS pitcher_primary_role_mv_rows;

\echo '--- 2) HoF batters in mv_fg_batter_jaws_cohort (any jaws_position_key) ---'
SELECT COUNT(DISTINCT m.player_id) AS hof_batters_in_cohort_mv
FROM mv_fg_batter_jaws_cohort m
INNER JOIN hall_of_fame_player h ON h.player_id = m.player_id
WHERE m.jaws_fwar IS NOT NULL;

\echo '--- 2b) HoF batters by jaws_position_key (cohort MV) ---'
SELECT
  m.jaws_position_key,
  COUNT(DISTINCT m.player_id) AS hof_players,
  COUNT(*) AS rows_n
FROM mv_fg_batter_jaws_cohort m
INNER JOIN hall_of_fame_player h ON h.player_id = m.player_id
WHERE m.jaws_fwar IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC, 1;

\echo '--- 2c) ID overlap: HoF player_id vs FG career / cohort MV (why join can be 0) ---'
SELECT
  (SELECT COUNT(DISTINCT player_id) FROM mv_fg_batter_jaws_cohort WHERE player_id IS NOT NULL) AS cohort_batter_distinct_player_id,
  (SELECT COUNT(DISTINCT h.player_id) FROM hall_of_fame_player h INNER JOIN fg_batting_career_mlb c ON c.player_id = h.player_id) AS hof_with_fg_batting_career_row,
  (SELECT COUNT(DISTINCT h.player_id) FROM hall_of_fame_player h INNER JOIN mv_fg_batter_jaws_cohort m ON m.player_id = h.player_id) AS hof_ids_that_appear_in_cohort_mv;

-- ---------------------------------------------------------------------------
-- 3) HoF with player_id but NOT in batting cohort MV (link / PA / MV gap)
-- ---------------------------------------------------------------------------
\echo '--- 3) HoF inductees with player_id missing from mv_fg_batter_jaws_cohort (limit 30) ---'
SELECT h.lahman_player_id, h.player_id, h.inducted_year
FROM hall_of_fame_player h
WHERE h.player_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM mv_fg_batter_jaws_cohort m WHERE m.player_id = h.player_id
  )
ORDER BY h.inducted_year DESC NULLS LAST
LIMIT 30;

-- ---------------------------------------------------------------------------
-- 4) Same for pitching cohort
-- ---------------------------------------------------------------------------
\echo '--- 4) HoF pitchers in mv_fg_pitcher_jaws_cohort ---'
SELECT COUNT(DISTINCT m.player_id) AS hof_pitchers_in_cohort_mv
FROM mv_fg_pitcher_jaws_cohort m
INNER JOIN hall_of_fame_player h ON h.player_id = m.player_id
WHERE m.jaws_fwar IS NOT NULL;

\echo '--- 4b) HoF pitchers by jaws_position_key ---'
SELECT
  m.jaws_position_key,
  COUNT(DISTINCT m.player_id) AS hof_players
FROM mv_fg_pitcher_jaws_cohort m
INNER JOIN hall_of_fame_player h ON h.player_id = m.player_id
WHERE m.jaws_fwar IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC, 1;

-- ---------------------------------------------------------------------------
-- 5) Per-player drill (psql only — skipped unless you pass -v player_id=…)
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v player_id=660271 -f scripts/diagnose-jaws-hof-cohort.sql
-- ---------------------------------------------------------------------------
\echo '--- 5) Per-player (skipped if -v player_id not set) ---'
\if :{?player_id}
SELECT
  :player_id::bigint AS player_id,
  (SELECT jaws_position_key FROM mv_fg_batter_jaws_primary_pos WHERE player_id = :player_id::bigint LIMIT 1) AS primary_pos_mv,
  (SELECT jaws_position_key FROM mv_fg_batter_jaws_cohort WHERE player_id = :player_id::bigint LIMIT 1) AS cohort_mv_position,
  (
    SELECT COUNT(*)::integer
    FROM mv_fg_batter_jaws_cohort m
    INNER JOIN hall_of_fame_player h ON h.player_id = m.player_id
    WHERE m.jaws_position_key = (
        SELECT jaws_position_key FROM mv_fg_batter_jaws_primary_pos WHERE player_id = :player_id::bigint LIMIT 1
      )
      AND m.jaws_fwar IS NOT NULL
      AND m.player_id <> :player_id::bigint
  ) AS peer_n_excluding_self,
  (
    SELECT COUNT(*)::integer
    FROM mv_fg_batter_jaws_cohort m
    INNER JOIN hall_of_fame_player h ON h.player_id = m.player_id
    WHERE m.jaws_position_key = (
        SELECT jaws_position_key FROM mv_fg_batter_jaws_primary_pos WHERE player_id = :player_id::bigint LIMIT 1
      )
      AND m.jaws_fwar IS NOT NULL
  ) AS hof_at_position_incl_self;
\else
\echo '(pass -v player_id=dim_player.surrogate_id to run section 5)'
\endif

-- ---------------------------------------------------------------------------
-- 6) Pitching: per-player (same -v player_id), mirrors API peer filter (RP/SP + SP_RP)
-- ---------------------------------------------------------------------------
\echo '--- 6) Pitching per-player (skipped if -v player_id not set) ---'
\if :{?player_id}
WITH rk AS (
  SELECT COALESCE(
    (SELECT jaws_position_key FROM mv_fg_pitcher_jaws_primary_role WHERE player_id = :player_id::bigint LIMIT 1),
    (SELECT jaws_position_key FROM mv_fg_pitcher_jaws_cohort WHERE player_id = :player_id::bigint LIMIT 1)
  ) AS k
)
SELECT
  :player_id::bigint AS player_id,
  rk.k AS resolved_role_key,
  (
    SELECT COUNT(*)::integer
    FROM mv_fg_pitcher_jaws_cohort m
    INNER JOIN hall_of_fame_player h ON h.player_id = m.player_id
    WHERE m.jaws_fwar IS NOT NULL
      AND m.player_id <> :player_id::bigint
      AND (
        (rk.k = 'RP' AND m.jaws_position_key IN ('RP', 'SP_RP'))
        OR (rk.k = 'SP' AND m.jaws_position_key IN ('SP', 'SP_RP'))
        OR (rk.k = 'SP_RP' AND m.jaws_position_key = 'SP_RP')
      )
  ) AS peer_n_like_api
FROM rk;
\endif
