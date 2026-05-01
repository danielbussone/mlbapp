/**
 * Mock `savant_fielding_oaa_cell` rows for dev-only OAA breakdown prototype.
 * OF ids match `etl/mlbapp_etl/fielding_oaa_cell.py` (`of_dir_*`).
 * IF ids match `docs/SAVANT_INFIELD_OAA_AND_FRV_PLAN.md` §3.1 (planned ingest).
 */

export type OaaCellRow = { cell_id: string; oaa: number; attempts: number };

/** Six Savant outfield directional slices (same vocabulary as production ETL). */
export const MOCK_OF_DIR_CELLS: OaaCellRow[] = [
  { cell_id: 'of_dir_back', oaa: 1, attempts: 120 },
  { cell_id: 'of_dir_back_left', oaa: 2, attempts: 95 },
  { cell_id: 'of_dir_in_left', oaa: -1, attempts: 88 },
  { cell_id: 'of_dir_in', oaa: 3, attempts: 140 },
  { cell_id: 'of_dir_in_right', oaa: 0, attempts: 76 },
  { cell_id: 'of_dir_back_right', oaa: -2, attempts: 102 },
];

/** Planned four infield directional slices (`if_dir_*` only for this prototype). */
export const MOCK_IF_OAA_CELLS: OaaCellRow[] = [
  { cell_id: 'if_dir_in', oaa: 4, attempts: 210 },
  { cell_id: 'if_dir_toward_3b', oaa: 1, attempts: 165 },
  { cell_id: 'if_dir_toward_1b', oaa: -2, attempts: 178 },
  { cell_id: 'if_dir_behind', oaa: 0, attempts: 92 },
];

export const IF_OAA_LABEL: Record<string, string> = {
  if_dir_in: 'In front',
  if_dir_toward_3b: 'Toward 3B line',
  if_dir_toward_1b: 'Toward 1B line',
  if_dir_behind: 'Behind',
};

export function sumOaaFromCells(rows: OaaCellRow[], predicate: (cellId: string) => boolean): number | null {
  let sum = 0;
  let any = false;
  for (const r of rows) {
    if (!predicate(r.cell_id)) continue;
    sum += r.oaa;
    any = true;
  }
  return any ? sum : null;
}
