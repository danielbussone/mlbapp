import type pg from 'pg';
import type { LeaderboardAttachment } from '@mlbapp/shared';
import {
  buildSelectList,
  columnDisplayType,
  columnLabel,
  getSortExpression,
  isLeaderboardDataset,
  listSortMetrics,
  resolveColumns,
  sortColumnIdForAttachment,
  type LeaderboardDataset,
} from '../leaderboard/catalog.js';

export type LeaderboardQueryArgs = {
  dataset: string;
  sort_metric: string;
  order: 'asc' | 'desc';
  limit: number;
  columns?: string[];
  season_from?: number;
  season_to?: number;
  min_pa?: number;
  min_ip_outs?: number;
  min_tbf?: number;
  qualified_only?: boolean;
  title?: string;
};

function fromClause(dataset: LeaderboardDataset): string {
  switch (dataset) {
    case 'fg_batting_career':
      return 'fg_batting_career_mlb x';
    case 'fg_pitching_career':
      return 'fg_pitching_career_mlb x';
    case 'fg_batting_season':
      return 'fg_batting_season_mlb_consolidated x';
    case 'fg_pitching_season':
      return 'fg_pitching_season_mlb_consolidated x';
    default:
      throw new Error('unreachable');
  }
}

export async function executeLeaderboardQuery(
  pool: pg.Pool,
  raw: LeaderboardQueryArgs
): Promise<
  | { ok: true; leaderboard: LeaderboardAttachment }
  | {
      ok: false;
      error: string;
      allowed_sort_metrics?: string[];
      invalid_columns?: string[];
    }
> {
  if (!isLeaderboardDataset(raw.dataset)) {
    return {
      ok: false,
      error: 'invalid_dataset',
      allowed_sort_metrics: [],
    };
  }
  const dataset = raw.dataset;
  const sortExpr = getSortExpression(dataset, raw.sort_metric);
  if (!sortExpr) {
    return {
      ok: false,
      error: 'invalid_sort_metric',
      allowed_sort_metrics: listSortMetrics(dataset),
    };
  }

  const { ids: columnIds, invalid } = resolveColumns(dataset, raw.columns);
  if (invalid.length) {
    return { ok: false, error: 'invalid_columns', invalid_columns: invalid };
  }

  const selectList = buildSelectList(dataset, columnIds);
  const orderDir = raw.order === 'asc' ? 'ASC' : 'DESC';
  const lim = Math.min(100, Math.max(1, raw.limit));

  const params: unknown[] = [];
  const where: string[] = [];

  if (dataset === 'fg_batting_season' || dataset === 'fg_pitching_season') {
    if (raw.season_from != null) {
      params.push(raw.season_from);
      where.push(`x.season >= $${params.length}`);
    }
    if (raw.season_to != null) {
      params.push(raw.season_to);
      where.push(`x.season <= $${params.length}`);
    }
  }

  if (raw.min_pa != null) {
    params.push(raw.min_pa);
    const col =
      dataset === 'fg_batting_career'
        ? 'x.career_pa'
        : dataset === 'fg_batting_season'
          ? 'x.pa'
          : null;
    if (col) where.push(`${col} >= $${params.length}`);
  }

  if (raw.min_tbf != null) {
    params.push(raw.min_tbf);
    const col =
      dataset === 'fg_pitching_career'
        ? 'x.career_tbf'
        : dataset === 'fg_pitching_season'
          ? 'x.tbf'
          : null;
    if (col) where.push(`${col} >= $${params.length}`);
  }

  if (raw.min_ip_outs != null && (dataset === 'fg_pitching_career' || dataset === 'fg_pitching_season')) {
    params.push(raw.min_ip_outs);
    const col = dataset === 'fg_pitching_career' ? 'x.career_ip_outs' : 'x.ip_outs';
    where.push(`${col} >= $${params.length}`);
  }

  if (raw.qualified_only) {
    if (dataset === 'fg_batting_season' || dataset === 'fg_pitching_season') {
      where.push('x.season_rate_stat_qualified IS TRUE');
    } else if (dataset === 'fg_batting_career' || dataset === 'fg_pitching_career') {
      where.push('x.seasons_rate_stat_qualified > 0');
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(lim);
  const limitParam = params.length;

  const sql = `
SELECT ${selectList}
FROM ${fromClause(dataset)}
LEFT JOIN dim_player p ON p.player_id = x.player_id
${whereSql}
ORDER BY ${sortExpr} ${orderDir} NULLS LAST
LIMIT $${limitParam}
`;

  const { rows } = await pool.query<Record<string, unknown>>(sql, params);

  const withRank = rows.map((r, i) => ({ rank: i + 1, ...r }));

  const displayCols = [
    { id: 'rank', label: '#', type: 'integer' as const },
    ...columnIds.map((id) => ({
      id,
      label: columnLabel(id),
      type: columnDisplayType(id),
    })),
  ];

  const sortColumnId = sortColumnIdForAttachment(dataset, raw.sort_metric, columnIds);

  const leaderboard: LeaderboardAttachment = {
    version: 1,
    title:
      raw.title?.trim() ||
      (dataset.includes('career') ? 'Career leaderboard' : 'Season leaderboard'),
    columns: displayCols,
    rows: withRank,
    sort: { columnId: sortColumnId, order: raw.order },
    provenance: {
      dataset,
      sort_metric: raw.sort_metric,
      order: raw.order,
      season_from: raw.season_from,
      season_to: raw.season_to,
      min_pa: raw.min_pa,
      min_ip_outs: raw.min_ip_outs,
      min_tbf: raw.min_tbf,
      qualified_only: raw.qualified_only,
    },
  };

  return { ok: true, leaderboard };
}
