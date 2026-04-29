/** Align with player-card data scope (see apps/web cardSeasonYear). */
export const PLAYER_CHAT_SEASON_YEAR_MAX = 2026;

function parseFourDigitYear(s: string): number | null {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1900 || n > PLAYER_CHAT_SEASON_YEAR_MAX) return null;
  return n;
}

/**
 * Explicit season year in the message (e.g. “in 2017”, “2017 season”).
 * Prefer the last match.
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
  if (hits.length === 0) return null;
  return hits[hits.length - 1] ?? null;
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

/** Strip trailing “’s pitching / ’s batting” (straight or curly apostrophe) so DB name resolve works. */
export function stripPossessiveRoleSuffixFromName(s: string): string {
  return s
    .replace(/['\u2019]s\s+(pitching|batting|hitting|offense|defense|stats?)\s*$/i, '')
    .trim();
}

/** First token (lowercase) must not look like a question/stat opener for bare-name search. */
const BARE_NAME_FIRST_TOKEN_BLOCK = new Set(
  [
    'what',
    'how',
    'why',
    'when',
    'who',
    'which',
    'where',
    'compare',
    'is',
    'are',
    'was',
    'were',
    'did',
    'does',
    'do',
    'can',
    'could',
    'would',
    'should',
    'has',
    'have',
    'had',
    'if',
    'any',
    'give',
    'list',
    'explain',
    'define',
    'calculate',
    'tell',
    'show',
    'look',
    'open',
    'find',
    'search',
    'war',
    'era',
    'fip',
    'whip',
    'woba',
    'ops',
    'avg',
    'babip',
    'xfip',
    'the',
    'a',
    'an',
    'this',
    'that',
    'these',
    'those',
    'fangraphs',
    'statcast',
    'savant',
  ].map((s) => s.toLowerCase())
);

const INLINE_YEAR_PATTERNS: Array<{ re: RegExp; nameIdx: number; yearIdx: number }> = [
  { re: /what\s+was\s+(.+?)\s+like\s+in\s+(19\d{2}|20\d{2})\b/i, nameIdx: 1, yearIdx: 2 },
  { re: /how\s+did\s+(.+?)\s+do\s+in\s+(19\d{2}|20\d{2})\b/i, nameIdx: 1, yearIdx: 2 },
  { re: /how\s+was\s+(.+?)\s+in\s+(19\d{2}|20\d{2})\b/i, nameIdx: 1, yearIdx: 2 },
];

const BIO_PREFIXES = [
  'tell\\s+me\\s+about\\s+',
  'talk\\s+(?:to\\s+me\\s+)?about\\s+',
  'discuss\\s+',
  'show\\s+me\\s+',
  'look\\s+up\\s+',
  'stats\\s+for\\s+',
  'open\\s+',
  '^about\\s+',
  '^who\\s+is\\s+',
  '^who(?:\'s|s)\\s+',
];

const BIO_PATTERNS = BIO_PREFIXES.map((prefix) => new RegExp(`${prefix}(.+)`, 'i'));

function tokenLooksLikeNamePart(t: string): boolean {
  return /^[\p{L}][\p{L}'.-]*$/u.test(t.trim());
}

/**
 * Whole-line search: “Shohei Ohtani”, “Mike Trout” (2–4 name tokens, no question/stat lead-in).
 */
function tryBareNameQuery(message: string): string | null {
  const m = message.trim();
  if (!m || m.length > 200) return null;
  if (/\n/.test(m)) return null;
  if (/\band\b/i.test(m)) return null;
  const parts = m.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  if (!parts.every(tokenLooksLikeNamePart)) return null;
  const first = parts[0].toLowerCase();
  if (first == null || BARE_NAME_FIRST_TOKEN_BLOCK.has(first)) return null;
  return m.replace(/[?.!]+$/g, '').trim();
}

export type PlayerCardChatIntentPayload = {
  nameQuery: string;
  explicitSeason: number | null;
};

/** Single-player card intent from phrasing or bare “First Last” search (caller should skip if compare intent). */
export function extractPlayerCardChatIntentFromMessage(message: string): PlayerCardChatIntentPayload | null {
  const m = message.trim();
  if (!m) return null;

  for (const { re, nameIdx, yearIdx } of INLINE_YEAR_PATTERNS) {
    const x = m.match(re);
    if (x?.[nameIdx] && x?.[yearIdx]) {
      let nameQuery = x[nameIdx].replace(/[?.!]+$/g, '').trim();
      nameQuery = stripPossessiveRoleSuffixFromName(nameQuery);
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
      let nameQuery = stripSeasonSuffixFromName(rest, explicitSeason);
      nameQuery = stripPossessiveRoleSuffixFromName(nameQuery);
      if (nameQuery.length > 0 && nameQuery.length <= 200) {
        return { nameQuery, explicitSeason };
      }
    }
  }

  const bare = tryBareNameQuery(m);
  if (bare && bare.length > 0 && bare.length <= 200) {
    const explicitSeason = extractExplicitSeasonYearFromMessage(m);
    let nameQuery = stripSeasonSuffixFromName(bare, explicitSeason);
    nameQuery = stripPossessiveRoleSuffixFromName(nameQuery);
    if (nameQuery.length > 0) return { nameQuery, explicitSeason };
  }

  return null;
}

/**
 * Name string for DB resolve / tool repair (trim + collapse spaces). Caller applies {@link normalizePlayerNameQuery} if needed.
 */
export function inferPlayerNameQueryFromUserMessageShared(message: string): string | null {
  const intent = extractPlayerCardChatIntentFromMessage(message);
  if (intent) return intent.nameQuery.trim().replace(/\s+/g, ' ');

  const m = message.trim();
  const resolveAnd = m.match(/\bresolve\s+(.+?)\s+\band\b/i);
  if (resolveAnd?.[1]) {
    let name = resolveAnd[1].trim().replace(/[?.!]+$/g, '').trim();
    name = stripPossessiveRoleSuffixFromName(name);
    if (name.length > 0 && name.length <= 200) return name.replace(/\s+/g, ' ');
  }
  return null;
}
