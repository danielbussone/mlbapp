/**
 * Single-player PA-weighted primary position (keep in sync with Flyway V29
 * ``mv_fg_batter_jaws_primary_pos`` bucket rules). Scoped by ``rid`` for performance.
 */
export const JAWS_BATTER_PRIMARY_POSITION_SCOPED_SQL = `
WITH rid AS (
  SELECT DISTINCT c.id_fg
  FROM fg_batting_career_mlb c
  WHERE c.player_id = $1
  UNION
  SELECT (m.id_value)::integer AS id_fg
  FROM player_external_identifier m
  WHERE m.player_id = $1
    AND m.id_system = 'fangraphs'
    AND m.id_value ~ '^[0-9]+$'
),
bat_has_tot AS (
  SELECT b.id_fg, b.season, b.level, BOOL_OR(b.team = 'TOT') AS has_tot
  FROM fg_batting_season_current b
  INNER JOIN rid r ON r.id_fg = b.id_fg
  WHERE b.level = 'MLB'
  GROUP BY b.id_fg, b.season, b.level
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
    b.pa::numeric AS row_pa,
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
  INNER JOIN rid r ON r.id_fg = c.id_fg
),
joined_season AS (
  SELECT
    p.id_fg,
    p.season,
    p.raw_pos,
    COALESCE(s.season_pa, p.row_pa, 0::numeric) AS season_pa
  FROM picked_season p
  LEFT JOIN season_pa s ON s.id_fg = p.id_fg AND s.season = p.season
),
parts AS (
  SELECT
    j.id_fg,
    j.season_pa,
    NULLIF(trim(unnest(string_to_array(j.raw_pos, '/'::text))), '') AS part,
    NULLIF(cardinality(string_to_array(j.raw_pos, '/'::text)), 0)::numeric AS n_split
  FROM joined_season j
  WHERE j.raw_pos IS NOT NULL
    AND j.season_pa > 0
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
        ('OF',  'RF',  1.0 / 3.0),
        ('PH',  'DH',  1.0),
        ('UTIL', 'DH', 1.0),
        ('UT',  'DH',  1.0),
        ('INF', '2B', 1.0 / 3.0),
        ('INF', '3B', 1.0 / 3.0),
        ('INF', 'SS', 1.0 / 3.0),
        ('MI',  '2B', 0.5),
        ('MI',  'SS', 0.5)
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
SELECT pp.jaws_position_key AS k
FROM primary_pos pp
INNER JOIN rid ON rid.id_fg = pp.id_fg
LIMIT 1
`;
