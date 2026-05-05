import { useQuery } from '@tanstack/react-query';
import { HttpError } from '@/api/queryClient.js';

export const compareKeys = {
  fgCareer: (playerIds: readonly [number, number], season: number | null | undefined) =>
    ['compare', 'fg-career', playerIds[0], playerIds[1], season ?? 'none'] as const,
  statcastSummary: (
    playerIds: readonly [number, number],
    params: { role: 'pitcher' | 'batter'; gameYear: number },
  ) => ['compare', 'statcast-summary', playerIds[0], playerIds[1], params.role, params.gameYear] as const,
};

export async function fetchCompareFgCareer(
  playerIds: readonly [number, number],
  season?: number | null,
): Promise<Record<string, unknown>> {
  const q = new URLSearchParams({ player_ids: `${playerIds[0]},${playerIds[1]}` });
  if (season != null && season > 0) {
    q.set('season', String(season));
  }
  const r = await fetch(`/api/players/compare/fg-career?${q}`);
  const j = (await r.json()) as Record<string, unknown> & { error?: string };
  if (!r.ok) {
    throw new HttpError(String(j.error ?? (r.statusText || 'Request failed')), r.status);
  }
  return j;
}

export async function fetchCompareStatcastSummary(
  playerIds: readonly [number, number],
  params: { role: 'pitcher' | 'batter'; gameYear: number },
): Promise<Record<string, unknown>> {
  const q = new URLSearchParams({
    player_ids: `${playerIds[0]},${playerIds[1]}`,
    role: params.role,
    game_year: String(params.gameYear),
  });
  const r = await fetch(`/api/players/compare/statcast-summary?${q}`);
  const j = (await r.json()) as Record<string, unknown> & { error?: string };
  if (!r.ok) {
    throw new HttpError(String(j.error ?? (r.statusText || 'Request failed')), r.status);
  }
  return j;
}

export function useCompareFgCareerQuery(opts: {
  playerIds: readonly [number, number] | null;
  season?: number | null;
  enabled?: boolean;
}) {
  const { playerIds, season, enabled = true } = opts;
  const ok =
    enabled &&
    playerIds != null &&
    playerIds[0] > 0 &&
    playerIds[1] > 0 &&
    Number.isFinite(playerIds[0]) &&
    Number.isFinite(playerIds[1]);
  return useQuery({
    queryKey: playerIds != null ? compareKeys.fgCareer(playerIds, season) : ['compare', 'fg-career', 'invalid'],
    queryFn: () => fetchCompareFgCareer(playerIds!, season),
    enabled: ok,
  });
}

export function useCompareStatcastSummaryQuery(opts: {
  playerIds: readonly [number, number] | null;
  role: 'pitcher' | 'batter';
  gameYear: number;
  enabled?: boolean;
}) {
  const { playerIds, role, gameYear, enabled = true } = opts;
  const ok =
    enabled &&
    playerIds != null &&
    playerIds[0] > 0 &&
    playerIds[1] > 0 &&
    Number.isFinite(gameYear);
  return useQuery({
    queryKey:
      playerIds != null
        ? compareKeys.statcastSummary(playerIds, { role, gameYear })
        : ['compare', 'statcast-summary', 'invalid'],
    queryFn: () => fetchCompareStatcastSummary(playerIds!, { role, gameYear }),
    enabled: ok,
  });
}
