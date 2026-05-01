import { fgCardHasAnyRows, type FgBattingCardApi } from '@/lib/batterFgTables.js';

export type InferredCardRole = 'batting' | 'pitching' | 'fielding';

function nn(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Guess batting vs pitching (vs fielding-only) tab from FanGraphs **career** rows (cheap `last_seasons=1` fetches still include career).
 * Heuristic only — URL / user toggle always wins when set explicitly.
 */
export function inferPrimaryCardRole(bat: FgBattingCardApi, pit: FgBattingCardApi): InferredCardRole {
  const hasB = fgCardHasAnyRows(bat);
  const hasP = fgCardHasAnyRows(pit);
  if (!hasB && !hasP) return 'fielding';
  if (!hasB && hasP) return 'pitching';
  if (hasB && !hasP) return 'batting';

  const bc = bat.career;
  const pc = pit.career;
  const pa = nn(bc?.career_pa);
  const ipOuts = nn(pc?.career_ip_outs);
  const gs = nn(pc?.career_games_started);
  const batWar = nn(bc?.career_war);
  const pitWar = nn(pc?.career_war);
  const inningsApprox = ipOuts / 3;

  if (gs >= 30 && pa < 150) return 'pitching';
  if (ipOuts >= 400 && pa < 120) return 'pitching';

  if (pa >= 500 && gs < 8 && ipOuts < 50) return 'batting';
  if (pa >= 200 && inningsApprox < 15 && gs < 3) return 'batting';

  if (pa >= 250 && inningsApprox >= 80) {
    return pitWar >= batWar ? 'pitching' : 'batting';
  }

  if (inningsApprox > Math.max(pa * 0.12, 40) && gs >= 5) return 'pitching';
  return 'batting';
}
