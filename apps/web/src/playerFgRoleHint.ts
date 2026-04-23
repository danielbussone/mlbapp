import { normalizeFgCardPayload, type FgBattingCardApi } from './batterFgTables.js';
import { fetchJsonDedupe } from './fetchJsonDedupe.js';

type FgRoleHintResponse = { batting?: unknown; pitching?: unknown };

/**
 * Single request: two career-only FanGraphs aggregates (no consolidated season scan).
 * Deduplicates concurrent callers (e.g. Strict Mode + future shared use).
 */
export async function fetchFgRoleHint(playerId: number): Promise<{ batting: FgBattingCardApi; pitching: FgBattingCardApi }> {
  const raw = (await fetchJsonDedupe(`/api/players/${playerId}/fg-card-role-hint`)) as FgRoleHintResponse;
  return {
    batting: normalizeFgCardPayload(raw?.batting),
    pitching: normalizeFgCardPayload(raw?.pitching),
  };
}
