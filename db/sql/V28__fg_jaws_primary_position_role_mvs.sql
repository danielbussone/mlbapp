-- Primary position / pitcher role for JAWS expanded **without** career PA or games minimums.
-- Used to bucket any linked batter/pitcher for HoF-only cohort percentiles (see jawsExpanded.ts).
-- Refresh after FanGraphs consolidated MVs, alongside V27 cohort MVs (etl/mlbapp_etl/fg.py).

-- ---------------------------------------------------------------------------
-- Batters: same PA-weighted primary position as mv_fg_batter_jaws_cohort (V27), no career PA floor.
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW mv_fg_batter_jaws_primary_pos AS
WITH
bat_has_tot AS (
  SELECT id_fg, season, level, BOOL_OR(team = 'TOT') AS has_tot
  FROM fg_batting_season_current
  WHERE level = 'MLB'
  GROUP BY id_fg, season, level
),
bat_filtered AS (
  SELECT b.*, h.has_tot
  FROM fg_batting_season_current b
  INNER JOIN bat_has_tot h
    ON h.id_fg = b.id_fg AND h.season = b.season AND h.level = b.level
  WHERE b.level = 'MLB'
    AND ((h.has_tot AND b.team = 'TOT') OR (NOT h.has_tot))
),
picked_season AS (
  SELECT DISTINCT ON (b.id_fg, b.season)
    b.id_fg,
    b.season::smallint AS season,
    NULLIF(
      TRIM(
        COALESCE(
          NULLIF(TRIM(b.stats_jsonb->>'Position'), ''),
          NULLIF(TRIM(b.stats_jsonb->>'position'), ''),
          NULLIF(TRIM(b.stats_jsonb->>'primary_position'), ''),
          NULLIF(TRIM(b.stats_jsonb->>'Pos'), '')
        )
      ),
      ''
    ) AS raw_pos
  FROM bat_filtered b
  ORDER BY
    b.id_fg,
    b.season,
    CASE WHEN b.team = 'TOT' THEN 0 ELSE 1 END,
    b.pa DESC NULLS LAST
),
season_pa AS (
  SELECT c.id_fg, c.season::smallint AS season, c.pa::numeric AS season_pa
  FROM fg_batting_season_mlb_consolidated c
),
joined_season AS (
  SELECT p.id_fg, p.season, p.raw_pos, s.season_pa
  FROM picked_season p
  INNER JOIN season_pa s ON s.id_fg = p.id_fg AND s.season = p.season
),
parts AS (
  SELECT
    j.id_fg,
    j.season_pa,
    NULLIF(trim(unnest(string_to_array(j.raw_pos, '/'::text))), '') AS part,
    NULLIF(cardinality(string_to_array(j.raw_pos, '/'::text)), 0)::numeric AS n_split
  FROM joined_season j
  WHERE j.raw_pos IS NOT NULL
),
norm_tok AS (
  SELECT
    id_fg,
    season_pa / NULLIF(n_split, 0) AS pa_share,
    upper(regexp_replace(trim(part), '\s+', '', 'g')) AS utok
  FROM parts
  WHERE trim(part) <> ''
    AND trim(part) !~ '^[0-9]+(\.[0-9]+)?$'
),
bucket_rows AS (
  SELECT n.id_fg, x.pos_key, x.contrib
  FROM norm_tok n
  CROSS JOIN LATERAL (
    SELECT v.pos_key, v.contrib_mult * n.pa_share AS contrib
    FROM (
      VALUES
        ('C',   'C'::text,   1.0::numeric),
        ('1B',  '1B',  1.0),
        ('2B',  '2B',  1.0),
        ('3B',  '3B',  1.0),
        ('SS',  'SS',  1.0),
        ('LF',  'LF',  1.0),
        ('CF',  'CF',  1.0),
        ('RF',  'RF',  1.0),
        ('DH',  'DH',  1.0),
        ('OF',  'LF',  1.0 / 3.0),
        ('OF',  'CF',  1.0 / 3.0),
        ('OF',  'RF',  1.0 / 3.0)
    ) AS v(ut, pos_key, contrib_mult)
    WHERE v.ut = n.utok
  ) AS x(pos_key, contrib)
),
agg_pos AS (
  SELECT id_fg, pos_key, SUM(contrib) AS pos_pa
  FROM bucket_rows
  GROUP BY id_fg, pos_key
),
primary_pos AS (
  SELECT DISTINCT ON (id_fg)
    id_fg,
    pos_key AS jaws_position_key
  FROM agg_pos
  ORDER BY id_fg, pos_pa DESC, pos_key ASC
)
SELECT
  c.id_fg,
  c.player_id,
  pp.jaws_position_key
FROM fg_batting_career_mlb c
INNER JOIN primary_pos pp ON pp.id_fg = c.id_fg
WHERE c.player_id IS NOT NULL
  AND pp.jaws_position_key IS NOT NULL;

CREATE UNIQUE INDEX mv_fg_batter_jaws_primary_pos_id_fg_uidx ON mv_fg_batter_jaws_primary_pos (id_fg);
CREATE INDEX mv_fg_batter_jaws_primary_pos_player_idx ON mv_fg_batter_jaws_primary_pos (player_id);
CREATE INDEX mv_fg_batter_jaws_primary_pos_pos_idx ON mv_fg_batter_jaws_primary_pos (jaws_position_key);

COMMENT ON MATERIALIZED VIEW mv_fg_batter_jaws_primary_pos IS
  'PA-weighted primary fielding position for all batters with linked player_id (no career PA minimum).';

-- ---------------------------------------------------------------------------
-- Pitchers: SP/RP/SP_RP heuristic (V27), **without** career_games >= 150 filter.
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW mv_fg_pitcher_jaws_primary_role AS
WITH
peak AS (
  SELECT id_fg, SUM(war)::double precision AS peak_war_fwar
  FROM (
    SELECT
      s.id_fg,
      s.war,
      ROW_NUMBER() OVER (PARTITION BY s.id_fg ORDER BY s.war DESC NULLS LAST) AS rn
    FROM fg_pitching_season_mlb_consolidated s
    WHERE s.war IS NOT NULL
  ) t
  WHERE t.rn <= 7
  GROUP BY id_fg
),
usage AS (
  SELECT
    c.id_fg,
    c.player_id,
    CASE
      WHEN c.career_games IS NULL OR c.career_games <= 0 THEN NULL
      WHEN c.career_games >= 8
        AND (c.career_games_started >= 10 OR (c.career_games_started::numeric / c.career_games::numeric) >= 0.55)
        THEN 'SP'
      WHEN c.career_games >= 15
        AND (c.career_games_started <= 2 OR (c.career_games_started::numeric / NULLIF(c.career_games::numeric, 0)) <= 0.1)
        THEN 'RP'
      WHEN (c.career_games_started::numeric / NULLIF(c.career_games::numeric, 0)) >= 0.42 AND c.career_games_started >= 3
        THEN 'SP'
      WHEN (c.career_games_started::numeric / NULLIF(c.career_games::numeric, 0)) <= 0.2 AND c.career_games >= 10
        THEN 'RP'
      WHEN c.career_games >= 12 THEN 'SP_RP'
      ELSE NULL
    END AS jaws_position_key
  FROM fg_pitching_career_mlb c
  INNER JOIN peak pk ON pk.id_fg = c.id_fg
  WHERE c.player_id IS NOT NULL
    AND c.career_war IS NOT NULL
    AND pk.peak_war_fwar IS NOT NULL
)
SELECT
  u.id_fg,
  u.player_id,
  u.jaws_position_key
FROM usage u
WHERE u.jaws_position_key IS NOT NULL;

CREATE UNIQUE INDEX mv_fg_pitcher_jaws_primary_role_id_fg_uidx ON mv_fg_pitcher_jaws_primary_role (id_fg);
CREATE INDEX mv_fg_pitcher_jaws_primary_role_player_idx ON mv_fg_pitcher_jaws_primary_role (player_id);
CREATE INDEX mv_fg_pitcher_jaws_primary_role_pos_idx ON mv_fg_pitcher_jaws_primary_role (jaws_position_key);

COMMENT ON MATERIALIZED VIEW mv_fg_pitcher_jaws_primary_role IS
  'SP/RP/SP_RP bucket for pitchers with linked player_id (no career games minimum).';
