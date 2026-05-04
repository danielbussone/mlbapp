-- FanGraphs ``stats_jsonb`` keys that look numeric and are **not** already used for
-- league percentiles in ``apps/api/src/repos/leaguePercentilesFgSavant.ts`` (Tier‑1).
--
-- Tier‑1 batting (merged / consolidated → fg_season_* slots): wOBA, xwOBA, wRC+, K%, BB%,
--   AVG, SLG, ISO, BsR, Off, Def, WAR (+ aliases Offense/Defense).
-- Tier‑1 pitching (merged stats view): xERA, xFIP, K% & BB% (from merged), WAR (FIP basis),
--   RA9‑WAR family from jsonb.
--
-- Run: psql "$DATABASE_URL" -f scripts/fg-jsonb-keys-not-in-tier1-percentiles.sql
-- Edit the season window in ``params`` (full history is expensive on large DBs).

-- ---------------------------------------------------------------------------
-- 1) Batting: jsonb keys (numeric-ish) minus Tier‑1
-- ---------------------------------------------------------------------------
WITH params(y0, y1) AS (
  VALUES (1871, 2100) -- narrow e.g. (1998, 2025) for faster scans
),
tier1_bat(key) AS (
  VALUES
    ('wOBA'), ('xwOBA'), ('xWOBA'), ('wRC+'), ('BB%'), ('K%'), ('AVG'), ('SLG'), ('ISO'),
    ('BsR'), ('Off'), ('Def'), ('WAR'), ('Offense'), ('Defense')
),
bat_kv AS (
  SELECT
    b.season::int AS season,
    kv.key AS json_key,
    kv.value AS raw_val
  FROM fg_batting_season_current b
  CROSS JOIN LATERAL jsonb_each_text(b.stats_jsonb) AS kv(key, val)
  CROSS JOIN params p
  WHERE b.level = 'MLB'
    AND b.player_id IS NOT NULL
    AND b.season::int BETWEEN p.y0 AND p.y1
),
bat_num AS (
  SELECT
    season,
    json_key,
    raw_val,
    CASE
      WHEN trim(raw_val) IS NULL OR trim(raw_val) = '' OR lower(trim(raw_val)) IN ('nan', 'null', '-')
        THEN NULL
      WHEN trim(raw_val) !~ '^[[:space:]]*[+-]?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$'
        THEN NULL
      ELSE trim(raw_val)::double precision
    END AS v
  FROM bat_kv
),
bat_agg AS (
  SELECT
    json_key,
    COUNT(*)::bigint AS json_key_occurrences,
    COUNT(*) FILTER (WHERE v IS NOT NULL)::bigint AS rows_numeric_parse_ok,
    MIN(season) FILTER (WHERE v IS NOT NULL) AS min_season_numeric,
    MAX(season) FILTER (WHERE v IS NOT NULL) AS max_season_numeric
  FROM bat_num
  GROUP BY json_key
)
SELECT
  'batting'::text AS role,
  a.json_key,
  a.json_key_occurrences,
  a.rows_numeric_parse_ok,
  a.min_season_numeric,
  a.max_season_numeric
FROM bat_agg a
WHERE NOT EXISTS (SELECT 1 FROM tier1_bat t WHERE t.key = a.json_key)
  -- Drop obvious identity / label keys (not rate stats).
  AND a.json_key !~* '^(idfg|season|team|level|playerid|playername|name|teamnameabb|position|pos)$'
ORDER BY a.rows_numeric_parse_ok DESC, a.json_key;

-- ---------------------------------------------------------------------------
-- 2) Pitching: jsonb keys (numeric-ish) minus Tier‑1
-- ---------------------------------------------------------------------------
WITH params(y0, y1) AS (
  VALUES (1871, 2100) -- keep in sync with query (1) window
),
tier1_pit(key) AS (
  VALUES
    ('xERA'), ('xFIP'), ('WAR'),
    ('RA9-WAR'), ('RA9 WAR'), ('RA9-Wins'), ('RA9_WAR'), ('RA9WAR'), ('WAR_RA9')
),
pit_kv AS (
  SELECT
    f.season::int AS season,
    kv.key AS json_key,
    kv.value AS raw_val
  FROM fg_pitching_season_current f
  CROSS JOIN LATERAL jsonb_each_text(f.stats_jsonb) AS kv(key, val)
  CROSS JOIN params p
  WHERE f.level = 'MLB'
    AND f.player_id IS NOT NULL
    AND f.season::int BETWEEN p.y0 AND p.y1
),
pit_num AS (
  SELECT
    season,
    json_key,
    raw_val,
    CASE
      WHEN trim(raw_val) IS NULL OR trim(raw_val) = '' OR lower(trim(raw_val)) IN ('nan', 'null', '-')
        THEN NULL
      WHEN trim(raw_val) !~ '^[[:space:]]*[+-]?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$'
        THEN NULL
      ELSE trim(raw_val)::double precision
    END AS v
  FROM pit_kv
),
pit_agg AS (
  SELECT
    json_key,
    COUNT(*)::bigint AS json_key_occurrences,
    COUNT(*) FILTER (WHERE v IS NOT NULL)::bigint AS rows_numeric_parse_ok,
    MIN(season) FILTER (WHERE v IS NOT NULL) AS min_season_numeric,
    MAX(season) FILTER (WHERE v IS NOT NULL) AS max_season_numeric
  FROM pit_num
  GROUP BY json_key
)
SELECT
  'pitching'::text AS role,
  a.json_key,
  a.json_key_occurrences,
  a.rows_numeric_parse_ok,
  a.min_season_numeric,
  a.max_season_numeric
FROM pit_agg a
WHERE NOT EXISTS (SELECT 1 FROM tier1_pit t WHERE t.key = a.json_key)
  AND a.json_key !~* '^(idfg|season|team|level|playerid|playername|name|teamnameabb)$'
ORDER BY a.rows_numeric_parse_ok DESC, a.json_key;

-- ---------------------------------------------------------------------------
-- 3) Optional: typed columns on FG season tables with **no** fg_season_* percentile yet
--    (same repo as Tier‑1; useful for era tools even when the value is not only in jsonb).
-- ---------------------------------------------------------------------------
SELECT 'typed_batting_columns' AS note,
       unnest(ARRAY['obp', 'babip'])::text AS column_name,
       'Consider fg_season_obp / fg_season_babip midrank vs PA-qualified cohort'::text AS hint
UNION ALL
SELECT 'typed_pitching_columns',
       unnest(ARRAY['era', 'fip', 'k_per_9', 'bb_per_9', 'hr_per_9', 'babip', 'lob_pct', 'gb_pct', 'hr_fb_pct', 'vfa']),
       'Pitching card already has typed cols; league percentiles not wired for these yet';
