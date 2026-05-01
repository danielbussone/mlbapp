/**
 * Prototype: derive 20–80 scouting-style grades from existing league percentile payloads.
 * See plan: scouting 20-80 tools (Phase 0).
 */

import type { LeaguePercentilesResponse, PercentileSlot } from '@/features/league-percentiles/leaguePercentilesTypes.js';
import { goodnessDisplayPercentile } from '@/features/league-percentiles/percentileGoodnessColor.js';

/** Goodness percentile 0–100 → 20–80 scale, rounded to nearest 5 (scouting steps). */
export function goodnessToScoutingGrade20_80(g: number): number {
  const clamped = Math.min(100, Math.max(0, g));
  const raw = 20 + (60 * clamped) / 100;
  const rounded5 = Math.round(raw / 5) * 5;
  return Math.min(80, Math.max(20, rounded5));
}

function weightedMeanGoodness(
  slots: Record<string, PercentileSlot>,
  metricIds: readonly string[]
): number | null {
  let sum = 0;
  let n = 0;
  for (const id of metricIds) {
    const slot = slots[id];
    if (!slot) continue;
    const g = goodnessDisplayPercentile(slot);
    if (g == null || !Number.isFinite(g)) continue;
    sum += g;
    n += 1;
  }
  if (n === 0) return null;
  return sum / n;
}

function gradeFromMetricIds(
  slots: Record<string, PercentileSlot>,
  metricIds: readonly string[]
): number | null {
  const mean = weightedMeanGoodness(slots, metricIds);
  return mean == null ? null : goodnessToScoutingGrade20_80(mean);
}

/** Merge percentile slots the same way as `LeaguePercentilesPanel` per role. */
export function mergeSlotsForScouting(data: LeaguePercentilesResponse): Record<string, PercentileSlot> {
  if (data.role === 'batter') {
    const bat = data.savant_batting ?? data.percentiles ?? {};
    const run = data.savant_running ?? {};
    return { ...bat, ...run };
  }
  if (data.role === 'pitcher') {
    return data.savant_pitching ?? data.season?.percentiles ?? {};
  }
  if (data.role === 'fielding') {
    const groups = data.fielding_percentile_groups;
    const total = groups?.find((g) => g.position_key === 'TOTAL');
    const base = total?.percentiles ?? data.savant_fielding ?? data.percentiles ?? {};
    const run = data.savant_running ?? {};
    const cat = data.savant_catching ?? {};
    return { ...base, ...run, ...cat };
  }
  return {};
}

export type ScoutingToolLine = {
  key: string;
  label: string;
  /** Process-oriented composite (or single-metric) grade */
  process: number | null;
  /** Results-oriented grade */
  result: number | null;
  /** Short hint when a column is intentionally empty */
  processNote?: string;
  resultNote?: string;
  /** Short labels for stats averaged into the process grade (goodness percentiles; missing metrics renormalize). */
  processTooltip: string;
  /** Short labels for stats feeding the result grade, or "—" / "(planned)". */
  resultTooltip: string;
};

export function battingScoutingLines(slots: Record<string, PercentileSlot>): ScoutingToolLine[] {
  const hitProcess = gradeFromMetricIds(slots, ['bat_whiff_pct', 'bip_avg_estimated_ba']);
  const hitResult = gradeFromMetricIds(slots, ['fg_season_avg']);

  const eyeProcess = gradeFromMetricIds(slots, ['bat_chase_pct']);
  const eyeResult = gradeFromMetricIds(slots, ['fg_season_bb_pct']);

  const powerProcess = gradeFromMetricIds(slots, [
    'bip_barrel_pct',
    'bip_hard_hit_pct',
    'bip_ev90',
    'bip_avg_exit_velo',
  ]);
  const powerResult = gradeFromMetricIds(slots, ['fg_season_iso']);

  const overallProcess = gradeFromMetricIds(slots, ['fg_season_xwoba']);
  const overallResult = gradeFromMetricIds(slots, ['fg_season_woba', 'fg_season_wrc_plus']);

  const runProcess = gradeFromMetricIds(slots, ['running_sprint_speed']);
  const runResult = gradeFromMetricIds(slots, ['fg_season_bsr']);

  return [
    {
      key: 'hit',
      label: 'Hit',
      process: hitProcess,
      result: hitResult,
      processTooltip: 'Whiff %, xBA on contact',
      resultTooltip: 'AVG',
    },
    {
      key: 'eye',
      label: 'Eye',
      process: eyeProcess,
      result: eyeResult,
      processTooltip: 'Chase %',
      resultTooltip: 'BB%',
    },
    {
      key: 'power',
      label: 'Power',
      process: powerProcess,
      result: powerResult,
      processTooltip: 'Barrel %, Hard-hit %, EV90, Avg EV',
      resultTooltip: 'ISO',
    },
    {
      key: 'overall',
      label: 'Overall',
      process: overallProcess,
      result: overallResult,
      processTooltip: 'xwOBA',
      resultTooltip: 'wOBA, wRC+',
    },
    {
      key: 'run',
      label: 'Run',
      process: runProcess,
      result: runResult,
      processTooltip: 'Sprint speed',
      resultTooltip: 'BsR',
    },
  ];
}

export function pitchingScoutingLines(slots: Record<string, PercentileSlot>): ScoutingToolLine[] {
  const stuff = gradeFromMetricIds(slots, [
    'pitch_ff_avg_velo',
    'pitch_avg_exit_velo_on_bip',
    'pitch_avg_estimated_ba_allowed',
  ]);
  const command = gradeFromMetricIds(slots, ['pitch_zone_pct', 'pitch_avg_release_extension']);
  const control = gradeFromMetricIds(slots, ['fg_season_pit_bb_pct']);
  const miss = gradeFromMetricIds(slots, ['fg_season_pit_k_pct', 'pitch_whiff_pct', 'pitch_swstr_pct']);
  const contact = gradeFromMetricIds(slots, [
    'pitch_barrel_pct_allowed',
    'pitch_hard_hit_pct_allowed',
    'pitch_sweet_spot_pct_allowed',
  ]);
  /** Expected-run composite for one Overall grade (ERA/FIP percentiles not in cohort yet). */
  const overall = gradeFromMetricIds(slots, ['fg_season_pit_xera', 'fg_season_pit_xfip']);

  return [
    {
      key: 'stuff',
      label: 'Stuff',
      process: stuff,
      result: null,
      processTooltip: 'FF velo, Avg EV allowed, xBA allowed',
      resultTooltip: '',
    },
    {
      key: 'command',
      label: 'Command',
      process: command,
      result: null,
      processTooltip: 'Zone %, Extension',
      resultTooltip: '',
    },
    {
      key: 'control',
      label: 'Control',
      process: control,
      result: null,
      processTooltip: 'BB%',
      resultTooltip: '',
    },
    {
      key: 'miss',
      label: 'Swing & miss',
      process: miss,
      result: null,
      processTooltip: 'K%, Whiff %, SwStr %',
      resultTooltip: '',
    },
    {
      key: 'pitch_contact',
      label: 'Pitch to contact',
      process: contact,
      result: null,
      processTooltip: 'Barrel % allowed, Hard-hit % allowed, Sweet-spot % allowed',
      resultTooltip: '',
    },
    {
      key: 'overall_pit',
      label: 'Overall',
      process: overall,
      result: null,
      processTooltip: 'xERA, xFIP',
      resultTooltip: '',
    },
  ];
}

export function fieldingScoutingLines(slots: Record<string, PercentileSlot>): ScoutingToolLine[] {
  const range = gradeFromMetricIds(slots, ['pos_oaa', 'pos_drs', 'pos_uzr', 'pos_frv']);
  const arm = gradeFromMetricIds(slots, ['catch_pop_time_sec', 'catch_cs_above_avg']);

  return [
    {
      key: 'range',
      label: 'Range',
      process: range,
      result: null,
      processTooltip: 'OAA, DRS, UZR, FRV',
      resultTooltip: '—',
    },
    {
      key: 'arm',
      label: 'Arm',
      process: arm,
      result: null,
      processNote: arm == null ? 'non-C or no arm stats' : undefined,
      processTooltip: 'Pop time, CS+',
      resultTooltip: '—',
    },
  ];
}
