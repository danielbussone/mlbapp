import type pg from 'pg';
import { rowToJson, rowsToJson } from './rowJson.js';

/**
 * Savant bat-tracking fields on Statcast Search CSV (also in `payload_jsonb` after ETL).
 * Same names as pybaseball / Baseball Savant exports for 2024+ tracked swings.
 */
export const STATCAST_BAT_TRACKING_JSON_KEYS = {
  bat_speed: 'bat_speed',
  attack_angle: 'attack_angle',
  attack_direction: 'attack_direction',
  swing_path_tilt: 'swing_path_tilt',
} as const;

/** Player-card movement clouds need enough pitches with non-null pfx (see pitcher branch filter). */
const MAX_SAMPLE_PITCHER = 200;
/** Batter spray / batted-ball pulls can be much larger (all chartable BIP with hc_x/hc_y). */
const MAX_SAMPLE_BATTER = 12_000;
const MIN_YEAR = 2010;
const MAX_YEAR = 2026;

function clampYear(y: number): number {
  return Math.min(Math.max(y, MIN_YEAR), MAX_YEAR);
}

/** Clamped game year for Statcast queries (routes use this name). */
export function clampGameYear(y: number): number {
  return clampYear(y);
}

export async function statcastPitcherPitchMix(
  pool: pg.Pool,
  pitcher_mlbam: number,
  game_year: number
): Promise<Record<string, unknown>[]> {
  const y = clampYear(game_year);
  const { rows } = await pool.query(
    `
    SELECT
      pitch_type,
      COUNT(*)::bigint AS pitches,
      ROUND((100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0))::numeric, 1) AS pct,
      ROUND(AVG(release_speed)::numeric, 1) AS avg_velo
    FROM statcast_pitch
    WHERE game_year = $1
      AND pitcher_mlbam = $2
      AND pitch_type IS NOT NULL
    GROUP BY pitch_type
    ORDER BY pitches DESC
    `,
    [y, pitcher_mlbam]
  );
  return rowsToJson(rows as Record<string, unknown>[]);
}

export async function statcastBatterBattedBall(
  pool: pg.Pool,
  batter_mlbam: number,
  game_year: number
): Promise<Record<string, unknown>> {
  const y = clampYear(game_year);
  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE launch_speed IS NOT NULL)::bigint AS bbe,
      ROUND(AVG(launch_speed)::numeric, 1) AS avg_ev,
      ROUND(AVG(launch_angle)::numeric, 1) AS avg_la
    FROM statcast_pitch
    WHERE game_year = $1
      AND batter_mlbam = $2
      AND launch_speed IS NOT NULL
    `,
    [y, batter_mlbam]
  );
  return rowToJson((rows[0] ?? {}) as Record<string, unknown>);
}

/**
 * Season aggregates for bat path (bat speed, attack angle / direction, swing tilt) vs league
 * among pitches where `bat_speed` is present in `payload_jsonb` (Hawk-Eye bat tracking).
 * Player stats scan only that batter’s bat-tracked rows; league stats still scan all bat-tracked
 * rows for the season (required for true league averages).
 */
export async function statcastBatterBatPathSummary(
  pool: pg.Pool,
  batter_mlbam: number,
  game_year: number
): Promise<Record<string, unknown>> {
  const y = clampYear(game_year);
  const { rows } = await pool.query(
    `
    WITH league_rows AS (
      SELECT
        NULLIF(TRIM(payload_jsonb->>'bat_speed'), '')::double precision AS bs,
        NULLIF(TRIM(payload_jsonb->>'attack_angle'), '')::double precision AS aa,
        NULLIF(TRIM(payload_jsonb->>'attack_direction'), '')::double precision AS ad,
        NULLIF(TRIM(payload_jsonb->>'swing_path_tilt'), '')::double precision AS st
      FROM statcast_pitch
      WHERE game_year = $1
        AND NULLIF(TRIM(payload_jsonb->>'bat_speed'), '') IS NOT NULL
    ),
    league_agg AS (
      SELECT
        COUNT(*)::bigint AS league_tracked_swings,
        ROUND(AVG(bs)::numeric, 1) AS league_avg_bat_speed,
        ROUND(AVG(aa)::numeric, 1) AS league_avg_attack_angle,
        ROUND(AVG(ad)::numeric, 1) AS league_avg_attack_direction,
        ROUND(AVG(st)::numeric, 1) AS league_avg_swing_path_tilt
      FROM league_rows
    ),
    player_rows AS (
      SELECT
        NULLIF(TRIM(payload_jsonb->>'bat_speed'), '')::double precision AS bs,
        NULLIF(TRIM(payload_jsonb->>'attack_angle'), '')::double precision AS aa,
        NULLIF(TRIM(payload_jsonb->>'attack_direction'), '')::double precision AS ad,
        NULLIF(TRIM(payload_jsonb->>'swing_path_tilt'), '')::double precision AS st
      FROM statcast_pitch
      WHERE game_year = $1
        AND batter_mlbam = $2
        AND NULLIF(TRIM(payload_jsonb->>'bat_speed'), '') IS NOT NULL
    ),
    player_agg AS (
      SELECT
        COUNT(*)::bigint AS player_tracked_swings,
        ROUND(AVG(bs)::numeric, 1) AS player_avg_bat_speed,
        ROUND(AVG(aa)::numeric, 1) AS player_avg_attack_angle,
        ROUND(AVG(ad)::numeric, 1) AS player_avg_attack_direction,
        ROUND(AVG(st)::numeric, 1) AS player_avg_swing_path_tilt
      FROM player_rows
    )
    SELECT
      p.player_tracked_swings,
      p.player_avg_bat_speed,
      p.player_avg_attack_angle,
      p.player_avg_attack_direction,
      p.player_avg_swing_path_tilt,
      l.league_tracked_swings,
      l.league_avg_bat_speed,
      l.league_avg_attack_angle,
      l.league_avg_attack_direction,
      l.league_avg_swing_path_tilt,
      (
        SELECT upper(trim(s.payload_jsonb->>'stand'))
        FROM statcast_pitch s
        WHERE s.game_year = $1
          AND s.batter_mlbam = $2
          AND NULLIF(TRIM(s.payload_jsonb->>'bat_speed'), '') IS NOT NULL
          AND NULLIF(TRIM(s.payload_jsonb->>'stand'), '') <> ''
        GROUP BY upper(trim(s.payload_jsonb->>'stand'))
        ORDER BY COUNT(*) DESC NULLS LAST
        LIMIT 1
      ) AS batter_stand
    FROM player_agg p
    CROSS JOIN league_agg l
    `,
    [y, batter_mlbam]
  );
  return rowToJson((rows[0] ?? {}) as Record<string, unknown>);
}

/**
 * True when the assembled statcast-summary payload has anything the player card can render
 * (pitch mix, movement sample, batted-ball row, spray/BIP sample, or bat-tracking aggregates).
 * Used to set `statcast_available` so the UI can collapse the Savant rail when the DB has
 * nothing for this player/year (e.g. retired pre–Statcast era).
 */
export function statcastSummaryHasRenderableData(
  role: 'pitcher' | 'batter',
  payload: Record<string, unknown>,
  want: { mix: boolean; battedBall: boolean; sample: boolean; batPath: boolean }
): boolean {
  if (role === 'pitcher') {
    if (want.mix) {
      const mix = payload.mix;
      if (Array.isArray(mix) && mix.length > 0) return true;
    }
    if (want.sample) {
      const sample = payload.sample;
      if (Array.isArray(sample) && sample.length > 0) return true;
    }
    return false;
  }
  if (want.battedBall) {
    const bb = payload.batted_ball as Record<string, unknown> | undefined;
    const bbe = Number(bb?.bbe ?? 0);
    if (Number.isFinite(bbe) && bbe > 0) return true;
  }
  if (want.batPath) {
    const bp = payload.bat_path as Record<string, unknown> | undefined;
    const tracked = Number(bp?.player_tracked_swings ?? 0);
    if (Number.isFinite(tracked) && tracked > 0) return true;
  }
  if (want.sample) {
    const sample = payload.sample;
    if (Array.isArray(sample) && sample.length > 0) return true;
  }
  return false;
}

export async function statcastSampleRows(
  pool: pg.Pool,
  input: {
    role: 'pitcher' | 'batter';
    mlbam: number;
    game_year: number;
    limit?: number | null;
  }
): Promise<Record<string, unknown>[]> {
  const y = clampYear(input.game_year);
  const cap = input.role === 'pitcher' ? MAX_SAMPLE_PITCHER : MAX_SAMPLE_BATTER;
  const defaultLim = input.role === 'pitcher' ? 2000 : 8000;
  const lim = Math.min(Math.max(input.limit ?? defaultLim, 1), cap);
  const sql =
    input.role === 'pitcher'
      ? `
    SELECT game_pk, at_bat_number, pitch_number, game_date, pitch_type,
           release_speed, pfx_x, pfx_z, launch_speed, launch_angle, events, description
    FROM statcast_pitch
    WHERE game_year = $1
      AND pitcher_mlbam = $2
      AND pfx_x IS NOT NULL
      AND pfx_z IS NOT NULL
    ORDER BY game_date DESC NULLS LAST, game_pk DESC, at_bat_number, pitch_number
    LIMIT $3
    `
      : `
    SELECT game_pk, at_bat_number, pitch_number, game_date, pitch_type,
           release_speed, pfx_x, pfx_z, launch_speed, launch_angle, events, description,
           NULLIF(TRIM(payload_jsonb->>'hc_x'), '')::double precision AS hc_x,
           NULLIF(TRIM(payload_jsonb->>'hc_y'), '')::double precision AS hc_y
    FROM statcast_pitch
    WHERE game_year = $1
      AND batter_mlbam = $2
      AND NULLIF(TRIM(payload_jsonb->>'hc_x'), '') IS NOT NULL
      AND NULLIF(TRIM(payload_jsonb->>'hc_y'), '') IS NOT NULL
    ORDER BY game_date DESC NULLS LAST, game_pk DESC, at_bat_number, pitch_number
    LIMIT $3
    `;
  const { rows } = await pool.query(sql, [y, input.mlbam, lim]);
  return rowsToJson(rows as Record<string, unknown>[]);
}
