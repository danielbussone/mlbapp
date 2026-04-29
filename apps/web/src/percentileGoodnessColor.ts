import type { LeaguePercentilesResponse, PercentileSlot } from './leaguePercentilesTypes.js';

/** 1st / low → blue, 50th → grey, 99th / high → red (matches `LeaguePercentilesPanel` slider rail). */
const SLIDER_BLUE = { r: 21, g: 101, b: 192 };
const SLIDER_GREY = { r: 158, g: 158, b: 158 };
const SLIDER_RED = { r: 198, g: 40, b: 40 };

function lerpByte(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Slider thumb / dial fill for goodness-oriented percentile `dp` in 0–100. */
export function thumbColorForGoodnessPercentile(dp: number): string {
  const t = Math.min(100, Math.max(0, dp)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 0.5) {
    const u = t / 0.5;
    r = lerpByte(SLIDER_BLUE.r, SLIDER_GREY.r, u);
    g = lerpByte(SLIDER_BLUE.g, SLIDER_GREY.g, u);
    b = lerpByte(SLIDER_BLUE.b, SLIDER_GREY.b, u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = lerpByte(SLIDER_GREY.r, SLIDER_RED.r, u);
    g = lerpByte(SLIDER_GREY.g, SLIDER_RED.g, u);
    b = lerpByte(SLIDER_GREY.b, SLIDER_RED.b, u);
  }
  return `rgb(${r},${g},${b})`;
}

/** Same mapping as `LeaguePercentilesPanel` `displayPercentile`. */
export function goodnessDisplayPercentile(slot: PercentileSlot): number | null {
  const p = slot.p;
  if (p == null || !Number.isFinite(p)) return null;
  const dir = slot.direction ?? 'higher_better';
  return dir === 'lower_better' ? 100 - p : p;
}

/** Primary defensive spot key used for `fielding_percentile_groups.position_key` OAA percentile lookup. */
export type FieldingOaaPrimaryPos = 'LF' | 'CF' | 'RF' | '1B' | '2B' | '3B' | 'SS';

/**
 * Goodness-oriented 0–100 position for OAA vs league (`pos_oaa`), for the primary fielding spot when available,
 * else TOTAL / flat fielding payload.
 */
export function fieldingOaaGoodnessDp(
  data: LeaguePercentilesResponse | null,
  primaryFielding: FieldingOaaPrimaryPos
): number | null {
  if (!data?.percentiles_available || data.role !== 'fielding') return null;

  const fromSlots = (slots: Record<string, PercentileSlot> | undefined): number | null => {
    const slot = slots?.pos_oaa;
    if (!slot) return null;
    return goodnessDisplayPercentile(slot);
  };

  const groups = data.fielding_percentile_groups;
  if (groups?.length) {
    const posG = groups.find((g) => g.position_key === primaryFielding);
    const fromPos = fromSlots(posG?.percentiles);
    if (fromPos != null) return fromPos;
    const tot = groups.find((g) => g.position_key === 'TOTAL');
    const fromTotal = fromSlots(tot?.percentiles);
    if (fromTotal != null) return fromTotal;
  }
  return fromSlots(data.savant_fielding ?? data.percentiles);
}
