import type { LeaguePercentilesResponse, PercentileSlot } from './leaguePercentilesTypes.js';

/**
 * Flatten percentile slots for a role the same way scouting grades and single-bucket
 * checks expect (TOTAL fielding merge, running, catching).
 */
export function mergePercentileSlotsForRole(data: LeaguePercentilesResponse): Record<string, PercentileSlot> {
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
