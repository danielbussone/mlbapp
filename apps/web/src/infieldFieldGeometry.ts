/**
 * Infield landmarks in **100×100** SVG user space (same as spray / OAA / FRV field art; y increases downward).
 *
 * The white chalk diamond on `spray/dodger-stadium-dimensions.png` is **smaller and pulled toward home** than a
 * perfect square with vertices at ±24 px from home on the diagonals. **`DIAMOND_SCALE`** nudges 1B / 2B / 3B onto
 * those corners (tweak if the asset is replaced).
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const HOME_X = 50;
const HOME_Y = 86;
/** Scale 0–1: shrink from legacy textbook square (24, 24, 48 deltas) toward home to match the PNG diamond. */
export const INFIELD_DIAMOND_SCALE = 0.6 as const;
const DIAMOND_SCALE = INFIELD_DIAMOND_SCALE;
const DX = 24 * DIAMOND_SCALE;
const DY = 24 * DIAMOND_SCALE;

export const INFIELD_100 = {
  home: { x: HOME_X, y: HOME_Y },
  /** 1B bag — right corner of the white diamond. */
  firstBag: { x: HOME_X + DX, y: HOME_Y - DY },
  /** 2B bag — top corner (toward CF). */
  secondBag: { x: HOME_X, y: HOME_Y - 2 * DY },
  /** 3B bag — left corner. */
  thirdBag: { x: HOME_X - DX, y: HOME_Y - DY },
} as const;

const { firstBag, secondBag, thirdBag } = INFIELD_100;

/** Shortstop: between 2B and 3B, biased toward 2B (hole shaded toward second base). */
export const ssFieldPosition = {
  x: lerp(lerp(secondBag.x, thirdBag.x, 0.5), secondBag.x, 0.45),
  y: lerp(lerp(secondBag.y, thirdBag.y, 0.5), secondBag.y, 0.45),
} as const;

/** Second baseman: between 2B and 1B, biased toward 2B. */
export const secondBasemanFieldPosition = {
  x: lerp(lerp(secondBag.x, firstBag.x, 0.5), secondBag.x, 0.45),
  y: lerp(lerp(secondBag.y, firstBag.y, 0.5), secondBag.y, 0.45),
} as const;

/**
 * Infield OAA mini-pie anchors: **1B** / **3B** on the bags, **2B** at the second-baseman hole (2B–1B), **SS** at
 * the shortstop hole (2B–3B). The chart renders **one** anchor matching FanGraphs primary IF innings (`ifMiniPieAnchorFromFg`).
 */
export const IF_OAA_MINI_PIE_ANCHORS = [
  { id: '1b', cx: firstBag.x, cy: firstBag.y, label: '1B' },
  { id: '2b', cx: secondBasemanFieldPosition.x, cy: secondBasemanFieldPosition.y, label: '2B' },
  { id: '3b', cx: thirdBag.x, cy: thirdBag.y, label: '3B' },
  { id: 'ss', cx: ssFieldPosition.x, cy: ssFieldPosition.y, label: 'SS' },
] as const;

export type IfMiniPieAnchorId = (typeof IF_OAA_MINI_PIE_ANCHORS)[number]['id'];

/** Map FG primary (1B–SS by innings) to the SVG anchor for the single mini-pie. Default **SS** when unknown. */
export function ifMiniPieAnchorFromFg(pos: '1B' | '2B' | '3B' | 'SS' | null | undefined): IfMiniPieAnchorId {
  if (pos === '1B') return '1b';
  if (pos === '2B') return '2b';
  if (pos === '3B') return '3b';
  return 'ss';
}
