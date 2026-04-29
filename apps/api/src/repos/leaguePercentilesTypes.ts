/** Wire format for GET /players/:id/league-percentiles (see docs/COHORT_PERCENTILES_SPEC.md). */

export type PercentileDirection = 'higher_better' | 'lower_better';

export type PercentileSlot = {
  p: number | null;
  n: number | null;
  qualified: boolean;
  value: number | null;
  /** Raw cohort percentile (CDF of the stat). UI may invert when `lower_better`. */
  direction: PercentileDirection;
};

/** Fielding: one block (total season roll-up or a single FG `position`). */
export type FieldingPercentileGroup = {
  /** `TOTAL` or a position code e.g. `CF`, `LF`. */
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
  /** Savant-style rows: batting-only (card role batter). */
  savant_batting?: Record<string, PercentileSlot>;
  /** Savant-style rows: pitching-only (card role pitcher). */
  savant_pitching?: Record<string, PercentileSlot>;
  /** Savant-style fielding rows + FG metrics; Range/Arm/Strength placeholders until ingest. */
  savant_fielding?: Record<string, PercentileSlot>;
  /** Fielding only: season total (first) plus per-position blocks vs same-position cohorts. */
  fielding_percentile_groups?: FieldingPercentileGroup[];
  /** Sprint speed; returned for batter + fielding roles when data exists. */
  savant_running?: Record<string, PercentileSlot>;
};
