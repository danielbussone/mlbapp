/**
 * Maps API payloads backed by `fg_batting_career_mlb` and `fg_batting_season_mlb_consolidated`
 * (see docs/FG_CAREER_AGGREGATE_VIEWS.md) into player-card table rows.
 */

export type BattingCardLine = {
  seasonLabel: string;
  /** FanGraphs team(s) for this MLB season row (from `fg_batting_season_current`). */
  teamAbbr: string | null;
  games: number;
  pa: number;
  ab: number | null;
  r: number;
  h: number | null;
  hr: number;
  rbi: number;
  sb: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  wrcPlus: number | null;
  fwar: number | null;
};

export const BATTING_CARD_HEADERS: { key: keyof Omit<BattingCardLine, 'seasonLabel'>; label: string }[] = [
  { key: 'teamAbbr', label: 'Tm' },
  { key: 'games', label: 'G' },
  { key: 'pa', label: 'PA' },
  { key: 'ab', label: 'AB' },
  { key: 'r', label: 'R' },
  { key: 'h', label: 'H' },
  { key: 'hr', label: 'HR' },
  { key: 'rbi', label: 'RBI' },
  { key: 'sb', label: 'SB' },
  { key: 'avg', label: 'AVG' },
  { key: 'obp', label: 'OBP' },
  { key: 'slg', label: 'SLG' },
  { key: 'ops', label: 'OPS' },
  { key: 'wrcPlus', label: 'wRC+' },
  { key: 'fwar', label: 'fWAR' },
];

export type FgBattingCardApi = {
  career: Record<string, unknown> | null;
  seasons: Record<string, unknown>[];
  max_season?: number | null;
  has_row_for_season?: boolean | null;
  /** JAWS-style fWAR from API; null when absent. Peak is sum of best seven seasons' WAR. */
  jaws_fwar?: number | null;
  peak_war_fwar?: number | null;
};

/** Must stay in sync with API `last_seasons` max (`apps/api/src/routes/players.ts`). */
export const FG_CARD_SEASON_ROW_LIMIT = 100;

export function normalizeFgCardPayload(payload: unknown): FgBattingCardApi {
  const p = payload as Partial<FgBattingCardApi> | null;
  if (p == null || typeof p !== 'object') {
    return { career: null, seasons: [], max_season: null, has_row_for_season: null };
  }
  return {
    career: p.career ?? null,
    seasons: Array.isArray(p.seasons) ? p.seasons : [],
    max_season: p.max_season ?? null,
    has_row_for_season: p.has_row_for_season ?? null,
    jaws_fwar: p.jaws_fwar ?? null,
    peak_war_fwar: p.peak_war_fwar ?? null,
  };
}

/** True when the FG batting or pitching card payload would render a career block and/or season rows. */
export function fgCardHasAnyRows(api: FgBattingCardApi): boolean {
  return api.career != null || (Array.isArray(api.seasons) && api.seasons.length > 0);
}

/** True if consolidated seasons include MLB data for this calendar year (replaces API `for_season` when omitted). */
export function fgSeasonHasConsolidatedRow(seasons: Record<string, unknown>[], year: number): boolean {
  return seasons.some((s) => Number(s.season) === year);
}

/** FanGraphs MLB season row matches the card selector; never true for the Career row. */
export function fgCardSeasonRowIsSelected(seasonLabel: string, selectedSeason: number | undefined): boolean {
  if (selectedSeason === undefined || seasonLabel === 'Career') return false;
  const y = Number(seasonLabel);
  return Number.isFinite(y) && y === selectedSeason;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function nn(v: unknown, fallback = 0): number {
  return num(v) ?? fallback;
}

/** Career row from `GET .../fg-batting-card` (`career_h` / `career_ab` from `fg_batting_career_mlb`). */
export function mapCareerViewToBattingLine(c: Record<string, unknown>): BattingCardLine {
  return {
    seasonLabel: 'Career',
    teamAbbr: null,
    games: nn(c.career_games),
    pa: nn(c.career_pa),
    ab: num(c.career_ab),
    r: nn(c.career_r),
    h: num(c.career_h),
    hr: nn(c.career_hr),
    rbi: nn(c.career_rbi),
    sb: nn(c.career_sb),
    avg: num(c.career_avg),
    obp: num(c.career_obp),
    slg: num(c.career_slg),
    ops: num(c.career_ops),
    wrcPlus: num(c.career_wrc_plus_pa_weighted),
    fwar: num(c.career_war),
  };
}

/**
 * One consolidated MLB season row (`fg_batting_season_mlb_consolidated`):
 * OBP from H, walks_bb_pct_pa, HBP, SF, SH (FanGraphs career display rules at season grain).
 */
export function mapConsolidatedSeasonToBattingLine(s: Record<string, unknown>): BattingCardLine {
  const h = num(s.h);
  const ab = num(s.ab);
  const pa = nn(s.pa);
  const walks = num(s.walks_bb_pct_pa) ?? num(s.bb);
  const hbp = num(s.hbp);
  const sf = num(s.sf);
  const sh = num(s.sh);
  const tb = num(s.tb);

  let obp: number | null = null;
  if (h != null && walks != null && ab != null && hbp != null && sf != null && sh != null) {
    const nume = h + walks + hbp;
    const den = ab + walks + hbp + sf + sh;
    if (den > 0) obp = nume / den;
  }

  const slg = tb != null && ab != null && ab > 0 ? tb / ab : null;
  const avg = h != null && ab != null && ab > 0 ? h / ab : null;
  const ops = obp != null && slg != null ? obp + slg : null;

  const td = s.team_display;
  const teamAbbr =
    typeof td === 'string' && td.trim() !== '' ? td.trim() : null;
  return {
    seasonLabel: String(s.season ?? ''),
    teamAbbr,
    games: nn(s.games),
    pa,
    ab,
    r: nn(s.r),
    h,
    hr: nn(s.hr),
    rbi: nn(s.rbi),
    sb: nn(s.sb),
    avg,
    obp,
    slg,
    ops,
    wrcPlus: num(s.wrc_plus_pa_weighted),
    fwar: num(s.war),
  };
}

export function battingCardLinesFromCareerViews(api: FgBattingCardApi): {
  career: BattingCardLine | null;
  lastSeasons: BattingCardLine[];
} {
  const career = api.career ? mapCareerViewToBattingLine(api.career) : null;
  const lastSeasons = (api.seasons ?? []).map(mapConsolidatedSeasonToBattingLine);
  return { career, lastSeasons };
}

export function formatBattingCardCell(
  key: keyof Omit<BattingCardLine, 'seasonLabel'>,
  value: string | number | null
): string {
  if (key === 'teamAbbr') {
    if (value == null || value === '') return '—';
    return String(value);
  }
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '—';
  const n = value as number;
  if (
    key === 'games' ||
    key === 'pa' ||
    key === 'ab' ||
    key === 'r' ||
    key === 'h' ||
    key === 'hr' ||
    key === 'rbi' ||
    key === 'sb'
  ) {
    return String(Math.round(n));
  }
  if (key === 'avg' || key === 'obp' || key === 'slg' || key === 'ops') return n.toFixed(3);
  if (key === 'wrcPlus') return n.toFixed(0);
  if (key === 'fwar') return n.toFixed(1);
  return String(value);
}
