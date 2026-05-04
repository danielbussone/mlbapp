import type pg from 'pg';
import { playerFgPredicate, playerFgPredicateConsolidated } from './fangraphsFielding.js';
import { rowToJson, rowsToJson } from './rowJson.js';

/** Reject pure-numeric FG values mis-mapped as position (e.g. rate columns under `Pos`). */
function sanitizeFgPositionDisplay(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

/**
 * Pitcher header chip: SP / RP / SP·RP from FanGraphs consolidated games / games started.
 */
function pitcherUsageRoleLabel(gamesStarted: unknown, games: unknown): string | null {
  const k = pitcherJawsCohortRoleKey(gamesStarted, games);
  if (k === 'SP_RP') return 'SP/RP';
  return k;
}

/**
 * SP / RP / SP_RP bucket matching ``mv_fg_pitcher_jaws_cohort`` / primary-role matviews (underscore).
 * Uses **career** games and games started only (no peak-WAR requirement).
 */
export function pitcherJawsCohortRoleKey(
  careerGamesStarted: unknown,
  careerGames: unknown
): 'SP' | 'RP' | 'SP_RP' | null {
  const g = typeof careerGames === 'number' ? careerGames : Number(careerGames);
  const gsvRaw = typeof careerGamesStarted === 'number' ? careerGamesStarted : Number(careerGamesStarted);
  if (!Number.isFinite(g) || g <= 0) return null;
  const gsv = Number.isFinite(gsvRaw) && gsvRaw >= 0 ? gsvRaw : 0;
  const r = gsv / g;
  if (g >= 8 && (gsv >= 10 || r >= 0.55)) return 'SP';
  if (g >= 15 && (gsv <= 2 || r <= 0.1)) return 'RP';
  if (r >= 0.42 && gsv >= 3) return 'SP';
  if (r <= 0.2 && g >= 10) return 'RP';
  if (g >= 12) return 'SP_RP';
  return null;
}

/** id_fg candidates for this player: ``player_id`` on consolidated rows or ``fangraphs`` external (see V36 backfill). */
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

/**
 * JAWS-style peak: **sum** of fWAR in the best seven MLB seasons (fewer rows if the career has fewer than seven WAR seasons).
 * Matches the usual BRef “7-year peak” construction; uses FanGraphs consolidated season WAR — not rWAR.
 */
const FG_BATTING_PEAK_WAR_SQL = `
WITH ${fgResolvedIdFgCte('fg_batting_season_mlb_consolidated').trim()},
top_seasons AS (
  SELECT s.war AS war
  FROM fg_batting_season_mlb_consolidated s
  WHERE s.id_fg IN (SELECT id_fg FROM resolved_id_fg)
    AND s.war IS NOT NULL
  ORDER BY s.war DESC NULLS LAST
  LIMIT 7
)
SELECT SUM(war)::double precision AS peak_war_fwar
FROM top_seasons
`;

const FG_PITCHING_PEAK_WAR_SQL = `
WITH ${fgResolvedIdFgCte('fg_pitching_season_mlb_consolidated').trim()},
top_seasons AS (
  SELECT s.war AS war
  FROM fg_pitching_season_mlb_consolidated s
  WHERE s.id_fg IN (SELECT id_fg FROM resolved_id_fg)
    AND s.war IS NOT NULL
  ORDER BY s.war DESC NULLS LAST
  LIMIT 7
)
SELECT SUM(war)::double precision AS peak_war_fwar
FROM top_seasons
`;

/** JAWS = (career WAR + peak WAR) / 2 using fWAR from consolidated FG seasons. */
function jawsFwarFromCareerAndPeak(careerWar: unknown, peakWar: unknown): number | null {
  const c = typeof careerWar === 'number' ? careerWar : careerWar != null ? Number(careerWar) : NaN;
  const p = typeof peakWar === 'number' ? peakWar : peakWar != null ? Number(peakWar) : NaN;
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  return (c + p) / 2;
}

export type FgBattingCardPayload = {
  career: Record<string, unknown> | null;
  seasons: Record<string, unknown>[];
  max_season: number | null;
  has_row_for_season: boolean | null;
  /** JAWS-style metric using FanGraphs WAR; differs from Baseball-Reference JAWS (rWAR). */
  jaws_fwar: number | null;
  /** Sum of fWAR in the best seven seasons (same basis as `jaws_fwar`). */
  peak_war_fwar: number | null;
};

/** MLB team + primary position label per season from `fg_*_season_current` (not on consolidated MV). */
async function fgBattingSeasonDisplayBySeason(
  pool: pg.Pool,
  playerId: number
): Promise<Map<number, { team_display: string; position_display: string | null }>> {
  const { rows } = await pool.query(
    `
    SELECT b.season::integer AS season, b.team
    FROM fg_batting_season_current b
    WHERE ${playerFgPredicate('b')} AND b.level = 'MLB'
    `,
    [playerId]
  );
  const teamsBySeason = new Map<number, Set<string>>();
  for (const r of rows as { season: number; team: string }[]) {
    const se = Number(r.season);
    const t = String(r.team ?? '').trim();
    if (!Number.isFinite(se) || !t) continue;
    let set = teamsBySeason.get(se);
    if (!set) {
      set = new Set();
      teamsBySeason.set(se, set);
    }
    set.add(t);
  }
  const teamLabel = (se: number): string => {
    const set = teamsBySeason.get(se);
    if (!set || set.size === 0) return '';
    if (set.has('TOT')) return 'TOT';
    const arr = [...set].filter((x) => x !== 'TOT').sort();
    if (arr.length === 0) return 'TOT';
    if (arr.length === 1) return arr[0] ?? '';
    return arr.join('/');
  };

  const posRes = await pool.query(
    `
    SELECT DISTINCT ON (b.season)
      b.season::integer AS season,
      NULLIF(
        COALESCE(
          NULLIF(TRIM(b.stats_jsonb->>'Position'), ''),
          NULLIF(TRIM(b.stats_jsonb->>'position'), ''),
          NULLIF(TRIM(b.stats_jsonb->>'primary_position'), ''),
          NULLIF(TRIM(b.stats_jsonb->>'Pos'), '')
        ),
        ''
      ) AS position_display
    FROM fg_batting_season_current b
    WHERE ${playerFgPredicate('b')} AND b.level = 'MLB'
    ORDER BY
      b.season ASC,
      CASE WHEN b.team = 'TOT' THEN 0 ELSE 1 END ASC,
      b.pa DESC NULLS LAST
    `,
    [playerId]
  );
  const posMap = new Map<number, string | null>();
  for (const r of posRes.rows as { season: number; position_display: string | null }[]) {
    posMap.set(Number(r.season), sanitizeFgPositionDisplay(r.position_display));
  }

  const out = new Map<number, { team_display: string; position_display: string | null }>();
  const seasons = new Set<number>([...teamsBySeason.keys(), ...posMap.keys()]);
  for (const se of seasons) {
    out.set(se, { team_display: teamLabel(se), position_display: posMap.get(se) ?? null });
  }
  return out;
}

async function fgPitchingSeasonDisplayBySeason(
  pool: pg.Pool,
  playerId: number
): Promise<Map<number, { team_display: string; position_display: string | null }>> {
  const { rows } = await pool.query(
    `
    SELECT f.season::integer AS season, f.team
    FROM fg_pitching_season_current f
    WHERE ${playerFgPredicate('f')} AND f.level = 'MLB'
    `,
    [playerId]
  );
  const teamsBySeason = new Map<number, Set<string>>();
  for (const r of rows as { season: number; team: string }[]) {
    const se = Number(r.season);
    const t = String(r.team ?? '').trim();
    if (!Number.isFinite(se) || !t) continue;
    let set = teamsBySeason.get(se);
    if (!set) {
      set = new Set();
      teamsBySeason.set(se, set);
    }
    set.add(t);
  }
  const teamLabel = (se: number): string => {
    const set = teamsBySeason.get(se);
    if (!set || set.size === 0) return '';
    if (set.has('TOT')) return 'TOT';
    const arr = [...set].filter((x) => x !== 'TOT').sort();
    if (arr.length === 0) return 'TOT';
    if (arr.length === 1) return arr[0] ?? '';
    return arr.join('/');
  };

  const posRes = await pool.query(
    `
    SELECT DISTINCT ON (f.season)
      f.season::integer AS season,
      NULLIF(
        COALESCE(
          NULLIF(TRIM(f.stats_jsonb->>'Position'), ''),
          NULLIF(TRIM(f.stats_jsonb->>'position'), ''),
          NULLIF(TRIM(f.stats_jsonb->>'primary_position'), ''),
          NULLIF(TRIM(f.stats_jsonb->>'Pos'), '')
        ),
        ''
      ) AS position_display
    FROM fg_pitching_season_current f
    WHERE ${playerFgPredicate('f')} AND f.level = 'MLB'
    ORDER BY
      f.season ASC,
      CASE WHEN f.team = 'TOT' THEN 0 ELSE 1 END ASC,
      f.ip DESC NULLS LAST
    `,
    [playerId]
  );
  const posMap = new Map<number, string | null>();
  for (const r of posRes.rows as { season: number; position_display: string | null }[]) {
    posMap.set(Number(r.season), sanitizeFgPositionDisplay(r.position_display));
  }

  const out = new Map<number, { team_display: string; position_display: string | null }>();
  const seasons = new Set<number>([...teamsBySeason.keys(), ...posMap.keys()]);
  for (const se of seasons) {
    out.set(se, { team_display: teamLabel(se), position_display: posMap.get(se) ?? null });
  }
  return out;
}

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
    const [careerRes, peakRes] = await Promise.all([
      pool.query(careerSql, careerParams),
      pool.query(FG_BATTING_PEAK_WAR_SQL, careerParams),
    ]);
    const careerRow = careerRes.rows[0];
    const peakWar = peakRes.rows[0]?.peak_war_fwar ?? null;
    const cw = careerRow?.career_war ?? null;
    const jaws = jawsFwarFromCareerAndPeak(cw, peakWar);
    const peakNum =
      peakWar != null && typeof peakWar === 'number'
        ? peakWar
        : peakWar != null
          ? Number(peakWar)
          : null;
    return {
      career: careerRow ? rowToJson(careerRow as Record<string, unknown>) : null,
      seasons: [],
      max_season: null,
      has_row_for_season: null,
      jaws_fwar: jaws,
      peak_war_fwar: peakNum != null && Number.isFinite(peakNum) ? peakNum : null,
    };
  }

  const seasonsSql = `
    SELECT s.*
    FROM fg_batting_season_mlb_consolidated s
    WHERE ${playerFgPredicateConsolidated('s', 'batting')}
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
    WHERE ${playerFgPredicateConsolidated('s', 'batting')}
  `;

  const seasonsParams = [playerId, lim];
  const metaParams = forSeason == null ? [playerId] : [playerId, forSeason];

  const [careerRes, peakRes, seasonsRes, metaRes, displayBySeason] = await Promise.all([
    pool.query(careerSql, careerParams),
    pool.query(FG_BATTING_PEAK_WAR_SQL, careerParams),
    pool.query(seasonsSql, seasonsParams),
    pool.query(metaSql, metaParams),
    fgBattingSeasonDisplayBySeason(pool, playerId),
  ]);

  const careerRow = careerRes.rows[0];
  const peakWar = peakRes.rows[0]?.peak_war_fwar ?? null;
  const jaws = jawsFwarFromCareerAndPeak(careerRow?.career_war ?? null, peakWar);
  const peakNum =
    peakWar != null && typeof peakWar === 'number'
      ? peakWar
      : peakWar != null
        ? Number(peakWar)
        : null;
  const meta = metaRes.rows[0] as { max_season: number | null; has_row: boolean | null };

  const seasonsJson = rowsToJson(seasonsRes.rows as Record<string, unknown>[]).map((row) => {
    const sn = Number(row.season);
    const d = displayBySeason.get(sn);
    return {
      ...row,
      team_display: d?.team_display ?? null,
      position_display: d?.position_display ?? null,
    };
  });

  return {
    career: careerRow ? rowToJson(careerRow as Record<string, unknown>) : null,
    seasons: seasonsJson,
    max_season: meta?.max_season ?? null,
    has_row_for_season: forSeason == null ? null : meta?.has_row ?? null,
    jaws_fwar: jaws,
    peak_war_fwar: peakNum != null && Number.isFinite(peakNum) ? peakNum : null,
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
    const [careerRes, peakRes] = await Promise.all([
      pool.query(careerSql, careerParams),
      pool.query(FG_PITCHING_PEAK_WAR_SQL, careerParams),
    ]);
    const careerRow = careerRes.rows[0];
    const peakWar = peakRes.rows[0]?.peak_war_fwar ?? null;
    const cw = careerRow?.career_war ?? null;
    const jaws = jawsFwarFromCareerAndPeak(cw, peakWar);
    const peakNum =
      peakWar != null && typeof peakWar === 'number'
        ? peakWar
        : peakWar != null
          ? Number(peakWar)
          : null;
    return {
      career: careerRow ? rowToJson(careerRow as Record<string, unknown>) : null,
      seasons: [],
      max_season: null,
      has_row_for_season: null,
      jaws_fwar: jaws,
      peak_war_fwar: peakNum != null && Number.isFinite(peakNum) ? peakNum : null,
    };
  }

  const seasonsSql = `
    SELECT s.*
    FROM fg_pitching_season_mlb_consolidated s
    WHERE ${playerFgPredicateConsolidated('s', 'pitching')}
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
    WHERE ${playerFgPredicateConsolidated('s', 'pitching')}
  `;

  const seasonsParams = [playerId, lim];
  const metaParams = forSeason == null ? [playerId] : [playerId, forSeason];

  const [careerRes, peakRes, seasonsRes, metaRes, displayBySeason] = await Promise.all([
    pool.query(careerSql, careerParams),
    pool.query(FG_PITCHING_PEAK_WAR_SQL, careerParams),
    pool.query(seasonsSql, seasonsParams),
    pool.query(metaSql, metaParams),
    fgPitchingSeasonDisplayBySeason(pool, playerId),
  ]);

  const careerRow = careerRes.rows[0];
  const peakWar = peakRes.rows[0]?.peak_war_fwar ?? null;
  const jaws = jawsFwarFromCareerAndPeak(careerRow?.career_war ?? null, peakWar);
  const peakNum =
    peakWar != null && typeof peakWar === 'number'
      ? peakWar
      : peakWar != null
        ? Number(peakWar)
        : null;
  const meta = metaRes.rows[0] as { max_season: number | null; has_row: boolean | null };

  const seasonsJson = rowsToJson(seasonsRes.rows as Record<string, unknown>[]).map((row) => {
    const sn = Number(row.season);
    const d = displayBySeason.get(sn);
    const usage = pitcherUsageRoleLabel(row.games_started, row.games);
    const posFg = d?.position_display ?? null;
    return {
      ...row,
      team_display: d?.team_display ?? null,
      position_display: usage ?? posFg,
    };
  });

  return {
    career: careerRow ? rowToJson(careerRow as Record<string, unknown>) : null,
    seasons: seasonsJson,
    max_season: meta?.max_season ?? null,
    has_row_for_season: forSeason == null ? null : meta?.has_row ?? null,
    jaws_fwar: jaws,
    peak_war_fwar: peakNum != null && Number.isFinite(peakNum) ? peakNum : null,
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
