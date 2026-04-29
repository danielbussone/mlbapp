-- PA-weighted batting rates from fg_batting_season_current (TOT/split merge same as consolidated MV).
-- Used for league percentiles when stats_jsonb-derived columns on fg_batting_season_mlb_consolidated are null.

CREATE OR REPLACE VIEW fg_batting_season_mlb_merged_rates AS
WITH has_tot AS (
  SELECT
    id_fg,
    season,
    bool_or(team = 'TOT') AS has_tot
  FROM fg_batting_season_current
  WHERE level = 'MLB'
  GROUP BY id_fg, season
),
filtered AS (
  SELECT b.*, h.has_tot
  FROM fg_batting_season_current b
  INNER JOIN has_tot h ON h.id_fg = b.id_fg AND h.season = b.season
  WHERE b.level = 'MLB'
    AND ((h.has_tot AND b.team = 'TOT') OR (NOT h.has_tot))
),
merged AS (
  SELECT
    b.id_fg,
    b.season,
    MAX(b.player_id) AS player_id,
    SUM(b.pa)::bigint AS pa,
    SUM(CASE WHEN b.xwoba IS NOT NULL AND b.pa IS NOT NULL THEN b.xwoba::numeric * b.pa::numeric END)
      / NULLIF(SUM(CASE WHEN b.xwoba IS NOT NULL THEN b.pa::numeric END), 0) AS xwoba_pa_weighted,
    SUM(CASE WHEN b.k_pct IS NOT NULL AND b.pa IS NOT NULL THEN b.k_pct::numeric * b.pa::numeric END)
      / NULLIF(SUM(CASE WHEN b.k_pct IS NOT NULL THEN b.pa::numeric END), 0) AS k_pct,
    SUM(CASE WHEN b.bb_pct IS NOT NULL AND b.pa IS NOT NULL THEN b.bb_pct::numeric * b.pa::numeric END)
      / NULLIF(SUM(CASE WHEN b.bb_pct IS NOT NULL THEN b.pa::numeric END), 0) AS bb_pct,
    SUM(CASE WHEN b.avg IS NOT NULL AND b.pa IS NOT NULL THEN b.avg::numeric * b.pa::numeric END)
      / NULLIF(SUM(CASE WHEN b.avg IS NOT NULL THEN b.pa::numeric END), 0) AS season_avg,
    SUM(CASE WHEN b.slg IS NOT NULL AND b.pa IS NOT NULL THEN b.slg::numeric * b.pa::numeric END)
      / NULLIF(SUM(CASE WHEN b.slg IS NOT NULL THEN b.pa::numeric END), 0) AS season_slg,
    SUM((b.stats_jsonb->>'SO')::numeric) FILTER (WHERE b.stats_jsonb ? 'SO') AS so_from_json
  FROM filtered b
  GROUP BY b.id_fg, b.season
)
SELECT
  id_fg,
  season,
  player_id,
  pa,
  xwoba_pa_weighted,
  k_pct,
  bb_pct,
  season_avg,
  season_slg,
  CASE
    WHEN pa IS NOT NULL AND pa > 0 AND so_from_json IS NOT NULL
    THEN (so_from_json::numeric / pa::numeric)::numeric(8, 4)
  END AS k_pct_from_so
FROM merged
WHERE player_id IS NOT NULL;

COMMENT ON VIEW fg_batting_season_mlb_merged_rates IS
  'MLB batting one row per (id_fg, season): PA-weighted xwOBA, K%, BB%, AVG, SLG from typed FG columns; optional k_pct_from_so when SO exists in stats_jsonb.';
