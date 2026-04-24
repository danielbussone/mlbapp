import { CARD_SEASON_YEAR_MAX } from './cardSeasonYear.js';

function parseFourDigitYear(s: string): number | null {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1900 || n > CARD_SEASON_YEAR_MAX) return null;
  return n;
}

/**
 * Detects an explicit season year in the full message (e.g. “in 2017”, “2017 season”).
 * Prefer the last match so leading fluff does not win.
 */
export function extractExplicitSeasonYearFromMessage(message: string): number | null {
  const m = message.trim();
  if (!m) return null;
  const patterns = [
    /\b(?:in|during|for)\s+the\s+(19\d{2}|20\d{2})\b/gi,
    /\b(?:in|during|for)\s+(19\d{2}|20\d{2})\b/gi,
    /\b(19\d{2}|20\d{2})\s+season\b/gi,
  ];
  const hits: number[] = [];
  for (const re of patterns) {
    let x: RegExpExecArray | null;
    while ((x = re.exec(m)) != null) {
      const y = parseFourDigitYear(x[1] ?? '');
      if (y != null) hits.push(y);
    }
  }
  return hits.length > 0 ? hits[hits.length - 1]! : null;
}

function stripSeasonSuffixFromName(raw: string, explicitYear: number | null): string {
  let s = raw.trim();
  if (explicitYear != null) {
    const y = explicitYear;
    s = s.replace(new RegExp(`[,\\s]+in\\s+${y}\\s*$`, 'i'), '');
    s = s.replace(new RegExp(`[,\\s]+during\\s+(?:the\\s+)?${y}\\s*$`, 'i'), '');
    s = s.replace(new RegExp(`[,\\s]+for\\s+the\\s+${y}\\s+season\\s*$`, 'i'), '');
    s = s.replace(new RegExp(`[,\\s]+${y}\\s+season\\s*$`, 'i'), '');
  }
  return s.replace(/[?.!]+$/g, '').trim();
}

export type PlayerCardChatIntent = {
  nameQuery: string;
  /** When set, do not auto-fallback away from this year for empty current-year stats. */
  explicitSeason: number | null;
};

export type CompareChatIntent = {
  playerAQuery: string;
  playerBQuery: string;
  explicitSeason: number | null;
  /** `statcast` when the message asks about pitch mix / swings / Statcast; otherwise FanGraphs career-style compare. */
  mode: 'career' | 'statcast';
};

/**
 * Two-player compare from chat (e.g. “Compare Mike Trout and Ken Griffey Jr.”).
 * Prefer this over {@link extractPlayerCardChatIntent} when both patterns could match.
 */
export function extractCompareChatIntent(message: string): CompareChatIntent | null {
  const m = message.trim();
  if (!m) return null;
  const andMatch =
    m.match(/compare\s+(.+?)\s+and\s+(.+?)(?:[.?!]|$)/i) ||
    m.match(/how\s+do\s+(.+?)\s+and\s+(.+?)\s+differ/i);
  if (!andMatch?.[1] || !andMatch[2]) return null;
  const a = andMatch[1].replace(/[?.!]+$/g, '').trim();
  const b = andMatch[2].replace(/[?.!]+$/g, '').trim();
  if (!a || !b || a.length > 200 || b.length > 200) return null;
  const explicitSeason = extractExplicitSeasonYearFromMessage(m);
  const low = m.toLowerCase();
  const mode: CompareChatIntent['mode'] =
    low.includes('pitch mix') ||
    low.includes('swing') ||
    low.includes('statcast') ||
    low.includes('velo') ||
    low.includes('movement')
      ? 'statcast'
      : 'career';
  return { playerAQuery: a, playerBQuery: b, explicitSeason, mode };
}

const INLINE_YEAR_PATTERNS: Array<{ re: RegExp; nameIdx: number; yearIdx: number }> = [
  { re: /what\s+was\s+(.+?)\s+like\s+in\s+(19\d{2}|20\d{2})\b/i, nameIdx: 1, yearIdx: 2 },
  { re: /how\s+did\s+(.+?)\s+do\s+in\s+(19\d{2}|20\d{2})\b/i, nameIdx: 1, yearIdx: 2 },
  { re: /how\s+was\s+(.+?)\s+in\s+(19\d{2}|20\d{2})\b/i, nameIdx: 1, yearIdx: 2 },
];

const BIO_TAIL = '(.+)';

const BIO_PATTERNS = [
  new RegExp(`tell\\s+me\\s+about\\s+${BIO_TAIL}`, 'i'),
  new RegExp(`^about\\s+${BIO_TAIL}`, 'i'),
  new RegExp(`^who\\s+is\\s+${BIO_TAIL}`, 'i'),
];

/**
 * Detect a natural-language ask that should open the player card beside chat.
 * Returns a cleaned `nameQuery` for `/players/named` and an optional `explicitSeason`
 * when the user named a year (chat or inline in the “what was … in YEAR” form).
 */
export function extractPlayerCardChatIntent(message: string): PlayerCardChatIntent | null {
  const m = message.trim();
  if (!m) return null;

  if (extractCompareChatIntent(m) != null) return null;

  for (const { re, nameIdx, yearIdx } of INLINE_YEAR_PATTERNS) {
    const x = m.match(re);
    if (x?.[nameIdx] && x?.[yearIdx]) {
      const nameQuery = x[nameIdx].replace(/[?.!]+$/g, '').trim();
      const explicitSeason = parseFourDigitYear(x[yearIdx]);
      if (nameQuery.length > 0 && nameQuery.length <= 200 && explicitSeason != null) {
        return { nameQuery, explicitSeason };
      }
    }
  }

  for (const re of BIO_PATTERNS) {
    const x = m.match(re);
    if (x?.[1]) {
      const rest = x[1].replace(/[?.!]+$/g, '').trim();
      const explicitSeason = extractExplicitSeasonYearFromMessage(m);
      const nameQuery = stripSeasonSuffixFromName(rest, explicitSeason);
      if (nameQuery.length > 0 && nameQuery.length <= 200) {
        return { nameQuery, explicitSeason };
      }
    }
  }

  return null;
}

/**
 * @deprecated Prefer {@link extractPlayerCardChatIntent}; kept for narrow compatibility.
 */
export function extractSinglePlayerBioQuery(message: string): string | null {
  return extractPlayerCardChatIntent(message)?.nameQuery ?? null;
}
