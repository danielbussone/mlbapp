export type OutfieldAnchor = 'LF' | 'CF' | 'RF';

/** Approximate standing spot on the 100×100 field graphic (y grows down; home ≈ bottom center). */
const ANCHORS: Record<OutfieldAnchor, { x: number; y: number }> = {
  LF: { x: 28, y: 44 },
  CF: { x: 50, y: 28 },
  RF: { x: 72, y: 44 },
};

const HOME: { x: number; y: number } = { x: 50, y: 86 };

/** Wedge center order: back → … → back_left (60° steps in fielder frame). */
const SLICE_SUFFIX_TO_I: Record<string, number> = {
  back: 0,
  back_right: 1,
  in_right: 2,
  in: 3,
  in_left: 4,
  back_left: 5,
};

const SLICE_LABEL: Record<string, string> = {
  back: 'Back',
  back_left: 'Back left',
  back_right: 'Back right',
  in: 'In',
  in_left: 'In left',
  in_right: 'In right',
};

function norm2(x: number, y: number): { x: number; y: number } {
  const h = Math.hypot(x, y) || 1;
  return { x: x / h, y: y / h };
}

/** Unit “toward home” and “to fielder’s right” from anchor; SVG y-down. */
function fielderBasis(anchor: OutfieldAnchor): { inW: { x: number; y: number }; rightW: { x: number; y: number } } {
  const a = ANCHORS[anchor];
  const inW = norm2(HOME.x - a.x, HOME.y - a.y);
  /** Right = rotate “in” −90° in math CCW → (iny, -inx) in y-down screen. */
  const rightW = norm2(inW.y, -inW.x);
  return { inW, rightW };
}

/**
 * Direction (unit) for Savant directional slice, in field SVG coordinates.
 * Slices are 60° apart in the plane: back, back_right, …, back_left around the fielder.
 */
export function sliceDirectionForAnchor(anchor: OutfieldAnchor, sliceSuffix: string): { x: number; y: number } | null {
  const i = SLICE_SUFFIX_TO_I[sliceSuffix];
  if (i == null) return null;
  const { inW, rightW } = fielderBasis(anchor);
  const backW = { x: -inW.x, y: -inW.y };
  const a = (i * Math.PI) / 3;
  const x = backW.x * Math.cos(a) + rightW.x * Math.sin(a);
  const y = backW.y * Math.cos(a) + rightW.y * Math.sin(a);
  return norm2(x, y);
}

export function anchorCoords(anchor: OutfieldAnchor): { x: number; y: number } {
  return ANCHORS[anchor];
}

export function sliceHumanLabel(sliceSuffix: string): string {
  return SLICE_LABEL[sliceSuffix] ?? sliceSuffix;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Absolute OAA at slice ends of the directional color ramp (deep blue … deep red). */
export const OAA_DIRECTIONAL_GRAD_EXTENT = 6;

/** Deep blue (−extent) → neutral (0) → deep red (+extent); clamps outside ±extent. */
const GRAD_BLUE = { r: 13, g: 71, b: 161 }; // #0d47a1
const GRAD_NEUTRAL = { r: 189, g: 189, b: 189 };
const GRAD_RED = { r: 183, g: 28, b: 28 }; // #b71c1c

export function oaaGradientFill(oaa: number | null): { fill: string; textFill: string } {
  if (oaa == null) return { fill: 'hsl(40 10% 88%)', textFill: '#212121' };
  const e = OAA_DIRECTIONAL_GRAD_EXTENT;
  let r: number;
  let g: number;
  let b: number;
  if (oaa <= 0) {
    const u = Math.max(0, Math.min(1, (oaa + e) / e));
    r = Math.round(lerp(GRAD_BLUE.r, GRAD_NEUTRAL.r, u));
    g = Math.round(lerp(GRAD_BLUE.g, GRAD_NEUTRAL.g, u));
    b = Math.round(lerp(GRAD_BLUE.b, GRAD_NEUTRAL.b, u));
  } else {
    const u = Math.max(0, Math.min(1, oaa / e));
    r = Math.round(lerp(GRAD_NEUTRAL.r, GRAD_RED.r, u));
    g = Math.round(lerp(GRAD_NEUTRAL.g, GRAD_RED.g, u));
    b = Math.round(lerp(GRAD_NEUTRAL.b, GRAD_RED.b, u));
  }
  const fill = `rgb(${r},${g},${b})`;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const textFill = lum > 145 ? '#1a1a1a' : '#fafafa';
  return { fill, textFill };
}

/** HSL fill + label color for non-directional cell grid (red &gt; 0, grey = 0, blue &lt; 0, warm grey = null). */
export function oaaSliceFill(oaa: number | null): { fill: string; textFill: string } {
  const ink = '#212121';
  if (oaa == null) return { fill: 'hsl(40 8% 88%)', textFill: ink };
  if (oaa === 0) return { fill: 'hsl(0 0% 86%)', textFill: ink };
  const hue = oaa > 0 ? 0 : 220;
  const sat = Math.min(90, 30 + Math.abs(oaa) * 12);
  return { fill: `hsl(${hue} ${sat}% 88%)`, textFill: ink };
}

/**
 * SVG path for one 60° pie wedge centered at (cx, cy), opening toward `thetaMid` (radians, atan2 dy, dx).
 */
/** @param halfSpanRad half-angle of wedge (default 30° = Savant OF six-slice). Use π/4 for 90° quadrants (infield). */
export function wedgePath(cx: number, cy: number, r: number, thetaMid: number, halfSpanRad: number = Math.PI / 6): string {
  const half = halfSpanRad;
  const t1 = thetaMid - half;
  const t2 = thetaMid + half;
  const x1 = cx + r * Math.cos(t1);
  const y1 = cy + r * Math.sin(t1);
  const x2 = cx + r * Math.cos(t2);
  const y2 = cy + r * Math.sin(t2);
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`;
}

/** Compact OAA for inside slice markers (at most one decimal). */
export function formatOaaInMark(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
