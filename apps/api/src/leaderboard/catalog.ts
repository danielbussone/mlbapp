/**
 * Allowlisted leaderboard datasets, sort metrics, and display columns.
 * SQL fragments here are fixed strings — never composed from model output.
 */

export const LEADERBOARD_DATASETS = [
  'fg_batting_career',
  'fg_pitching_career',
  'fg_batting_season',
  'fg_pitching_season',
] as const;
export type LeaderboardDataset = (typeof LEADERBOARD_DATASETS)[number];

export type LeaderboardOrder = 'asc' | 'desc';

/** Maps logical column id → SELECT expression (alias `x` = stats row, `p` = dim_player). */
export type ColumnSql = string;

const nameExpr = `COALESCE(TRIM(COALESCE(p.name_first, '') || ' ' || COALESCE(p.name_last, '')), '(id_fg ' || x.id_fg::text || ')')`;

const BAT_CAREER_COLS: Record<string, ColumnSql> = {
  player_name: `${nameExpr}`,
  player_id: 'x.player_id',
  id_fg: 'x.id_fg',
  career_pa: 'x.career_pa',
  career_war: 'x.career_war',
  career_hr: 'x.career_hr',
  career_avg: 'x.career_avg',
  career_obp: 'x.career_obp',
  career_slg: 'x.career_slg',
  career_ops: 'x.career_ops',
  career_wrc_plus: 'x.career_wrc_plus_pa_weighted',
  career_off_runs: 'x.career_off_runs',
  career_def_runs: 'x.career_def_runs',
  career_bsr: 'x.career_bsr',
  career_k_pct: 'x.career_k_pct',
  career_bb_pct: 'x.career_bb_pct',
  career_hr_pct: 'x.career_hr_pct',
  first_season: 'x.first_season',
  last_season: 'x.last_season',
  seasons_count: 'x.seasons_count',
};

const PIT_CAREER_COLS: Record<string, ColumnSql> = {
  player_name: `${nameExpr}`,
  player_id: 'x.player_id',
  id_fg: 'x.id_fg',
  career_war: 'x.career_war',
  career_tbf: 'x.career_tbf',
  career_ip_outs: 'x.career_ip_outs',
  career_era: 'x.career_era',
  career_fip: 'x.career_fip',
  career_k_pct: 'x.career_k_pct',
  career_bb_pct: 'x.career_bb_pct',
  career_hr_pct: 'x.career_hr_pct',
  career_so: 'x.career_so',
  career_w: 'x.career_w',
  career_l: 'x.career_l',
  career_sv: 'x.career_sv',
  first_season: 'x.first_season',
  last_season: 'x.last_season',
  seasons_count: 'x.seasons_count',
};

const BAT_SEASON_COLS: Record<string, ColumnSql> = {
  player_name: `${nameExpr}`,
  player_id: 'x.player_id',
  id_fg: 'x.id_fg',
  season: 'x.season',
  pa: 'x.pa',
  games: 'x.games',
  war: 'x.war',
  wrc_plus: 'x.wrc_plus_pa_weighted',
  off_runs: 'x.off_runs',
  def_runs: 'x.def_runs',
  hr: 'x.hr',
  so: 'x.so',
  bb: 'x.bb',
  ibb: 'x.ibb',
  k_pct: '(x.so::numeric / NULLIF(x.pa, 0))',
  bb_pct: '((x.bb + x.ibb)::numeric / NULLIF(x.pa, 0))',
  hr_pct: '(x.hr::numeric / NULLIF(x.pa, 0))',
};

const PIT_SEASON_COLS: Record<string, ColumnSql> = {
  player_name: `${nameExpr}`,
  player_id: 'x.player_id',
  id_fg: 'x.id_fg',
  season: 'x.season',
  games: 'x.games',
  ip_outs: 'x.ip_outs',
  tbf: 'x.tbf',
  war: 'x.war',
  era: 'x.era',
  fip: 'x.fip_innings_weighted',
  k_pct: 'x.k_pct',
  bb_pct: 'x.bb_pct',
  hr_pct: 'x.hr_pct',
  so: 'x.so',
  hr: 'x.hr',
};

/** ORDER BY expressions (must match dataset FROM alias `x`). */
const BAT_CAREER_SORT: Record<string, string> = {
  career_war: 'x.career_war',
  career_pa: 'x.career_pa',
  career_hr: 'x.career_hr',
  career_avg: 'x.career_avg',
  career_obp: 'x.career_obp',
  career_slg: 'x.career_slg',
  career_ops: 'x.career_ops',
  career_wrc_plus: 'x.career_wrc_plus_pa_weighted',
  career_off_runs: 'x.career_off_runs',
  career_def_runs: 'x.career_def_runs',
  career_bsr: 'x.career_bsr',
  career_k_pct: 'x.career_k_pct',
  career_bb_pct: 'x.career_bb_pct',
  career_hr_pct: 'x.career_hr_pct',
  /** Three-true-outcome rate sum (K% + BB% + HR%) — higher = more TTO. */
  tto_rate_sum:
    '(COALESCE(x.career_k_pct, 0) + COALESCE(x.career_bb_pct, 0) + COALESCE(x.career_hr_pct, 0))',
  first_season: 'x.first_season',
  last_season: 'x.last_season',
};

const PIT_CAREER_SORT: Record<string, string> = {
  career_war: 'x.career_war',
  career_tbf: 'x.career_tbf',
  career_ip_outs: 'x.career_ip_outs',
  career_era: 'x.career_era',
  career_fip: 'x.career_fip',
  career_k_pct: 'x.career_k_pct',
  career_bb_pct: 'x.career_bb_pct',
  career_hr_pct: 'x.career_hr_pct',
  career_so: 'x.career_so',
};

const BAT_SEASON_SORT: Record<string, string> = {
  war: 'x.war',
  pa: 'x.pa',
  games: 'x.games',
  wrc_plus: 'x.wrc_plus_pa_weighted',
  off_runs: 'x.off_runs',
  def_runs: 'x.def_runs',
  hr: 'x.hr',
  season: 'x.season',
  tto_rate_sum: `(
    COALESCE(x.so::numeric / NULLIF(x.pa, 0), 0)
    + COALESCE((x.bb + x.ibb)::numeric / NULLIF(x.pa, 0), 0)
    + COALESCE(x.hr::numeric / NULLIF(x.pa, 0), 0)
  )`,
};

const PIT_SEASON_SORT: Record<string, string> = {
  war: 'x.war',
  tbf: 'x.tbf',
  ip_outs: 'x.ip_outs',
  era: 'x.era',
  fip: 'x.fip_innings_weighted',
  k_pct: 'x.k_pct',
  bb_pct: 'x.bb_pct',
  hr_pct: 'x.hr_pct',
  so: 'x.so',
  season: 'x.season',
};

const SORT_BY_DATASET: Record<LeaderboardDataset, Record<string, string>> = {
  fg_batting_career: BAT_CAREER_SORT,
  fg_pitching_career: PIT_CAREER_SORT,
  fg_batting_season: BAT_SEASON_SORT,
  fg_pitching_season: PIT_SEASON_SORT,
};

const COLS_BY_DATASET: Record<LeaderboardDataset, Record<string, ColumnSql>> = {
  fg_batting_career: BAT_CAREER_COLS,
  fg_pitching_career: PIT_CAREER_COLS,
  fg_batting_season: BAT_SEASON_COLS,
  fg_pitching_season: PIT_SEASON_COLS,
};

const DEFAULT_COLUMNS: Record<LeaderboardDataset, string[]> = {
  fg_batting_career: ['player_name', 'career_war', 'career_pa', 'first_season', 'last_season'],
  fg_pitching_career: ['player_name', 'career_war', 'career_tbf', 'first_season', 'last_season'],
  fg_batting_season: ['player_name', 'season', 'war', 'pa', 'wrc_plus', 'def_runs'],
  fg_pitching_season: ['player_name', 'season', 'war', 'era', 'fip', 'tbf'],
};

/** Human labels for tool / prompt documentation. */
export const SORT_METRIC_LABELS: Record<string, string> = {
  career_war: 'Career WAR (batting/pitching)',
  career_pa: 'Career plate appearances (batters)',
  career_tbf: 'Career batters faced (pitchers)',
  career_era: 'Career ERA (pitchers; lower is better — use order asc)',
  career_fip: 'Career FIP (pitchers; lower is better — use order asc)',
  tto_rate_sum: 'Three true outcomes (K% + BB% + HR%) — higher = more TTO',
  war: 'WAR (single season)',
  def_runs: 'Defensive runs component (FanGraphs def_runs, season batting)',
  career_def_runs: 'Career defensive runs (batting career)',
  era: 'ERA (season; lower is better — use order asc)',
  fip: 'FIP (season; lower is better — use order asc)',
  wrc_plus: 'wRC+ (PA-weighted season)',
  career_wrc_plus: 'wRC+ (PA-weighted career)',
};

export function isLeaderboardDataset(v: string): v is LeaderboardDataset {
  return (LEADERBOARD_DATASETS as readonly string[]).includes(v);
}

export function getSortExpression(dataset: LeaderboardDataset, sortMetric: string): string | undefined {
  return SORT_BY_DATASET[dataset][sortMetric];
}

export function listSortMetrics(dataset: LeaderboardDataset): string[] {
  return Object.keys(SORT_BY_DATASET[dataset]);
}

/** Compact list for Ollama tool description. */
export function leaderboardSortMetricsDoc(): string {
  return LEADERBOARD_DATASETS.map((d) => `${d}: ${listSortMetrics(d).join(', ')}`).join(' | ');
}

export function resolveColumns(
  dataset: LeaderboardDataset,
  requested: string[] | undefined
): { ids: string[]; invalid: string[] } {
  const allowed = COLS_BY_DATASET[dataset];
  const want = requested?.length ? requested : DEFAULT_COLUMNS[dataset];
  const invalid = want.filter((id) => !allowed[id]);
  const ids = want.filter((id) => allowed[id]);
  return { ids: ids.length ? ids : DEFAULT_COLUMNS[dataset], invalid };
}

export function buildSelectList(dataset: LeaderboardDataset, columnIds: string[]): string {
  const allowed = COLS_BY_DATASET[dataset];
  const parts: string[] = [];
  for (const id of columnIds) {
    const expr = allowed[id];
    if (!expr) continue;
    parts.push(`${expr} AS ${id}`);
  }
  return parts.join(', ');
}

/** Prefer a display column that reflects the sort when possible. */
export function sortColumnIdForAttachment(
  dataset: LeaderboardDataset,
  sortMetric: string,
  selectedColumnIds: string[]
): string {
  if (sortMetric === 'tto_rate_sum') {
    if (dataset === 'fg_batting_career' && selectedColumnIds.includes('career_k_pct')) return 'career_k_pct';
    if (dataset === 'fg_batting_season' && selectedColumnIds.includes('k_pct')) return 'k_pct';
  }
  const metricToCol: Record<string, string> = {
    career_war: 'career_war',
    career_pa: 'career_pa',
    career_hr: 'career_hr',
    career_avg: 'career_avg',
    career_obp: 'career_obp',
    career_slg: 'career_slg',
    career_ops: 'career_ops',
    career_wrc_plus: 'career_wrc_plus',
    career_off_runs: 'career_off_runs',
    career_def_runs: 'career_def_runs',
    career_bsr: 'career_bsr',
    career_k_pct: 'career_k_pct',
    career_bb_pct: 'career_bb_pct',
    career_hr_pct: 'career_hr_pct',
    career_tbf: 'career_tbf',
    career_ip_outs: 'career_ip_outs',
    career_era: 'career_era',
    career_fip: 'career_fip',
    career_so: 'career_so',
    war: 'war',
    pa: 'pa',
    games: 'games',
    wrc_plus: 'wrc_plus',
    off_runs: 'off_runs',
    def_runs: 'def_runs',
    hr: 'hr',
    season: 'season',
    era: 'era',
    fip: 'fip',
    tbf: 'tbf',
    ip_outs: 'ip_outs',
    k_pct: 'k_pct',
    bb_pct: 'bb_pct',
    hr_pct: 'hr_pct',
    so: 'so',
    tto_rate_sum: 'k_pct',
  };
  const mapped = metricToCol[sortMetric];
  if (mapped && selectedColumnIds.includes(mapped)) return mapped;
  if (selectedColumnIds.includes(sortMetric)) return sortMetric;
  return selectedColumnIds[0] ?? 'player_name';
}

export function columnDisplayType(id: string): 'string' | 'number' | 'integer' | undefined {
  if (id === 'player_name') return 'string';
  if (
    id === 'season' ||
    id === 'first_season' ||
    id === 'last_season' ||
    id === 'seasons_count' ||
    id === 'games' ||
    id === 'player_id' ||
    id === 'id_fg' ||
    id === 'career_pa' ||
    id === 'career_hr' ||
    id === 'career_so' ||
    id === 'pa' ||
    id === 'so' ||
    id === 'hr' ||
    id === 'bb' ||
    id === 'ibb' ||
    id === 'ip_outs' ||
    id === 'tbf' ||
    id === 'career_tbf' ||
    id === 'career_ip_outs' ||
    id === 'career_w' ||
    id === 'career_l' ||
    id === 'career_sv'
  )
    return 'integer';
  return 'number';
}

export function columnLabel(id: string): string {
  const labels: Record<string, string> = {
    player_name: 'Player',
    career_war: 'WAR',
    career_pa: 'PA',
    career_tbf: 'TBF',
    career_ip_outs: 'IP outs',
    career_era: 'ERA',
    career_fip: 'FIP',
    career_k_pct: 'K%',
    career_bb_pct: 'BB%',
    career_hr_pct: 'HR%',
    career_hr: 'HR',
    career_avg: 'AVG',
    career_obp: 'OBP',
    career_slg: 'SLG',
    career_ops: 'OPS',
    career_wrc_plus: 'wRC+',
    career_off_runs: 'Off',
    career_def_runs: 'Def',
    career_bsr: 'BsR',
    first_season: 'From',
    last_season: 'To',
    seasons_count: 'Seasons',
    season: 'Season',
    war: 'WAR',
    pa: 'PA',
    wrc_plus: 'wRC+',
    off_runs: 'Off',
    def_runs: 'Def',
    era: 'ERA',
    fip: 'FIP',
    k_pct: 'K%',
    bb_pct: 'BB%',
    hr_pct: 'HR%',
    ip_outs: 'IP outs',
  };
  return labels[id] ?? id;
}
