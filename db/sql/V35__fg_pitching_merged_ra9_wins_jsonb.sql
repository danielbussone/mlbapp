-- FanGraphs ``/api/leaders/major-league/data`` JSON does not ship ``RA9-WAR``; the value shown as
-- RA9-WAR on the site corresponds to the ``RA9-Wins`` field in the payload (see FG leaderboard grid).

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
    SUM(
      CASE
        WHEN f.xfip IS NOT NULL AND mlb_ip_display_to_outs(f.ip::double precision) IS NOT NULL
        THEN f.xfip::numeric * mlb_ip_display_to_outs(f.ip::double precision)::numeric
      END
    ) AS xfip_ip_num,
    SUM(
      CASE
        WHEN f.xfip IS NOT NULL AND mlb_ip_display_to_outs(f.ip::double precision) IS NOT NULL
        THEN mlb_ip_display_to_outs(f.ip::double precision)::numeric
      END
    ) AS xfip_ip_den,
    MAX(f.xfip::numeric) FILTER (WHERE f.xfip IS NOT NULL) AS xfip_fallback,
    SUM(f.war::numeric) AS pit_war_fip,
    SUM(
      COALESCE(
        NULLIF(TRIM(f.stats_jsonb->>'RA9-WAR'), '')::numeric,
        NULLIF(TRIM(f.stats_jsonb->>'RA9 WAR'), '')::numeric,
        NULLIF(TRIM(f.stats_jsonb->>'RA9-Wins'), '')::numeric,
        fp.war_ra9::numeric
      )
    ) AS pit_war_ra9
  FROM filtered f
  INNER JOIN fg_pitching_season fp
    ON fp.snapshot_id = f.snapshot_id
    AND fp.id_fg = f.id_fg
    AND fp.season = f.season
    AND fp.team = f.team
    AND fp.level = f.level
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
  pit_war_ra9 AS war_ra9,
  COALESCE(
    CASE
      WHEN xfip_ip_den IS NOT NULL AND xfip_ip_den > 0 THEN (xfip_ip_num / xfip_ip_den)::numeric(6, 2)
    END,
    xfip_fallback::numeric(6, 2)
  ) AS xfip
FROM merged
WHERE player_id IS NOT NULL;

COMMENT ON VIEW fg_pitching_season_mlb_merged_stats IS
  'MLB pitching season merge: IP-weighted xERA and xFIP, TBF-based K%/BB%, FIP-WAR (sum war), RA9-WAR (jsonb RA9-WAR / RA9 WAR / RA9-Wins else fg_pitching_season.war_ra9); player_id from row or player_external_identifier (fangraphs).';
