import { normalizePlayerNameQuery } from './playerNameQuery.js';

function parseFourDigitYear(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
}

/**
 * Calendar year only when the user clearly tied a season to the question
 * (avoids spurious years from unrelated text).
 */
export function inferExplicitSeasonYearFromUserMessage(message: string): number | null {
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
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    while ((x = r.exec(m)) != null) {
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

/**
 * Extract a player name string from common chat phrasings ("Tell me about Mookie Betts", …).
 * Used to repair resolve_player when the model omits name_query.
 */
export function inferPlayerNameQueryFromUserMessage(message: string): string | null {
  const m = message.trim();
  if (!m) return null;

  const inlineYear = [
    { re: /what\s+was\s+(.+?)\s+like\s+in\s+(19\d{2}|20\d{2})\b/i, g: 1 },
    { re: /how\s+did\s+(.+?)\s+do\s+in\s+(19\d{2}|20\d{2})\b/i, g: 1 },
    { re: /how\s+was\s+(.+?)\s+in\s+(19\d{2}|20\d{2})\b/i, g: 1 },
  ];
  for (const { re, g } of inlineYear) {
    const x = m.match(re);
    if (x?.[g]) {
      const name = x[g].replace(/[?.!]+$/g, '').trim();
      if (name.length > 0 && name.length <= 200) return normalizePlayerNameQuery(name);
    }
  }

  const bio = [
    /tell\s+me\s+about\s+(.+)/i,
    /^about\s+(.+)/i,
    /^who\s+is\s+(.+)/i,
  ];
  for (const re of bio) {
    const x = m.match(re);
    if (x?.[1]) {
      const rest = x[1].replace(/[?.!]+$/g, '').trim();
      const y = inferExplicitSeasonYearFromUserMessage(m);
      const name = stripSeasonSuffixFromName(rest, y);
      if (name.length > 0 && name.length <= 200) return normalizePlayerNameQuery(name);
    }
  }

  const resolveAnd = m.match(/\bresolve\s+(.+?)\s+\band\b/i);
  if (resolveAnd?.[1]) {
    const name = resolveAnd[1].trim();
    if (name.length > 0 && name.length <= 200) return normalizePlayerNameQuery(name);
  }

  return null;
}
