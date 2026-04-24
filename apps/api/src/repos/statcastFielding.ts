import type pg from 'pg';
import { rowsToJson } from './rowJson.js';
import { clampGameYear } from './statcast.js';

/** Savant-style OAA grid cells (optional ingest into `savant_fielding_oaa_cell`). */
export async function statcastFieldingOaaCells(
  pool: pg.Pool,
  player_mlbam: number,
  game_year: number
): Promise<Record<string, unknown>[]> {
  const y = clampGameYear(game_year);
  try {
    const { rows } = await pool.query(
      `
      SELECT player_mlbam, game_year, cell_id, oaa, attempts, ingested_at
      FROM savant_fielding_oaa_cell
      WHERE player_mlbam = $1 AND game_year = $2
      ORDER BY cell_id
      `,
      [player_mlbam, y]
    );
    return rowsToJson(rows as Record<string, unknown>[]);
  } catch {
    return [];
  }
}
