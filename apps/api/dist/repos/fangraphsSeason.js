import { rowsToJson } from './rowJson.js';
/** Default max rows for `get_fg_season_line` tool and ad-hoc queries. */
const DEFAULT_FG_SEASON_LIMIT = 30;
/** Upper bound when `compare_mode` is set (long careers + multiple team rows per year). */
export const FG_COMPARE_SEASON_ROW_CEILING = 120;
const BATTING_COLS = `
  b.season, b.team, b.level, b.id_fg, b.age, b.games, b.pa, b.hr, b.r, b.rbi, b.sb,
  b.bb_pct, b.k_pct, b.iso, b.babip, b.avg, b.obp, b.slg, b.woba, b.xwoba, b.wrc_plus,
  b.bsr, b.off_runs, b.def_runs, b.war, b.rate_stat_qualified, b.stats_jsonb, b.ingest_pulled_at
`;
const PITCHING_COLS = `
  f.season, f.team, f.level, f.id_fg, f.age, f.w, f.l, f.sv, f.games, f.games_started,
  f.ip, f.k_per_9, f.bb_per_9, f.hr_per_9, f.babip, f.lob_pct, f.gb_pct, f.hr_fb_pct,
  f.vfa, f.era, f.xera, f.fip, f.xfip, f.war, f.rate_stat_qualified, f.stats_jsonb, f.ingest_pulled_at
`;
export async function getFgSeasonLines(pool, input) {
    const cap = input.compare_mode ? FG_COMPARE_SEASON_ROW_CEILING : DEFAULT_FG_SEASON_LIMIT;
    const defaultWhenUnset = input.compare_mode ? FG_COMPARE_SEASON_ROW_CEILING : DEFAULT_FG_SEASON_LIMIT;
    const limit = Math.min(Math.max(input.limit ?? defaultWhenUnset, 1), cap);
    // Match by Chadwick fangraphs crosswalk OR by FG row.player_id (ETL may link without matching id_fg text).
    const joinBat = `
    FROM fg_batting_season_current b
    WHERE (b.player_id = $1 OR EXISTS (
      SELECT 1 FROM player_external_identifier m
      WHERE m.player_id = $1 AND m.id_system = 'fangraphs' AND m.id_value = b.id_fg::text
    ))
      AND ($2::smallint IS NULL OR b.season = $2)
      AND ($3::smallint IS NULL OR b.season >= $3)
      AND ($4::smallint IS NULL OR b.season <= $4)
      AND ($5::text IS NULL OR b.team = $5)
      AND ($6::text IS NULL OR b.level = $6)
    ORDER BY b.season DESC, b.team
    LIMIT $7
  `;
    const joinPit = `
    FROM fg_pitching_season_current f
    WHERE (f.player_id = $1 OR EXISTS (
      SELECT 1 FROM player_external_identifier m
      WHERE m.player_id = $1 AND m.id_system = 'fangraphs' AND m.id_value = f.id_fg::text
    ))
      AND ($2::smallint IS NULL OR f.season = $2)
      AND ($3::smallint IS NULL OR f.season >= $3)
      AND ($4::smallint IS NULL OR f.season <= $4)
      AND ($5::text IS NULL OR f.team = $5)
      AND ($6::text IS NULL OR f.level = $6)
    ORDER BY f.season DESC, f.team
    LIMIT $7
  `;
    const params = [
        input.player_id,
        input.season ?? null,
        input.season_from ?? null,
        input.season_to ?? null,
        input.team ?? null,
        input.level ?? null,
        limit,
    ];
    const sql = input.role === 'pitching'
        ? `SELECT ${PITCHING_COLS} ${joinPit}`
        : `SELECT ${BATTING_COLS} ${joinBat}`;
    const { rows } = await pool.query(sql, params);
    return rowsToJson(rows);
}
