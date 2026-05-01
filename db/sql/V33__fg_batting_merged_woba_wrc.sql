-- PA-weighted wOBA and wRC+ on ``fg_batting_season_mlb_merged_rates`` for league percentiles
-- (`fg_season_woba`, ``fg_season_wrc_plus``). New columns **appended** at the end (42P16-safe).

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
    MAX(
      COALESCE(
        b.player_id,
        (
          SELECT pe.player_id
          FROM player_external_identifier pe
          WHERE pe.id_system = 'fangraphs' AND pe.id_value = b.id_fg::text
          LIMIT 1
        )
      )
    ) AS player_id,
    SUM(b.pa)::bigint AS pa,
    SUM(CASE WHEN b.xwoba IS NOT NULL AND b.pa IS NOT NULL THEN b.xwoba::numeric * b.pa::numeric END)
      / NULLIF(SUM(CASE WHEN b.xwoba IS NOT NULL THEN b.pa::numeric END), 0) AS xwoba_pa_weighted,
    SUM(CASE WHEN b.woba IS NOT NULL AND b.pa IS NOT NULL THEN b.woba::numeric * b.pa::numeric END)
      / NULLIF(SUM(CASE WHEN b.woba IS NOT NULL THEN b.pa::numeric END), 0) AS woba_pa_weighted,
    SUM(CASE WHEN b.wrc_plus IS NOT NULL AND b.pa IS NOT NULL THEN b.wrc_plus::numeric * b.pa::numeric END)
      / NULLIF(SUM(CASE WHEN b.wrc_plus IS NOT NULL THEN b.pa::numeric END), 0) AS wrc_plus_pa_weighted,
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
  END AS k_pct_from_so,
  woba_pa_weighted,
  wrc_plus_pa_weighted
FROM merged
WHERE player_id IS NOT NULL;

COMMENT ON VIEW fg_batting_season_mlb_merged_rates IS
  'MLB batting one row per (id_fg, season): PA-weighted typed rates (xwOBA, wOBA, wRC+, …); player_id from row or player_external_identifier (fangraphs).';
