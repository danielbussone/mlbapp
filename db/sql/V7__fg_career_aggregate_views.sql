-- FanGraphs MLB career rollups from fg_*_season_current (see docs/FG_CAREER_AGGREGATE_VIEWS.md).
-- Season grain: TOT row only when present; else sum splits. Career grain: sums + PA-weighted wRC+/wOBA/xwOBA.

-- ---------------------------------------------------------------------------
-- Batting: one logical MLB row per (id_fg, season)
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
  'MLB batting one row per (id_fg, season): TOT-only when present, else summed splits; PA-weighted rate components for career rollups.';

CREATE VIEW fg_batting_career_mlb AS
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
GROUP BY s.id_fg;

COMMENT ON VIEW fg_batting_career_mlb IS
  'MLB batting career totals per id_fg from fg_batting_season_mlb_consolidated; WAR is sum of season WAR; wRC+/wOBA/xwOBA are PA-weighted across seasons.';

-- ---------------------------------------------------------------------------
-- Pitching: one logical MLB row per (id_fg, season) — no career IP sum
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
  latest_ingest_pulled_at
FROM season_agg;

COMMENT ON VIEW fg_pitching_season_mlb_consolidated IS
  'MLB pitching one row per (id_fg, season): TOT-only when present, else summed splits; IP not summed at career level.';

CREATE VIEW fg_pitching_career_mlb AS
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
  MAX(s.latest_ingest_pulled_at) AS latest_ingest_pulled_at
FROM fg_pitching_season_mlb_consolidated s
GROUP BY s.id_fg;

COMMENT ON VIEW fg_pitching_career_mlb IS
  'MLB pitching career totals per id_fg; WAR is sum of season WAR; no career IP (innings thirds not additive in SQL literals).';
