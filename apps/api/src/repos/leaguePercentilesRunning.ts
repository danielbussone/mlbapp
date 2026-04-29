import type pg from 'pg';
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

const MIN_COHORT_FULL = 10;

export async function fetchSavantRunning(
  pool: pg.Pool,
  input: { game_year: number; key_mlbam: number; min_cohort?: number }
): Promise<Record<string, PercentileSlot>> {
  const { rows: cr } = await pool.query(
    `SELECT sprint_speed::float8 AS v FROM player_season_sprint_speed
     WHERE game_year = $1 AND sprint_speed IS NOT NULL`,
    [input.game_year]
  );
  const cohort = cr.map((r) => num((r as { v: unknown }).v)).filter((x): x is number => x != null);

  const { rows: pr } = await pool.query(
    `SELECT sprint_speed::float8 AS v FROM player_season_sprint_speed
     WHERE game_year = $1 AND key_mlbam = $2`,
    [input.game_year, input.key_mlbam]
  );
  const playerV = num((pr[0] as { v?: unknown } | undefined)?.v);
  const minCohort = Math.max(1, input.min_cohort ?? MIN_COHORT_FULL);
  const pct = playerV != null && cohort.length > 0 ? midrankPercentile(cohort, playerV) : null;
  const qualified = playerV != null && cohort.length >= minCohort;

  return {
    running_sprint_speed: buildPercentileSlot({
      percentile: pct,
      cohortN: cohort.length,
      qualified,
      value: playerV,
      direction: directionForMetric('running_sprint_speed'),
    }),
  };
}
