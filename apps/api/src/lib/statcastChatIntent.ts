import { normalizePlayerNameQuery } from './playerNameQuery.js';

const YEAR = '(20\\d{2}|19\\d{2})';

export type StatcastHostInject =
  | { kind: 'pitcher_mix'; name_query: string; game_year: number }
  | { kind: 'batter_batted_ball'; name_query: string; game_year: number };

/**
 * Detect Statcast phrasing the small model often answers without tools; host can inject resolve + tool.
 */
export function inferStatcastHostInject(message: string): StatcastHostInject | null {
  const m = message.trim();
  if (!m) return null;

  const pitchRes = m.match(
    new RegExp(
      `(?:statcast\\s+)?pitch\\s+mix\\s+(?:for|from)\\s+(.+?)\\s+in\\s+${YEAR}\\b`,
      'is'
    )
  );
  if (pitchRes?.[1] && pitchRes[2]) {
    const game_year = parseInt(pitchRes[2], 10);
    if (game_year >= 2010 && game_year <= 2032) {
      const name_query = normalizePlayerNameQuery(pitchRes[1].replace(/[?.!]+$/g, '').trim());
      if (name_query.length > 0 && name_query.length <= 200) return { kind: 'pitcher_mix', name_query, game_year };
    }
  }

  const evRes = m.match(
    new RegExp(
      `what\\s+is\\s+(.+?)['\u2019]s\\s+average\\s+exit\\s+velocity\\s+in\\s+${YEAR}\\b`,
      'is'
    )
  );
  if (evRes?.[1] && evRes[2]) {
    const game_year = parseInt(evRes[2], 10);
    if (game_year >= 2010 && game_year <= 2032) {
      let name_query = normalizePlayerNameQuery(evRes[1].replace(/[?.!]+$/g, '').trim());
      name_query = name_query.replace(/\s+/g, ' ').trim();
      if (name_query.length > 0 && name_query.length <= 200) {
        return { kind: 'batter_batted_ball', name_query, game_year };
      }
    }
  }

  return null;
}
