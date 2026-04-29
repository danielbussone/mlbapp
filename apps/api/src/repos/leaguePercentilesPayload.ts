import type { PercentileDirection, PercentileSlot } from './leaguePercentilesTypes.js';

export function buildPercentileSlot(input: {
  percentile: number | null | undefined;
  cohortN: number | null | undefined;
  qualified: boolean;
  value: number | null | undefined;
  direction?: PercentileDirection;
}): PercentileSlot {
  const n =
    input.cohortN != null && Number.isFinite(Number(input.cohortN))
      ? Math.trunc(Number(input.cohortN))
      : null;
  const value =
    input.value != null && Number.isFinite(Number(input.value)) ? Number(input.value) : null;
  const qualified = Boolean(input.qualified) && value != null;
  /** Cohort percentile may display when unqualified (provisional); `qualified` drives UI emphasis. */
  const p =
    value != null && input.percentile != null && Number.isFinite(Number(input.percentile))
      ? Math.min(100, Math.max(0, Math.round(Number(input.percentile))))
      : null;
  const direction = input.direction ?? 'higher_better';
  return { p, n, qualified, value, direction };
}
