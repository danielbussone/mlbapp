-- FanGraphs career OBP display matches (H + walks + HBP) / (AB + walks + HBP + SF + SH):
-- sacrifice flies in the denominator only (validated vs FG career line for Trout ~.407).

DROP VIEW IF EXISTS fg_batting_career_mlb CASCADE;

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
  'MLB batting career: walks from sum(bb_pct*pa); OBP = (H+walks+HBP)/(AB+walks+HBP+SF+SH) per FanGraphs career display (SF denominator only).';
