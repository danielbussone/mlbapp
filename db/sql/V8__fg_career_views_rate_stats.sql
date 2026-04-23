-- Career / season rate stats from counting components (stats_jsonb + IP display).
-- See docs/FG_CAREER_AGGREGATE_VIEWS.md for formulas.

CREATE OR REPLACE FUNCTION mlb_ip_display_to_outs(ip double precision)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN ip IS NULL OR ip < 0 THEN NULL
    ELSE (
      (FLOOR(ip)::int * 3) +
      CASE
        WHEN (ip - FLOOR(ip)) >= 0.04 AND (ip - FLOOR(ip)) <= 0.16 THEN 1
        WHEN (ip - FLOOR(ip)) >= 0.17 AND (ip - FLOOR(ip)) <= 0.26 THEN 2
        WHEN (ip - FLOOR(ip)) < 0.04 THEN 0
        ELSE NULL
      END
    )
  END;
$$;

COMMENT ON FUNCTION mlb_ip_display_to_outs(double precision) IS
  'FanGraphs-style IP (0.1 / 0.2 = thirds) to total outs; matches ETL Python fg_qualify.ip_stat_to_outs.';

DROP VIEW IF EXISTS fg_batting_career_mlb CASCADE;
DROP VIEW IF EXISTS fg_pitching_career_mlb CASCADE;
DROP VIEW IF EXISTS fg_batting_season_mlb_consolidated CASCADE;
DROP VIEW IF EXISTS fg_pitching_season_mlb_consolidated CASCADE;

-- ---------------------------------------------------------------------------
-- Batting: consolidated season + career (counting stats from stats_jsonb)
-- ---------------------------------------------------------------------------

CREATE VIEW fg_batting_season_mlb_consolidated AS
WITH has_tot AS (
  SELECT
    id_fg,
    season,
    level,
    BOOL_OR(team = 'TOT') AS has_tot
  FROM fg_batting_season_current
  WHERE level = 'MLB'
  GROUP BY id_fg, season, level
),
filtered AS (
  SELECT b.*, h.has_tot
  FROM fg_batting_season_current b
  INNER JOIN has_tot h
    ON h.id_fg = b.id_fg AND h.season = b.season AND h.level = b.level
  WHERE b.level = 'MLB'
    AND ((h.has_tot AND b.team = 'TOT') OR (NOT h.has_tot))
),
season_agg AS (
  SELECT
    b.id_fg,
    b.season,
    b.level,
    MAX(b.player_id) AS player_id,
    BOOL_OR(b.rate_stat_qualified IS TRUE) AS season_rate_stat_qualified,
    SUM(b.games)::integer AS games,
    SUM(b.pa)::bigint AS pa,
    SUM(b.hr)::bigint AS hr,
    SUM(b.r)::bigint AS r,
    SUM(b.rbi)::bigint AS rbi,
    SUM(b.sb)::bigint AS sb,
    SUM(b.war)::numeric AS war,
    SUM(b.off_runs)::numeric AS off_runs,
    SUM(b.def_runs)::numeric AS def_runs,
    SUM(b.bsr)::numeric AS bsr,
    SUM(b.wrc_plus::numeric * b.pa::numeric) FILTER (WHERE b.wrc_plus IS NOT NULL) AS wrc_plus_pa_num,
    SUM(b.pa) FILTER (WHERE b.wrc_plus IS NOT NULL) AS wrc_plus_pa_den,
    SUM(b.woba::numeric * b.pa::numeric) FILTER (WHERE b.woba IS NOT NULL) AS woba_pa_num,
    SUM(b.pa) FILTER (WHERE b.woba IS NOT NULL) AS woba_pa_den,
    SUM(b.xwoba::numeric * b.pa::numeric) FILTER (WHERE b.xwoba IS NOT NULL) AS xwoba_pa_num,
    SUM(b.pa) FILTER (WHERE b.xwoba IS NOT NULL) AS xwoba_pa_den,
    SUM((b.stats_jsonb->>'H')::numeric) FILTER (WHERE b.stats_jsonb ? 'H') AS h,
    SUM((b.stats_jsonb->>'AB')::numeric) FILTER (WHERE b.stats_jsonb ? 'AB') AS ab,
    SUM((b.stats_jsonb->>'BB')::numeric) FILTER (WHERE b.stats_jsonb ? 'BB') AS bb,
    SUM((b.stats_jsonb->>'IBB')::numeric) FILTER (WHERE b.stats_jsonb ? 'IBB') AS ibb,
    SUM((b.stats_jsonb->>'HBP')::numeric) FILTER (WHERE b.stats_jsonb ? 'HBP') AS hbp,
    SUM((b.stats_jsonb->>'SF')::numeric) FILTER (WHERE b.stats_jsonb ? 'SF') AS sf,
    SUM((b.stats_jsonb->>'SH')::numeric) FILTER (WHERE b.stats_jsonb ? 'SH') AS sh,
    SUM((b.stats_jsonb->>'SO')::numeric) FILTER (WHERE b.stats_jsonb ? 'SO') AS so,
    SUM(
      COALESCE(
        NULLIF((b.stats_jsonb->>'TB'), '')::numeric,
        COALESCE(NULLIF((b.stats_jsonb->>'1B'), '')::numeric, 0)
          + 2 * COALESCE(NULLIF((b.stats_jsonb->>'2B'), '')::numeric, 0)
          + 3 * COALESCE(NULLIF((b.stats_jsonb->>'3B'), '')::numeric, 0)
          + 4 * b.hr::numeric
      )
    ) AS tb,
    MAX(b.ingest_pulled_at) AS latest_ingest_pulled_at
  FROM filtered b
  GROUP BY b.id_fg, b.season, b.level
)
SELECT
  id_fg,
  season,
  level,
  player_id,
  season_rate_stat_qualified,
  games,
  pa,
  hr,
  r,
  rbi,
  sb,
  war,
  off_runs,
  def_runs,
  bsr,
  h,
  ab,
  bb,
  ibb,
  hbp,
  sf,
  sh,
  so,
  tb,
  CASE
    WHEN wrc_plus_pa_den IS NOT NULL AND wrc_plus_pa_den > 0
    THEN wrc_plus_pa_num / wrc_plus_pa_den
  END AS wrc_plus_pa_weighted,
  CASE
    WHEN woba_pa_den IS NOT NULL AND woba_pa_den > 0
    THEN woba_pa_num / woba_pa_den
  END AS woba_pa_weighted,
  CASE
    WHEN xwoba_pa_den IS NOT NULL AND xwoba_pa_den > 0
    THEN xwoba_pa_num / xwoba_pa_den
  END AS xwoba_pa_weighted,
  wrc_plus_pa_num,
  wrc_plus_pa_den,
  woba_pa_num,
  woba_pa_den,
  xwoba_pa_num,
  xwoba_pa_den,
  latest_ingest_pulled_at
FROM season_agg;

COMMENT ON VIEW fg_batting_season_mlb_consolidated IS
  'MLB batting one row per (id_fg, season): TOT-only when present, else summed splits; counting totals from stats_jsonb for career rates.';

CREATE VIEW fg_batting_career_mlb AS
WITH agg AS (
  SELECT
    s.id_fg,
    MAX(s.player_id) AS player_id,
    COUNT(*)::integer AS seasons_count,
    MIN(s.season) AS first_season,
    MAX(s.season) AS last_season,
    COUNT(*) FILTER (WHERE s.season_rate_stat_qualified) AS seasons_rate_stat_qualified,
    SUM(s.games)::bigint AS career_games,
    SUM(s.pa) AS career_pa,
    SUM(s.hr) AS career_hr,
    SUM(s.r) AS career_r,
    SUM(s.rbi) AS career_rbi,
    SUM(s.sb) AS career_sb,
    SUM(s.war) AS career_war,
    SUM(s.off_runs) AS career_off_runs,
    SUM(s.def_runs) AS career_def_runs,
    SUM(s.bsr) AS career_bsr,
    SUM(s.h) AS sum_h,
    SUM(s.ab) AS sum_ab,
    SUM(s.bb) AS sum_bb,
    SUM(s.ibb) AS sum_ibb,
    SUM(s.hbp) AS sum_hbp,
    SUM(s.sf) AS sum_sf,
    SUM(s.sh) AS sum_sh,
    SUM(s.so) AS sum_so,
    SUM(s.tb) AS sum_tb,
    CASE
      WHEN SUM(s.wrc_plus_pa_num) IS NOT NULL AND SUM(s.wrc_plus_pa_den) > 0
      THEN SUM(s.wrc_plus_pa_num) / SUM(s.wrc_plus_pa_den)
    END AS career_wrc_plus_pa_weighted,
    CASE
      WHEN SUM(s.woba_pa_num) IS NOT NULL AND SUM(s.woba_pa_den) > 0
      THEN SUM(s.woba_pa_num) / SUM(s.woba_pa_den)
    END AS career_woba_pa_weighted,
    CASE
      WHEN SUM(s.xwoba_pa_num) IS NOT NULL AND SUM(s.xwoba_pa_den) > 0
      THEN SUM(s.xwoba_pa_num) / SUM(s.xwoba_pa_den)
    END AS career_xwoba_pa_weighted,
    MAX(s.latest_ingest_pulled_at) AS latest_ingest_pulled_at
  FROM fg_batting_season_mlb_consolidated s
  GROUP BY s.id_fg
)
SELECT
  id_fg,
  player_id,
  seasons_count,
  first_season,
  last_season,
  seasons_rate_stat_qualified,
  career_games,
  career_pa,
  career_hr,
  career_r,
  career_rbi,
  career_sb,
  career_war,
  career_off_runs,
  career_def_runs,
  career_bsr,
  career_wrc_plus_pa_weighted,
  career_woba_pa_weighted,
  career_xwoba_pa_weighted,
  (sum_h / NULLIF(sum_ab, 0))::numeric(8, 4) AS career_avg,
  (
    (sum_h + COALESCE(sum_bb, 0) + COALESCE(sum_ibb, 0) + COALESCE(sum_hbp, 0))
    / NULLIF(
      sum_ab + COALESCE(sum_bb, 0) + COALESCE(sum_ibb, 0) + COALESCE(sum_hbp, 0) + COALESCE(sum_sf, 0) + COALESCE(sum_sh, 0),
      0
    )
  )::numeric(8, 4) AS career_obp,
  (sum_tb / NULLIF(sum_ab, 0))::numeric(8, 4) AS career_slg,
  (
    (sum_h + COALESCE(sum_bb, 0) + COALESCE(sum_ibb, 0) + COALESCE(sum_hbp, 0))
    / NULLIF(
      sum_ab + COALESCE(sum_bb, 0) + COALESCE(sum_ibb, 0) + COALESCE(sum_hbp, 0) + COALESCE(sum_sf, 0) + COALESCE(sum_sh, 0),
      0
    )
    + (sum_tb / NULLIF(sum_ab, 0))
  )::numeric(8, 4) AS career_ops,
  (sum_so / NULLIF(career_pa, 0))::numeric(8, 4) AS career_k_pct,
  ((COALESCE(sum_bb, 0) + COALESCE(sum_ibb, 0)) / NULLIF(career_pa, 0))::numeric(8, 4) AS career_bb_pct,
  (career_hr::numeric / NULLIF(career_pa, 0))::numeric(8, 4) AS career_hr_pct,
  latest_ingest_pulled_at
FROM agg;

COMMENT ON VIEW fg_batting_career_mlb IS
  'MLB batting career per id_fg: counting sums + AVG/OBP/SLG/OPS from H,AB,BB,IBB,HBP,SF,TB; K%/BB%/HR% vs PA (decimal fractions).';

-- ---------------------------------------------------------------------------
-- Pitching: ERA from ER & IP outs; FIP innings-weighted; K/BB/HR% vs TBF
-- ---------------------------------------------------------------------------

CREATE VIEW fg_pitching_season_mlb_consolidated AS
WITH has_tot AS (
  SELECT
    id_fg,
    season,
    level,
    BOOL_OR(team = 'TOT') AS has_tot
  FROM fg_pitching_season_current
  WHERE level = 'MLB'
  GROUP BY id_fg, season, level
),
filtered AS (
  SELECT b.*, h.has_tot
  FROM fg_pitching_season_current b
  INNER JOIN has_tot h
    ON h.id_fg = b.id_fg AND h.season = b.season AND h.level = b.level
  WHERE b.level = 'MLB'
    AND ((h.has_tot AND b.team = 'TOT') OR (NOT h.has_tot))
),
season_agg AS (
  SELECT
    b.id_fg,
    b.season,
    b.level,
    MAX(b.player_id) AS player_id,
    BOOL_OR(b.rate_stat_qualified IS TRUE) AS season_rate_stat_qualified,
    SUM(b.games)::integer AS games,
    SUM(b.games_started)::integer AS games_started,
    SUM(b.w)::integer AS w,
    SUM(b.l)::integer AS l,
    SUM(b.sv)::integer AS sv,
    SUM(b.war)::numeric AS war,
    SUM(mlb_ip_display_to_outs(b.ip::double precision)) AS ip_outs,
    SUM((b.stats_jsonb->>'ER')::numeric) FILTER (WHERE b.stats_jsonb ? 'ER') AS er,
    SUM((b.stats_jsonb->>'SO')::numeric) FILTER (WHERE b.stats_jsonb ? 'SO') AS so,
    SUM((b.stats_jsonb->>'BB')::numeric) FILTER (WHERE b.stats_jsonb ? 'BB') AS bb,
    SUM((b.stats_jsonb->>'IBB')::numeric) FILTER (WHERE b.stats_jsonb ? 'IBB') AS ibb,
    SUM((b.stats_jsonb->>'HR')::numeric) FILTER (WHERE b.stats_jsonb ? 'HR') AS hr,
    SUM((b.stats_jsonb->>'TBF')::numeric) FILTER (WHERE b.stats_jsonb ? 'TBF') AS tbf,
    SUM(
      CASE
        WHEN b.fip IS NOT NULL AND mlb_ip_display_to_outs(b.ip::double precision) IS NOT NULL
        THEN b.fip::numeric * (mlb_ip_display_to_outs(b.ip::double precision)::numeric / 3.0)
      END
    ) AS fip_innings_num,
    SUM(
      CASE
        WHEN mlb_ip_display_to_outs(b.ip::double precision) IS NOT NULL
        THEN mlb_ip_display_to_outs(b.ip::double precision)::numeric / 3.0
      END
    ) AS innings_for_fip,
    MAX(b.ingest_pulled_at) AS latest_ingest_pulled_at
  FROM filtered b
  GROUP BY b.id_fg, b.season, b.level
)
SELECT
  id_fg,
  season,
  level,
  player_id,
  season_rate_stat_qualified,
  games,
  games_started,
  w,
  l,
  sv,
  war,
  ip_outs,
  er,
  so,
  bb,
  ibb,
  hr,
  tbf,
  CASE
    WHEN er IS NOT NULL AND ip_outs IS NOT NULL AND ip_outs > 0
    THEN (er::numeric * 27.0 / ip_outs::numeric)::numeric(6, 2)
  END AS era,
  CASE
    WHEN fip_innings_num IS NOT NULL AND innings_for_fip IS NOT NULL AND innings_for_fip > 0
    THEN (fip_innings_num / innings_for_fip)::numeric(6, 2)
  END AS fip_innings_weighted,
  CASE
    WHEN so IS NOT NULL AND tbf IS NOT NULL AND tbf > 0
    THEN (so::numeric / tbf::numeric)::numeric(8, 4)
  END AS k_pct,
  CASE
    WHEN tbf IS NOT NULL AND tbf > 0
    THEN ((COALESCE(bb, 0) + COALESCE(ibb, 0)) / tbf::numeric)::numeric(8, 4)
  END AS bb_pct,
  CASE
    WHEN hr IS NOT NULL AND tbf IS NOT NULL AND tbf > 0
    THEN (hr::numeric / tbf::numeric)::numeric(8, 4)
  END AS hr_pct,
  fip_innings_num,
  innings_for_fip,
  latest_ingest_pulled_at
FROM season_agg;

COMMENT ON VIEW fg_pitching_season_mlb_consolidated IS
  'MLB pitching one row per (id_fg, season): TOT/split merge; ER/SO/BB/HR/TBF from stats_jsonb; IP outs via mlb_ip_display_to_outs; season ERA/FIP/K%/BB%/HR%.';

CREATE VIEW fg_pitching_career_mlb AS
WITH agg AS (
  SELECT
    s.id_fg,
    MAX(s.player_id) AS player_id,
    COUNT(*)::integer AS seasons_count,
    MIN(s.season) AS first_season,
    MAX(s.season) AS last_season,
    COUNT(*) FILTER (WHERE s.season_rate_stat_qualified) AS seasons_rate_stat_qualified,
    SUM(s.games)::bigint AS career_games,
    SUM(s.games_started)::bigint AS career_games_started,
    SUM(s.w)::bigint AS career_w,
    SUM(s.l)::bigint AS career_l,
    SUM(s.sv)::bigint AS career_sv,
    SUM(s.war) AS career_war,
    SUM(s.ip_outs) AS career_ip_outs,
    SUM(s.er) AS career_er,
    SUM(s.so) AS career_so,
    SUM(s.bb) AS career_bb,
    SUM(s.ibb) AS career_ibb,
    SUM(s.hr) AS career_hr,
    SUM(s.tbf) AS career_tbf,
    SUM(s.fip_innings_num) AS sum_fip_innings_num,
    SUM(s.innings_for_fip) AS sum_innings_for_fip,
    MAX(s.latest_ingest_pulled_at) AS latest_ingest_pulled_at
  FROM fg_pitching_season_mlb_consolidated s
  GROUP BY s.id_fg
)
SELECT
  id_fg,
  player_id,
  seasons_count,
  first_season,
  last_season,
  seasons_rate_stat_qualified,
  career_games,
  career_games_started,
  career_w,
  career_l,
  career_sv,
  career_war,
  career_ip_outs,
  (career_er::numeric * 27.0 / NULLIF(career_ip_outs::numeric, 0))::numeric(6, 2) AS career_era,
  (sum_fip_innings_num / NULLIF(sum_innings_for_fip, 0))::numeric(6, 2) AS career_fip,
  (career_so::numeric / NULLIF(career_tbf::numeric, 0))::numeric(8, 4) AS career_k_pct,
  ((COALESCE(career_bb, 0) + COALESCE(career_ibb, 0)) / NULLIF(career_tbf::numeric, 0))::numeric(8, 4) AS career_bb_pct,
  (career_hr::numeric / NULLIF(career_tbf::numeric, 0))::numeric(8, 4) AS career_hr_pct,
  latest_ingest_pulled_at
FROM agg;

COMMENT ON VIEW fg_pitching_career_mlb IS
  'MLB pitching career per id_fg: ERA = 27*ER/ip_outs; FIP = innings-weighted mean of season FIP; K%/BB%/HR% vs sum(TBF).';
