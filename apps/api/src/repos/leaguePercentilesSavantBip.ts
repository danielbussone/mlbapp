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

function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}

function slot(
  metricId: string,
  pct: unknown,
  n: unknown,
  qualified: boolean,
  value: unknown
): PercentileSlot {
  const pv = num(pct);
  const nv = int(n);
  const vv = num(value);
  return buildPercentileSlot({
    percentile: pv,
    cohortN: nv,
    qualified,
    value: vv,
    direction: directionForMetric(metricId),
  });
}

export async function fetchBatterSavantBipExtras(
  pool: pg.Pool,
  input: { game_year: number; batter_mlbam: number; t_bbe: number; t_bbe_est: number }
): Promise<Record<string, PercentileSlot>> {
  const { rows } = await pool.query(
    `SELECT * FROM statcast_batter_season_savant_bip_mv
     WHERE game_year = $1 AND batter_mlbam = $2`,
    [input.game_year, input.batter_mlbam]
  );
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  const bbe = int(row.bbe) ?? 0;
  const bbeEst = int(row.bbe_with_est_ba) ?? 0;
  const tBbe = Math.max(1, input.t_bbe);
  const tBbeEst = Math.max(1, input.t_bbe_est);

  return {
    bip_barrel_pct: slot(
      'bip_barrel_pct',
      row.pct_barrel_pct,
      row.cohort_n_bip,
      bbe >= tBbe && num(row.val_barrel_pct) != null,
      row.val_barrel_pct
    ),
    bip_sweet_spot_pct: slot(
      'bip_sweet_spot_pct',
      row.pct_sweet_spot_pct,
      row.cohort_n_bip,
      bbe >= tBbe && num(row.val_sweet_spot_pct) != null,
      row.val_sweet_spot_pct
    ),
    bip_avg_estimated_ba: slot(
      'bip_avg_estimated_ba',
      row.pct_avg_estimated_ba,
      row.cohort_n_est_ba,
      bbeEst >= tBbeEst && num(row.val_avg_estimated_ba) != null,
      row.val_avg_estimated_ba
    ),
  };
}

export async function fetchPitcherSavantBipExtras(
  pool: pg.Pool,
  input: { game_year: number; pitcher_mlbam: number; t_bbe: number; t_bbe_est: number }
): Promise<Record<string, PercentileSlot>> {
  const { rows } = await pool.query(
    `SELECT * FROM statcast_pitcher_season_savant_bip_mv
     WHERE game_year = $1 AND pitcher_mlbam = $2`,
    [input.game_year, input.pitcher_mlbam]
  );
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  const bbe = int(row.bbe) ?? 0;
  const bbeEst = int(row.bbe_with_est_ba) ?? 0;
  const tBbe = Math.max(1, input.t_bbe);
  const tBbeEst = Math.max(1, input.t_bbe_est);

  return {
    pitch_barrel_pct_allowed: slot(
      'pitch_barrel_pct_allowed',
      row.pct_barrel_pct_allowed,
      row.cohort_n_bip,
      bbe >= tBbe && num(row.val_barrel_pct_allowed) != null,
      row.val_barrel_pct_allowed
    ),
    pitch_sweet_spot_pct_allowed: slot(
      'pitch_sweet_spot_pct_allowed',
      row.pct_sweet_spot_pct_allowed,
      row.cohort_n_bip,
      bbe >= tBbe && num(row.val_sweet_spot_pct_allowed) != null,
      row.val_sweet_spot_pct_allowed
    ),
    pitch_avg_estimated_ba_allowed: slot(
      'pitch_avg_estimated_ba_allowed',
      row.pct_avg_estimated_ba_allowed,
      row.cohort_n_est_ba,
      bbeEst >= tBbeEst && num(row.val_avg_estimated_ba_allowed) != null,
      row.val_avg_estimated_ba_allowed
    ),
    pitch_hard_hit_pct_allowed: slot(
      'pitch_hard_hit_pct_allowed',
      row.pct_hard_hit_pct_allowed,
      row.cohort_n_bip,
      bbe >= tBbe && num(row.val_hard_hit_pct_allowed) != null,
      row.val_hard_hit_pct_allowed
    ),
  };
}
