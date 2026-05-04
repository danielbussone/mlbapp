import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LeaguePercentilesResponse } from '@/features/league-percentiles/leaguePercentilesTypes.js';
import type { PlayerRow } from '@/features/player-card/PlayerCardPanel.js';

/** Mirrors {@link CardRole} on `PlayerCardPanel` without importing the panel module at runtime. */
type PlayerCardTabRole = 'batting' | 'pitching' | 'fielding';
import type { JawsExpandedApiRole, JawsExpandedWirePayload } from '@/features/player-card/JawsExpandedBlock.js';
import { HttpError } from '@/api/queryClient.js';
import {
  FG_CARD_SEASON_ROW_LIMIT,
  normalizeFgCardPayload,
  type FgBattingCardApi,
} from '@/lib/batterFgTables.js';
import { parseStatcastSummaryPayload, type StatcastSummaryPayload } from '@/lib/statcastSummaryPayload.js';

export type LeaguePercentilesApiRole = 'batter' | 'pitcher' | 'fielding';

export const playerKeys = {
  root: (playerId: number) => ['player', playerId] as const,
  /** GET /api/players/:id */
  detail: (playerId: number) => ['player', playerId, 'detail'] as const,
  fgBattingCard: (playerId: number) =>
    ['player', playerId, 'fg-batting-card', { last_seasons: FG_CARD_SEASON_ROW_LIMIT }] as const,
  fgPitchingCard: (playerId: number) =>
    ['player', playerId, 'fg-pitching-card', { last_seasons: FG_CARD_SEASON_ROW_LIMIT }] as const,
  statcastSummary: (
    playerId: number,
    params: { role: 'batter' | 'pitcher'; game_year: number; limit: number },
  ) => ['player', playerId, 'statcast-summary', params] as const,
  leaguePercentiles: (playerId: number, params: { game_year: number; role: LeaguePercentilesApiRole }) =>
    ['player', playerId, 'league-percentiles', params] as const,
  jawsExpanded: (playerId: number, params: { role: JawsExpandedApiRole }) =>
    ['player', playerId, 'jaws-expanded', params] as const,
};

export async function parseJsonOrThrow<T>(r: Response): Promise<T> {
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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function fetchPlayerDetail(playerId: number): Promise<PlayerRow> {
  const r = await fetch(`/api/players/${playerId}`);
  const j = await parseJsonOrThrow<PlayerRow & { error?: string }>(r);
  if (!r.ok) {
    throw new HttpError(String(j.error ?? (r.statusText || 'Request failed')), r.status);
  }
  return j;
}

export async function fetchFgBattingCard(playerId: number): Promise<FgBattingCardApi> {
  const qs = new URLSearchParams({ last_seasons: String(FG_CARD_SEASON_ROW_LIMIT) });
  const r = await fetch(`/api/players/${playerId}/fg-batting-card?${qs.toString()}`);
  const j = await parseJsonOrThrow<FgBattingCardApi & { error?: string }>(r);
  if (!r.ok) {
    throw new HttpError(String(j.error ?? (r.statusText || 'FG batting card failed')), r.status);
  }
  return normalizeFgCardPayload(j);
}

export async function fetchFgPitchingCard(playerId: number): Promise<FgBattingCardApi> {
  const qs = new URLSearchParams({ last_seasons: String(FG_CARD_SEASON_ROW_LIMIT) });
  const r = await fetch(`/api/players/${playerId}/fg-pitching-card?${qs.toString()}`);
  const j = await parseJsonOrThrow<FgBattingCardApi & { error?: string }>(r);
  if (!r.ok) {
    throw new HttpError(String(j.error ?? (r.statusText || 'FG pitching card failed')), r.status);
  }
  return normalizeFgCardPayload(j);
}

export async function fetchStatcastSummary(
  playerId: number,
  params: { role: 'batter' | 'pitcher'; game_year: number; limit: number },
): Promise<StatcastSummaryPayload> {
  const scQ = new URLSearchParams({
    role: params.role,
    game_year: String(params.game_year),
    limit: String(params.limit),
  });
  const r = await fetch(`/api/players/${playerId}/statcast-summary?${scQ.toString()}`);
  const raw = await parseJsonOrThrow<unknown>(r);
  if (!r.ok) {
    const j = raw as { error?: string };
    throw new HttpError(String(j.error ?? (r.statusText || 'Statcast request failed')), r.status);
  }
  const scPayload = parseStatcastSummaryPayload(raw);
  if (!scPayload.ok) {
    throw new HttpError(`Statcast response invalid (${scPayload.error})`, 400);
  }
  return scPayload.value;
}

export function usePlayerCardCoreQueries(opts: { playerId: number; season: number; role: PlayerCardTabRole }) {
  const { playerId, season, role } = opts;
  const scRole: 'batter' | 'pitcher' = role === 'pitching' ? 'pitcher' : 'batter';
  const statLimit = scRole === 'batter' ? 8000 : 4000;

  const playerQ = useQuery({
    queryKey: playerKeys.detail(playerId),
    queryFn: () => fetchPlayerDetail(playerId),
    enabled: Number.isFinite(playerId) && playerId > 0,
  });

  const fgBatQ = useQuery({
    queryKey: playerKeys.fgBattingCard(playerId),
    queryFn: () => fetchFgBattingCard(playerId),
    enabled: Number.isFinite(playerId) && playerId > 0 && playerQ.isSuccess,
  });

  const fgPitQ = useQuery({
    queryKey: playerKeys.fgPitchingCard(playerId),
    queryFn: () => fetchFgPitchingCard(playerId),
    enabled: Number.isFinite(playerId) && playerId > 0 && playerQ.isSuccess,
  });

  const statcastQ = useQuery({
    queryKey: playerKeys.statcastSummary(playerId, {
      role: scRole,
      game_year: season,
      limit: statLimit,
    }),
    queryFn: () =>
      fetchStatcastSummary(playerId, { role: scRole, game_year: season, limit: statLimit }),
    enabled: Number.isFinite(playerId) && playerId > 0 && playerQ.isSuccess && role !== 'fielding',
  });

  const resourceError = useMemo(() => {
    const parts: string[] = [];
    if (playerQ.isError) parts.push(errMsg(playerQ.error));
    if (fgBatQ.isError) parts.push(errMsg(fgBatQ.error));
    if (fgPitQ.isError) parts.push(errMsg(fgPitQ.error));
    if (role !== 'fielding' && statcastQ.isError) parts.push(errMsg(statcastQ.error));
    return parts.length ? parts.join('; ') : null;
  }, [
    playerQ.isError,
    playerQ.error,
    fgBatQ.isError,
    fgBatQ.error,
    fgPitQ.isError,
    fgPitQ.error,
    statcastQ.isError,
    statcastQ.error,
    role,
  ]);

  const fetchingPlayer = playerQ.isLoading;
  const fetchingFg =
    playerQ.isSuccess &&
    (!fgBatQ.isFetched || !fgPitQ.isFetched || fgBatQ.isFetching || fgPitQ.isFetching);
  const fetchingSc = playerQ.isSuccess && role !== 'fielding' && statcastQ.isFetching;

  return {
    player: playerQ.data ?? null,
    fgBattingCard: fgBatQ.data ?? null,
    fgPitchingCard: fgPitQ.data ?? null,
    statcast: role === 'fielding' ? null : (statcastQ.data ?? null),
    fetchingPlayer,
    fetchingFg,
    fetchingSc,
    error: resourceError,
    playerQ,
    fgBatQ,
    fgPitQ,
    statcastQ,
  };
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
