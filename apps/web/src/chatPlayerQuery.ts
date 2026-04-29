import { extractExplicitSeasonYearFromMessage, extractPlayerCardChatIntentFromMessage } from '@mlbapp/shared';

export { extractExplicitSeasonYearFromMessage };

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
    m.match(/compare\s+(.+?)\s+and\s+(.+?)(?:[.?!]|$)/is) ||
    m.match(/\bhow\s+do\s+(.+?)\s+and\s+(.+?)\s+differ\b/is);
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

/**
 * Detect a natural-language ask that should open the player card beside chat.
 * Returns a cleaned `nameQuery` for `/players/named` and an optional `explicitSeason`
 * when the user named a year (chat or inline in the “what was … in YEAR” form).
 */
export function extractPlayerCardChatIntent(message: string): PlayerCardChatIntent | null {
  const m = message.trim();
  if (!m) return null;
  if (extractCompareChatIntent(m) != null) return null;
  const fromShared = extractPlayerCardChatIntentFromMessage(m);
  if (!fromShared) return null;
  return {
    nameQuery: fromShared.nameQuery,
    explicitSeason: fromShared.explicitSeason,
  };
}

/**
 * @deprecated Prefer {@link extractPlayerCardChatIntent}; kept for narrow compatibility.
 */
export function extractSinglePlayerBioQuery(message: string): string | null {
  return extractPlayerCardChatIntent(message)?.nameQuery ?? null;
}
