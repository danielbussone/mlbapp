import type pg from 'pg';
import { cohortPeerFloorForQualifiedMin, pitchTypeMidrankPeerPitchFloor } from './leaguePercentilesQualification.js';
import type { PercentileSlot } from './leaguePercentilesTypes.js';
import { buildPercentileSlot } from './leaguePercentilesPayload.js';

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function midrankInSubquery(
  pool: pg.Pool,
  sql: string,
  params: unknown[]
): Promise<{ cohortN: number; p: number | null }> {
  const { rows } = await pool.query(sql, params);
  const r = rows[0] as { n?: unknown; below?: unknown; tied?: unknown } | undefined;
  const cohortN = Math.trunc(Number(r?.n ?? 0));
  const below = Math.trunc(Number(r?.below ?? 0));
  const tied = Math.trunc(Number(r?.tied ?? 0));
  if (!cohortN) return { cohortN: 0, p: null };
  return { cohortN, p: Math.round((100 * (below + 0.5 * tied)) / cohortN) };
}

/**
 * Fill missing percentiles via runtime midrank when we have a raw `value` but no `p`.
 * Statcast MVs only set `pct_*` at fixed SQL floors (e.g. pitcher chase at `pitches >= 800`);
 * API `qualified` uses **prorated** floors, so early-season arms can be qualified with
 * `val_*` populated and `pct_*` still null — they must not be excluded here.
 * Midrank SQL uses `cohortPeerFloorForQualifiedMin(...)` so the peer COUNT is not empty when
 * prorated pitch/swing/BIP floors are still high vs April workloads.
 */
function needsHypothetical(s: PercentileSlot): boolean {
  return s.value != null && s.p == null;
}

function mergePct(slot: PercentileSlot, cohortN: number, p: number | null): PercentileSlot {
  if (p == null) return slot;
  return buildPercentileSlot({
    percentile: p,
    cohortN: cohortN > 0 ? cohortN : slot.n,
    qualified: slot.qualified,
    value: slot.value,
    direction: slot.direction,
  });
}

/** Midrank vs prorated Statcast batter MV cohort (same floor as qualification for peers). */
export async function enrichBatterStatcastMvHypotheticals(
  pool: pg.Pool,
  input: {
    game_year: number;
    tBbe: number;
    tTracked: number;
    tPitchesChase: number;
    tSwingsWhiff: number;
    slots: Record<string, PercentileSlot>;
  }
): Promise<void> {
  const { game_year, tBbe, tTracked, tPitchesChase, tSwingsWhiff, slots } = input;
  const bbePeerFloor = cohortPeerFloorForQualifiedMin(tBbe);
  const trackedPeerFloor = cohortPeerFloorForQualifiedMin(tTracked);
  const chasePeerFloor = cohortPeerFloorForQualifiedMin(tPitchesChase);
  const whiffSwPeerFloor = cohortPeerFloorForQualifiedMin(tSwingsWhiff);

  const jobs: Promise<void>[] = [];

  const run = async (key: string, sql: string, params: unknown[]) => {
    const s = slots[key];
    if (!s || !needsHypothetical(s) || s.value == null) return;
    const { cohortN, p } = await midrankInSubquery(pool, sql, params);
    if (p != null) slots[key] = mergePct(s, cohortN, p);
  };

  jobs.push(
    run(
      'bip_avg_exit_velo',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_bip_avg_exit_velo::float8 AS v
             FROM statcast_batter_season_percentile_mv
             WHERE game_year = $1 AND bbe >= $2 AND val_bip_avg_exit_velo IS NOT NULL) s`,
      [game_year, bbePeerFloor, slots.bip_avg_exit_velo!.value]
    )
  );
  jobs.push(
    run(
      'bip_avg_launch_angle',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_bip_avg_launch_angle::float8 AS v
             FROM statcast_batter_season_percentile_mv
             WHERE game_year = $1 AND bbe >= $2 AND val_bip_avg_launch_angle IS NOT NULL) s`,
      [game_year, bbePeerFloor, slots.bip_avg_launch_angle!.value]
    )
  );
  jobs.push(
    run(
      'bip_hard_hit_pct',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_bip_hard_hit_pct::float8 AS v
             FROM statcast_batter_season_percentile_mv
             WHERE game_year = $1 AND bbe >= $2 AND val_bip_hard_hit_pct IS NOT NULL) s`,
      [game_year, bbePeerFloor, slots.bip_hard_hit_pct!.value]
    )
  );

  for (const [key, col] of [
    ['swing_avg_bat_speed', 'val_swing_avg_bat_speed'],
    ['swing_avg_attack_angle', 'val_swing_avg_attack_angle'],
    ['swing_avg_attack_direction', 'val_swing_avg_attack_direction'],
    ['swing_avg_path_tilt', 'val_swing_avg_path_tilt'],
  ] as const) {
    jobs.push(
      run(
        key,
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
                COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
         FROM (SELECT ${col}::float8 AS v
               FROM statcast_batter_season_percentile_mv
               WHERE game_year = $1 AND tracked_swings >= $2 AND ${col} IS NOT NULL) s`,
        [game_year, trackedPeerFloor, num(slots[key]!.value)]
      )
    );
  }

  jobs.push(
    run(
      'bat_chase_pct',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_bat_chase_pct::float8 AS v
             FROM statcast_batter_season_percentile_mv
             WHERE game_year = $1 AND pitches_seen >= $2 AND val_bat_chase_pct IS NOT NULL) s`,
      [game_year, chasePeerFloor, slots.bat_chase_pct!.value]
    )
  );
  jobs.push(
    run(
      'bat_whiff_pct',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_bat_whiff_pct::float8 AS v
             FROM statcast_batter_season_percentile_mv
             WHERE game_year = $1 AND swings >= $2 AND val_bat_whiff_pct IS NOT NULL) s`,
      [game_year, whiffSwPeerFloor, slots.bat_whiff_pct!.value]
    )
  );

  await Promise.all(jobs);
}

export async function enrichPitcherStatcastTotalsHypotheticals(
  pool: pg.Pool,
  input: {
    game_year: number;
    tBbe: number;
    tPitches: number;
    tSwingsWhiff: number;
    tPitchesExt: number;
    tFf: number;
    slots: Record<string, PercentileSlot>;
  }
): Promise<void> {
  const { game_year, tBbe, tPitches, tSwingsWhiff, tPitchesExt, tFf, slots } = input;
  const pitchPeerFloor = cohortPeerFloorForQualifiedMin(tPitches);
  const swingPeerFloor = cohortPeerFloorForQualifiedMin(tSwingsWhiff);
  const bbePeerFloor = cohortPeerFloorForQualifiedMin(tBbe);
  const extPeerFloor = cohortPeerFloorForQualifiedMin(tPitchesExt);
  const ffPeerFloor = cohortPeerFloorForQualifiedMin(tFf);
  const jobs: Promise<void>[] = [];

  const run = async (key: string, sql: string, params: unknown[]) => {
    const s = slots[key];
    if (!s || !needsHypothetical(s) || s.value == null) return;
    const { cohortN, p } = await midrankInSubquery(pool, sql, params);
    if (p != null) slots[key] = mergePct(s, cohortN, p);
  };

  jobs.push(
    run(
      'pitch_avg_exit_velo_on_bip',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_avg_exit_velo_on_bip::float8 AS v
             FROM statcast_pitcher_season_totals_percentile_mv
             WHERE game_year = $1 AND bbe >= $2 AND val_avg_exit_velo_on_bip IS NOT NULL) s`,
      [game_year, bbePeerFloor, slots.pitch_avg_exit_velo_on_bip!.value]
    )
  );

  for (const [key, col] of [
    ['pitch_chase_pct', 'val_chase_pct'],
    ['pitch_swstr_pct', 'val_swstr_pct'],
    ['pitch_zone_pct', 'val_zone_pct'],
    ['pitch_swing_pct', 'val_swing_pct'],
  ] as const) {
    jobs.push(
      run(
        key,
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
                COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
         FROM (SELECT ${col}::float8 AS v
               FROM statcast_pitcher_season_totals_percentile_mv
               WHERE game_year = $1 AND pitches >= $2 AND ${col} IS NOT NULL) s`,
        [game_year, pitchPeerFloor, num(slots[key]!.value)]
      )
    );
  }

  jobs.push(
    run(
      'pitch_whiff_pct',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_whiff_pct::float8 AS v
             FROM statcast_pitcher_season_totals_percentile_mv
             WHERE game_year = $1 AND swings >= $2 AND val_whiff_pct IS NOT NULL) s`,
      [game_year, swingPeerFloor, slots.pitch_whiff_pct!.value]
    )
  );

  for (const [key, col] of [
    ['pitch_gb_pct', 'val_gb_pct'],
    ['pitch_fb_pct', 'val_fb_pct'],
    ['pitch_hr_pct', 'val_hr_pct'],
  ] as const) {
    jobs.push(
      run(
        key,
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
                COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
         FROM (SELECT ${col}::float8 AS v
               FROM statcast_pitcher_season_totals_percentile_mv
               WHERE game_year = $1 AND bbe >= $2 AND ${col} IS NOT NULL) s`,
        [game_year, bbePeerFloor, num(slots[key]!.value)]
      )
    );
  }

  jobs.push(
    run(
      'pitch_avg_release_extension',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_avg_release_extension::float8 AS v
             FROM statcast_pitcher_season_totals_percentile_mv
             WHERE game_year = $1 AND pitches_with_extension >= $2 AND val_avg_release_extension IS NOT NULL) s`,
      [game_year, extPeerFloor, slots.pitch_avg_release_extension!.value]
    )
  );
  jobs.push(
    run(
      'pitch_ff_avg_velo',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_ff_avg_velo::float8 AS v
             FROM statcast_pitcher_season_totals_percentile_mv
             WHERE game_year = $1 AND ff_pitches >= $2 AND val_ff_avg_velo IS NOT NULL) s`,
      [game_year, ffPeerFloor, slots.pitch_ff_avg_velo!.value]
    )
  );

  await Promise.all(jobs);
}

export async function enrichPitchTypeMvHypotheticals(
  pool: pg.Pool,
  input: {
    game_year: number;
    pitch_type: string;
    tPitches: number;
    slots: Record<string, PercentileSlot>;
  }
): Promise<void> {
  const { game_year, pitch_type, tPitches, slots } = input;
  const pt = pitch_type.trim().toUpperCase();
  if (!pt) return;
  const pitchPeerFloor = pitchTypeMidrankPeerPitchFloor(tPitches);

  const jobs: Promise<void>[] = [];
  const run = async (key: string, col: string) => {
    const s = slots[key];
    if (!s || !needsHypothetical(s) || s.value == null) return;
    const { cohortN, p } = await midrankInSubquery(
      pool,
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $4::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $4::float8)::int AS tied
       FROM (SELECT ${col}::float8 AS v
             FROM statcast_pitcher_season_pitchtype_percentile_mv
             WHERE game_year = $1 AND pitch_type = $2 AND pitches >= $3 AND ${col} IS NOT NULL) s`,
      [game_year, pt, pitchPeerFloor, s.value]
    );
    if (p != null) slots[key] = mergePct(s, cohortN, p);
  };

  for (const [key, col] of [
    ['pitch_avg_velo', 'val_avg_velo'],
    ['pitch_avg_spin', 'val_avg_spin'],
    ['pitch_avg_pfx_x', 'val_avg_pfx_x'],
    ['pitch_avg_pfx_z', 'val_avg_pfx_z'],
    ['pitch_zone_pct', 'val_zone_pct'],
    ['pitch_chase_pct', 'val_chase_pct'],
    ['pitch_swing_pct', 'val_swing_pct'],
    ['pitch_whiff_pct', 'val_whiff_pct'],
    ['pitch_swstr_pct', 'val_swstr_pct'],
    ['pitch_gb_pct', 'val_gb_pct'],
    ['pitch_fb_pct', 'val_fb_pct'],
    ['pitch_hr_pct', 'val_hr_pct'],
  ] as const) {
    jobs.push(run(key, col));
  }
  await Promise.all(jobs);
}

export async function enrichBatterSavantBipMvHypotheticals(
  pool: pg.Pool,
  input: {
    game_year: number;
    tBbe: number;
    tBbeEst: number;
    slots: Record<string, PercentileSlot>;
  }
): Promise<void> {
  const { game_year, tBbe, tBbeEst, slots } = input;
  const bbePeerFloor = cohortPeerFloorForQualifiedMin(tBbe);
  const bbeEstPeerFloor = cohortPeerFloorForQualifiedMin(tBbeEst);
  const jobs: Promise<void>[] = [];
  const run = async (key: string, sql: string, params: unknown[]) => {
    const s = slots[key];
    if (!s || !needsHypothetical(s) || s.value == null) return;
    const { cohortN, p } = await midrankInSubquery(pool, sql, params);
    if (p != null) slots[key] = mergePct(s, cohortN, p);
  };

  jobs.push(
    run(
      'bip_barrel_pct',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_barrel_pct::float8 AS v
             FROM statcast_batter_season_savant_bip_mv
             WHERE game_year = $1 AND bbe >= $2 AND val_barrel_pct IS NOT NULL) s`,
      [game_year, bbePeerFloor, slots.bip_barrel_pct!.value]
    )
  );
  jobs.push(
    run(
      'bip_sweet_spot_pct',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_sweet_spot_pct::float8 AS v
             FROM statcast_batter_season_savant_bip_mv
             WHERE game_year = $1 AND bbe >= $2 AND val_sweet_spot_pct IS NOT NULL) s`,
      [game_year, bbePeerFloor, slots.bip_sweet_spot_pct!.value]
    )
  );
  jobs.push(
    run(
      'bip_avg_estimated_ba',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_avg_estimated_ba::float8 AS v
             FROM statcast_batter_season_savant_bip_mv
             WHERE game_year = $1 AND bbe_with_est_ba >= $2 AND val_avg_estimated_ba IS NOT NULL) s`,
      [game_year, bbeEstPeerFloor, slots.bip_avg_estimated_ba!.value]
    )
  );

  await Promise.all(jobs);
}

export async function enrichPitcherSavantBipMvHypotheticals(
  pool: pg.Pool,
  input: {
    game_year: number;
    tBbe: number;
    tBbeEst: number;
    slots: Record<string, PercentileSlot>;
  }
): Promise<void> {
  const { game_year, tBbe, tBbeEst, slots } = input;
  const bbePeerFloor = cohortPeerFloorForQualifiedMin(tBbe);
  const bbeEstPeerFloor = cohortPeerFloorForQualifiedMin(tBbeEst);
  const jobs: Promise<void>[] = [];
  const run = async (key: string, sql: string, params: unknown[]) => {
    const s = slots[key];
    if (!s || !needsHypothetical(s) || s.value == null) return;
    const { cohortN, p } = await midrankInSubquery(pool, sql, params);
    if (p != null) slots[key] = mergePct(s, cohortN, p);
  };

  for (const [key, col, bbeCol] of [
    ['pitch_barrel_pct_allowed', 'val_barrel_pct_allowed', 'bbe'],
    ['pitch_sweet_spot_pct_allowed', 'val_sweet_spot_pct_allowed', 'bbe'],
    ['pitch_hard_hit_pct_allowed', 'val_hard_hit_pct_allowed', 'bbe'],
  ] as const) {
    jobs.push(
      run(
        key,
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
                COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
         FROM (SELECT ${col}::float8 AS v
               FROM statcast_pitcher_season_savant_bip_mv
               WHERE game_year = $1 AND ${bbeCol} >= $2 AND ${col} IS NOT NULL) s`,
        [game_year, bbePeerFloor, num(slots[key]!.value)]
      )
    );
  }
  jobs.push(
    run(
      'pitch_avg_estimated_ba_allowed',
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE v < $3::float8)::int AS below,
              COUNT(*) FILTER (WHERE v = $3::float8)::int AS tied
       FROM (SELECT val_avg_estimated_ba_allowed::float8 AS v
             FROM statcast_pitcher_season_savant_bip_mv
             WHERE game_year = $1 AND bbe_with_est_ba >= $2 AND val_avg_estimated_ba_allowed IS NOT NULL) s`,
      [game_year, bbeEstPeerFloor, slots.pitch_avg_estimated_ba_allowed!.value]
    )
  );
  await Promise.all(jobs);
}
