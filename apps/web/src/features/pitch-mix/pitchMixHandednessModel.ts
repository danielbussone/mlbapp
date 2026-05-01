/** Shared L/R vs-batter usage helpers for pitch-mix UI. */

export type HandednessRow = {
  pitch_type: string;
  L: number;
  R: number;
  total: number;
};

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normPt(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * Horizontal usage bar length (px).
 * Shares that **round to 1%** in the UI (`toFixed(0)`) use the same width as **2%** so the bar matches
 * the “good” 2% look; all other positive % stay proportional.
 *
 * Call sites must render widths as explicit `"${n}px"` strings in MUI `sx`: bare numeric `width` values
 * in `(0, 1)` are treated as **fractions of the parent width** (e.g. `0.98` → 98% wide), not sub‑pixel
 * lengths — so a ~1px bar becomes a full‑track slab.
 */
export function handednessSideBarPx(pct: number, trackPx: number): number {
  if (!Number.isFinite(pct) || !Number.isFinite(trackPx) || trackPx <= 0) return 0;
  const p = Math.min(100, Math.max(0, pct));
  if (!(p > 0)) return 0;
  const eff = Math.round(p) === 1 ? 2 : p;
  return Math.min(trackPx, (eff / 100) * trackPx);
}

/**
 * `border-radius: 999px` on a bar thinner than its height renders like a ~height-wide capsule,
 * which makes 1% look as wide as ~10%. Cap radius when the bar is narrow.
 */
export function handednessUsageBarRadiusPx(barW: number, barH: number): number | string {
  if (!(barW > 0) || !(barH > 0)) return 0;
  if (barW >= barH) return '999px';
  return Math.max(1, Math.min(4, barW / 2));
}

export function mixUsagePct(row: Record<string, unknown>): number {
  const raw = row.pct;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number.parseFloat(raw.trim().replace(/%$/, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Map pitch_type → L% / R% from `mix_extended_by_stand` rows. */
export function handednessLrMap(byStandRows: Record<string, unknown>[]): Map<string, { L: number; R: number }> {
  const lr = new Map<string, { L: number; R: number }>();
  for (const r of byStandRows) {
    const pt = normPt(String(r.pitch_type ?? ''));
    if (!pt) continue;
    const st = String(r.batter_stand ?? '').toUpperCase();
    if (st !== 'L' && st !== 'R') continue;
    const pct = num(r.pct);
    if (pct == null) continue;
    let o = lr.get(pt);
    if (!o) {
      o = { L: 0, R: 0 };
      lr.set(pt, o);
    }
    if (st === 'L') o.L = pct;
    else o.R = pct;
  }
  return lr;
}

/** One row per `mix` row order; `total` from mix %; L/R from map or 0. */
export function handednessRowsForMixOrder(
  mix: Record<string, unknown>[],
  byStandRows: Record<string, unknown>[]
): HandednessRow[] {
  if (!byStandRows.length) return [];
  const lr = handednessLrMap(byStandRows);
  return mix.map((row) => {
    const pt = normPt(String(row.pitch_type ?? ''));
    const side = lr.get(pt);
    return {
      pitch_type: pt,
      /** No `mix_extended_by_stand` row for this side → 0 bar segment (not "0% observed"). */
      L: side?.L ?? 0,
      R: side?.R ?? 0,
      total: mixUsagePct(row),
    };
  });
}

/** Sort by overall usage descending (supplemental full-width plot). */
export function handednessRowsSortedByTotal(
  overallMixRows: Record<string, unknown>[],
  byStandRows: Record<string, unknown>[]
): HandednessRow[] {
  if (!byStandRows.length) return [];
  const lr = handednessLrMap(byStandRows);
  const order = [...overallMixRows]
    .map((r) => ({
      pitch_type: normPt(String(r.pitch_type ?? '')),
      total: mixUsagePct(r),
    }))
    .filter((x) => x.pitch_type)
    .sort((a, b) => b.total - a.total);
  const out: HandednessRow[] = [];
  for (const { pitch_type, total } of order) {
    const side = lr.get(pitch_type);
    if (!side) continue;
    out.push({ pitch_type, L: side.L, R: side.R, total });
  }
  return out;
}
