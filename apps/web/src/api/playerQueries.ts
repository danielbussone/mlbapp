import { useQuery } from '@tanstack/react-query';
import type { LeaguePercentilesResponse } from '@/features/league-percentiles/leaguePercentilesTypes.js';
import type { JawsExpandedApiRole, JawsExpandedWirePayload } from '@/features/player-card/JawsExpandedBlock.js';
import { HttpError } from '@/api/queryClient.js';

export type LeaguePercentilesApiRole = 'batter' | 'pitcher' | 'fielding';

export const playerKeys = {
  root: (playerId: number) => ['player', playerId] as const,
  leaguePercentiles: (playerId: number, params: { game_year: number; role: LeaguePercentilesApiRole }) =>
    ['player', playerId, 'league-percentiles', params] as const,
  jawsExpanded: (playerId: number, params: { role: JawsExpandedApiRole }) =>
    ['player', playerId, 'jaws-expanded', params] as const,
};

async function parseJsonOrThrow<T>(r: Response): Promise<T> {
  try {
    return (await r.json()) as T;
  } catch {
    throw new HttpError('Invalid JSON response', r.status || 500);
  }
}

export async function fetchLeaguePercentiles(
  playerId: number,
  game_year: number,
  role: LeaguePercentilesApiRole,
): Promise<LeaguePercentilesResponse> {
  const qs = new URLSearchParams({ game_year: String(game_year), role });
  const r = await fetch(`/api/players/${playerId}/league-percentiles?${qs.toString()}`);
  const j = await parseJsonOrThrow<LeaguePercentilesResponse & { error?: string }>(r);
  if (!r.ok) {
    throw new HttpError(String(j.error ?? (r.statusText || 'Request failed')), r.status);
  }
  if (j.error) {
    throw new HttpError(String(j.error), 400);
  }
  return j;
}

export async function fetchJawsExpanded(
  playerId: number,
  role: JawsExpandedApiRole,
): Promise<JawsExpandedWirePayload> {
  const qs = new URLSearchParams({ role });
  const r = await fetch(`/api/players/${playerId}/jaws-expanded?${qs.toString()}`);
  const j = await parseJsonOrThrow<JawsExpandedWirePayload & { error?: string }>(r);
  if (!r.ok) {
    throw new HttpError(typeof j.error === 'string' ? j.error : 'Failed to load JAWS', r.status);
  }
  return j;
}

export function useLeaguePercentilesQuery(opts: {
  playerId: number;
  gameYear: number;
  role: LeaguePercentilesApiRole;
  enabled?: boolean;
}) {
  const { playerId, gameYear, role, enabled = true } = opts;
  const params = { game_year: gameYear, role };
  return useQuery({
    queryKey: playerKeys.leaguePercentiles(playerId, params),
    queryFn: () => fetchLeaguePercentiles(playerId, gameYear, role),
    enabled: enabled && Number.isFinite(playerId) && playerId > 0 && Number.isFinite(gameYear),
  });
}

export function useJawsExpandedQuery(opts: {
  playerId: number;
  fgRole: JawsExpandedApiRole;
  enabled?: boolean;
}) {
  const { playerId, fgRole, enabled = true } = opts;
  const params = { role: fgRole };
  return useQuery({
    queryKey: playerKeys.jawsExpanded(playerId, params),
    queryFn: () => fetchJawsExpanded(playerId, fgRole),
    enabled: enabled && Number.isFinite(playerId) && playerId > 0,
  });
}
