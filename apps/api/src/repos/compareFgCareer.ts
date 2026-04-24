import type pg from 'pg';
import { getFgBattingCardPayload, getFgPitchingCardPayload } from './fangraphsCareer.js';
import { getPlayersByIds } from './players.js';

const MAX_COMPARE_PLAYERS = 4;

export type CompareFgCareerInput = {
  player_ids: number[];
};

/**
 * FanGraphs career aggregates for multiple players (Stathead-style compare).
 * Uses scoped career queries from {@link getFgBattingCardPayload} / {@link getFgPitchingCardPayload}.
 */
export async function compareFgCareer(
  pool: pg.Pool,
  input: CompareFgCareerInput
): Promise<Record<string, unknown>> {
  const ids = [...new Set(input.player_ids)]
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_COMPARE_PLAYERS);
  if (ids.length < 2) {
    return { error: 'Need at least two distinct valid player_ids', min: 2, max: MAX_COMPARE_PLAYERS };
  }

  const players = await getPlayersByIds(pool, ids);
  const careerOpts = { lastSeasons: 1, forSeason: null as number | null, careerOnly: true as const };

  const batting = [];
  const pitching = [];
  for (const pid of ids) {
    const [b, p] = await Promise.all([
      getFgBattingCardPayload(pool, pid, careerOpts),
      getFgPitchingCardPayload(pool, pid, careerOpts),
    ]);
    batting.push({ player_id: pid, career: b.career });
    pitching.push({ player_id: pid, career: p.career });
  }

  return {
    players,
    batting_careers: batting,
    pitching_careers: pitching,
    meta: { player_ids: ids },
  };
}
