import type pg from 'pg';
import {
  battingFgSeasonEarlyQualifiedPa,
  cohortPeerFloorForQualifiedMin,
} from './leaguePercentilesQualification.js';
import { buildPercentileSlot } from './leaguePercentilesPayload.js';
import type { PercentileSlot } from './leaguePercentilesTypes.js';
import { directionForMetric } from './leaguePercentilesMetricDirection.js';

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}

function midrankPercentile(cohortValues: number[], x: number): number | null {
  if (cohortValues.length === 0 || !Number.isFinite(x)) return null;
  let below = 0;
  let tied = 0;
  for (const v of cohortValues) {
    if (v < x) below += 1;
    else if (v === x) tied += 1;
  }
  return Math.round((100 * (below + 0.5 * tied)) / cohortValues.length);
}

function slotFg(
  metricId: string,
  pct: number | null,
  n: number | null,
  qualified: boolean,
  value: number | null
): PercentileSlot {
  const cohortOk = (n ?? 0) > 0;
  return buildPercentileSlot({
    percentile: pct,
    cohortN: n,
    qualified: Boolean(qualified) && value != null && cohortOk,
    value,
    direction: directionForMetric(metricId),
  });
}

export async function fetchSavantFgBattingSeason(
  pool: pg.Pool,
  input: { season: number; player_id: number; min_pa: number }
): Promise<Record<string, PercentileSlot>> {
  const { season, player_id, min_pa } = input;
  const minPa = Math.max(1, min_pa);
  const cohortPa = cohortPeerFloorForQualifiedMin(minPa);
  const cohortWhere = `season = $1 AND pa >= ${cohortPa} AND player_id IS NOT NULL`;
  const kExpr = `COALESCE(k_pct, k_pct_from_so)::float8`;

  const [{ rows: pr }, xwC, kC, bbC, avgC, slgC] = await Promise.all([
    pool.query(
      `SELECT xwoba_pa_weighted, pa, k_pct, bb_pct, season_avg, season_slg, k_pct_from_so
       FROM fg_batting_season_mlb_merged_rates
       WHERE player_id = $2 AND season = $1`,
      [season, player_id]
    ),
    pool.query(
      `SELECT xwoba_pa_weighted::float8 AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND xwoba_pa_weighted IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT ${kExpr} AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND (k_pct IS NOT NULL OR k_pct_from_so IS NOT NULL)`,
      [season]
    ),
    pool.query(
      `SELECT bb_pct::float8 AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND bb_pct IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT season_avg::float8 AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND season_avg IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT season_slg::float8 AS v FROM fg_batting_season_mlb_merged_rates
       WHERE ${cohortWhere} AND season_slg IS NOT NULL`,
      [season]
    ),
  ]);

  const pRow = (pr[0] ?? {}) as Record<string, unknown>;
  const pa = int(pRow.pa) ?? 0;
  const xw = num(pRow.xwoba_pa_weighted);
  const kPct = num(pRow.k_pct) ?? num(pRow.k_pct_from_so);
  const bbPct = num(pRow.bb_pct);
  const avg = num(pRow.season_avg);
  const slg = num(pRow.season_slg);

  const xwArr = xwC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const kArr = kC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const bbArr = bbC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const avgArr = avgC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const slgArr = slgC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);

  const qualBat = pa >= minPa;
  /** Non-provisional once PA ≥ 10% of the prorated full-season bar (`battingFgSeasonEarlyQualifiedPa`). */
  const qualFgEarly = qualBat || pa >= battingFgSeasonEarlyQualifiedPa(minPa);

  return {
    fg_season_xwoba: slotFg(
      'fg_season_xwoba',
      xw != null ? midrankPercentile(xwArr, xw) : null,
      xwArr.length,
      qualFgEarly,
      xw
    ),
    fg_season_k_pct: slotFg(
      'fg_season_k_pct',
      kPct != null ? midrankPercentile(kArr, kPct) : null,
      kArr.length,
      qualFgEarly,
      kPct != null ? Math.round(kPct * 10000) / 100 : null
    ),
    fg_season_bb_pct: slotFg(
      'fg_season_bb_pct',
      bbPct != null ? midrankPercentile(bbArr, bbPct) : null,
      bbArr.length,
      qualFgEarly,
      bbPct != null ? Math.round(bbPct * 10000) / 100 : null
    ),
    fg_season_avg: slotFg(
      'fg_season_avg',
      avg != null ? midrankPercentile(avgArr, avg) : null,
      avgArr.length,
      qualFgEarly,
      avg != null ? Math.round(avg * 1000) / 1000 : null
    ),
    fg_season_slg: slotFg(
      'fg_season_slg',
      slg != null ? midrankPercentile(slgArr, slg) : null,
      slgArr.length,
      qualFgEarly,
      slg != null ? Math.round(slg * 1000) / 1000 : null
    ),
  };
}

export async function fetchSavantFgPitchingSeason(
  pool: pg.Pool,
  input: { season: number; player_id: number; min_tbf: number }
): Promise<Record<string, PercentileSlot>> {
  const { season, player_id, min_tbf } = input;
  const minTbf = Math.max(1, min_tbf);
  const cohortTbf = cohortPeerFloorForQualifiedMin(minTbf);
  /** Qualification uses minTbf; midrank cohorts use a lower floor (see cohortPeerFloorForQualifiedMin). */
  const cohortWhere = `season = $1 AND tbf >= ${cohortTbf} AND player_id IS NOT NULL`;

  const [{ rows: pr }, xeraC, kC, bbC] = await Promise.all([
    pool.query(
      `SELECT tbf, k_pct::float8 AS k_pct, bb_pct::float8 AS bb_pct, xera::float8 AS xera
       FROM fg_pitching_season_mlb_merged_stats
       WHERE player_id = $2 AND season = $1`,
      [season, player_id]
    ),
    pool.query(
      `SELECT xera::float8 AS v FROM fg_pitching_season_mlb_merged_stats
       WHERE ${cohortWhere} AND xera IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT k_pct::float8 AS v FROM fg_pitching_season_mlb_merged_stats
       WHERE ${cohortWhere} AND k_pct IS NOT NULL`,
      [season]
    ),
    pool.query(
      `SELECT bb_pct::float8 AS v FROM fg_pitching_season_mlb_merged_stats
       WHERE ${cohortWhere} AND bb_pct IS NOT NULL`,
      [season]
    ),
  ]);

  const pRow = (pr[0] ?? {}) as Record<string, unknown>;
  const tbf = int(pRow.tbf) ?? 0;
  const xera = num(pRow.xera);
  const kPct = num(pRow.k_pct);
  const bbPct = num(pRow.bb_pct);

  const xeraArr = xeraC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const kArr = kC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);
  const bbArr = bbC.rows.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);

  const qualPit = tbf >= minTbf;

  return {
    fg_season_pit_xera: slotFg(
      'fg_season_pit_xera',
      xera != null ? midrankPercentile(xeraArr, xera) : null,
      xeraArr.length,
      qualPit,
      xera
    ),
    fg_season_pit_k_pct: slotFg(
      'fg_season_pit_k_pct',
      kPct != null ? midrankPercentile(kArr, kPct) : null,
      kArr.length,
      qualPit,
      kPct != null ? Math.round(kPct * 10000) / 100 : null
    ),
    fg_season_pit_bb_pct: slotFg(
      'fg_season_pit_bb_pct',
      bbPct != null ? midrankPercentile(bbArr, bbPct) : null,
      bbArr.length,
      qualPit,
      bbPct != null ? Math.round(bbPct * 10000) / 100 : null
    ),
  };
}
