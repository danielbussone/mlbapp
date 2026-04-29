import type pg from 'pg';
import type {
  FieldingPercentileGroup,
  LeaguePercentilesResponse,
  PercentileSlot,
} from './leaguePercentilesTypes.js';
import { rowsToJson } from './rowJson.js';
import { buildPercentileSlot } from './leaguePercentilesPayload.js';
import { directionForMetric } from './leaguePercentilesMetricDirection.js';
import { playerFgPredicate } from './fangraphsFielding.js';
import { fetchSavantFgBattingSeason, fetchSavantFgPitchingSeason } from './leaguePercentilesFgSavant.js';
import { fetchBatterSavantBipExtras, fetchPitcherSavantBipExtras } from './leaguePercentilesSavantBip.js';
import { fetchSavantRunning } from './leaguePercentilesRunning.js';
import {
  fetchMaxMlbPlayerGamesForSeason,
  PITCH_TYPE_NON_PROVISIONAL_TYPE_PITCHES,
  prorateCountForSeason,
  REFERENCE_SCHEDULE_GAMES,
} from './leaguePercentilesQualification.js';
import {
  enrichBatterSavantBipMvHypotheticals,
  enrichBatterStatcastMvHypotheticals,
  enrichPitcherSavantBipMvHypotheticals,
  enrichPitcherStatcastTotalsHypotheticals,
  enrichPitchTypeMvHypotheticals,
} from './leaguePercentilesMidrankMv.js';

export const LEAGUE_PERCENTILES_COHORT_SPEC_VERSION = '2026.17';

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

function isUndefinedRelation(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '42P01');
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

const FG_FIELDING_SUMMABLE_POS = `upper(trim(f.position)) NOT IN ('ALL', 'UNK', 'UNKNOWN', '')`;

type FieldingCohortMetricRow = { drs: number | null; uzr: number | null; oaa: number | null; frv: number | null };

function buildFieldingPercentileSlots(
  cohort: FieldingCohortMetricRow[],
  pDrs: number | null,
  pUzr: number | null,
  pOaa: number | null,
  pFrv: number | null,
  playerInn: number | null,
  minInn: number
): Record<string, PercentileSlot> {
  const drsVals = cohort.map((r) => r.drs).filter((x): x is number => x != null);
  const uzrVals = cohort.map((r) => r.uzr).filter((x): x is number => x != null);
  const oaaVals = cohort.map((r) => r.oaa).filter((x): x is number => x != null);
  const frvVals = cohort.map((r) => r.frv).filter((x): x is number => x != null);
  const qual = playerInn != null && playerInn >= minInn;
  return {
    pos_drs: buildPercentileSlot({
      percentile: pDrs != null ? midrankPercentile(drsVals, pDrs) : null,
      cohortN: drsVals.length,
      qualified: qual && pDrs != null && drsVals.length > 0,
      value: pDrs,
      direction: directionForMetric('pos_drs'),
    }),
    pos_uzr: buildPercentileSlot({
      percentile: pUzr != null ? midrankPercentile(uzrVals, pUzr) : null,
      cohortN: uzrVals.length,
      qualified: qual && pUzr != null && uzrVals.length > 0,
      value: pUzr,
      direction: directionForMetric('pos_uzr'),
    }),
    pos_oaa: buildPercentileSlot({
      percentile: pOaa != null ? midrankPercentile(oaaVals, pOaa) : null,
      cohortN: oaaVals.length,
      qualified: qual && pOaa != null && oaaVals.length > 0,
      value: pOaa,
      direction: directionForMetric('pos_oaa'),
    }),
    pos_frv: buildPercentileSlot({
      percentile: pFrv != null ? midrankPercentile(frvVals, pFrv) : null,
      cohortN: frvVals.length,
      qualified: qual && pFrv != null && frvVals.length > 0,
      value: pFrv,
      direction: directionForMetric('pos_frv'),
    }),
    pos_inn: buildPercentileSlot({
      percentile: null,
      cohortN: null,
      qualified: playerInn != null && playerInn > 0,
      value: playerInn,
      direction: directionForMetric('pos_inn'),
    }),
  };
}

function mapCohortRows(rows: Record<string, unknown>[]): FieldingCohortMetricRow[] {
  return rows.map((r) => ({
    drs: num(r.drs),
    uzr: num(r.uzr),
    oaa: num(r.oaa),
    frv: num(r.frv),
  }));
}

/** One FG position (exact) or outfield union for `OF` query param. */
async function fieldingPercentilesSingleGroup(
  pool: pg.Pool,
  input: {
    season: number;
    player_id: number;
    minInn: number;
    position: string;
  }
): Promise<FieldingPercentileGroup | null> {
  const pos = input.position.trim().toUpperCase();
  if (!pos || pos === 'ALL' || pos === 'UNK' || pos === 'UNKNOWN') return null;
  const isOutfieldAggregate = pos === 'OF';
  const posFilterPlayer = isOutfieldAggregate
    ? `upper(trim(f.position)) IN ('LF', 'CF', 'RF')`
    : `upper(trim(f.position)) = $3`;
  const posFilterCohort = isOutfieldAggregate
    ? `upper(trim(f.position)) IN ('LF', 'CF', 'RF')`
    : `upper(trim(f.position)) = $2`;
  const fgPlayer = playerFgPredicate('f');
  const { rows: pr } = await pool.query(
    `
    SELECT drs::numeric AS drs, uzr::numeric AS uzr, oaa::numeric AS oaa, frv::numeric AS frv, inn::numeric AS inn
    FROM fg_fielding_season_current f
    WHERE (${fgPlayer}) AND f.season = $2 AND ${posFilterPlayer} AND f.level = 'MLB'
    ORDER BY f.inn DESC NULLS LAST
    LIMIT 1
    `,
    isOutfieldAggregate ? [input.player_id, input.season] : [input.player_id, input.season, pos]
  );
  if (pr.length === 0) return null;
  const playerRow = (pr[0] ?? {}) as Record<string, unknown>;
  const playerInn = num(playerRow.inn);
  const pDrs0 = num(playerRow.drs);
  const pUzr0 = num(playerRow.uzr);
  const pOaa0 = num(playerRow.oaa);
  const pFrv0 = num(playerRow.frv);
  if (playerInn == null && pDrs0 == null && pUzr0 == null && pOaa0 == null && pFrv0 == null) {
    return null;
  }

  const { rows: cr } = await pool.query(
    `
    SELECT drs::numeric AS drs, uzr::numeric AS uzr, oaa::numeric AS oaa, frv::numeric AS frv
    FROM fg_fielding_season_current f
    WHERE f.season = $1 AND ${posFilterCohort} AND f.level = 'MLB'
      AND COALESCE(f.inn, 0) >= $${isOutfieldAggregate ? 2 : 3}::numeric
      AND ${FG_FIELDING_SUMMABLE_POS}
    `,
    isOutfieldAggregate ? [input.season, input.minInn] : [input.season, pos, input.minInn]
  );
  const cohort = mapCohortRows(rowsToJson(cr as Record<string, unknown>[]) as Record<string, unknown>[]);
  const label = isOutfieldAggregate ? 'Outfield (LF+CF+RF)' : pos;
  const key = isOutfieldAggregate ? 'OF' : pos;
  return {
    position_key: key,
    label,
    percentiles: buildFieldingPercentileSlots(
      cohort,
      pDrs0,
      pUzr0,
      pOaa0,
      pFrv0,
      playerInn,
      input.minInn
    ),
  };
}

async function fieldingPercentilesTotalSeason(
  pool: pg.Pool,
  input: { season: number; player_id: number; minInn: number }
): Promise<FieldingPercentileGroup | null> {
  const fgPlayer = playerFgPredicate('f');
  const { rows: pr } = await pool.query(
    `
    SELECT
      SUM(f.inn::numeric) AS inn,
      SUM(f.drs::numeric) AS drs,
      SUM(f.uzr::numeric) AS uzr,
      SUM(f.oaa::numeric) AS oaa,
      SUM(f.frv::numeric) AS frv
    FROM fg_fielding_season_current f
    WHERE (${fgPlayer}) AND f.season = $2 AND f.level = 'MLB'
      AND ${FG_FIELDING_SUMMABLE_POS}
    `,
    [input.player_id, input.season]
  );
  const playerRow = (pr[0] ?? {}) as Record<string, unknown>;
  const playerInn = num(playerRow.inn);
  if (playerInn == null || playerInn <= 0) return null;

  const { rows: cr } = await pool.query(
    `
    SELECT
      SUM(f.drs::numeric) AS drs,
      SUM(f.uzr::numeric) AS uzr,
      SUM(f.oaa::numeric) AS oaa,
      SUM(f.frv::numeric) AS frv
    FROM fg_fielding_season_current f
    WHERE f.season = $1 AND f.level = 'MLB'
      AND ${FG_FIELDING_SUMMABLE_POS}
    GROUP BY f.id_fg
    HAVING SUM(COALESCE(f.inn, 0)) >= $2::numeric
    `,
    [input.season, input.minInn]
  );
  const cohort = mapCohortRows(rowsToJson(cr as Record<string, unknown>[]) as Record<string, unknown>[]);
  return {
    position_key: 'TOTAL',
    label: 'All positions',
    percentiles: buildFieldingPercentileSlots(
      cohort,
      num(playerRow.drs),
      num(playerRow.uzr),
      num(playerRow.oaa),
      num(playerRow.frv),
      playerInn,
      input.minInn
    ),
  };
}

export async function fetchFieldingLeaguePercentilesBundle(
  pool: pg.Pool,
  input: { season: number; player_id: number; min_inn_field?: number }
): Promise<LeaguePercentilesResponse> {
  const minInn = Math.max(1, input.min_inn_field ?? 100);
  const fgPlayer = playerFgPredicate('f');
  const { rows: posRows } = await pool.query(
    `
    SELECT upper(trim(f.position)) AS pos
    FROM fg_fielding_season_current f
    WHERE (${fgPlayer}) AND f.season = $2 AND f.level = 'MLB'
      AND ${FG_FIELDING_SUMMABLE_POS}
    GROUP BY upper(trim(f.position))
    HAVING SUM(COALESCE(f.inn, 0)) > 0
    ORDER BY SUM(f.inn::numeric) DESC NULLS LAST
    `,
    [input.player_id, input.season]
  );
  const positions = posRows
    .map((r) => String((r as { pos?: unknown }).pos ?? '').trim().toUpperCase())
    .filter((p) => p.length > 0);

  if (positions.length === 0) {
    return {
      cohort_spec_version: LEAGUE_PERCENTILES_COHORT_SPEC_VERSION,
      game_year: input.season,
      role: 'fielding',
      cohort_notes: ['FanGraphs fg_fielding_season_current', 'MLB', 'no summable position rows for player'],
      percentiles_available: false,
      reason: 'No FanGraphs fielding rows for this player/season (position splits)',
      percentiles: {},
    };
  }

  let totalGroup = await fieldingPercentilesTotalSeason(pool, {
    season: input.season,
    player_id: input.player_id,
    minInn,
  });
  if (totalGroup == null) {
    return {
      cohort_spec_version: LEAGUE_PERCENTILES_COHORT_SPEC_VERSION,
      game_year: input.season,
      role: 'fielding',
      cohort_notes: ['FanGraphs fg_fielding_season_current', 'MLB'],
      percentiles_available: false,
      reason: 'Could not aggregate fielding totals for this player/season',
      percentiles: {},
    };
  }

  if (positions.length === 1) {
    const only = positions[0];
    if (only) totalGroup = { ...totalGroup, label: only };
  }

  const groups: FieldingPercentileGroup[] = [totalGroup];
  const multi = positions.length > 1;
  if (multi) {
    for (const pos of positions) {
      const g = await fieldingPercentilesSingleGroup(pool, {
        season: input.season,
        player_id: input.player_id,
        minInn,
        position: pos,
      });
      if (g != null) groups.push(g);
    }
  }

  return {
    cohort_spec_version: LEAGUE_PERCENTILES_COHORT_SPEC_VERSION,
    game_year: input.season,
    role: 'fielding',
    cohort_notes: [
      'FanGraphs fielding',
      'Total: summed DRS/UZR/OAA/FRV across summable positions vs league id_fg season sums',
      `Per-position cohort: inn≥${minInn} at that position (prorated from max player games vs ${REFERENCE_SCHEDULE_GAMES})`,
      'docs/COHORT_PERCENTILES_SPEC.md',
    ],
    percentiles_available: true,
    percentiles: totalGroup.percentiles,
    fielding_percentile_groups: groups,
  };
}

function slotFromRow(
  metricId: string,
  pctCol: string,
  nCol: string,
  qual: boolean,
  valCol: string,
  row: Record<string, unknown>
): PercentileSlot {
  return buildPercentileSlot({
    percentile: int(row[pctCol]),
    cohortN: int(row[nCol]),
    qualified: qual,
    value: num(row[valCol]),
    direction: directionForMetric(metricId),
  });
}

async function tryOptionalRelation<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (isUndefinedRelation(e)) return null;
    throw e;
  }
}

export async function fetchBatterLeaguePercentiles(
  pool: pg.Pool,
  input: { game_year: number; batter_mlbam: number; player_id: number }
): Promise<LeaguePercentilesResponse> {
  const anchorRaw = await fetchMaxMlbPlayerGamesForSeason(pool, input.game_year).catch(() => 0);
  const anchorG = Math.max(1, anchorRaw);
  const tBbe = prorateCountForSeason(50, anchorG);
  const tTracked = prorateCountForSeason(25, anchorG);
  const tPitchesChase = prorateCountForSeason(400, anchorG);
  const tSwingsWhiff = prorateCountForSeason(150, anchorG);
  const tBbeEst = prorateCountForSeason(50, anchorG);
  const minPaFg = prorateCountForSeason(200, anchorG);
  const minSprintCohort = Math.max(3, prorateCountForSeason(10, anchorG));

  const { rows } = await pool.query(
    `SELECT * FROM statcast_batter_season_percentile_mv
     WHERE game_year = $1 AND batter_mlbam = $2`,
    [input.game_year, input.batter_mlbam]
  );
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  const bbe = int(row.bbe) ?? 0;
  const tracked = int(row.tracked_swings) ?? 0;
  const pitchesSeen = int(row.pitches_seen) ?? 0;
  const swings = int(row.swings) ?? 0;

  const percentiles: Record<string, PercentileSlot> = {
    bip_avg_exit_velo: slotFromRow(
      'bip_avg_exit_velo',
      'pct_bip_avg_exit_velo',
      'cohort_n_bip',
      bbe >= tBbe && num(row.val_bip_avg_exit_velo) != null,
      'val_bip_avg_exit_velo',
      row
    ),
    bip_avg_launch_angle: slotFromRow(
      'bip_avg_launch_angle',
      'pct_bip_avg_launch_angle',
      'cohort_n_bip',
      bbe >= tBbe && num(row.val_bip_avg_launch_angle) != null,
      'val_bip_avg_launch_angle',
      row
    ),
    bip_hard_hit_pct: slotFromRow(
      'bip_hard_hit_pct',
      'pct_bip_hard_hit_pct',
      'cohort_n_bip',
      bbe >= tBbe && num(row.val_bip_hard_hit_pct) != null,
      'val_bip_hard_hit_pct',
      row
    ),
    swing_avg_bat_speed: slotFromRow(
      'swing_avg_bat_speed',
      'pct_swing_avg_bat_speed',
      'cohort_n_bat_track',
      tracked >= tTracked && num(row.val_swing_avg_bat_speed) != null,
      'val_swing_avg_bat_speed',
      row
    ),
    swing_avg_attack_angle: slotFromRow(
      'swing_avg_attack_angle',
      'pct_swing_avg_attack_angle',
      'cohort_n_bat_track',
      tracked >= tTracked && num(row.val_swing_avg_attack_angle) != null,
      'val_swing_avg_attack_angle',
      row
    ),
    swing_avg_attack_direction: slotFromRow(
      'swing_avg_attack_direction',
      'pct_swing_avg_attack_direction',
      'cohort_n_bat_track',
      tracked >= tTracked && num(row.val_swing_avg_attack_direction) != null,
      'val_swing_avg_attack_direction',
      row
    ),
    swing_avg_path_tilt: slotFromRow(
      'swing_avg_path_tilt',
      'pct_swing_avg_path_tilt',
      'cohort_n_bat_track',
      tracked >= tTracked && num(row.val_swing_avg_path_tilt) != null,
      'val_swing_avg_path_tilt',
      row
    ),
    bat_chase_pct: buildPercentileSlot({
      percentile: num(row.val_bat_chase_pct) != null ? int(row.pct_bat_chase_pct) : null,
      cohortN: int(row.cohort_n_bat_chase),
      qualified: pitchesSeen >= tPitchesChase && num(row.val_bat_chase_pct) != null,
      value: num(row.val_bat_chase_pct),
      direction: directionForMetric('bat_chase_pct'),
    }),
    bat_whiff_pct: buildPercentileSlot({
      percentile: num(row.val_bat_whiff_pct) != null ? int(row.pct_bat_whiff_pct) : null,
      cohortN: int(row.cohort_n_bat_whiff),
      qualified: swings >= tSwingsWhiff && num(row.val_bat_whiff_pct) != null,
      value: num(row.val_bat_whiff_pct),
      direction: directionForMetric('bat_whiff_pct'),
    }),
  };

  await enrichBatterStatcastMvHypotheticals(pool, {
    game_year: input.game_year,
    tBbe,
    tTracked,
    tPitchesChase,
    tSwingsWhiff,
    slots: percentiles,
  });

  const fgSavant =
    (await tryOptionalRelation(() =>
      fetchSavantFgBattingSeason(pool, {
        season: input.game_year,
        player_id: input.player_id,
        min_pa: minPaFg,
      })
    )) ?? {};
  const bipExtras =
    (await tryOptionalRelation(() =>
      fetchBatterSavantBipExtras(pool, {
        game_year: input.game_year,
        batter_mlbam: input.batter_mlbam,
        t_bbe: tBbe,
        t_bbe_est: tBbeEst,
      })
    )) ?? {};
  const running =
    (await tryOptionalRelation(() =>
      fetchSavantRunning(pool, {
        game_year: input.game_year,
        key_mlbam: input.batter_mlbam,
        min_cohort: minSprintCohort,
      })
    )) ?? {};

  const savant_batting: Record<string, PercentileSlot> = {
    ...fgSavant,
    ...bipExtras,
    ...percentiles,
  };

  await enrichBatterSavantBipMvHypotheticals(pool, {
    game_year: input.game_year,
    tBbe,
    tBbeEst,
    slots: savant_batting,
  });

  return {
    cohort_spec_version: LEAGUE_PERCENTILES_COHORT_SPEC_VERSION,
    game_year: input.game_year,
    role: 'batter',
    cohort_notes: [
      'MLB Statcast',
      'FanGraphs season (xwOBA, K%, BB%, AVG, SLG)',
      'docs/COHORT_PERCENTILES_SPEC.md',
    ],
    percentiles_available: true,
    percentiles,
    savant_batting,
    savant_running: Object.keys(running).length ? running : undefined,
  };
}

export async function fetchPitcherLeaguePercentiles(
  pool: pg.Pool,
  input: { game_year: number; pitcher_mlbam: number; player_id: number }
): Promise<LeaguePercentilesResponse> {
  const anchorRaw = await fetchMaxMlbPlayerGamesForSeason(pool, input.game_year).catch(() => 0);
  const anchorG = Math.max(1, anchorRaw);
  const tBbe = prorateCountForSeason(50, anchorG);
  const tPitchesProcess = prorateCountForSeason(800, anchorG);
  const tSwingsWhiff = prorateCountForSeason(200, anchorG);
  const tPitchesExt = prorateCountForSeason(400, anchorG);
  const tFf = prorateCountForSeason(75, anchorG);
  const tPitchType = prorateCountForSeason(250, anchorG);
  const tBbeEst = prorateCountForSeason(50, anchorG);
  const minTbfFg = prorateCountForSeason(150, anchorG);
  const minSprintCohort = Math.max(3, prorateCountForSeason(10, anchorG));

  const { rows: tot } = await pool.query(
    `SELECT * FROM statcast_pitcher_season_totals_percentile_mv
     WHERE game_year = $1 AND pitcher_mlbam = $2`,
    [input.game_year, input.pitcher_mlbam]
  );
  const t = (tot[0] ?? {}) as Record<string, unknown>;
  const pitches = int(t.pitches) ?? 0;
  const swings = int(t.swings) ?? 0;
  const bbe = int(t.bbe) ?? 0;
  const pExt = int(t.pitches_with_extension) ?? 0;
  const ffN = int(t.ff_pitches) ?? 0;

  const seasonPct: Record<string, PercentileSlot> = {
    pitch_avg_exit_velo_on_bip: buildPercentileSlot({
      percentile: num(t.val_avg_exit_velo_on_bip) != null ? int(t.pct_avg_exit_velo_on_bip) : null,
      cohortN: int(t.cohort_n_bip),
      qualified: bbe >= tBbe && num(t.val_avg_exit_velo_on_bip) != null,
      value: num(t.val_avg_exit_velo_on_bip),
      direction: directionForMetric('pitch_avg_exit_velo_on_bip'),
    }),
    pitch_chase_pct: buildPercentileSlot({
      percentile: num(t.val_chase_pct) != null ? int(t.pct_chase_pct) : null,
      cohortN: int(t.cohort_n_pitch_process),
      qualified: pitches >= tPitchesProcess && num(t.val_chase_pct) != null,
      value: num(t.val_chase_pct),
      direction: directionForMetric('pitch_chase_pct'),
    }),
    pitch_whiff_pct: buildPercentileSlot({
      percentile: num(t.val_whiff_pct) != null ? int(t.pct_whiff_pct) : null,
      cohortN: int(t.cohort_n_swings_whiff),
      qualified: swings >= tSwingsWhiff && num(t.val_whiff_pct) != null,
      value: num(t.val_whiff_pct),
      direction: directionForMetric('pitch_whiff_pct'),
    }),
    pitch_swstr_pct: buildPercentileSlot({
      percentile: num(t.val_swstr_pct) != null ? int(t.pct_swstr_pct) : null,
      cohortN: int(t.cohort_n_pitch_process),
      qualified: pitches >= tPitchesProcess && num(t.val_swstr_pct) != null,
      value: num(t.val_swstr_pct),
      direction: directionForMetric('pitch_swstr_pct'),
    }),
    pitch_zone_pct: buildPercentileSlot({
      percentile: num(t.val_zone_pct) != null ? int(t.pct_zone_pct) : null,
      cohortN: int(t.cohort_n_pitch_process),
      qualified: pitches >= tPitchesProcess && num(t.val_zone_pct) != null,
      value: num(t.val_zone_pct),
      direction: directionForMetric('pitch_zone_pct'),
    }),
    pitch_swing_pct: buildPercentileSlot({
      percentile: num(t.val_swing_pct) != null ? int(t.pct_swing_pct) : null,
      cohortN: int(t.cohort_n_pitch_process),
      qualified: pitches >= tPitchesProcess && num(t.val_swing_pct) != null,
      value: num(t.val_swing_pct),
      direction: directionForMetric('pitch_swing_pct'),
    }),
    pitch_gb_pct: buildPercentileSlot({
      percentile: num(t.val_gb_pct) != null ? int(t.pct_gb_pct) : null,
      cohortN: int(t.cohort_n_bip),
      qualified: bbe >= tBbe && num(t.val_gb_pct) != null,
      value: num(t.val_gb_pct),
      direction: directionForMetric('pitch_gb_pct'),
    }),
    pitch_fb_pct: buildPercentileSlot({
      percentile: num(t.val_fb_pct) != null ? int(t.pct_fb_pct) : null,
      cohortN: int(t.cohort_n_bip),
      qualified: bbe >= tBbe && num(t.val_fb_pct) != null,
      value: num(t.val_fb_pct),
      direction: directionForMetric('pitch_fb_pct'),
    }),
    pitch_hr_pct: buildPercentileSlot({
      percentile: num(t.val_hr_pct) != null ? int(t.pct_hr_pct) : null,
      cohortN: int(t.cohort_n_bip),
      qualified: bbe >= tBbe && num(t.val_hr_pct) != null,
      value: num(t.val_hr_pct),
      direction: directionForMetric('pitch_hr_pct'),
    }),
    pitch_avg_release_extension: buildPercentileSlot({
      percentile: num(t.val_avg_release_extension) != null ? int(t.pct_avg_release_extension) : null,
      cohortN: int(t.cohort_n_extension),
      qualified: pExt >= tPitchesExt && num(t.val_avg_release_extension) != null,
      value: num(t.val_avg_release_extension),
      direction: directionForMetric('pitch_avg_release_extension'),
    }),
    pitch_ff_avg_velo: buildPercentileSlot({
      percentile: num(t.val_ff_avg_velo) != null ? int(t.pct_ff_avg_velo) : null,
      cohortN: int(t.cohort_n_ff_velo),
      qualified: ffN >= tFf && num(t.val_ff_avg_velo) != null,
      value: num(t.val_ff_avg_velo),
      direction: directionForMetric('pitch_ff_avg_velo'),
    }),
  };

  await enrichPitcherStatcastTotalsHypotheticals(pool, {
    game_year: input.game_year,
    tBbe,
    tPitches: tPitchesProcess,
    tSwingsWhiff,
    tPitchesExt,
    tFf,
    slots: seasonPct,
  });

  const { rows: ptRows } = await pool.query(
    `SELECT * FROM statcast_pitcher_season_pitchtype_percentile_mv
     WHERE game_year = $1 AND pitcher_mlbam = $2
     ORDER BY pitches DESC`,
    [input.game_year, input.pitcher_mlbam]
  );
  const byPitch: Record<string, Record<string, PercentileSlot>> = {};
  for (const raw of rowsToJson(ptRows as Record<string, unknown>[])) {
    const r = raw as Record<string, unknown>;
    const pt = String(r.pitch_type ?? '').trim();
    if (!pt) continue;
    const pc = int(r.pitches) ?? 0;
    /** Prorated full-season floor, or enough type pitches that we treat the row as non-provisional. */
    const pitchTypeQualified =
      pc >= tPitchType || pc >= PITCH_TYPE_NON_PROVISIONAL_TYPE_PITCHES;
    const spinVal = num(r.val_avg_spin);
    byPitch[pt] = {
      pitch_avg_velo: slotFromRow(
        'pitch_avg_velo',
        'pct_avg_velo',
        'cohort_n',
        pitchTypeQualified && num(r.val_avg_velo) != null,
        'val_avg_velo',
        r
      ),
      pitch_avg_spin: buildPercentileSlot({
        percentile: spinVal != null ? int(r.pct_avg_spin) : null,
        cohortN: int(r.cohort_n),
        qualified: pitchTypeQualified && spinVal != null,
        value: spinVal,
        direction: directionForMetric('pitch_avg_spin'),
      }),
      pitch_avg_pfx_x: slotFromRow(
        'pitch_avg_pfx_x',
        'pct_avg_pfx_x',
        'cohort_n',
        pitchTypeQualified && num(r.val_avg_pfx_x) != null,
        'val_avg_pfx_x',
        r
      ),
      pitch_avg_pfx_z: slotFromRow(
        'pitch_avg_pfx_z',
        'pct_avg_pfx_z',
        'cohort_n',
        pitchTypeQualified && num(r.val_avg_pfx_z) != null,
        'val_avg_pfx_z',
        r
      ),
      pitch_zone_pct: slotFromRow(
        'pitch_zone_pct',
        'pct_zone_pct',
        'cohort_n',
        pitchTypeQualified && num(r.val_zone_pct) != null,
        'val_zone_pct',
        r
      ),
      pitch_chase_pct: slotFromRow(
        'pitch_chase_pct',
        'pct_chase_pct',
        'cohort_n',
        pitchTypeQualified && num(r.val_chase_pct) != null,
        'val_chase_pct',
        r
      ),
      pitch_swing_pct: slotFromRow(
        'pitch_swing_pct',
        'pct_swing_pct',
        'cohort_n',
        pitchTypeQualified && num(r.val_swing_pct) != null,
        'val_swing_pct',
        r
      ),
      pitch_whiff_pct: slotFromRow(
        'pitch_whiff_pct',
        'pct_whiff_pct',
        'cohort_n',
        pitchTypeQualified && num(r.val_whiff_pct) != null,
        'val_whiff_pct',
        r
      ),
      pitch_swstr_pct: slotFromRow(
        'pitch_swstr_pct',
        'pct_swstr_pct',
        'cohort_n',
        pitchTypeQualified && num(r.val_swstr_pct) != null,
        'val_swstr_pct',
        r
      ),
      pitch_gb_pct: slotFromRow(
        'pitch_gb_pct',
        'pct_gb_pct',
        'cohort_n',
        pitchTypeQualified && num(r.val_gb_pct) != null,
        'val_gb_pct',
        r
      ),
      pitch_fb_pct: slotFromRow(
        'pitch_fb_pct',
        'pct_fb_pct',
        'cohort_n',
        pitchTypeQualified && num(r.val_fb_pct) != null,
        'val_fb_pct',
        r
      ),
      pitch_hr_pct: slotFromRow(
        'pitch_hr_pct',
        'pct_hr_pct',
        'cohort_n',
        pitchTypeQualified && num(r.val_hr_pct) != null,
        'val_hr_pct',
        r
      ),
    };
    await enrichPitchTypeMvHypotheticals(pool, {
      game_year: input.game_year,
      pitch_type: pt,
      tPitches: tPitchType,
      slots: byPitch[pt],
    });
  }

  const fgSavant =
    (await tryOptionalRelation(() =>
      fetchSavantFgPitchingSeason(pool, {
        season: input.game_year,
        player_id: input.player_id,
        min_tbf: minTbfFg,
      })
    )) ?? {};
  const bipExtras =
    (await tryOptionalRelation(() =>
      fetchPitcherSavantBipExtras(pool, {
        game_year: input.game_year,
        pitcher_mlbam: input.pitcher_mlbam,
        t_bbe: tBbe,
        t_bbe_est: tBbeEst,
      })
    )) ?? {};

  const savant_pitching: Record<string, PercentileSlot> = {
    ...fgSavant,
    ...seasonPct,
    ...bipExtras,
  };

  await enrichPitcherSavantBipMvHypotheticals(pool, {
    game_year: input.game_year,
    tBbe,
    tBbeEst,
    slots: savant_pitching,
  });

  return {
    cohort_spec_version: LEAGUE_PERCENTILES_COHORT_SPEC_VERSION,
    game_year: input.game_year,
    role: 'pitcher',
    cohort_notes: [
      'MLB Statcast',
      'FanGraphs season (xERA, K%, BB%)',
      'pitch-type cohort: (game_year, pitch_type)',
      'docs/COHORT_PERCENTILES_SPEC.md',
    ],
    percentiles_available: true,
    season: { percentiles: seasonPct },
    by_pitch_type: byPitch,
    savant_pitching,
  };
}

export async function getLeaguePercentilesForPlayer(
  pool: pg.Pool,
  input: {
    player_id: number;
    key_mlbam: number | null;
    game_year: number;
    role: 'batter' | 'pitcher' | 'fielding';
    position?: string | null;
  }
): Promise<LeaguePercentilesResponse> {
  if (input.role === 'fielding') {
    const anchorRaw = await fetchMaxMlbPlayerGamesForSeason(pool, input.game_year).catch(() => 0);
    const anchorG = Math.max(1, anchorRaw);
    const minInnField = prorateCountForSeason(100, anchorG);
    const minSprintCohort = Math.max(3, prorateCountForSeason(10, anchorG));
    const base = await fetchFieldingLeaguePercentilesBundle(pool, {
      season: input.game_year,
      player_id: input.player_id,
      min_inn_field: minInnField,
    });
    const mlbam = input.key_mlbam;
    const running =
      mlbam != null
        ? (await tryOptionalRelation(() =>
            fetchSavantRunning(pool, {
              game_year: input.game_year,
              key_mlbam: mlbam,
              min_cohort: minSprintCohort,
            })
          )) ?? {}
        : {};
    const savant_fielding: Record<string, PercentileSlot> = {
      ...(base.percentiles ?? {}),
    };
    return {
      ...base,
      cohort_notes: [
        ...base.cohort_notes,
        'OAA on FG rows is FanGraphs-reported OAA; Savant Range / Arm / Strength sliders ship after ingest (see docs/DATASETS.md, scripts/analyze-percentile-slider-support.sql).',
      ],
      savant_fielding,
      savant_running: Object.keys(running).length ? running : undefined,
    };
  }
  if (input.key_mlbam == null) {
    return {
      cohort_spec_version: LEAGUE_PERCENTILES_COHORT_SPEC_VERSION,
      game_year: input.game_year,
      role: input.role,
      cohort_notes: [],
      percentiles_available: false,
      reason: 'Player has no key_mlbam',
      percentiles: {},
    };
  }
  try {
    if (input.role === 'batter') {
      return await fetchBatterLeaguePercentiles(pool, {
        game_year: input.game_year,
        batter_mlbam: input.key_mlbam,
        player_id: input.player_id,
      });
    }
    return await fetchPitcherLeaguePercentiles(pool, {
      game_year: input.game_year,
      pitcher_mlbam: input.key_mlbam,
      player_id: input.player_id,
    });
  } catch (e) {
    if (isUndefinedRelation(e)) {
      return {
        cohort_spec_version: LEAGUE_PERCENTILES_COHORT_SPEC_VERSION,
        game_year: input.game_year,
        role: input.role,
        cohort_notes: [
          'Materialized views missing; run Flyway V15–V20 + pnpm db:refresh-percentiles',
        ],
        percentiles_available: false,
        reason: 'statcast percentile materialized views not installed or not refreshed',
        percentiles: {},
      };
    }
    throw e;
  }
}

