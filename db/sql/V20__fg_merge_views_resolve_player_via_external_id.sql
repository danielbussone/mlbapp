-- When fg_*_season rows are not backfilled with player_id, resolve dim_player via
-- player_external_identifier (id_system = 'fangraphs', id_value = id_fg::text), same as fangraphsCareer.ts.

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
  'MLB batting one row per (id_fg, season): PA-weighted typed rates; player_id from row or player_external_identifier (fangraphs).';

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
    MAX(f.xera::numeric) FILTER (WHERE f.xera IS NOT NULL) AS xera_fallback
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
  END AS bb_pct
FROM merged
WHERE player_id IS NOT NULL;

COMMENT ON VIEW fg_pitching_season_mlb_merged_stats IS
  'MLB pitching season merge: IP-weighted xERA, TBF-based K%/BB%; player_id from row or player_external_identifier (fangraphs).';
