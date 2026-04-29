import type pg from 'pg';

/** MLB regular-season length used to prorate Statcast / FG minimums from league "games played" depth. */
export const REFERENCE_SCHEDULE_GAMES = 162;

function int(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Max single-player games in the season (sum of team rows), across MLB batting and pitching FG lines.
 * Used to prorate full-season sample minimums during an in-progress year.
 */
export async function fetchMaxMlbPlayerGamesForSeason(pool: pg.Pool, season: number): Promise<number> {
  const { rows } = await pool.query(
    `
    SELECT GREATEST(
      COALESCE((
        SELECT MAX(gs)::int
        FROM (
          SELECT SUM(b.games)::int AS gs
          FROM fg_batting_season_current b
          WHERE b.season = $1 AND b.level = 'MLB' AND b.games IS NOT NULL
          GROUP BY b.player_id
        ) t
      ), 0),
      COALESCE((
        SELECT MAX(gs)::int
        FROM (
          SELECT SUM(f.games)::int AS gs
          FROM fg_pitching_season_current f
          WHERE f.season = $1 AND f.level = 'MLB' AND f.games IS NOT NULL
          GROUP BY f.player_id
        ) u
      ), 0)
    ) AS g
    `,
    [season]
  );
  return int(rows[0]?.g) ?? 0;
}

/** Scale a full-season count floor by how deep the league schedule is (by max player games). */
export function prorateCountForSeason(fullSeasonMinimum: number, maxPlayerGamesInSeason: number): number {
  if (fullSeasonMinimum <= 0) return 0;
  const g = Math.max(1, Math.min(maxPlayerGamesInSeason, REFERENCE_SCHEDULE_GAMES));
  return Math.max(1, Math.round((fullSeasonMinimum * g) / REFERENCE_SCHEDULE_GAMES));
}

/** Default fraction of the qualification floor for Statcast/Savant **season** midrank peers. */
export const COHORT_PEER_FRACTION_DEFAULT = 0.52;

/**
 * Pitch-type (`by_pitch_type`) midrank peers: velocity/spin/zone/chase etc. stabilize faster than
 * season aggregates, so the peer pitch-count floor is relaxed more aggressively (midrank only).
 */
export const COHORT_PEER_FRACTION_PITCH_TYPE_MIDRANK = 0.3;

/**
 * Pitch-type rows: `qualified` (and non-provisional UI) once this many pitches of that type;
 * also caps pitch-type runtime midrank peer floor (`pitchTypeMidrankPeerPitchFloor`).
 */
export const PITCH_TYPE_NON_PROVISIONAL_TYPE_PITCHES = 50;

/**
 * FanGraphs batting season (**xwOBA**, **K%**, **BB%**, **AVG**, **SLG**): early `qualified`
 * (non-provisional UI) uses this fraction of the **same prorated** PA bar as full qualification
 * (`prorateCountForSeason(200, anchorG)`), where `anchorG` is {@link fetchMaxMlbPlayerGamesForSeason}.
 */
export const BATTING_FG_SEASON_EARLY_QUAL_FRACTION = 0.1;

/** Min PA for early `qualified` on FG batting season slots; scales with `proratedFullSeasonPaBar`. */
export function battingFgSeasonEarlyQualifiedPa(proratedFullSeasonPaBar: number): number {
  const bar = Math.max(1, Math.trunc(proratedFullSeasonPaBar));
  return Math.max(1, Math.round(bar * BATTING_FG_SEASON_EARLY_QUAL_FRACTION));
}

/**
 * Peer `pitches` floor for `statcast_pitcher_season_pitchtype_percentile_mv` runtime midrank only.
 * Uses the relaxed pitch-type fraction, then caps so we never require more than
 * {@link PITCH_TYPE_NON_PROVISIONAL_TYPE_PITCHES} type pitches to enter the cohort.
 */
export function pitchTypeMidrankPeerPitchFloor(qualTypePitchMin: number): number {
  return Math.max(
    1,
    Math.min(
      PITCH_TYPE_NON_PROVISIONAL_TYPE_PITCHES,
      cohortPeerFloorForQualifiedMin(qualTypePitchMin, COHORT_PEER_FRACTION_PITCH_TYPE_MIDRANK)
    )
  );
}

/**
 * Lower PA/TBF/pitch count floor for **who counts in a midrank cohort** vs the stricter qualification floor.
 * Statcast MVs use fixed SQL cutoffs (e.g. 800 pitches) for `pct_*`; runtime midrank must not require
 * `pitches >=` the same prorated full-season number when few arms have reached it yet (empty COUNT → no `p`).
 */
export function cohortPeerFloorForQualifiedMin(
  qualifiedMin: number,
  fraction: number = COHORT_PEER_FRACTION_DEFAULT
): number {
  const q = Math.max(1, qualifiedMin);
  const relaxed = Math.max(1, Math.floor(q * fraction));
  return Math.min(q, relaxed);
}
