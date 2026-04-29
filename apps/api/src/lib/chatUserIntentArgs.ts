import {
  extractExplicitSeasonYearFromMessage,
  inferPlayerNameQueryFromUserMessageShared,
} from '@mlbapp/shared';
import { normalizePlayerNameQuery } from './playerNameQuery.js';

/**
 * Calendar year only when the user clearly tied a season to the question
 * (avoids spurious years from unrelated text).
 */
export function inferExplicitSeasonYearFromUserMessage(message: string): number | null {
  return extractExplicitSeasonYearFromMessage(message);
}

/**
 * Extract a player name string from common chat phrasings (“Tell me about Mookie Betts”, bare “Mike Trout”, …).
 * Used to repair resolve_player when the model omits name_query.
 */
export function inferPlayerNameQueryFromUserMessage(message: string): string | null {
  const raw = inferPlayerNameQueryFromUserMessageShared(message);
  if (!raw) return null;
  return normalizePlayerNameQuery(raw);
}
