import type pg from 'pg';
import { rowsToJson } from './rowJson.js';

/** Match FG rows to dim_player by surrogate id or fangraphs external id (`$1` = dim `player_id`). */
export function playerFgPredicate(alias: string): string {
  return `(
    ${alias}.player_id = $1
    OR EXISTS (
      SELECT 1 FROM player_external_identifier m
      WHERE m.player_id = $1 AND m.id_system = 'fangraphs' AND m.id_value = ${alias}.id_fg::text
    )
  )`;
}

export type FgFieldingQuery = {
  player_id: number;
  season?: number | null;
  season_from?: number | null;
  season_to?: number | null;
  limit?: number | null;
};

const MAX_ROWS = 200;

/**
 * FanGraphs fielding lines from `fg_fielding_season_current` (V14+).
 */
export async function getFgFieldingSeasonLines(
  pool: pg.Pool,
  input: FgFieldingQuery
): Promise<Record<string, unknown>[]> {
  const lim = Math.min(Math.max(input.limit ?? MAX_ROWS, 1), MAX_ROWS);
  const conds: string[] = [`${playerFgPredicate('f')}`];
  const params: unknown[] = [input.player_id];
  let p = 2;

  if (input.season != null) {
    conds.push(`f.season = $${p}::smallint`);
    params.push(input.season);
    p += 1;
  } else {
    if (input.season_from != null) {
      conds.push(`f.season >= $${p}::smallint`);
      params.push(input.season_from);
      p += 1;
    }
    if (input.season_to != null) {
      conds.push(`f.season <= $${p}::smallint`);
      params.push(input.season_to);
      p += 1;
    }
  }

  const where = conds.join(' AND ');
  const sql = `
    SELECT f.*
    FROM fg_fielding_season_current f
    WHERE ${where}
    ORDER BY f.season DESC, f.inn DESC NULLS LAST, f.position
    LIMIT $${p}
  `;
  params.push(lim);

  const { rows } = await pool.query(sql, params);
  return rowsToJson(rows as Record<string, unknown>[]);
}
