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
/** Statcast `statcast_pitch` / related tables: do not use this floor for FanGraphs-only routes (e.g. league percentiles). */
const MIN_YEAR = 2010;
const MAX_YEAR = 2026;

function clampYear(y: number): number {
  return Math.min(Math.max(y, MIN_YEAR), MAX_YEAR);
}

/** Clamped game year for Statcast SQL only. League percentiles use `clampLeaguePercentilesGameYear` in `leaguePercentiles.ts`. */
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

/**
 * Pitch-type row with process rates (V2). Denominators:
 * - zone_pct, chase_pct: use **known** `payload_jsonb.zone` (numeric 1–14) in the numerator/denominator as defined in SQL.
 * - whiff_pct: swinging strikes ÷ **swings** on this pitch type (fouls count as swings).
 * - swstr_pct: swinging strikes ÷ **all pitches** of this type (includes takes; always ≤ whiff_pct when swings ≤ pitches).
 * - swing_pct: swings ÷ **all pitches** of this type (same `is_swing` rule as whiff denominator’s swing set).
 * - gb_pct, fb_pct, hr_pct: among **batted-ball events** (`launch_speed` IS NOT NULL) for that pitch type.
 */
export async function statcastPitcherPitchMixExtended(
  pool: pg.Pool,
  pitcher_mlbam: number,
  game_year: number
): Promise<Record<string, unknown>[]> {
  const y = clampYear(game_year);
  const { rows } = await pool.query(
    `
    WITH p AS (
      SELECT
        pitch_type,
        release_speed,
        description,
        events,
        launch_speed,
        launch_angle,
        NULLIF(TRIM(payload_jsonb->>'zone'), '')::numeric AS zone_num,
        LOWER(TRIM(COALESCE(payload_jsonb->>'bb_type', ''))) AS bb_type_l,
        (description IN (
          'swinging_strike', 'swinging_strike_blocked', 'foul', 'foul_tip',
          'hit_into_play', 'hit_into_play_no_out', 'hit_into_play_score',
          'foul_bunt', 'missed_bunt', 'bunt_foul_tip'
        )) AS is_swing,
        (description IN ('swinging_strike', 'swinging_strike_blocked')) AS is_whiff,
        (NULLIF(TRIM(payload_jsonb->>'zone'), '')::numeric IS NOT NULL
          AND NULLIF(TRIM(payload_jsonb->>'zone'), '')::numeric BETWEEN 1 AND 9) AS in_zone,
        (NULLIF(TRIM(payload_jsonb->>'zone'), '')::numeric IS NOT NULL
          AND NOT (NULLIF(TRIM(payload_jsonb->>'zone'), '')::numeric BETWEEN 1 AND 9)) AS out_zone,
        (launch_speed IS NOT NULL) AS is_bip,
        (LOWER(COALESCE(events, '')) LIKE '%home_run%') AS is_hr,
        CASE
          WHEN LOWER(TRIM(COALESCE(payload_jsonb->>'bb_type', ''))) = 'ground_ball' THEN TRUE
          WHEN payload_jsonb->>'bb_type' IS NULL AND launch_speed IS NOT NULL AND launch_angle IS NOT NULL
            AND launch_angle::double precision <= 10 THEN TRUE
          ELSE FALSE
        END AS is_gb,
        CASE
          WHEN LOWER(TRIM(COALESCE(payload_jsonb->>'bb_type', ''))) IN ('fly_ball', 'popup') THEN TRUE
          WHEN payload_jsonb->>'bb_type' IS NULL AND launch_speed IS NOT NULL AND launch_angle IS NOT NULL
            AND launch_angle::double precision >= 25 THEN TRUE
          ELSE FALSE
        END AS is_fb
      FROM statcast_pitch
      WHERE game_year = $1
        AND pitcher_mlbam = $2
        AND pitch_type IS NOT NULL
        AND TRIM(pitch_type) <> ''
    )
    SELECT
      pitch_type,
      COUNT(*)::bigint AS pitches,
      ROUND((100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0))::numeric, 1) AS pct,
      ROUND(AVG(release_speed)::numeric, 1) AS avg_velo,
      ROUND((100.0 * COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND in_zone) /
        NULLIF(COUNT(*) FILTER (WHERE zone_num IS NOT NULL), 0))::numeric, 1) AS zone_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND out_zone AND is_swing) /
        NULLIF(COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND out_zone), 0))::numeric, 1) AS chase_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_swing) / NULLIF(COUNT(*), 0))::numeric, 1) AS swing_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_whiff) /
        NULLIF(COUNT(*) FILTER (WHERE is_swing), 0))::numeric, 1) AS whiff_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_whiff) / NULLIF(COUNT(*), 0))::numeric, 1) AS swstr_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_bip AND is_gb) /
        NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric, 1) AS gb_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_bip AND is_fb) /
        NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric, 1) AS fb_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_bip AND is_hr) /
        NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric, 1) AS hr_pct
    FROM p
    GROUP BY pitch_type
    ORDER BY pitches DESC
    `,
    [y, pitcher_mlbam]
  );
  return rowsToJson(rows as Record<string, unknown>[]);
}

/**
 * Same process rates as `statcastPitcherPitchMixExtended`, split by batter stand (L/R only).
 * `pct` is usage within pitches to that handedness (sums to 100% per `batter_stand`).
 */
export async function statcastPitcherPitchMixExtendedByBatterStand(
  pool: pg.Pool,
  pitcher_mlbam: number,
  game_year: number
): Promise<Record<string, unknown>[]> {
  const y = clampYear(game_year);
  const { rows } = await pool.query(
    `
    WITH p AS (
      SELECT
        pitch_type,
        release_speed,
        description,
        events,
        launch_speed,
        launch_angle,
        NULLIF(TRIM(payload_jsonb->>'zone'), '')::numeric AS zone_num,
        LOWER(TRIM(COALESCE(payload_jsonb->>'bb_type', ''))) AS bb_type_l,
        (description IN (
          'swinging_strike', 'swinging_strike_blocked', 'foul', 'foul_tip',
          'hit_into_play', 'hit_into_play_no_out', 'hit_into_play_score',
          'foul_bunt', 'missed_bunt', 'bunt_foul_tip'
        )) AS is_swing,
        (description IN ('swinging_strike', 'swinging_strike_blocked')) AS is_whiff,
        (NULLIF(TRIM(payload_jsonb->>'zone'), '')::numeric IS NOT NULL
          AND NULLIF(TRIM(payload_jsonb->>'zone'), '')::numeric BETWEEN 1 AND 9) AS in_zone,
        (NULLIF(TRIM(payload_jsonb->>'zone'), '')::numeric IS NOT NULL
          AND NOT (NULLIF(TRIM(payload_jsonb->>'zone'), '')::numeric BETWEEN 1 AND 9)) AS out_zone,
        (launch_speed IS NOT NULL) AS is_bip,
        (LOWER(COALESCE(events, '')) LIKE '%home_run%') AS is_hr,
        CASE
          WHEN LOWER(TRIM(COALESCE(payload_jsonb->>'bb_type', ''))) = 'ground_ball' THEN TRUE
          WHEN payload_jsonb->>'bb_type' IS NULL AND launch_speed IS NOT NULL AND launch_angle IS NOT NULL
            AND launch_angle::double precision <= 10 THEN TRUE
          ELSE FALSE
        END AS is_gb,
        CASE
          WHEN LOWER(TRIM(COALESCE(payload_jsonb->>'bb_type', ''))) IN ('fly_ball', 'popup') THEN TRUE
          WHEN payload_jsonb->>'bb_type' IS NULL AND launch_speed IS NOT NULL AND launch_angle IS NOT NULL
            AND launch_angle::double precision >= 25 THEN TRUE
          ELSE FALSE
        END AS is_fb,
        CASE
          WHEN upper(substring(trim(COALESCE(payload_jsonb->>'stand', '')), 1, 1)) IN ('L', 'R')
          THEN upper(substring(trim(COALESCE(payload_jsonb->>'stand', '')), 1, 1))
          ELSE NULL
        END AS batter_stand
      FROM statcast_pitch
      WHERE game_year = $1
        AND pitcher_mlbam = $2
        AND pitch_type IS NOT NULL
        AND TRIM(pitch_type) <> ''
    )
    SELECT
      pitch_type,
      batter_stand,
      COUNT(*)::bigint AS pitches,
      ROUND((100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY batter_stand), 0))::numeric, 1) AS pct,
      ROUND(AVG(release_speed)::numeric, 1) AS avg_velo,
      ROUND((100.0 * COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND in_zone) /
        NULLIF(COUNT(*) FILTER (WHERE zone_num IS NOT NULL), 0))::numeric, 1) AS zone_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND out_zone AND is_swing) /
        NULLIF(COUNT(*) FILTER (WHERE zone_num IS NOT NULL AND out_zone), 0))::numeric, 1) AS chase_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_swing) / NULLIF(COUNT(*), 0))::numeric, 1) AS swing_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_whiff) /
        NULLIF(COUNT(*) FILTER (WHERE is_swing), 0))::numeric, 1) AS whiff_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_whiff) / NULLIF(COUNT(*), 0))::numeric, 1) AS swstr_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_bip AND is_gb) /
        NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric, 1) AS gb_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_bip AND is_fb) /
        NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric, 1) AS fb_pct,
      ROUND((100.0 * COUNT(*) FILTER (WHERE is_bip AND is_hr) /
        NULLIF(COUNT(*) FILTER (WHERE is_bip), 0))::numeric, 1) AS hr_pct
    FROM p
    WHERE batter_stand IS NOT NULL
    GROUP BY pitch_type, batter_stand
    ORDER BY batter_stand ASC, pitches DESC
    `,
    [y, pitcher_mlbam]
  );
  return rowsToJson(rows as Record<string, unknown>[]);
}

/** Binned velocity histogram per pitch type (1 mph bins from lo to hi). */
export async function statcastPitcherVeloHistogram(
  pool: pg.Pool,
  pitcher_mlbam: number,
  game_year: number,
  mphLo = 60,
  mphHi = 105
): Promise<Record<string, unknown>[]> {
  const y = clampYear(game_year);
  const { rows } = await pool.query(
    `
    WITH p AS (
      SELECT
        pitch_type,
        FLOOR(release_speed::double precision)::int AS mph_floor
      FROM statcast_pitch
      WHERE game_year = $1
        AND pitcher_mlbam = $2
        AND pitch_type IS NOT NULL
        AND release_speed IS NOT NULL
        AND release_speed::double precision >= $3::double precision
        AND release_speed::double precision < ($4::double precision + 1)
    )
    SELECT
      pitch_type,
      mph_floor,
      COUNT(*)::bigint AS bin_count
    FROM p
    GROUP BY pitch_type, mph_floor
    ORDER BY pitch_type, mph_floor
    `,
    [y, pitcher_mlbam, mphLo, mphHi]
  );
  return rowsToJson(rows as Record<string, unknown>[]);
}

/** League-average release speed (mph) by pitch type for `game_year` (all MLB pitchers, tracked pitches only). */
export async function statcastLeagueAvgVeloByPitchType(
  pool: pg.Pool,
  game_year: number
): Promise<Record<string, unknown>[]> {
  const y = clampYear(game_year);
  const { rows } = await pool.query(
    `
    SELECT
      pitch_type,
      ROUND(AVG(release_speed)::numeric, 1) AS avg_velo
    FROM statcast_pitch
    WHERE game_year = $1
      AND pitch_type IS NOT NULL
      AND TRIM(pitch_type) <> ''
      AND release_speed IS NOT NULL
    GROUP BY pitch_type
    ORDER BY pitch_type
    `,
    [y]
  );
  return rowsToJson(rows as Record<string, unknown>[]);
}

/** Dominant `p_throws` from Statcast rows (payload_jsonb) for pitcher-perspective movement charts. */
export async function statcastPitcherThrowsHand(
  pool: pg.Pool,
  pitcher_mlbam: number,
  game_year: number
): Promise<'L' | 'R' | null> {
  const y = clampYear(game_year);
  const { rows } = await pool.query(
    `
    SELECT NULLIF(TRIM(payload_jsonb->>'p_throws'), '') AS th,
           COUNT(*)::bigint AS c
    FROM statcast_pitch
    WHERE game_year = $1
      AND pitcher_mlbam = $2
      AND NULLIF(TRIM(payload_jsonb->>'p_throws'), '') IN ('L', 'R')
    GROUP BY 1
    ORDER BY c DESC
    LIMIT 1
    `,
    [y, pitcher_mlbam]
  );
  const t = String((rows[0] as { th?: string } | undefined)?.th ?? '')
    .trim()
    .toUpperCase();
  if (t === 'L') return 'L';
  if (t === 'R') return 'R';
  return null;
}

/**
 * League-average pfx by pitch type. When `p_throws_hand` is `'L'` or `'R'`, aggregates only that
 * handedness (matches individual pitcher movement in catcher-frame `pfx_x`). Otherwise uses the
 * pre-aggregated MV (all pitchers combined).
 */
export async function statcastLeagueMovementByYear(
  pool: pg.Pool,
  game_year: number,
  p_throws_hand: 'L' | 'R' | null = null
): Promise<Record<string, unknown>[]> {
  const y = clampYear(game_year);
  if (p_throws_hand === 'L' || p_throws_hand === 'R') {
    try {
      const { rows } = await pool.query(
        `
        SELECT
          $1::smallint AS game_year,
          pitch_type,
          COUNT(*)::bigint AS pitches,
          ROUND(AVG(pfx_x::double precision)::numeric, 4) AS avg_pfx_x_ft,
          ROUND(AVG(pfx_z::double precision)::numeric, 4) AS avg_pfx_z_ft,
          ROUND(STDDEV_SAMP(pfx_x::double precision)::numeric, 4) AS std_pfx_x_ft,
          ROUND(STDDEV_SAMP(pfx_z::double precision)::numeric, 4) AS std_pfx_z_ft
        FROM statcast_pitch
        WHERE game_year = $1
          AND pitch_type IS NOT NULL
          AND TRIM(pitch_type) <> ''
          AND pfx_x IS NOT NULL
          AND pfx_z IS NOT NULL
          AND NULLIF(TRIM(payload_jsonb->>'p_throws'), '') = $2
        GROUP BY pitch_type
        ORDER BY pitches DESC
        `,
        [y, p_throws_hand]
      );
      return rowsToJson(rows as Record<string, unknown>[]);
    } catch {
      return [];
    }
  }
  try {
    const { rows } = await pool.query(
      `
      SELECT game_year, pitch_type, pitches,
             avg_pfx_x_ft, avg_pfx_z_ft, std_pfx_x_ft, std_pfx_z_ft
      FROM statcast_league_pitch_movement_rollup
      WHERE game_year = $1
      ORDER BY pitches DESC
      `,
      [y]
    );
    return rowsToJson(rows as Record<string, unknown>[]);
  } catch {
    return [];
  }
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

/** One row per (game_year, pitch_type) with usage % for season-trend charts. */
export async function statcastPitcherMixByYearRange(
  pool: pg.Pool,
  pitcher_mlbam: number,
  yearFrom: number,
  yearTo: number
): Promise<Record<string, unknown>[]> {
  const y0 = clampYear(yearFrom);
  const y1 = clampYear(yearTo);
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  const { rows } = await pool.query(
    `
    WITH c AS (
      SELECT
        game_year,
        pitch_type,
        COUNT(*)::bigint AS pitches
      FROM statcast_pitch
      WHERE pitcher_mlbam = $1
        AND game_year BETWEEN $2 AND $3
        AND pitch_type IS NOT NULL
        AND TRIM(pitch_type) <> ''
      GROUP BY game_year, pitch_type
    )
    SELECT
      game_year,
      pitch_type,
      pitches,
      ROUND((100.0 * pitches / NULLIF(SUM(pitches) OVER (PARTITION BY game_year), 0))::numeric, 1) AS pct
    FROM c
    ORDER BY game_year, pitches DESC
    `,
    [pitcher_mlbam, lo, hi]
  );
  return rowsToJson(rows as Record<string, unknown>[]);
}

/** Per-season bat-path summary for trend charts (one query per year; league recomputed each year). */
export async function statcastBatterBatPathTimeseries(
  pool: pg.Pool,
  batter_mlbam: number,
  yearFrom: number,
  yearTo: number
): Promise<Record<string, unknown>[]> {
  const y0 = clampYear(yearFrom);
  const y1 = clampYear(yearTo);
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  const years: number[] = [];
  for (let y = lo; y <= hi; y += 1) years.push(y);
  const rows = await Promise.all(
    years.map(async (gy) => {
      const summary = await statcastBatterBatPathSummary(pool, batter_mlbam, gy);
      return { game_year: gy, ...summary };
    })
  );
  return rows;
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
  want: {
    mix: boolean;
    battedBall: boolean;
    sample: boolean;
    batPath: boolean;
    mixExtended?: boolean;
    veloDist?: boolean;
    leagueMovement?: boolean;
  }
): boolean {
  if (role === 'pitcher') {
    if (want.mix) {
      const mix = payload.mix;
      if (Array.isArray(mix) && mix.length > 0) return true;
    }
    if (want.mixExtended) {
      const mx = payload.mix_extended;
      const mxs = payload.mix_extended_by_stand;
      if ((Array.isArray(mx) && mx.length > 0) || (Array.isArray(mxs) && mxs.length > 0)) return true;
    }
    if (want.veloDist) {
      const v = payload.velo_dist;
      if (Array.isArray(v) && v.length > 0) return true;
    }
    if (want.leagueMovement) {
      const lm = payload.league_movement;
      if (Array.isArray(lm) && lm.length > 0) return true;
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
           release_speed, pfx_x, pfx_z, launch_speed, launch_angle, events, description,
           NULLIF(TRIM(payload_jsonb->>'zone'), '') AS zone,
           NULLIF(TRIM(payload_jsonb->>'arm_angle'), '')::double precision AS arm_angle,
           NULLIF(TRIM(payload_jsonb->>'release_pos_x'), '')::double precision AS release_pos_x,
           NULLIF(TRIM(payload_jsonb->>'release_pos_z'), '')::double precision AS release_pos_z,
           NULLIF(TRIM(payload_jsonb->>'release_extension'), '')::double precision AS release_extension,
           NULLIF(TRIM(payload_jsonb->>'spin_axis'), '')::double precision AS spin_axis
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
