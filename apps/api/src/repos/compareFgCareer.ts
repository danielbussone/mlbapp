import type pg from 'pg';
import { getFgBattingCardPayload, getFgPitchingCardPayload } from './fangraphsCareer.js';
import { getFgSeasonLines } from './fangraphsSeason.js';
import { getPlayersByIds } from './players.js';

const MAX_COMPARE_PLAYERS = 4;

export type CompareFgCareerInput = {
  player_ids: number[];
  /** When set, return that season’s FanGraphs rows instead of career aggregates. */
  season?: number | null;
};

/**
 * FanGraphs career aggregates for multiple players (Stathead-style compare), or one season slice
 * when `season` is set.
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
  const season =
    input.season != null && Number.isInteger(input.season) && input.season >= 1900 && input.season <= 2100
      ? input.season
      : null;

  if (season != null) {
    const batting_fg_season: { player_id: number; rows: Record<string, unknown>[] }[] = [];
    const pitching_fg_season: { player_id: number; rows: Record<string, unknown>[] }[] = [];
    for (const pid of ids) {
      const [bRows, pRows] = await Promise.all([
        getFgSeasonLines(pool, { player_id: pid, role: 'batting', season, limit: 12 }),
        getFgSeasonLines(pool, { player_id: pid, role: 'pitching', season, limit: 12 }),
      ]);
      batting_fg_season.push({ player_id: pid, rows: bRows });
      pitching_fg_season.push({ player_id: pid, rows: pRows });
    }
    return {
      players,
      batting_fg_season,
      pitching_fg_season,
      meta: { player_ids: ids, fg_season_year: season },
    };
  }

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
