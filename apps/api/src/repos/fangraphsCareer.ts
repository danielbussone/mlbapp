import type pg from 'pg';
import { rowToJson, rowsToJson } from './rowJson.js';

/** Match FG rows to dim_player by surrogate id or fangraphs external id. */
function playerFgPredicate(alias: string): string {
  return `(
    ${alias}.player_id = $1
    OR EXISTS (
      SELECT 1 FROM player_external_identifier m
      WHERE m.player_id = $1 AND m.id_system = 'fangraphs' AND m.id_value = ${alias}.id_fg::text
    )
  )`;
}

/** id_fg candidates for this player (same disjunction as playerFgPredicate, without scanning all careers). */
function fgResolvedIdFgCte(
  consolidatedTable: 'fg_batting_season_mlb_consolidated' | 'fg_pitching_season_mlb_consolidated'
): string {
  return `
resolved_id_fg AS (
  SELECT DISTINCT id_fg FROM (
    SELECT s.id_fg
    FROM ${consolidatedTable} s
    WHERE s.player_id = $1
    UNION
    SELECT (m.id_value)::integer AS id_fg
    FROM player_external_identifier m
    WHERE m.player_id = $1
      AND m.id_system = 'fangraphs'
      AND m.id_value ~ '^[0-9]+$'
  ) x
)`;
}

/** Mirrors db/sql/V12 `fg_batting_career_mlb` but aggregates only rows for `resolved_id_fg`. */
const FG_BATTING_CAREER_SCOPED_SQL = `
WITH ${fgResolvedIdFgCte('fg_batting_season_mlb_consolidated').trim()},
agg AS (
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
  WHERE s.id_fg IN (SELECT id_fg FROM resolved_id_fg)
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
FROM agg
ORDER BY career_pa DESC NULLS LAST, id_fg
LIMIT 1
`;

/** Mirrors db/sql/V8 `fg_pitching_career_mlb` but aggregates only rows for `resolved_id_fg`. */
const FG_PITCHING_CAREER_SCOPED_SQL = `
WITH ${fgResolvedIdFgCte('fg_pitching_season_mlb_consolidated').trim()},
agg AS (
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
  WHERE s.id_fg IN (SELECT id_fg FROM resolved_id_fg)
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
FROM agg
ORDER BY career_war DESC NULLS LAST, career_games DESC NULLS LAST, id_fg
LIMIT 1
`;

export type FgBattingCardPayload = {
  career: Record<string, unknown> | null;
  seasons: Record<string, unknown>[];
  max_season: number | null;
  has_row_for_season: boolean | null;
};

/**
 * Career row matches `fg_batting_career_mlb` but aggregates only this player’s `id_fg` rows
 * (avoids computing every career in the league on each request).
 */
export async function getFgBattingCardPayload(
  pool: pg.Pool,
  playerId: number,
  options: { lastSeasons: number; forSeason: number | null; careerOnly?: boolean }
): Promise<FgBattingCardPayload> {
  const careerOnly = options.careerOnly === true;
  const lim = Math.min(Math.max(options.lastSeasons, 1), 100);
  const forSeason = options.forSeason;

  const careerSql = FG_BATTING_CAREER_SCOPED_SQL;

  const careerParams = [playerId];

  if (careerOnly) {
    const careerRes = await pool.query(careerSql, careerParams);
    const careerRow = careerRes.rows[0];
    return {
      career: careerRow ? rowToJson(careerRow as Record<string, unknown>) : null,
      seasons: [],
      max_season: null,
      has_row_for_season: null,
    };
  }

  const seasonsSql = `
    SELECT s.*
    FROM fg_batting_season_mlb_consolidated s
    WHERE ${playerFgPredicate('s')}
    ORDER BY s.season DESC
    LIMIT $2
  `;

  const metaSql = `
    SELECT
      MAX(s.season)::integer AS max_season,
      ${
        forSeason == null
          ? 'NULL::boolean AS has_row'
          : `BOOL_OR(s.season = $2::smallint) AS has_row`
      }
    FROM fg_batting_season_mlb_consolidated s
    WHERE ${playerFgPredicate('s')}
  `;

  const seasonsParams = [playerId, lim];
  const metaParams = forSeason == null ? [playerId] : [playerId, forSeason];

  const [careerRes, seasonsRes, metaRes] = await Promise.all([
    pool.query(careerSql, careerParams),
    pool.query(seasonsSql, seasonsParams),
    pool.query(metaSql, metaParams),
  ]);

  const careerRow = careerRes.rows[0];
  const meta = metaRes.rows[0] as { max_season: number | null; has_row: boolean | null };

  return {
    career: careerRow ? rowToJson(careerRow as Record<string, unknown>) : null,
    seasons: rowsToJson(seasonsRes.rows as Record<string, unknown>[]),
    max_season: meta?.max_season ?? null,
    has_row_for_season: forSeason == null ? null : meta?.has_row ?? null,
  };
}

/**
 * Career row matches `fg_pitching_career_mlb` but aggregates only this player’s `id_fg` rows.
 */
export async function getFgPitchingCardPayload(
  pool: pg.Pool,
  playerId: number,
  options: { lastSeasons: number; forSeason: number | null; careerOnly?: boolean }
): Promise<FgBattingCardPayload> {
  const careerOnly = options.careerOnly === true;
  const lim = Math.min(Math.max(options.lastSeasons, 1), 100);
  const forSeason = options.forSeason;

  const careerSql = FG_PITCHING_CAREER_SCOPED_SQL;

  const careerParams = [playerId];

  if (careerOnly) {
    const careerRes = await pool.query(careerSql, careerParams);
    const careerRow = careerRes.rows[0];
    return {
      career: careerRow ? rowToJson(careerRow as Record<string, unknown>) : null,
      seasons: [],
      max_season: null,
      has_row_for_season: null,
    };
  }

  const seasonsSql = `
    SELECT s.*
    FROM fg_pitching_season_mlb_consolidated s
    WHERE ${playerFgPredicate('s')}
    ORDER BY s.season DESC
    LIMIT $2
  `;

  const metaSql = `
    SELECT
      MAX(s.season)::integer AS max_season,
      ${
        forSeason == null
          ? 'NULL::boolean AS has_row'
          : `BOOL_OR(s.season = $2::smallint) AS has_row`
      }
    FROM fg_pitching_season_mlb_consolidated s
    WHERE ${playerFgPredicate('s')}
  `;

  const seasonsParams = [playerId, lim];
  const metaParams = forSeason == null ? [playerId] : [playerId, forSeason];

  const [careerRes, seasonsRes, metaRes] = await Promise.all([
    pool.query(careerSql, careerParams),
    pool.query(seasonsSql, seasonsParams),
    pool.query(metaSql, metaParams),
  ]);

  const careerRow = careerRes.rows[0];
  const meta = metaRes.rows[0] as { max_season: number | null; has_row: boolean | null };

  return {
    career: careerRow ? rowToJson(careerRow as Record<string, unknown>) : null,
    seasons: rowsToJson(seasonsRes.rows as Record<string, unknown>[]),
    max_season: meta?.max_season ?? null,
    has_row_for_season: forSeason == null ? null : meta?.has_row ?? null,
  };
}

/** One HTTP round-trip for batting vs pitching tab inference: two career aggregates only (no season scan). */
export async function getFgRoleHintPayload(
  pool: pg.Pool,
  playerId: number
): Promise<{ batting: FgBattingCardPayload; pitching: FgBattingCardPayload }> {
  const stub = { lastSeasons: 1, forSeason: null as number | null, careerOnly: true as const };
  const [batting, pitching] = await Promise.all([
    getFgBattingCardPayload(pool, playerId, stub),
    getFgPitchingCardPayload(pool, playerId, stub),
  ]);
  return { batting, pitching };
}
