/** Subset of GET /players/:id/league-percentiles (see docs/COHORT_PERCENTILES_SPEC.md). */

export type PercentileDirection = 'higher_better' | 'lower_better';

export type PercentileSlot = {
  p: number | null;
  n: number | null;
  qualified: boolean;
  value: number | null;
  direction: PercentileDirection;
};

export type FieldingPercentileGroup = {
  position_key: string;
  label: string;
  percentiles: Record<string, PercentileSlot>;
};

export type LeaguePercentilesResponse = {
  cohort_spec_version: string;
  game_year: number;
  role: 'batter' | 'pitcher' | 'fielding';
  cohort_notes: string[];
  percentiles_available: boolean;
  reason?: string;
  percentiles?: Record<string, PercentileSlot>;
  season?: { percentiles: Record<string, PercentileSlot> };
  by_pitch_type?: Record<string, Record<string, PercentileSlot>>;
  savant_batting?: Record<string, PercentileSlot>;
  savant_pitching?: Record<string, PercentileSlot>;
  savant_fielding?: Record<string, PercentileSlot>;
  savant_running?: Record<string, PercentileSlot>;
  fielding_percentile_groups?: FieldingPercentileGroup[];
};
