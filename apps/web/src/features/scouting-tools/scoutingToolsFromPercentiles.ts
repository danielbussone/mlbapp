/**
 * Prototype: derive 20–80 scouting-style grades from existing league percentile payloads.
 * See plan: scouting 20-80 tools (Phase 0).
 */

import type {
  LeaguePercentilesResponse,
  PercentileDirection,
  PercentileSlot,
} from '@/features/league-percentiles/leaguePercentilesTypes.js';
import { goodnessDisplayPercentile } from '@/features/league-percentiles/percentileGoodnessColor.js';

/** Goodness percentile 0–100 → 20–80 scale, rounded to nearest 5 (scouting steps). */
export function goodnessToScoutingGrade20_80(g: number): number {
  const clamped = Math.min(100, Math.max(0, g));
  const raw = 20 + (60 * clamped) / 100;
  const rounded5 = Math.round(raw / 5) * 5;
  return Math.min(80, Math.max(20, rounded5));
}

export type MetricContribution = {
  metricId: string;
  /** Raw league / cohort percentile 0–100 from the API slot */
  leaguePercentile: number | null;
  direction: PercentileDirection;
  /** Goodness-oriented 0–100 (flipped when `lower_better`) */
  goodnessPercentile: number | null;
  qualified: boolean;
  value: number | null;
  /** Included in the mean for this grade */
  used: boolean;
};

/** Click-through drill-down: how a 20–80 cell was derived from percentile slots. */
export type ScoutingGradeBreakdown = {
  grade20_80: number | null;
  /** Mean goodness 0–100 over `used` metrics (same input as the grade mapper) */
  meanGoodness: number | null;
  metrics: MetricContribution[];
  /** Step-by-step lines (may include numeric substitution for this row) */
  formulaLines: string[];
  /** How this row picked stats (e.g. first tier with data, or fallback set) */
  selectionNote?: string;
};

const FORMULA_PREAMBLE: readonly string[] = [
  '1) Goodness (0–100, higher = better): start from league percentile p; if the stat is lower-is-better, use (100 − p).',
  '2) Mean: average goodness over listed metrics that have data; missing stats are omitted (not zeros).',
  '3) Map to 20–80: raw = 20 + 60 × (mean ÷ 100).',
  '4) Display: round raw to the nearest 5, then clamp to [20, 80].',
];

function metricContribution(
  slots: Record<string, PercentileSlot>,
  metricId: string,
  used: boolean
): MetricContribution {
  const slot = slots[metricId];
  const g = slot ? goodnessDisplayPercentile(slot) : null;
  const usedEff = used && g != null && Number.isFinite(g);
  return {
    metricId,
    leaguePercentile: slot?.p ?? null,
    direction: slot?.direction ?? 'higher_better',
    goodnessPercentile: g,
    qualified: slot?.qualified ?? false,
    value: slot?.value ?? null,
    used: usedEff,
  };
}

/** Explains the grade from a single equal-weight group of metrics (same logic as the displayed grade). */
export function explainGradeFromMetricIds(
  slots: Record<string, PercentileSlot>,
  metricIds: readonly string[]
): ScoutingGradeBreakdown {
  const contributions = metricIds.map((id) => {
    const slot = slots[id];
    const g = slot ? goodnessDisplayPercentile(slot) : null;
    const canUse = g != null && Number.isFinite(g);
    return metricContribution(slots, id, canUse);
  });
  const used = contributions.filter((m) => m.used);
  const mean =
    used.length === 0 ? null : used.reduce((s, m) => s + (m.goodnessPercentile as number), 0) / used.length;
  const grade = mean == null ? null : goodnessToScoutingGrade20_80(mean);
  const formulaLines = [...FORMULA_PREAMBLE];
  if (mean != null) {
    const sumExpr = used.map((m) => `${fmt1(m.goodnessPercentile as number)}`).join(' + ');
    formulaLines.push(`For this cell: mean_goodness = (${sumExpr}) / ${used.length} = ${mean.toFixed(2)}.`);
    const rawUncapped = 20 + (60 * mean) / 100;
    formulaLines.push(
      `raw_20_80 = 20 + 60×(${mean.toFixed(2)}/100) = ${rawUncapped.toFixed(2)} → nearest 5 → displayed grade = ${grade}.`
    );
  } else {
    formulaLines.push('For this cell: no metric had a usable league percentile, so no grade.');
  }
  return { grade20_80: grade, meanGoodness: mean, metrics: contributions, formulaLines };
}

function fmt1(x: number): string {
  return (Math.round(x * 10) / 10).toFixed(1);
}

function explainGradeWithFallback(
  slots: Record<string, PercentileSlot>,
  primary: readonly string[],
  fallback: readonly string[]
): ScoutingGradeBreakdown {
  const a = explainGradeFromMetricIds(slots, primary);
  if (a.meanGoodness != null) {
    return { ...a, selectionNote: `Stats averaged: ${primary.join(', ')}.` };
  }
  const b = explainGradeFromMetricIds(slots, fallback);
  if (b.meanGoodness != null) {
    return { ...b, selectionNote: `Stats averaged: ${fallback.join(', ')}.` };
  }
  return {
    ...b,
    selectionNote: 'No usable goodness percentiles in either stat list for this row.',
  };
}

function explainFirstTier(
  slots: Record<string, PercentileSlot>,
  tiers: readonly (readonly string[])[],
  tierSummaries: readonly string[]
): ScoutingGradeBreakdown {
  const tierRule =
    'Tier rule: try each group in order; the first group with at least one usable goodness percentile supplies the grade (only that group’s metrics appear below).';
  const preamble = [...FORMULA_PREAMBLE, tierRule];
  for (let i = 0; i < tiers.length; i++) {
    const metricIds = tiers[i]!;
    const b = explainGradeFromMetricIds(slots, metricIds);
    if (b.meanGoodness != null) {
      const summary = tierSummaries[i] ?? metricIds.join(', ');
      return {
        ...b,
        formulaLines: [...preamble, ...b.formulaLines.slice(FORMULA_PREAMBLE.length)],
        selectionNote: `Tier used: ${summary}.`,
      };
    }
  }
  return {
    grade20_80: null,
    meanGoodness: null,
    metrics: [],
    formulaLines: [...preamble, 'No tier had usable data, so this cell has no grade.'],
    selectionNote: 'No tier matched.',
  };
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

/** Shown when a role has no result column or result is not implemented. */
export const SCOUTING_NO_RESULT_BREAKDOWN: ScoutingGradeBreakdown = {
  grade20_80: null,
  meanGoodness: null,
  metrics: [],
  formulaLines: ['No separate result grade for this row in the current prototype.'],
};

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
  /** Click drill-down for the process (or single) grade column */
  processBreakdown: ScoutingGradeBreakdown;
  /** Click drill-down for the result grade column */
  resultBreakdown: ScoutingGradeBreakdown;
};

export function battingScoutingLines(slots: Record<string, PercentileSlot>, _season: number): ScoutingToolLine[] {
  const hitProcessBd = explainGradeWithFallback(
    slots,
    ['bat_whiff_pct', 'bip_avg_estimated_ba'],
    ['fg_season_k_pct']
  );
  const hitResultBd = explainGradeFromMetricIds(slots, ['fg_season_avg']);

  const eyeProcessBd = explainGradeWithFallback(slots, ['bat_chase_pct'], ['fg_season_bb_pct']);
  const eyeResultBd = explainGradeFromMetricIds(slots, ['fg_season_bb_pct']);

  const powerProcessBd = explainGradeWithFallback(
    slots,
    ['bip_barrel_pct', 'bip_hard_hit_pct', 'bip_ev90', 'bip_avg_exit_velo'],
    ['fg_season_iso', 'fg_season_slg']
  );
  const powerResultBd = explainGradeFromMetricIds(slots, ['fg_season_iso']);

  const overallProcessBd = explainGradeWithFallback(slots, ['fg_season_xwoba'], ['fg_season_woba', 'fg_season_wrc_plus']);
  const overallResultBd = explainGradeFromMetricIds(slots, ['fg_season_woba', 'fg_season_wrc_plus']);

  const runProcessBd = explainGradeFromMetricIds(slots, ['running_sprint_speed']);
  const runResultBd = explainGradeFromMetricIds(slots, ['fg_season_bsr']);

  return [
    {
      key: 'hit',
      label: 'Hit',
      process: hitProcessBd.grade20_80,
      result: hitResultBd.grade20_80,
      processTooltip: 'Whiff %, xBA on contact, K%',
      resultTooltip: 'AVG',
      processBreakdown: hitProcessBd,
      resultBreakdown: hitResultBd,
    },
    {
      key: 'eye',
      label: 'Eye',
      process: eyeProcessBd.grade20_80,
      result: eyeResultBd.grade20_80,
      processTooltip: 'Chase %, BB%',
      resultTooltip: 'BB%',
      processBreakdown: eyeProcessBd,
      resultBreakdown: eyeResultBd,
    },
    {
      key: 'power',
      label: 'Power',
      process: powerProcessBd.grade20_80,
      result: powerResultBd.grade20_80,
      processTooltip: 'Barrel %, Hard-hit %, EV90, Avg EV, ISO, SLG',
      resultTooltip: 'ISO',
      processBreakdown: powerProcessBd,
      resultBreakdown: powerResultBd,
    },
    {
      key: 'overall',
      label: 'Overall',
      process: overallProcessBd.grade20_80,
      result: overallResultBd.grade20_80,
      processTooltip: 'xwOBA, wOBA, wRC+',
      resultTooltip: 'wOBA, wRC+',
      processBreakdown: overallProcessBd,
      resultBreakdown: overallResultBd,
    },
    {
      key: 'run',
      label: 'Run',
      process: runProcessBd.grade20_80,
      result: runResultBd.grade20_80,
      processTooltip: 'Sprint speed',
      resultTooltip: 'BsR',
      processBreakdown: runProcessBd,
      resultBreakdown: runResultBd,
    },
  ];
}

const FG_STUFF_PLUS = 'fg_season_pit_stuff_plus';
const FG_LOCATION_PLUS = 'fg_season_pit_location_plus';
const FG_PITCHING_PLUS = 'fg_season_pit_pitching_plus';

function goodnessPercentileUsable(slots: Record<string, PercentileSlot>, metricId: string): boolean {
  const slot = slots[metricId];
  const g = slot ? goodnessDisplayPercentile(slot) : null;
  return g != null && Number.isFinite(g);
}

/** All three FanGraphs + metrics have usable league-percentile goodness (cohort slots). */
export function fgTriplePlusUsable(slots: Record<string, PercentileSlot>): boolean {
  return (
    goodnessPercentileUsable(slots, FG_STUFF_PLUS) &&
    goodnessPercentileUsable(slots, FG_LOCATION_PLUS) &&
    goodnessPercentileUsable(slots, FG_PITCHING_PLUS)
  );
}

/** Season ≥ 2002, modern: expected + index + realized run prevention (missing stats drop out of the mean). */
const OVERALL_PITCH_2020_METRICS = [
  'fg_season_pit_xera',
  'fg_season_pit_xfip',
  FG_PITCHING_PLUS,
  'fg_season_pit_era',
  'fg_season_pit_fip',
] as const;

function explainGradeOverallPitch(
  slots: Record<string, PercentileSlot>,
  season: number,
  triplePlus: boolean
): ScoutingGradeBreakdown {
  if (triplePlus && season >= 2002) {
    if (season >= 2020) {
      const b = explainGradeFromMetricIds(slots, OVERALL_PITCH_2020_METRICS);
      return {
        ...b,
        selectionNote:
          b.meanGoodness != null
            ? 'FanGraphs + bundle (Stuff+, Location+, Pitching+ available): Overall averages xERA, xFIP, Pitching+, ERA, and FIP (each with data is included).'
            : 'No usable Overall inputs.',
      };
    }
    const b = explainGradeFromMetricIds(slots, ['fg_season_pit_era', 'fg_season_pit_fip', FG_PITCHING_PLUS]);
    return {
      ...b,
      selectionNote:
        b.meanGoodness != null
          ? 'FanGraphs + bundle: Overall averages ERA, FIP, and Pitching+.'
          : 'No usable Overall inputs.',
    };
  }

  if (season >= 2020) {
    const b = explainGradeFromMetricIds(slots, OVERALL_PITCH_2020_METRICS);
    if (b.meanGoodness != null) {
      return {
        ...b,
        selectionNote:
          'Set: xERA, xFIP, Pitching+, ERA, FIP (season ≥ 2020; stats without cohort percentiles are omitted from the mean).',
      };
    }
  }
  const b = explainGradeFromMetricIds(slots, ['fg_season_pit_era', 'fg_season_pit_fip']);
  return {
    ...b,
    selectionNote:
      season >= 2020
        ? 'Set: ERA, FIP only (none of the broader 2020+ Overall inputs had usable percentiles).'
        : 'Set: ERA, FIP.',
  };
}

export function pitchingScoutingLines(slots: Record<string, PercentileSlot>, season: number): ScoutingToolLine[] {
  const ancient = season < 2002;

  if (ancient) {
    const stuffMissBd = explainGradeFromMetricIds(slots, ['fg_season_pit_k_pct']);
    const commandControlBd = explainGradeFromMetricIds(slots, ['fg_season_pit_bb_pct']);
    const overallBd = explainGradeFromMetricIds(slots, ['fg_season_pit_era', 'fg_season_pit_fip']);
    return [
      {
        key: 'stuff_miss',
        label: 'Stuff & miss',
        process: stuffMissBd.grade20_80,
        result: null,
        processTooltip: 'K%',
        resultTooltip: '',
        processBreakdown: stuffMissBd,
        resultBreakdown: SCOUTING_NO_RESULT_BREAKDOWN,
      },
      {
        key: 'command_control',
        label: 'Command & control',
        process: commandControlBd.grade20_80,
        result: null,
        processTooltip: 'BB%',
        resultTooltip: '',
        processBreakdown: commandControlBd,
        resultBreakdown: SCOUTING_NO_RESULT_BREAKDOWN,
      },
      {
        key: 'overall_pit',
        label: 'Overall',
        process: overallBd.grade20_80,
        result: null,
        processTooltip: 'ERA, FIP',
        resultTooltip: '',
        processBreakdown: overallBd,
        resultBreakdown: SCOUTING_NO_RESULT_BREAKDOWN,
      },
    ];
  }

  const triplePlus = fgTriplePlusUsable(slots);

  let stuffBd: ScoutingGradeBreakdown;
  let stuffTip: string;
  if (triplePlus) {
    stuffBd = {
      ...explainGradeFromMetricIds(slots, [FG_STUFF_PLUS]),
      selectionNote:
        'FanGraphs Stuff+ only (Stuff+, Location+, and Pitching+ cohort slots all available).',
    };
    stuffTip = 'Stuff+';
  } else {
    const stuffTiers: (readonly string[])[] = [
      ['pitch_ff_avg_velo', 'pitch_whiff_pct', 'pitch_swstr_pct'],
    ];
    const stuffTierLabels: string[] = ['Statcast: FF velo, Whiff%, SwStr%'];
    if (season >= 2020) {
      stuffTiers.push([FG_STUFF_PLUS]);
      stuffTierLabels.push('FanGraphs Stuff+');
    }
    stuffTiers.push([
      'fg_season_pit_fbv',
      'fg_season_pit_fg_o_swing_pct',
      'fg_season_pit_fg_swstr_pct',
    ]);
    stuffTierLabels.push('FanGraphs: FBv, O-Swing%, SwStr%');
    stuffTiers.push(['fg_season_pit_k_pct']);
    stuffTierLabels.push('FanGraphs K%');
    stuffBd = explainFirstTier(slots, stuffTiers, stuffTierLabels);
    stuffTip =
      season >= 2020
        ? 'FF velo, Whiff%, SwStr%, Stuff+, FBv, O-Swing%, K%'
        : 'FF velo, Whiff%, SwStr%, FBv, O-Swing%, K%';
  }

  let commandBd: ScoutingGradeBreakdown;
  let commandTip: string;
  if (triplePlus) {
    commandBd = {
      ...explainGradeFromMetricIds(slots, [FG_LOCATION_PLUS]),
      selectionNote:
        'FanGraphs Location+ only (Stuff+, Location+, and Pitching+ cohort slots all available).',
    };
    commandTip = 'Location+';
  } else {
    const commandTiers: (readonly string[])[] = [['pitch_zone_pct']];
    const commandTierLabels: string[] = ['Statcast: Zone%'];
    if (season >= 2020) {
      commandTiers.push([FG_LOCATION_PLUS]);
      commandTierLabels.push('FanGraphs Location+');
    }
    commandTiers.push(['fg_season_pit_fg_zone_pct']);
    commandTierLabels.push('FanGraphs Zone%');
    commandBd = explainFirstTier(slots, commandTiers, commandTierLabels);
    commandTip =
      season >= 2020 ? 'Zone%, Location+, FanGraphs Zone%' : 'Zone%, FanGraphs Zone%';
  }

  const controlBd = explainGradeFromMetricIds(slots, ['fg_season_pit_bb_pct']);

  const limitTiers: (readonly string[])[] = [
    ['pitch_barrel_pct_allowed', 'pitch_hard_hit_pct_allowed', 'pitch_sweet_spot_pct_allowed'],
    ['fg_season_pit_fg_gb_pct', 'fg_season_pit_fg_iffb_pct', 'fg_season_pit_fg_hard_pct'],
    ['fg_season_pit_fg_gb_pct', 'fg_season_pit_hr_fb_pct'],
    ['fg_season_pit_babip'],
  ];
  const limitTierLabels = [
    'Statcast: Barrel%, Hard-hit%, Sweet-spot%',
    'FanGraphs: GB%, IFFB%, Hard%',
    'FanGraphs: GB%, HR/FB',
    'FanGraphs BABIP',
  ] as const;
  const limitDamageBd = explainFirstTier(slots, limitTiers, limitTierLabels);

  const overallBd = explainGradeOverallPitch(slots, season, triplePlus);

  const overallTip =
    season >= 2020
      ? 'xERA, xFIP, Pitching+, ERA, FIP'
      : triplePlus
        ? 'ERA, FIP, Pitching+'
        : 'ERA, FIP';

  return [
    {
      key: 'stuff',
      label: 'Stuff',
      process: stuffBd.grade20_80,
      result: null,
      processTooltip: stuffTip,
      resultTooltip: '',
      processBreakdown: stuffBd,
      resultBreakdown: SCOUTING_NO_RESULT_BREAKDOWN,
    },
    {
      key: 'command',
      label: 'Command',
      process: commandBd.grade20_80,
      result: null,
      processTooltip: commandTip,
      resultTooltip: '',
      processBreakdown: commandBd,
      resultBreakdown: SCOUTING_NO_RESULT_BREAKDOWN,
    },
    {
      key: 'control',
      label: 'Control',
      process: controlBd.grade20_80,
      result: null,
      processTooltip: 'BB%',
      resultTooltip: '',
      processBreakdown: controlBd,
      resultBreakdown: SCOUTING_NO_RESULT_BREAKDOWN,
    },
    {
      key: 'limit_damage',
      label: 'Limit damage',
      process: limitDamageBd.grade20_80,
      result: null,
      processTooltip: 'Barrel%, Hard-hit%, Sweet-spot%, GB%, IFFB%, Hard%, HR/FB, BABIP',
      resultTooltip: '',
      processBreakdown: limitDamageBd,
      resultBreakdown: SCOUTING_NO_RESULT_BREAKDOWN,
    },
    {
      key: 'overall_pit',
      label: 'Overall',
      process: overallBd.grade20_80,
      result: null,
      processTooltip: overallTip,
      resultTooltip: '',
      processBreakdown: overallBd,
      resultBreakdown: SCOUTING_NO_RESULT_BREAKDOWN,
    },
  ];
}

export function fieldingScoutingLines(slots: Record<string, PercentileSlot>, _season: number): ScoutingToolLine[] {
  const rangeBd = explainGradeFromMetricIds(slots, ['pos_oaa', 'pos_drs', 'pos_uzr', 'pos_frv']);
  const armBd = explainGradeFromMetricIds(slots, ['catch_pop_time_sec', 'catch_cs_above_avg']);
  const armGrade = armBd.grade20_80;

  return [
    {
      key: 'range',
      label: 'Range',
      process: rangeBd.grade20_80,
      result: null,
      processTooltip: 'OAA, DRS, UZR, FRV',
      resultTooltip: '—',
      processBreakdown: rangeBd,
      resultBreakdown: SCOUTING_NO_RESULT_BREAKDOWN,
    },
    {
      key: 'arm',
      label: 'Arm',
      process: armGrade,
      result: null,
      processNote: armGrade == null ? 'non-C or no arm stats' : undefined,
      processTooltip: 'Pop time, CS+',
      resultTooltip: '—',
      processBreakdown: armBd,
      resultBreakdown: SCOUTING_NO_RESULT_BREAKDOWN,
    },
  ];
}
