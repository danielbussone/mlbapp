const OF_CODES = ['LF', 'CF', 'RF', 'OF'] as const;

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** True when the cell carries a numeric defensive rate (0 is valid; null/blank/NaN are not). */
function rateCellPresent(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n);
}

export function normPos(p: unknown): string {
  return String(p ?? '')
    .trim()
    .toUpperCase();
}

export type FieldingAggLine = {
  key: string;
  seasonLabel: string;
  team: string;
  position: string;
  inn: number;
  drs: number;
  uzr: number;
  oaa: number;
  games: number;
  errors: number;
  /** At least one source row had a numeric DRS value (sum may still be 0). */
  drsDefined: boolean;
  uzrDefined: boolean;
  oaaDefined: boolean;
};

/** @deprecated Use FieldingAggLine */
export type OutfieldAggLine = FieldingAggLine;

function sumRows(rs: Record<string, unknown>[]): Omit<FieldingAggLine, 'key' | 'seasonLabel' | 'team' | 'position'> {
  let inn = 0;
  let drs = 0;
  let uzr = 0;
  let oaa = 0;
  let games = 0;
  let errors = 0;
  let drsDefined = false;
  let uzrDefined = false;
  let oaaDefined = false;
  for (const r of rs) {
    inn += num(r.inn);
    games += num(r.games);
    errors += num(r.errors);
    if (rateCellPresent(r.drs)) {
      drs += num(r.drs);
      drsDefined = true;
    }
    if (rateCellPresent(r.uzr)) {
      uzr += num(r.uzr);
      uzrDefined = true;
    }
    if (rateCellPresent(r.oaa)) {
      oaa += num(r.oaa);
      oaaDefined = true;
    }
  }
  return { inn, drs, uzr, oaa, games, errors, drsDefined, uzrDefined, oaaDefined };
}

/** Drop league-total / unknown buckets so we do not double-count with position splits. */
export function filterSummableFieldingRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.filter((r) => {
    const p = normPos(r.position);
    if (!p || p === 'ALL' || p === 'UNK' || p === 'UNKNOWN') return false;
    return true;
  });
}

function addExpandedPrimaryTokens(parts: string[], into: Set<string>): void {
  for (let raw of parts) {
    raw = raw.replace(/·/g, ' ').trim().toUpperCase();
    if (!raw) continue;
    if (raw === 'SP' || raw === 'RP' || raw === 'SP/RP' || raw === 'SWRP') {
      into.add('P');
      continue;
    }
    if (raw === 'OF' || raw === 'OUTFIELD') {
      for (const c of OF_CODES) into.add(c);
      continue;
    }
    if (raw === 'IF' || raw === 'INF' || raw === 'INFIELD') {
      for (const c of ['1B', '2B', '3B', 'SS', 'C']) into.add(c);
      continue;
    }
    const compact = raw.replace(/\s+/g, '');
    if (compact) into.add(compact);
  }
}

/**
 * Map FanGraphs batting/pitching `position_display` (header chip) to fielding `position` codes
 * for filtering rolled-up fielding rows.
 */
export function codesForPrimaryPositionDisplay(primaryDisplay: string | null | undefined): Set<string> | null {
  if (primaryDisplay == null) return null;
  const s = String(primaryDisplay).trim();
  if (!s) return null;
  const chunks = s
    .split(/[/|]|(?:\s+and\s+)/i)
    .flatMap((part) => part.split(',').map((p) => p.trim()))
    .filter(Boolean);
  const codes = new Set<string>();
  addExpandedPrimaryTokens(chunks, codes);
  return codes.size > 0 ? codes : null;
}

export type BuildFieldingCareerOpts = {
  /** When true, only rows whose `position` matches the header primary (see `primaryDisplay`). */
  primaryOnly?: boolean;
  /** FanGraphs season primary from batting/pitching card (`position_display`), e.g. `CF` or `DH/OF`. */
  primaryDisplay?: string | null;
};

/** Summable FG rows after optional primary-position filter (shared by career/season builders). */
export function fieldingRowsAfterPrimaryFilter(
  rows: Record<string, unknown>[],
  opts?: BuildFieldingCareerOpts
): Record<string, unknown>[] {
  let base = filterSummableFieldingRows(rows);
  const primaryOnly = Boolean(opts?.primaryOnly);
  const primaryCodes = primaryOnly ? codesForPrimaryPositionDisplay(opts?.primaryDisplay ?? null) : null;
  if (primaryOnly && primaryCodes != null && primaryCodes.size > 0) {
    base = base.filter((r) => primaryCodes.has(normPos(r.position)));
  }
  return base;
}

function teamsJoined(rs: Record<string, unknown>[]): string {
  const teams = [...new Set(rs.map((x) => String(x.team ?? '').trim()).filter(Boolean))].sort();
  return teams.join(' / ') || '—';
}

/** One career row + one row per season (lines merged across team/position splits for that year). */
export function buildFieldingCareerAndSeasons(
  rows: Record<string, unknown>[],
  opts?: BuildFieldingCareerOpts
): { career: FieldingAggLine | null; seasons: FieldingAggLine[] } {
  const base = fieldingRowsAfterPrimaryFilter(rows, opts);
  if (base.length === 0) return { career: null, seasons: [] };

  const primaryOnly = Boolean(opts?.primaryOnly);
  const primaryCodes = primaryOnly ? codesForPrimaryPositionDisplay(opts?.primaryDisplay ?? null) : null;
  const careerParts = sumRows(base);
  const careerPosLabel =
    primaryOnly && primaryCodes != null && primaryCodes.size > 0
      ? [...primaryCodes].sort().join('/')
      : 'All positions';

  const career: FieldingAggLine = {
    key: 'career',
    seasonLabel: 'Career',
    team: '—',
    position: careerPosLabel,
    ...careerParts,
  };

  const bySeason = new Map<number, Record<string, unknown>[]>();
  for (const r of base) {
    const se = num(r.season);
    if (!Number.isFinite(se) || se <= 0) continue;
    let bucket = bySeason.get(se);
    if (bucket === undefined) {
      bucket = [];
      bySeason.set(se, bucket);
    }
    bucket.push(r);
  }

  const seasons: FieldingAggLine[] = [...bySeason.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([se, rs]) => {
      const parts = sumRows(rs);
      const poss = [...new Set(rs.map((x) => normPos(x.position)))].sort();
      const posLabel = poss.length === 1 ? (poss[0] ?? '') : poss.join('/');
      return {
        key: `y-${se}`,
        seasonLabel: String(se),
        team: teamsJoined(rs),
        position: posLabel,
        ...parts,
      };
    });

  return { career, seasons };
}

/**
 * Career rollup: one **All** row (every season, team, and position), then one row per position
 * (merged across seasons and teams), sorted by career innings descending.
 */
export function buildFieldingCareerExpanded(
  rows: Record<string, unknown>[],
  opts?: BuildFieldingCareerOpts
): FieldingAggLine[] {
  const base = fieldingRowsAfterPrimaryFilter(rows, opts);
  if (base.length === 0) return [];

  const allParts = sumRows(base);
  const out: FieldingAggLine[] = [
    {
      key: 'career-all',
      seasonLabel: 'Career',
      team: '—',
      position: 'All',
      ...allParts,
    },
  ];

  const byPos = new Map<string, Record<string, unknown>[]>();
  for (const r of base) {
    const p = normPos(r.position);
    let posBucket = byPos.get(p);
    if (posBucket === undefined) {
      posBucket = [];
      byPos.set(p, posBucket);
    }
    posBucket.push(r);
  }
  const posSorted = [...byPos.entries()].sort(
    (a, b) => sumRows(b[1]).inn - sumRows(a[1]).inn || a[0].localeCompare(b[0])
  );
  for (const [pos, prs] of posSorted) {
    const parts = sumRows(prs);
    out.push({
      key: `career-${pos}`,
      seasonLabel: 'Career',
      team: teamsJoined(prs),
      position: pos,
      ...parts,
    });
  }
  return out;
}

/**
 * Flat list: for each season (newest first), one **All** row (every position + team in that year),
 * then one row per position (teams merged within that season+position), sorted by innings descending.
 */
export function buildFieldingSeasonsExpanded(
  rows: Record<string, unknown>[],
  opts?: BuildFieldingCareerOpts
): FieldingAggLine[] {
  const base = fieldingRowsAfterPrimaryFilter(rows, opts);
  if (base.length === 0) return [];

  const bySeason = new Map<number, Record<string, unknown>[]>();
  for (const r of base) {
    const se = num(r.season);
    if (!Number.isFinite(se) || se <= 0) continue;
    let bucket = bySeason.get(se);
    if (bucket === undefined) {
      bucket = [];
      bySeason.set(se, bucket);
    }
    bucket.push(r);
  }

  const out: FieldingAggLine[] = [];
  for (const [se, rs] of [...bySeason.entries()].sort((a, b) => b[0] - a[0])) {
    const allParts = sumRows(rs);
    out.push({
      key: `y-${se}-all`,
      seasonLabel: String(se),
      team: teamsJoined(rs),
      position: 'All',
      ...allParts,
    });

    const byPos = new Map<string, Record<string, unknown>[]>();
    for (const r of rs) {
      const p = normPos(r.position);
      let posBucket = byPos.get(p);
      if (posBucket === undefined) {
        posBucket = [];
        byPos.set(p, posBucket);
      }
      posBucket.push(r);
    }
    const posSorted = [...byPos.entries()].sort((a, b) => sumRows(b[1]).inn - sumRows(a[1]).inn || a[0].localeCompare(b[0]));
    for (const [pos, prs] of posSorted) {
      const parts = sumRows(prs);
      out.push({
        key: `y-${se}-${pos}`,
        seasonLabel: String(se),
        team: teamsJoined(prs),
        position: pos,
        ...parts,
      });
    }
  }
  return out;
}

/** @deprecated Use buildFieldingCareerAndSeasons(rows) or filterSummableFieldingRows for OF-only views. */
export function filterOutfieldFgRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const OF: Set<string> = new Set(OF_CODES);
  return filterSummableFieldingRows(rows).filter((r) => OF.has(normPos(r.position)));
}

/** @deprecated Use buildFieldingCareerAndSeasons */
export function buildOutfieldCareerAndSeasons(rows: Record<string, unknown>[]): {
  career: FieldingAggLine | null;
  seasons: FieldingAggLine[];
} {
  const of = filterOutfieldFgRows(rows);
  return buildFieldingCareerAndSeasons(of, {});
}

export function fmtInn(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(1);
}

/** Formats a numeric rate; finite **0** prints as `0.0` (not a dash). */
export function fmtRate(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

/**
 * DRS / UZR / OAA: show a dash only when **no** source row had that metric.
 * Otherwise show the total, including real zeros.
 */
export function fmtFieldingMetric(n: number, defined: boolean): string {
  if (!defined) return '—';
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1);
}
