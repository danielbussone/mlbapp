import { normPos } from './outfieldFieldingAgg.js';

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * FanGraphs fielding row with most **inn** among LF / CF / RF for the given season.
 * Ignores combined `OF` rows (only explicit LF/CF/RF splits count).
 * Tie-break: CF, then LF, then RF.
 */
export function primaryOutfieldByInnings(
  rows: Record<string, unknown>[],
  season: number
): 'LF' | 'CF' | 'RF' | null {
  const innByPos = new Map<'LF' | 'CF' | 'RF', number>();
  for (const r of rows) {
    if (Number(r.season) !== season) continue;
    const p = normPos(r.position);
    if (p !== 'LF' && p !== 'CF' && p !== 'RF') continue;
    const pos = p as 'LF' | 'CF' | 'RF';
    innByPos.set(pos, (innByPos.get(pos) ?? 0) + num(r.inn));
  }
  if (innByPos.size === 0) return null;
  const order: ('LF' | 'CF' | 'RF')[] = ['CF', 'LF', 'RF'];
  let best: 'LF' | 'CF' | 'RF' = 'CF';
  let bestInn = -1;
  for (const pos of ['LF', 'CF', 'RF'] as const) {
    const inn = innByPos.get(pos) ?? 0;
    if (inn > bestInn) {
      bestInn = inn;
      best = pos;
      continue;
    }
    if (inn === bestInn && inn > 0) {
      if (order.indexOf(pos) < order.indexOf(best)) best = pos;
    }
  }
  return bestInn > 0 ? best : null;
}

const IF_SPOTS = ['1B', '2B', '3B', 'SS'] as const;
type IfSpot = (typeof IF_SPOTS)[number];

/**
 * FanGraphs fielding row with most **inn** among 1B / 2B / 3B / SS for the given season.
 * Tie-break: SS, then 2B, 3B, 1B.
 */
export function primaryInfieldByInnings(
  rows: Record<string, unknown>[],
  season: number
): IfSpot | null {
  const innByPos = new Map<IfSpot, number>();
  for (const r of rows) {
    if (Number(r.season) !== season) continue;
    const p = normPos(r.position);
    if (p !== '1B' && p !== '2B' && p !== '3B' && p !== 'SS') continue;
    const pos = p as IfSpot;
    innByPos.set(pos, (innByPos.get(pos) ?? 0) + num(r.inn));
  }
  if (innByPos.size === 0) return null;
  const order: IfSpot[] = ['SS', '2B', '3B', '1B'];
  let best: IfSpot = 'SS';
  let bestInn = -1;
  for (const pos of IF_SPOTS) {
    const inn = innByPos.get(pos) ?? 0;
    if (inn > bestInn) {
      bestInn = inn;
      best = pos;
      continue;
    }
    if (inn === bestInn && inn > 0) {
      if (order.indexOf(pos) < order.indexOf(best)) best = pos;
    }
  }
  return bestInn > 0 ? best : null;
}

/** Innings on LF/CF/RF vs 1B/2B/3B/SS for directional-OAA family selection when both OF and IF cells exist. */
export function fieldingInningsOfVsIf(
  rows: Record<string, unknown>[],
  season: number
): { ofInn: number; ifInn: number } {
  let ofInn = 0;
  let ifInn = 0;
  for (const r of rows) {
    if (Number(r.season) !== season) continue;
    const p = normPos(r.position);
    if (p === 'LF' || p === 'CF' || p === 'RF') ofInn += num(r.inn);
    if (p === '1B' || p === '2B' || p === '3B' || p === 'SS') ifInn += num(r.inn);
  }
  return { ofInn, ifInn };
}
