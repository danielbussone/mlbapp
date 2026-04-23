import { getFgSeasonLines } from './fangraphsSeason.js';
import { getPlayersByIds, resolvePlayerIdFromQuery } from './players.js';
export async function comparePlayersCareer(pool, input) {
    const includeBatting = input.include_batting !== false;
    const includePitching = input.include_pitching !== false;
    const ra = await resolvePlayerIdFromQuery(pool, input.player_a_query.trim());
    if ('error' in ra)
        return { error: ra.error, stage: 'resolve_a' };
    const rb = await resolvePlayerIdFromQuery(pool, input.player_b_query.trim());
    if ('error' in rb)
        return { error: rb.error, stage: 'resolve_b' };
    const ids = [ra.player_id, rb.player_id];
    const players = await getPlayersByIds(pool, ids);
    const batting = [];
    const pitching = [];
    if (includeBatting) {
        for (const pid of ids) {
            const rows = await getFgSeasonLines(pool, {
                player_id: pid,
                role: 'batting',
                season_from: input.season_from ?? null,
                season_to: input.season_to ?? null,
                limit: 40,
            });
            batting.push({ player_id: pid, rows });
        }
    }
    if (includePitching) {
        for (const pid of ids) {
            const rows = await getFgSeasonLines(pool, {
                player_id: pid,
                role: 'pitching',
                season_from: input.season_from ?? null,
                season_to: input.season_to ?? null,
                limit: 40,
            });
            pitching.push({ player_id: pid, rows });
        }
    }
    return {
        players,
        batting,
        pitching,
        meta: {
            include_batting: includeBatting,
            include_pitching: includePitching,
            season_from: input.season_from ?? null,
            season_to: input.season_to ?? null,
        },
    };
}
