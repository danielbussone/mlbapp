-- Repair environments that already applied an older V36 that required MLBAM text to match
-- ``^[0-9]+$`` only. FanGraphs JSON often stores ``xMLBAMID`` as ``681624.0``, which was skipped.
-- Idempotent: ``NOT EXISTS`` guards match corrected V36/V37; safe to run after those migrations.

INSERT INTO player_external_identifier (player_id, id_system, id_value)
SELECT DISTINCT ON (dp.player_id)
  dp.player_id,
  'fangraphs',
  b.id_fg::text
FROM fg_batting_season_current b
CROSS JOIN LATERAL (
  SELECT trim(COALESCE(
    NULLIF(TRIM(b.stats_jsonb->>'xMLBAMID'), ''),
    NULLIF(TRIM(b.stats_jsonb->>'MLBAMID'), ''),
    NULLIF(TRIM(b.stats_jsonb->>'MLBAM'), ''),
    NULLIF(TRIM(b.stats_jsonb->>'mlbam'), '')
  )) AS raw_str
) r
INNER JOIN dim_player dp ON dp.key_mlbam IS NOT NULL
  AND r.raw_str IS NOT NULL
  AND r.raw_str <> ''
  AND r.raw_str ~ '^[0-9]+(\.[0-9]+)?$'
  AND trunc(r.raw_str::numeric)::bigint = dp.key_mlbam::bigint
WHERE b.level = 'MLB'
  AND b.stats_jsonb IS NOT NULL
  AND (b.player_id IS NULL OR b.player_id = dp.player_id)
  AND NOT EXISTS (
    SELECT 1 FROM player_external_identifier e
    WHERE e.id_system = 'fangraphs' AND e.id_value = b.id_fg::text
  )
  AND NOT EXISTS (
    SELECT 1 FROM player_external_identifier e2
    WHERE e2.player_id = dp.player_id AND e2.id_system = 'fangraphs'
  )
ORDER BY dp.player_id, b.season DESC NULLS LAST, b.id_fg;

INSERT INTO player_external_identifier (player_id, id_system, id_value)
SELECT DISTINCT ON (dp.player_id)
  dp.player_id,
  'fangraphs',
  f.id_fg::text
FROM fg_pitching_season_current f
CROSS JOIN LATERAL (
  SELECT trim(COALESCE(
    NULLIF(TRIM(f.stats_jsonb->>'xMLBAMID'), ''),
    NULLIF(TRIM(f.stats_jsonb->>'MLBAMID'), ''),
    NULLIF(TRIM(f.stats_jsonb->>'MLBAM'), ''),
    NULLIF(TRIM(f.stats_jsonb->>'mlbam'), '')
  )) AS raw_str
) r
INNER JOIN dim_player dp ON dp.key_mlbam IS NOT NULL
  AND r.raw_str IS NOT NULL
  AND r.raw_str <> ''
  AND r.raw_str ~ '^[0-9]+(\.[0-9]+)?$'
  AND trunc(r.raw_str::numeric)::bigint = dp.key_mlbam::bigint
WHERE f.level = 'MLB'
  AND f.stats_jsonb IS NOT NULL
  AND (f.player_id IS NULL OR f.player_id = dp.player_id)
  AND NOT EXISTS (
    SELECT 1 FROM player_external_identifier e
    WHERE e.id_system = 'fangraphs' AND e.id_value = f.id_fg::text
  )
  AND NOT EXISTS (
    SELECT 1 FROM player_external_identifier e2
    WHERE e2.player_id = dp.player_id AND e2.id_system = 'fangraphs'
  )
ORDER BY dp.player_id, f.season DESC NULLS LAST, f.id_fg;

REFRESH MATERIALIZED VIEW fg_batting_season_mlb_consolidated;
REFRESH MATERIALIZED VIEW fg_pitching_season_mlb_consolidated;
