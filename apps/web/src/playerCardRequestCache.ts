import type { FgBattingCardApi } from './batterFgTables.js';
import type { StatcastSummaryPayload } from './statcastSummaryPayload.js';
import { parseStatcastSummaryPayload } from './statcastSummaryPayload.js';

/** Matches API player JSON cached by `PlayerCardPanel` (avoids importing the panel). */
export type CachedPlayerRow = {
  player_id: number;
  key_mlbam: number | null;
  name_first: string;
  name_last: string;
  birth_date?: string | null;
  externals?: Array<{ id_system: string; id_value: string }>;
};

const MAX_ENTRIES = 64;
const store = new Map<string, unknown>();

function touchGet(key: string): unknown | undefined {
  if (!store.has(key)) return undefined;
  const v = store.get(key);
  store.delete(key);
  store.set(key, v);
  return v;
}

function put(key: string, value: unknown): void {
  store.delete(key);
  store.set(key, value);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function playerCardPlayerKey(playerId: number): string {
  return `player:${playerId}`;
}

/** FG card payload does not depend on selected Statcast/card season — key by player only. */
export function playerCardFgBattingKey(playerId: number): string {
  return `fgBat:${playerId}`;
}

export function playerCardFgPitchingKey(playerId: number): string {
  return `fgPitch:${playerId}`;
}

export function playerCardStatcastKey(
  playerId: number,
  role: 'batting' | 'pitching',
  season: number
): string {
  return `sc:${playerId}:${role}:${season}`;
}

export function getCachedPlayer(playerId: number): CachedPlayerRow | undefined {
  const v = touchGet(playerCardPlayerKey(playerId));
  return v !== undefined ? (v as CachedPlayerRow) : undefined;
}

export function setCachedPlayer(playerId: number, row: CachedPlayerRow): void {
  put(playerCardPlayerKey(playerId), row);
}

export function getCachedFgBatting(playerId: number): FgBattingCardApi | undefined {
  const v = touchGet(playerCardFgBattingKey(playerId));
  return v !== undefined ? (v as FgBattingCardApi) : undefined;
}

export function setCachedFgBatting(playerId: number, card: FgBattingCardApi): void {
  put(playerCardFgBattingKey(playerId), card);
}

export function getCachedFgPitching(playerId: number): FgBattingCardApi | undefined {
  const v = touchGet(playerCardFgPitchingKey(playerId));
  return v !== undefined ? (v as FgBattingCardApi) : undefined;
}

export function setCachedFgPitching(playerId: number, card: FgBattingCardApi): void {
  put(playerCardFgPitchingKey(playerId), card);
}

export function getCachedStatcast(
  playerId: number,
  role: 'batting' | 'pitching',
  season: number
): StatcastSummaryPayload | undefined {
  const v = touchGet(playerCardStatcastKey(playerId, role, season));
  if (v === undefined) return undefined;
  const parsed = parseStatcastSummaryPayload(v);
  return parsed.ok ? parsed.value : undefined;
}

export function setCachedStatcast(
  playerId: number,
  role: 'batting' | 'pitching',
  season: number,
  payload: StatcastSummaryPayload
): void {
  put(playerCardStatcastKey(playerId, role, season), payload);
}
