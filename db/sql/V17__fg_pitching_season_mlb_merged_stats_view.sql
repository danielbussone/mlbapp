-- One logical MLB pitching row per (id_fg, season) matching fg_pitching_season_mlb_consolidated TOT/split merge.
-- Exposes xERA + TBF-based K%/BB% for Savant-style FG season percentiles (see docs/COHORT_PERCENTILES_SPEC.md).

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
    MAX(f.player_id) AS player_id,
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
    ) AS xera_ip_den
  FROM filtered f
  GROUP BY f.id_fg, f.season
)
SELECT
  id_fg,
  season,
  player_id,
  CASE
    WHEN xera_ip_den IS NOT NULL AND xera_ip_den > 0 THEN (xera_ip_num / xera_ip_den)::numeric(6, 2)
  END AS xera,
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
  'MLB pitching season merge (TOT vs splits): IP-weighted xERA, TBF-based K% and BB% for percentile cohorts.';
