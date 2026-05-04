-- Second pass after V36: link ``dim_player.key_mlbam`` when FanGraphs MLBAM lives under a
-- non-canonical ``stats_jsonb`` key (any top-level key ILIKE ``%mlbam%`` except ``playerid`` / ``idfg``).
-- Canonical keys use ``trunc(...::numeric)::bigint`` so values like ``681624.0`` match (same as V36).
-- One-time cost at migrate; keeps API queries on ``player_external_identifier`` only.

-- ---------------------------------------------------------------------------
-- Batting (only rows where V36-style known keys did not yield the player's MLBAM).
-- ---------------------------------------------------------------------------
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
  )) AS canon_str
) c
INNER JOIN dim_player dp ON dp.key_mlbam IS NOT NULL
INNER JOIN LATERAL (
  SELECT trim(kv.value) AS v
  FROM jsonb_each_text(b.stats_jsonb) kv
  WHERE kv.key ILIKE '%mlbam%'
    AND kv.key !~* '^(playerid|idfg)$'
    AND trim(kv.value) ~ '^[0-9]{5,9}(\.[0-9]+)?$'
  LIMIT 1
) x ON trunc(trim(x.v)::numeric)::bigint = dp.key_mlbam::bigint
WHERE b.level = 'MLB'
  AND b.stats_jsonb IS NOT NULL
  AND (b.player_id IS NULL OR b.player_id = dp.player_id)
  AND NOT (
    c.canon_str IS NOT NULL
    AND c.canon_str <> ''
    AND c.canon_str ~ '^[0-9]+(\.[0-9]+)?$'
    AND trunc(c.canon_str::numeric)::bigint = dp.key_mlbam::bigint
  )
  AND NOT EXISTS (
    SELECT 1 FROM player_external_identifier e
    WHERE e.id_system = 'fangraphs' AND e.id_value = b.id_fg::text
  )
  AND NOT EXISTS (
    SELECT 1 FROM player_external_identifier e2
    WHERE e2.player_id = dp.player_id AND e2.id_system = 'fangraphs'
  )
ORDER BY dp.player_id, b.season DESC NULLS LAST, b.id_fg;

-- ---------------------------------------------------------------------------
-- Pitching (same; players who still lack ``fangraphs`` after batting pass).
-- ---------------------------------------------------------------------------
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
  )) AS canon_str
) c
INNER JOIN dim_player dp ON dp.key_mlbam IS NOT NULL
INNER JOIN LATERAL (
  SELECT trim(kv.value) AS v
  FROM jsonb_each_text(f.stats_jsonb) kv
  WHERE kv.key ILIKE '%mlbam%'
    AND kv.key !~* '^(playerid|idfg)$'
    AND trim(kv.value) ~ '^[0-9]{5,9}(\.[0-9]+)?$'
  LIMIT 1
) x ON trunc(trim(x.v)::numeric)::bigint = dp.key_mlbam::bigint
WHERE f.level = 'MLB'
  AND f.stats_jsonb IS NOT NULL
  AND (f.player_id IS NULL OR f.player_id = dp.player_id)
  AND NOT (
    c.canon_str IS NOT NULL
    AND c.canon_str <> ''
    AND c.canon_str ~ '^[0-9]+(\.[0-9]+)?$'
    AND trunc(c.canon_str::numeric)::bigint = dp.key_mlbam::bigint
  )
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
