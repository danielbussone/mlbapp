/** Shared Statcast velo-bin parsing for histogram + pitch-mix table. */

export type VeloBin = { mph: number; c: number };

export type VeloDistributionModel = {
  byType: Map<string, VeloBin[]>;
  mphMin: number;
  mphMax: number;
  maxCount: number;
};

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** 1 mph bins per pitch_type from API `velo_dist` rows. */
export function aggregateVeloBins(rows: Record<string, unknown>[] | undefined): VeloDistributionModel {
  const m = new Map<string, VeloBin[]>();
  if (!rows?.length) {
    return { byType: m, mphMin: 80, mphMax: 100, maxCount: 1 };
  }
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const pt = String(r.pitch_type ?? '');
    const mph = num(r.mph_floor);
    const c = num(r.bin_count);
    if (!pt || c <= 0) continue;
    const arr = m.get(pt) ?? [];
    arr.push({ mph, c });
    m.set(pt, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.mph - b.mph);

  let lo = 999;
  let hi = 0;
  let mx = 1;
  for (const arr of m.values()) {
    for (const { mph, c } of arr) {
      lo = Math.min(lo, mph);
      hi = Math.max(hi, mph + 1);
      mx = Math.max(mx, c);
    }
  }
  if (lo > hi) return { byType: m, mphMin: 80, mphMax: 100, maxCount: 1 };
  return { byType: m, mphMin: lo, mphMax: hi + 1, maxCount: mx };
}
