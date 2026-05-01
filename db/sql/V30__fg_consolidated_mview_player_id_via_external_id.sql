-- ``fg_*_season_mlb_consolidated`` used ``MAX(b.player_id)`` from FG season rows only.
-- When FanGraphs ETL runs without ``--link-players``, ``player_id`` stays null on ``fg_*_season``
-- even if ``player_external_identifier`` (Fangraphs) maps ``id_fg`` → ``dim_player``.
-- Career views and JAWS matviews then have no ``player_id`` → empty cohort MVs and HoF joins of 0.
--
-- This migration recreates the consolidated MVs with the same COALESCE pattern as
-- ``fg_batting_season_mlb_merged_rates`` / ``fg_pitching_season_mlb_merged_stats`` (V20),
-- then restores career views and JAWS matviews (V27 cohort + V29 primary).

DROP MATERIALIZED VIEW IF EXISTS mv_fg_pitcher_jaws_primary_role;
DROP MATERIALIZED VIEW IF EXISTS mv_fg_pitcher_jaws_cohort;
DROP MATERIALIZED VIEW IF EXISTS mv_fg_batter_jaws_primary_pos;
DROP MATERIALIZED VIEW IF EXISTS mv_fg_batter_jaws_cohort;

DROP VIEW IF EXISTS fg_batting_career_mlb CASCADE;
DROP VIEW IF EXISTS fg_pitching_career_mlb CASCADE;

DROP MATERIALIZED VIEW IF EXISTS fg_batting_season_mlb_consolidated;
DROP MATERIALIZED VIEW IF EXISTS fg_pitching_season_mlb_consolidated;

-- ---------------------------------------------------------------------------
-- Batting consolidated (V13 + resolved player_id)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW fg_batting_season_mlb_consolidated AS
WITH has_tot AS (
  SELECT
    id_fg,
    season,
    level,
    BOOL_OR(team = 'TOT') AS has_tot
  FROM fg_batting_season_current
  WHERE level = 'MLB'
  GROUP BY id_fg, season, level
),
filtered AS (
  SELECT b.*, h.has_tot
  FROM fg_batting_season_current b
  INNER JOIN has_tot h
    ON h.id_fg = b.id_fg AND h.season = b.season AND h.level = b.level
  WHERE b.level = 'MLB'
    AND ((h.has_tot AND b.team = 'TOT') OR (NOT h.has_tot))
),
filtered_res AS (
  SELECT
    b.*,
    COALESCE(
      b.player_id,
      (
        SELECT pe.player_id
        FROM player_external_identifier pe
        WHERE pe.id_system = 'fangraphs'
          AND pe.id_value = b.id_fg::text
        ORDER BY pe.player_id
        LIMIT 1
      )
    ) AS resolved_player_id
  FROM filtered b
),
season_agg AS (
  SELECT
    b.id_fg,
    b.season,
    b.level,
    MAX(b.resolved_player_id) AS player_id,
    BOOL_OR(b.rate_stat_qualified IS TRUE) AS season_rate_stat_qualified,
    SUM(b.games)::integer AS games,
    SUM(b.pa)::bigint AS pa,
    SUM(b.hr)::bigint AS hr,
    SUM(b.r)::bigint AS r,
    SUM(b.rbi)::bigint AS rbi,
    SUM(b.sb)::bigint AS sb,
    SUM(b.war)::numeric AS war,
    SUM(b.off_runs)::numeric AS off_runs,
    SUM(b.def_runs)::numeric AS def_runs,
    SUM(b.bsr)::numeric AS bsr,
    SUM(b.wrc_plus::numeric * b.pa::numeric) FILTER (WHERE b.wrc_plus IS NOT NULL) AS wrc_plus_pa_num,
    SUM(b.pa) FILTER (WHERE b.wrc_plus IS NOT NULL) AS wrc_plus_pa_den,
    SUM(b.woba::numeric * b.pa::numeric) FILTER (WHERE b.woba IS NOT NULL) AS woba_pa_num,
    SUM(b.pa) FILTER (WHERE b.woba IS NOT NULL) AS woba_pa_den,
    SUM(b.xwoba::numeric * b.pa::numeric) FILTER (WHERE b.xwoba IS NOT NULL) AS xwoba_pa_num,
    SUM(b.pa) FILTER (WHERE b.xwoba IS NOT NULL) AS xwoba_pa_den,
    SUM((b.stats_jsonb->>'H')::numeric) FILTER (WHERE b.stats_jsonb ? 'H') AS h,
    SUM((b.stats_jsonb->>'AB')::numeric) FILTER (WHERE b.stats_jsonb ? 'AB') AS ab,
    SUM((b.stats_jsonb->>'BB')::numeric) FILTER (WHERE b.stats_jsonb ? 'BB') AS bb,
    SUM((b.stats_jsonb->>'IBB')::numeric) FILTER (WHERE b.stats_jsonb ? 'IBB') AS ibb,
    SUM((b.stats_jsonb->>'HBP')::numeric) FILTER (WHERE b.stats_jsonb ? 'HBP') AS hbp,
    SUM((b.stats_jsonb->>'SF')::numeric) FILTER (WHERE b.stats_jsonb ? 'SF') AS sf,
    SUM((b.stats_jsonb->>'SH')::numeric) FILTER (WHERE b.stats_jsonb ? 'SH') AS sh,
    SUM((b.stats_jsonb->>'SO')::numeric) FILTER (WHERE b.stats_jsonb ? 'SO') AS so,
    SUM(
      COALESCE(
        NULLIF((b.stats_jsonb->>'TB'), '')::numeric,
        COALESCE(NULLIF((b.stats_jsonb->>'1B'), '')::numeric, 0)
          + 2 * COALESCE(NULLIF((b.stats_jsonb->>'2B'), '')::numeric, 0)
          + 3 * COALESCE(NULLIF((b.stats_jsonb->>'3B'), '')::numeric, 0)
          + 4 * b.hr::numeric
      )
    ) AS tb,
    SUM(
      COALESCE(
        b.bb_pct::numeric * b.pa::numeric,
        (NULLIF((b.stats_jsonb->>'BB'), ''))::numeric
      )
    ) AS walks_bb_pct_pa,
    MAX(b.ingest_pulled_at) AS latest_ingest_pulled_at
  FROM filtered_res b
  GROUP BY b.id_fg, b.season, b.level
)
SELECT
  id_fg,
  season,
  level,
  player_id,
  season_rate_stat_qualified,
  games,
  pa,
  hr,
  r,
  rbi,
  sb,
  war,
  off_runs,
  def_runs,
  bsr,
  h,
  ab,
  bb,
  ibb,
  hbp,
  sf,
  sh,
  so,
  tb,
  walks_bb_pct_pa,
  CASE
    WHEN wrc_plus_pa_den IS NOT NULL AND wrc_plus_pa_den > 0
    THEN wrc_plus_pa_num / wrc_plus_pa_den
  END AS wrc_plus_pa_weighted,
  CASE
    WHEN woba_pa_den IS NOT NULL AND woba_pa_den > 0
    THEN woba_pa_num / woba_pa_den
  END AS woba_pa_weighted,
  CASE
    WHEN xwoba_pa_den IS NOT NULL AND xwoba_pa_den > 0
    THEN xwoba_pa_num / xwoba_pa_den
  END AS xwoba_pa_weighted,
  wrc_plus_pa_num,
  wrc_plus_pa_den,
  woba_pa_num,
  woba_pa_den,
  xwoba_pa_num,
  xwoba_pa_den,
  latest_ingest_pulled_at
FROM season_agg;

COMMENT ON MATERIALIZED VIEW fg_batting_season_mlb_consolidated IS
  'MLB batting one row per (id_fg, season): TOT/split merge; player_id from row or player_external_identifier (Fangraphs). V30.';

CREATE UNIQUE INDEX fg_batting_season_mlb_consolidated_mv_uidx
  ON fg_batting_season_mlb_consolidated (id_fg, season);

CREATE INDEX fg_batting_season_mlb_consolidated_player_season_idx
  ON fg_batting_season_mlb_consolidated (player_id, season DESC)
  WHERE player_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Pitching consolidated (V13 + resolved player_id)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW fg_pitching_season_mlb_consolidated AS
WITH has_tot AS (
  SELECT
    id_fg,
    season,
    level,
    BOOL_OR(team = 'TOT') AS has_tot
  FROM fg_pitching_season_current
  WHERE level = 'MLB'
  GROUP BY id_fg, season, level
),
filtered AS (
  SELECT b.*, h.has_tot
  FROM fg_pitching_season_current b
  INNER JOIN has_tot h
    ON h.id_fg = b.id_fg AND h.season = b.season AND h.level = b.level
  WHERE b.level = 'MLB'
    AND ((h.has_tot AND b.team = 'TOT') OR (NOT h.has_tot))
),
filtered_res AS (
  SELECT
    b.*,
    COALESCE(
      b.player_id,
      (
        SELECT pe.player_id
        FROM player_external_identifier pe
        WHERE pe.id_system = 'fangraphs'
          AND pe.id_value = b.id_fg::text
        ORDER BY pe.player_id
        LIMIT 1
      )
    ) AS resolved_player_id
  FROM filtered b
),
season_agg AS (
  SELECT
    b.id_fg,
    b.season,
    b.level,
    MAX(b.resolved_player_id) AS player_id,
    BOOL_OR(b.rate_stat_qualified IS TRUE) AS season_rate_stat_qualified,
    SUM(b.games)::integer AS games,
    SUM(b.games_started)::integer AS games_started,
    SUM(b.w)::integer AS w,
    SUM(b.l)::integer AS l,
    SUM(b.sv)::integer AS sv,
    SUM(b.war)::numeric AS war,
    SUM(mlb_ip_display_to_outs(b.ip::double precision)) AS ip_outs,
    SUM((b.stats_jsonb->>'ER')::numeric) FILTER (WHERE b.stats_jsonb ? 'ER') AS er,
    SUM((b.stats_jsonb->>'SO')::numeric) FILTER (WHERE b.stats_jsonb ? 'SO') AS so,
    SUM((b.stats_jsonb->>'BB')::numeric) FILTER (WHERE b.stats_jsonb ? 'BB') AS bb,
    SUM((b.stats_jsonb->>'IBB')::numeric) FILTER (WHERE b.stats_jsonb ? 'IBB') AS ibb,
    SUM((b.stats_jsonb->>'HR')::numeric) FILTER (WHERE b.stats_jsonb ? 'HR') AS hr,
    SUM((b.stats_jsonb->>'TBF')::numeric) FILTER (WHERE b.stats_jsonb ? 'TBF') AS tbf,
    SUM(
      CASE
        WHEN b.fip IS NOT NULL AND mlb_ip_display_to_outs(b.ip::double precision) IS NOT NULL
        THEN b.fip::numeric * (mlb_ip_display_to_outs(b.ip::double precision)::numeric / 3.0)
      END
    ) AS fip_innings_num,
    SUM(
      CASE
        WHEN mlb_ip_display_to_outs(b.ip::double precision) IS NOT NULL
        THEN mlb_ip_display_to_outs(b.ip::double precision)::numeric / 3.0
      END
    ) AS innings_for_fip,
    MAX(b.ingest_pulled_at) AS latest_ingest_pulled_at
  FROM filtered_res b
  GROUP BY b.id_fg, b.season, b.level
)
SELECT
  id_fg,
  season,
  level,
  player_id,
  season_rate_stat_qualified,
  games,
  games_started,
  w,
  l,
  sv,
  war,
  ip_outs,
  er,
  so,
  bb,
  ibb,
  hr,
  tbf,
  CASE
    WHEN er IS NOT NULL AND ip_outs IS NOT NULL AND ip_outs > 0
    THEN (er::numeric * 27.0 / ip_outs::numeric)::numeric(6, 2)
  END AS era,
  CASE
    WHEN fip_innings_num IS NOT NULL AND innings_for_fip IS NOT NULL AND innings_for_fip > 0
    THEN (fip_innings_num / innings_for_fip)::numeric(6, 2)
  END AS fip_innings_weighted,
  CASE
    WHEN so IS NOT NULL AND tbf IS NOT NULL AND tbf > 0
    THEN (so::numeric / tbf::numeric)::numeric(8, 4)
  END AS k_pct,
  CASE
    WHEN tbf IS NOT NULL AND tbf > 0
    THEN ((COALESCE(bb, 0) + COALESCE(ibb, 0)) / tbf::numeric)::numeric(8, 4)
  END AS bb_pct,
  CASE
    WHEN hr IS NOT NULL AND tbf IS NOT NULL AND tbf > 0
    THEN (hr::numeric / tbf::numeric)::numeric(8, 4)
  END AS hr_pct,
  fip_innings_num,
  innings_for_fip,
  latest_ingest_pulled_at
FROM season_agg;

COMMENT ON MATERIALIZED VIEW fg_pitching_season_mlb_consolidated IS
  'MLB pitching one row per (id_fg, season): TOT/split merge; player_id from row or player_external_identifier (Fangraphs). V30.';

CREATE UNIQUE INDEX fg_pitching_season_mlb_consolidated_mv_uidx
  ON fg_pitching_season_mlb_consolidated (id_fg, season);

CREATE INDEX fg_pitching_season_mlb_consolidated_player_season_idx
  ON fg_pitching_season_mlb_consolidated (player_id, season DESC)
  WHERE player_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Career views (V13)
-- ---------------------------------------------------------------------------
CREATE VIEW fg_batting_career_mlb AS
WITH agg AS (
  SELECT
    s.id_fg,
    MAX(s.player_id) AS player_id,
    COUNT(*)::integer AS seasons_count,
    MIN(s.season) AS first_season,
    MAX(s.season) AS last_season,
    COUNT(*) FILTER (WHERE s.season_rate_stat_qualified) AS seasons_rate_stat_qualified,
    SUM(s.games)::bigint AS career_games,
    SUM(s.pa) AS career_pa,
    SUM(s.hr) AS career_hr,
    SUM(s.r) AS career_r,
    SUM(s.rbi) AS career_rbi,
    SUM(s.sb) AS career_sb,
    SUM(s.war) AS career_war,
    SUM(s.off_runs) AS career_off_runs,
    SUM(s.def_runs) AS career_def_runs,
    SUM(s.bsr) AS career_bsr,
    SUM(s.h) AS sum_h,
    SUM(s.ab) AS sum_ab,
    SUM(s.bb) AS sum_bb,
    SUM(s.ibb) AS sum_ibb,
    SUM(s.hbp) AS sum_hbp,
    SUM(s.sf) AS sum_sf,
    SUM(s.sh) AS sum_sh,
    SUM(s.so) AS sum_so,
    SUM(s.tb) AS sum_tb,
    SUM(s.walks_bb_pct_pa) AS sum_walks_bb_pct_pa,
    CASE
      WHEN SUM(s.wrc_plus_pa_num) IS NOT NULL AND SUM(s.wrc_plus_pa_den) > 0
      THEN SUM(s.wrc_plus_pa_num) / SUM(s.wrc_plus_pa_den)
    END AS career_wrc_plus_pa_weighted,
    CASE
      WHEN SUM(s.woba_pa_num) IS NOT NULL AND SUM(s.woba_pa_den) > 0
      THEN SUM(s.woba_pa_num) / SUM(s.woba_pa_den)
    END AS career_woba_pa_weighted,
    CASE
      WHEN SUM(s.xwoba_pa_num) IS NOT NULL AND SUM(s.xwoba_pa_den) > 0
      THEN SUM(s.xwoba_pa_num) / SUM(s.xwoba_pa_den)
    END AS career_xwoba_pa_weighted,
    MAX(s.latest_ingest_pulled_at) AS latest_ingest_pulled_at
  FROM fg_batting_season_mlb_consolidated s
  GROUP BY s.id_fg
)
SELECT
  id_fg,
  player_id,
  seasons_count,
  first_season,
  last_season,
  seasons_rate_stat_qualified,
  career_games,
  career_pa,
  sum_h AS career_h,
  sum_ab AS career_ab,
  career_hr,
  career_r,
  career_rbi,
  career_sb,
  career_war,
  career_off_runs,
  career_def_runs,
  career_bsr,
  career_wrc_plus_pa_weighted,
  career_woba_pa_weighted,
  career_xwoba_pa_weighted,
  (sum_h / NULLIF(sum_ab, 0))::numeric(8, 4) AS career_avg,
  (
    (sum_h + COALESCE(sum_walks_bb_pct_pa, 0) + COALESCE(sum_hbp, 0))
    / NULLIF(
      sum_ab + COALESCE(sum_walks_bb_pct_pa, 0) + COALESCE(sum_hbp, 0) + COALESCE(sum_sf, 0) + COALESCE(sum_sh, 0),
      0
    )
  )::numeric(8, 4) AS career_obp,
  (sum_tb / NULLIF(sum_ab, 0))::numeric(8, 4) AS career_slg,
  (
    (sum_h + COALESCE(sum_walks_bb_pct_pa, 0) + COALESCE(sum_hbp, 0))
    / NULLIF(
      sum_ab + COALESCE(sum_walks_bb_pct_pa, 0) + COALESCE(sum_hbp, 0) + COALESCE(sum_sf, 0) + COALESCE(sum_sh, 0),
      0
    )
    + (sum_tb / NULLIF(sum_ab, 0))
  )::numeric(8, 4) AS career_ops,
  (sum_so / NULLIF(career_pa, 0))::numeric(8, 4) AS career_k_pct,
  (sum_walks_bb_pct_pa / NULLIF(career_pa, 0))::numeric(8, 4) AS career_bb_pct,
  (career_hr::numeric / NULLIF(career_pa, 0))::numeric(8, 4) AS career_hr_pct,
  latest_ingest_pulled_at
FROM agg;

COMMENT ON VIEW fg_batting_career_mlb IS
  'MLB batting career from MV fg_batting_season_mlb_consolidated; OBP/BB% per V9–V12; career_h / career_ab = Σ H / Σ AB.';

CREATE VIEW fg_pitching_career_mlb AS
WITH agg AS (
  SELECT
    s.id_fg,
    MAX(s.player_id) AS player_id,
    COUNT(*)::integer AS seasons_count,
    MIN(s.season) AS first_season,
    MAX(s.season) AS last_season,
    COUNT(*) FILTER (WHERE s.season_rate_stat_qualified) AS seasons_rate_stat_qualified,
    SUM(s.games)::bigint AS career_games,
    SUM(s.games_started)::bigint AS career_games_started,
    SUM(s.w)::bigint AS career_w,
    SUM(s.l)::bigint AS career_l,
    SUM(s.sv)::bigint AS career_sv,
    SUM(s.war) AS career_war,
    SUM(s.ip_outs) AS career_ip_outs,
    SUM(s.er) AS career_er,
    SUM(s.so) AS career_so,
    SUM(s.bb) AS career_bb,
    SUM(s.ibb) AS career_ibb,
    SUM(s.hr) AS career_hr,
    SUM(s.tbf) AS career_tbf,
    SUM(s.fip_innings_num) AS sum_fip_innings_num,
    SUM(s.innings_for_fip) AS sum_innings_for_fip,
    MAX(s.latest_ingest_pulled_at) AS latest_ingest_pulled_at
  FROM fg_pitching_season_mlb_consolidated s
  GROUP BY s.id_fg
)
SELECT
  id_fg,
  player_id,
  seasons_count,
  first_season,
  last_season,
  seasons_rate_stat_qualified,
  career_games,
  career_games_started,
  career_w,
  career_l,
  career_sv,
  career_war,
  career_ip_outs,
  (career_er::numeric * 27.0 / NULLIF(career_ip_outs::numeric, 0))::numeric(6, 2) AS career_era,
  (sum_fip_innings_num / NULLIF(sum_innings_for_fip, 0))::numeric(6, 2) AS career_fip,
  (career_so::numeric / NULLIF(career_tbf::numeric, 0))::numeric(8, 4) AS career_k_pct,
  ((COALESCE(career_bb, 0) + COALESCE(career_ibb, 0)) / NULLIF(career_tbf::numeric, 0))::numeric(8, 4) AS career_bb_pct,
  (career_hr::numeric / NULLIF(career_tbf::numeric, 0))::numeric(8, 4) AS career_hr_pct,
  latest_ingest_pulled_at
FROM agg;

COMMENT ON VIEW fg_pitching_career_mlb IS
  'MLB pitching career from MV fg_pitching_season_mlb_consolidated; ERA/FIP/K%/BB%/HR% per V8.';

-- ---------------------------------------------------------------------------
-- JAWS cohort MVs (V27)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_fg_batter_jaws_cohort AS
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
),
peak AS (
  SELECT id_fg, SUM(war)::double precision AS peak_war_fwar
  FROM (
    SELECT
      s.id_fg,
      s.war,
      ROW_NUMBER() OVER (PARTITION BY s.id_fg ORDER BY s.war DESC NULLS LAST) AS rn
    FROM fg_batting_season_mlb_consolidated s
    WHERE s.war IS NOT NULL
  ) t
  WHERE t.rn <= 7
  GROUP BY id_fg
)
SELECT
  c.id_fg,
  c.player_id,
  c.career_pa::numeric AS career_pa,
  c.career_games::bigint AS career_games,
  c.career_war::numeric AS career_war,
  pk.peak_war_fwar,
  ((c.career_war::numeric + pk.peak_war_fwar::numeric) / 2.0)::numeric(8, 2) AS jaws_fwar,
  ((c.career_war::numeric * 162.0) / NULLIF(c.career_games::numeric, 0))::numeric(8, 2) AS war_per_162,
  pp.jaws_position_key
FROM fg_batting_career_mlb c
INNER JOIN peak pk ON pk.id_fg = c.id_fg
INNER JOIN primary_pos pp ON pp.id_fg = c.id_fg
WHERE c.player_id IS NOT NULL
  AND c.career_pa >= 1500
  AND pp.jaws_position_key IS NOT NULL
  AND c.career_war IS NOT NULL
  AND pk.peak_war_fwar IS NOT NULL;

CREATE UNIQUE INDEX mv_fg_batter_jaws_cohort_id_fg_uidx ON mv_fg_batter_jaws_cohort (id_fg);
CREATE INDEX mv_fg_batter_jaws_cohort_pos_idx ON mv_fg_batter_jaws_cohort (jaws_position_key);
CREATE INDEX mv_fg_batter_jaws_cohort_player_idx ON mv_fg_batter_jaws_cohort (player_id);

COMMENT ON MATERIALIZED VIEW mv_fg_batter_jaws_cohort IS
  'Batters with career_pa>=1500, linked player_id, JAWS fWAR + PA-derived primary position. Refresh after fg_batting_season_mlb_consolidated.';

CREATE MATERIALIZED VIEW mv_fg_pitcher_jaws_cohort AS
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
    c.career_games::numeric AS g,
    c.career_games_started::numeric AS gsv,
    c.career_war::numeric AS career_war,
    pk.peak_war_fwar,
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
    AND c.career_games >= 150
    AND c.career_war IS NOT NULL
    AND pk.peak_war_fwar IS NOT NULL
)
SELECT
  u.id_fg,
  u.player_id,
  NULL::numeric AS career_pa,
  u.g::bigint AS career_games,
  u.career_war,
  u.peak_war_fwar,
  ((u.career_war + u.peak_war_fwar::numeric) / 2.0)::numeric(8, 2) AS jaws_fwar,
  ((u.career_war * 162.0) / NULLIF(u.g, 0))::numeric(8, 2) AS war_per_162,
  u.jaws_position_key
FROM usage u
WHERE u.jaws_position_key IS NOT NULL;

CREATE UNIQUE INDEX mv_fg_pitcher_jaws_cohort_id_fg_uidx ON mv_fg_pitcher_jaws_cohort (id_fg);
CREATE INDEX mv_fg_pitcher_jaws_cohort_pos_idx ON mv_fg_pitcher_jaws_cohort (jaws_position_key);
CREATE INDEX mv_fg_pitcher_jaws_cohort_player_idx ON mv_fg_pitcher_jaws_cohort (player_id);

COMMENT ON MATERIALIZED VIEW mv_fg_pitcher_jaws_cohort IS
  'Pitchers with career_games>=150, linked player_id, JAWS fWAR + SP/RP/SP_RP bucket. Refresh after fg_pitching_season_mlb_consolidated.';

-- ---------------------------------------------------------------------------
-- JAWS primary matviews (V29)
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
        ('UT',  'DH',  1.0)
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
  'PA-weighted primary fielding position (V29: coalesce PA from season current; PH/UTIL/UT→DH).';

CREATE MATERIALIZED VIEW mv_fg_pitcher_jaws_primary_role AS
SELECT u.id_fg, u.player_id, u.jaws_position_key
FROM (
  SELECT
    c.id_fg,
    c.player_id,
    CASE
      WHEN c.career_games IS NULL OR c.career_games <= 0 THEN NULL::text
      WHEN c.career_games >= 8
        AND (
          c.career_games_started >= 10
          OR (c.career_games_started::numeric / c.career_games::numeric) >= 0.55
        )
        THEN 'SP'
      WHEN c.career_games >= 15
        AND (
          c.career_games_started <= 2
          OR (c.career_games_started::numeric / NULLIF(c.career_games::numeric, 0)) <= 0.1
        )
        THEN 'RP'
      WHEN (c.career_games_started::numeric / NULLIF(c.career_games::numeric, 0)) >= 0.42
        AND c.career_games_started >= 3
        THEN 'SP'
      WHEN (c.career_games_started::numeric / NULLIF(c.career_games::numeric, 0)) <= 0.2
        AND c.career_games >= 10
        THEN 'RP'
      WHEN c.career_games >= 12 THEN 'SP_RP'
      ELSE NULL::text
    END AS jaws_position_key
  FROM fg_pitching_career_mlb c
  WHERE c.player_id IS NOT NULL
) u
WHERE u.jaws_position_key IS NOT NULL;

CREATE UNIQUE INDEX mv_fg_pitcher_jaws_primary_role_id_fg_uidx ON mv_fg_pitcher_jaws_primary_role (id_fg);
CREATE INDEX mv_fg_pitcher_jaws_primary_role_player_idx ON mv_fg_pitcher_jaws_primary_role (player_id);
CREATE INDEX mv_fg_pitcher_jaws_primary_role_pos_idx ON mv_fg_pitcher_jaws_primary_role (jaws_position_key);

COMMENT ON MATERIALIZED VIEW mv_fg_pitcher_jaws_primary_role IS
  'SP/RP/SP_RP from career GS/G only (V29: no peak-WAR dependency).';
