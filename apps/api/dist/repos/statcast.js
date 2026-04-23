import { rowToJson, rowsToJson } from './rowJson.js';
const MAX_SAMPLE = 200;
const MIN_YEAR = 2010;
const MAX_YEAR = 2030;
function clampYear(y) {
    return Math.min(Math.max(y, MIN_YEAR), MAX_YEAR);
}
export async function statcastPitcherPitchMix(pool, pitcher_mlbam, game_year) {
    const y = clampYear(game_year);
    const { rows } = await pool.query(`
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
    `, [y, pitcher_mlbam]);
    return rowsToJson(rows);
}
export async function statcastBatterBattedBall(pool, batter_mlbam, game_year) {
    const y = clampYear(game_year);
    const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE launch_speed IS NOT NULL)::bigint AS bbe,
      ROUND(AVG(launch_speed)::numeric, 1) AS avg_ev,
      ROUND(AVG(launch_angle)::numeric, 1) AS avg_la
    FROM statcast_pitch
    WHERE game_year = $1
      AND batter_mlbam = $2
      AND launch_speed IS NOT NULL
    `, [y, batter_mlbam]);
    return rowToJson((rows[0] ?? {}));
}
export async function statcastSampleRows(pool, input) {
    const y = clampYear(input.game_year);
    const lim = Math.min(Math.max(input.limit ?? 50, 1), MAX_SAMPLE);
    const sql = input.role === 'pitcher'
        ? `
    SELECT game_pk, at_bat_number, pitch_number, game_date, pitch_type,
           release_speed, pfx_x, pfx_z, launch_speed, launch_angle, events, description
    FROM statcast_pitch
    WHERE game_year = $1 AND pitcher_mlbam = $2
    ORDER BY game_date DESC NULLS LAST, game_pk DESC, at_bat_number, pitch_number
    LIMIT $3
    `
        : `
    SELECT game_pk, at_bat_number, pitch_number, game_date, pitch_type,
           release_speed, pfx_x, pfx_z, launch_speed, launch_angle, events, description
    FROM statcast_pitch
    WHERE game_year = $1 AND batter_mlbam = $2
    ORDER BY game_date DESC NULLS LAST, game_pk DESC, at_bat_number, pitch_number
    LIMIT $3
    `;
    const { rows } = await pool.query(sql, [y, input.mlbam, lim]);
    return rowsToJson(rows);
}
