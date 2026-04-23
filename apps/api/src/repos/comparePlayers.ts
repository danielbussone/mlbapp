import type pg from 'pg';
import { FG_COMPARE_SEASON_ROW_CEILING, getFgSeasonLines } from './fangraphsSeason.js';
import { getPlayersByIds, resolvePlayerIdFromQuery } from './players.js';

const BATTING_LLM_KEYS = new Set([
  'season',
  'team',
  'level',
  'games',
  'pa',
  'hr',
  'r',
  'rbi',
  'sb',
  'avg',
  'obp',
  'slg',
  'woba',
  'wrc_plus',
  'war',
  'bb_pct',
  'k_pct',
  'age',
]);

const PITCHING_LLM_KEYS = new Set([
  'season',
  'team',
  'level',
  'games',
  'games_started',
  'ip',
  'w',
  'l',
  'sv',
  'era',
  'fip',
  'xfip',
  'k_per_9',
  'bb_per_9',
  'hr_per_9',
  'war',
  'age',
]);

function pickRowKeys(row: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in row) out[k] = row[k];
  }
  return out;
}

/** Long-tail FG API keys stored in `stats_jsonb`; keep a small pick list for chat payloads (not full blob). */
const BATTING_JSONB_PICK_KEYS = [
  'OPS',
  'AB',
  'H',
  '2B',
  '3B',
  'SO',
  'BB',
  'IBB',
  'HBP',
  'SF',
  'SH',
  'GDP',
  'CS',
  'EV',
  'LA',
  'Barrels',
  'Barrel%',
  'HardHit%',
  'maxEV',
  'Pull%',
  'Cent%',
  'Oppo%',
  'WPA',
  'RE24',
  'wRAA',
] as const;

const PITCHING_JSONB_PICK_KEYS = [
  'TBF',
  'H',
  'ER',
  'WHIP',
  'CG',
  'ShO',
  'HLD',
  'K/9',
  'BB/9',
  'HR/9',
  'LOB%',
  'GB%',
  'FB%',
  'HR/FB',
  'FBv',
  'Swing%',
  'Contact%',
  'Zone%',
  'CSW%',
  'tERA',
  'SIERA',
  'EV',
  'Barrels',
  'Barrel%',
] as const;

function parseStatsJsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw) as unknown;
      if (typeof j === 'object' && j != null && !Array.isArray(j)) return j as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function pickFromStatsJsonb(
  role: 'batting' | 'pitching',
  row: Record<string, unknown>
): Record<string, unknown> | undefined {
  const obj = parseStatsJsonObject(row.stats_jsonb);
  if (!obj) return undefined;
  const keyList = role === 'batting' ? BATTING_JSONB_PICK_KEYS : PITCHING_JSONB_PICK_KEYS;
  const out: Record<string, unknown> = {};
  for (const k of keyList) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) {
      out[k] = obj[k];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type ComparePlayersCareerInput = {
  player_a_query: string;
  player_b_query: string;
  include_batting?: boolean | null;
  include_pitching?: boolean | null;
  season_from?: number | null;
  season_to?: number | null;
};

export async function comparePlayersCareer(
  pool: pg.Pool,
  input: ComparePlayersCareerInput
): Promise<Record<string, unknown>> {
  const includeBatting = input.include_batting !== false;
  const includePitching = input.include_pitching !== false;

  const ra = await resolvePlayerIdFromQuery(pool, input.player_a_query.trim());
  if ('error' in ra) return { error: ra.error, stage: 'resolve_a' };
  const rb = await resolvePlayerIdFromQuery(pool, input.player_b_query.trim());
  if ('error' in rb) return { error: rb.error, stage: 'resolve_b' };

  const ids = [ra.player_id, rb.player_id];
  const players = await getPlayersByIds(pool, ids);

  const batting: { player_id: number; rows: Record<string, unknown>[] }[] = [];
  const pitching: { player_id: number; rows: Record<string, unknown>[] }[] = [];

  if (includeBatting) {
    for (const pid of ids) {
      const rows = await getFgSeasonLines(pool, {
        player_id: pid,
        role: 'batting',
        season_from: input.season_from ?? null,
        season_to: input.season_to ?? null,
        compare_mode: true,
        limit: FG_COMPARE_SEASON_ROW_CEILING,
      });
      batting.push({ player_id: pid, rows });
    }
  }

  if (includePitching) {
    for (const pid of ids) {
      const rows = await getFgSeasonLines(pool, {
        player_id: pid,
        role: 'pitching',
        season_from: input.season_from ?? null,
        season_to: input.season_to ?? null,
        compare_mode: true,
        limit: FG_COMPARE_SEASON_ROW_CEILING,
      });
      pitching.push({ player_id: pid, rows });
    }
  }

  return {
    players,
    batting,
    pitching,
    meta: {
      include_batting: includeBatting,
      include_pitching: includePitching,
      season_from: input.season_from ?? null,
      season_to: input.season_to ?? null,
    },
  };
}

function slimPlayersForLlm(players: unknown): unknown {
  if (!Array.isArray(players)) return players;
  return players.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const o = p as Record<string, unknown>;
    const first = String(o.name_first ?? '').trim();
    const last = String(o.name_last ?? '').trim();
    const display_name = [first, last].filter(Boolean).join(' ') || null;
    return {
      player_id: o.player_id,
      key_mlbam: o.key_mlbam,
      name_first: o.name_first,
      name_last: o.name_last,
      birth_date: o.birth_date,
      display_name,
    };
  });
}

/**
 * Drop bulky columns, trim externals, keep a small set of FanGraphs columns per season,
 * and add short hints so small models map player_id → names and stay on the user's question.
 */
export function stripComparePayloadForLlm(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.error != null) return { ...payload };

  const rowCounts = (blocks: unknown): { player_id: unknown; row_count: number }[] => {
    if (!Array.isArray(blocks)) return [];
    return blocks.map((b) => {
      if (!b || typeof b !== 'object') return { player_id: null, row_count: 0 };
      const box = b as { player_id?: unknown; rows?: unknown };
      const rows = box.rows;
      return {
        player_id: box.player_id ?? null,
        row_count: Array.isArray(rows) ? rows.length : 0,
      };
    });
  };

  const stripRows = (
    blocks: unknown,
    keys: Set<string>,
    role: 'batting' | 'pitching'
  ): unknown => {
    if (!Array.isArray(blocks)) return blocks;
    return blocks.map((b) => {
      if (!b || typeof b !== 'object') return b;
      const box = b as { player_id?: unknown; rows?: unknown };
      const rows = box.rows;
      if (!Array.isArray(rows)) return b;
      return {
        player_id: box.player_id,
        rows: rows.map((r) => {
          if (!r || typeof r !== 'object') return r;
          const row = { ...(r as Record<string, unknown>) };
          const statsPick = pickFromStatsJsonb(role, row);
          delete row.stats_jsonb;
          delete row.ingest_pulled_at;
          const slim = pickRowKeys(row, keys);
          if (statsPick) slim.stats_jsonb_pick = statsPick;
          return slim;
        }),
      };
    });
  };

  const metaBase =
    payload.meta != null && typeof payload.meta === 'object'
      ? { ...(payload.meta as Record<string, unknown>) }
      : {};
  metaBase.fg_rows_returned = {
    batting: rowCounts(payload.batting),
    pitching: rowCounts(payload.pitching),
    note: 'row_count is FanGraphs rows returned (season/team/level splits); often close to seasons played but can exceed seasons if the player had multiple teams in a year.',
  };

  return {
    ...payload,
    meta: metaBase,
    players: slimPlayersForLlm(payload.players),
    batting: stripRows(payload.batting, BATTING_LLM_KEYS, 'batting'),
    pitching: stripRows(payload.pitching, PITCHING_LLM_KEYS, 'pitching'),
    _compare_guide: [
      'Match each batting[].player_id / pitching[].player_id to players[].player_id; use players[].display_name when speaking to the fan.',
      'rows are FanGraphs MLB seasons, newest season first (not chronological career order).',
      'meta.fg_rows_returned counts rows per player; use it when discussing career length vs a single-season line.',
      "Answer the user's actual question only (e.g. if they asked to compare two players, compare both — do not invent a different question such as 'most accurate season').",
      'stats_jsonb_pick holds a small subset of long-tail metrics from FanGraphs stats_jsonb; the full JSONB blob is omitted.',
    ],
  };
}
